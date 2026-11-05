// 游戏世界一侧的「营地会话」：唯一持有游戏状态的地方。
// - 每个角色对应一个 NpcBrain 实体；状态变化后立刻对齐实体（是否在场、认知 LOD）。
// - 夜谈：组装提示词和离线台词，作为 Intelligence Activity 提交；每帧 poll 事件，
//   边生成边把文字推给界面；只有通过校验的最终回复才会改动信任和心情。

import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { type ActivityId, createIntelligencePortClient, type IntelligenceService, type SessionRef } from '@forgeax/engine/intelligence';
import {
  NPC_COGNITIVE_LOD_AMBIENT,
  NPC_COGNITIVE_LOD_OFFSTAGE,
  NPC_COGNITIVE_LOD_SPOTLIGHT,
  NpcBrain,
} from '@forgeax/engine/npc';
import { applyTalk, buildPrompt, canTalk, scriptedReply, type TalkResult, type Topic, TOPICS } from '../hanyi/ai/dialogue.ts';
import {
  acceptBanter, acceptIntent, acceptOpener, adoptAll, adoptIntent, applyBanter, banterPair,
  buildBanterPrompt, buildIntentPrompt, buildOpenerPrompt, openChat,
} from '../hanyi/ai/intent.ts';
import { makeRng } from '../hanyi/core/rng.ts';
import type { GameState } from '../hanyi/core/types.ts';
import { act, ch, def, has, moodWord, nm, rel, relWord, trustWord } from '../hanyi/core/world.ts';
import { SKILLS, TASKS, TASK_ORDER } from '../hanyi/data/rules.ts';
import { cancelProject, choose, endDay, endNight, newGame, setTask, startProject, toNight } from '../hanyi/game.ts';
import { blocked } from '../hanyi/systems/work.ts';
import { memoriesOf } from '../hanyi/ai/memory.ts';
import { acceptReply, encodeEnvelope, replySoFar } from '../souls/envelope.ts';
import { TALK_LIMITS } from '../souls/providers.ts';
import { type Affordance, type Perception, SoulClient, charIdOf, soulIdOf } from '../souls/soul-client.ts';
import { type Act, CHANNEL, type ToEngine, type ToHost } from './protocol.ts';

/** 一个在等 AI 回复的请求 */
type Pending =
  | { kind: 'talk'; id: string; topic?: Topic; fallback: TalkResult; raw: string; shown: string }
  | { kind: 'intent'; id: string; day: number }
  | { kind: 'opener'; id: string; day: number }
  | { kind: 'banter'; a: string; b: string; day: number };

const OFFLINE = 'hanyi-offline';

export class CampSession {
  s: GameState;
  focus: string | null = null;
  readonly souls = new SoulClient();
  private world: World | null = null;
  private readonly entities = new Map<string, EntityHandle>();
  private intel: IntelligenceService | null = null;
  private provider = '未连接';
  private readonly pending = new Map<ActivityId, Pending>();
  private readonly sessions: Record<string, SessionRef> = {};
  private thinking: string | null = null;
  private note: string | null = null;

  constructor(private readonly out: (m: ToHost) => void, seed?: number) {
    this.s = newGame(seed);
  }

  // ───────────── 消息 ─────────────

  receive(msg: ToEngine, port?: MessagePort) {
    if (!msg || msg.channel !== CHANNEL) return;
    switch (msg.kind) {
      case 'hello': {
        const saved = msg.save ? safeParse(msg.save) : null;
        if (saved) this.s = saved;
        this.align();
        this.publish();
        this.think();
        break;
      }
      case 'act': this.publish(this.act(msg.act)); break;
      case 'talk': this.talk(msg.id, msg.topic, msg.text); break;
      case 'focus':
        this.focus = msg.id;
        if (msg.id) openChat(this.s, msg.id);
        this.align();
        this.publish();
        break;
      case 'intelligence':
        if (port) void this.connect(createClient(msg.providerId, port), msg.label);
        break;
    }
  }

  act(a: Act): { title: string; text: string } | null {
    const s = this.s;
    let outcome: { title: string; text: string } | null = null;
    switch (a.type) {
      case 'new': this.s = newGame(); this.focus = null; break;
      case 'endDay': endDay(s); break;
      case 'toNight': toNight(s); break;
      case 'endNight': endNight(s); this.focus = null; break;
      case 'choose': outcome = choose(s, a.i); break;
      case 'setTask': setTask(s, a.id, a.task); break;
      case 'policy':
        if (a.k === 'ration' && (a.v === 'normal' || a.v === 'half')) s.policy.ration = a.v;
        if (a.k === 'heat' && (a.v === 'normal' || a.v === 'save')) s.policy.heat = a.v;
        break;
      case 'build': startProject(s, a.id); break;
      case 'cancel': cancelProject(s); break;
      case 'adopt': if (a.id) adoptIntent(s, a.id); else adoptAll(s); break;
    }
    this.align();
    if (a.type === 'new' || a.type === 'endNight' || a.type === 'toNight') this.think();
    return outcome;
  }

  publish(outcome: { title: string; text: string } | null = null) {
    const sessions: Record<string, string> = {};
    for (const [id, ref] of Object.entries(this.sessions)) sessions[id] = ref.id;
    this.out({
      channel: CHANNEL,
      kind: 'state',
      state: this.s,
      souls: this.souls.view(),
      talk: { thinking: this.thinking, note: this.note, provider: this.provider, sessions },
      outcome,
    });
  }

  // ───────────── NpcBrain 实体 ─────────────

  attach(world: World) {
    this.world = world;
    this.align();
  }

  /** 让每个角色的 NpcBrain 与游戏状态一致：谁在场、谁正被聚光 */
  align() {
    const world = this.world;
    if (!world) return;
    const ids = new Set(this.s.chars.map((c) => c.id));
    for (const [id, e] of this.entities) {
      if (!ids.has(id)) {
        world.despawn(e).unwrap();
        this.entities.delete(id);
      }
    }
    for (const c of this.s.chars) {
      const enabled = c.status === 'active';
      const lod = !enabled ? NPC_COGNITIVE_LOD_OFFSTAGE
        : this.focus === c.id && this.s.phase === 'night' ? NPC_COGNITIVE_LOD_SPOTLIGHT
          : NPC_COGNITIVE_LOD_AMBIENT;
      const e = this.entities.get(c.id);
      if (e === undefined) {
        const spawned = world.spawn({
          component: NpcBrain,
          data: { soulId: soulIdOf(c.id), affordanceRef: 'camp', enabled, lod },
        }).unwrap();
        this.entities.set(c.id, spawned);
        continue;
      }
      const cur = world.get(e, NpcBrain);
      if (!cur.ok || cur.value.lod !== lod || cur.value.enabled !== enabled) {
        world.set(e, NpcBrain, { enabled, lod }).unwrap();
      }
    }
  }

  /** 灵魂「能做什么」：今天能接的活、能聊的话题、心事是否已经说出口 */
  affordances(soulId: string): Affordance[] {
    const c = ch(this.s, charIdOf(soulId));
    if (!c) return [];
    const out: Affordance[] = TASK_ORDER.filter((t) => !blocked(this.s, c, t)).map((t) => ({ id: `task:${t}`, kind: 'task', label: TASKS[t].name }));
    for (const t of TOPICS) out.push({ id: `talk:${t.id}`, kind: 'talk', label: t.label.replace('TA', def(c.id).gender === 'f' ? '她' : '他') });
    out.push({ id: 'secret', kind: 'secret', label: this.s.flags[`heard_${c.id}`] ? '心事已说出口' : `心事（信任 ${def(c.id).secretTrust} 才肯说）` });
    return out;
  }

  /** 一次感知：从游戏状态里取出这个角色此刻「看得到、感受得到」的东西 */
  perceive(soulId: string): Perception | undefined {
    const s = this.s;
    const c = ch(s, charIdOf(soulId));
    if (!c || c.status !== 'active') return undefined;
    const marks: string[] = [];
    if (c.injured) marks.push('有伤');
    if (c.sick) marks.push('发烧');
    if (c.hungerDays) marks.push(`饿了${c.hungerDays}天`);
    const best = (Object.keys(c.skills) as (keyof typeof SKILLS)[]).sort((a, b) => c.skills[b] - c.skills[a])[0];
    const ties = act(s)
      .filter((o) => o.id !== c.id)
      .map((o) => [o.id, rel(s, c.id, o.id)] as const)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3)
      .map(([id, r]) => `${nm(id)}${relWord(r)}`)
      .join('、');
    return {
      day: s.day,
      phase: s.phase,
      body: `健康 ${c.health} · 体力 ${c.stamina}${marks.length ? ' · ' + marks.join('、') : ''} · 最拿手：${SKILLS[best]}`,
      heart: `心情${moodWord(c.mood)}（${c.mood}）· 对你${trustWord(c.trust)}（${c.trust}）${has(c, 'mute') ? ' · 不说话' : ''}`,
      ties: ties || '营地里只剩自己',
      recent: memoriesOf(s, c.id).slice(-3).map((m) => `第${m.day}天：${m.text}`),
    };
  }

  // ───────────── 夜谈 ─────────────

  async connect(service: IntelligenceService, label: string) {
    const old = this.intel;
    this.intel = service;
    this.provider = label;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      if (p.kind === 'talk') this.finish(p, p.topic ? p.fallback : null, '换了 AI 提供方，这句改用台词回答。');
      else this.settle(p);
    }
    this.thoughtFor = '';
    this.publish();
    this.think();
    if (old && old !== service) await old.close().catch(() => undefined);
  }

  talk(id: string, topic?: Topic, text?: string) {
    const s = this.s;
    if (!canTalk(s, id) || this.thinking) return;
    const said = (text ?? TOPICS.find((t) => t.id === topic)?.ask ?? '').slice(0, 120);
    if (!said) return;
    const log = (s.chat[id] ??= []);
    const history = log.slice();
    log.push({ from: 'me', text: said });
    const rng = makeRng(s.rng);
    const fallback = scriptedReply(s, id, topic ?? 'chat', rng);
    s.rng = rng.state();
    this.focus = id;
    this.note = null;
    this.align();
    const p: Pending = { kind: 'talk', id, topic: topic ?? (text ? undefined : 'chat'), fallback, raw: '', shown: '' };
    if (!this.intel) {
      this.finish(p, fallback, null);
      return;
    }
    const submitted = this.intel.submit({
      input: encodeEnvelope({ v: 1, soul: soulIdOf(id), prompt: buildPrompt(s, id, history, said), fallback }),
      session: this.sessions[id],
    });
    if (!submitted.ok) {
      this.finish(p, p.topic ? fallback : null, `AI 没接这个请求（${submitted.error.code}）。`);
      return;
    }
    this.pending.set(submitted.value.id, p);
    this.thinking = id;
    this.publish();
  }

  /** 每帧调用：取出 AI 的新事件 */
  poll() {
    if (!this.intel) return;
    for (const ev of this.intel.poll()) {
      const p = this.pending.get(ev.activityId);
      if (!p) continue;
      if (p.kind !== 'talk') {
        if (ev.type === 'text-delta') continue;
        this.pending.delete(ev.activityId);
        if (ev.type === 'completed') this.land(p, ev.output);
        else this.settle(p);
        continue;
      }
      if (ev.type === 'text-delta') {
        p.raw += ev.text;
        const t = replySoFar(p.raw);
        if (t && t !== p.shown) {
          p.shown = t;
          this.out({ channel: CHANNEL, kind: 'stream', id: p.id, text: t });
        }
        continue;
      }
      this.pending.delete(ev.activityId);
      if (ev.type === 'completed') {
        this.sessions[p.id] = ev.session;
        const r = acceptReply(ev.output);
        this.finish(p, r ?? (p.topic ? p.fallback : null), r ? null : '回复格式不对，改用台词。');
      } else if (ev.type === 'failed') {
        this.finish(p, p.topic ? p.fallback : null, `AI 出错了（${ev.error.code}），${p.topic ? '改用台词。' : '这句没说出去。'}`);
      } else {
        this.finish(p, p.topic ? p.fallback : null, null);
      }
    }
  }

  // ───────────── 自主行动：自荐、主动开口、篝火对话 ─────────────

  private thoughtFor = '';

  private get thinksWithAI() {
    return !!this.intel && this.intel.providerId !== OFFLINE;
  }

  /** 按当前阶段，让在场的灵魂用 AI 想一想；离线时保留按性子推出来的结果 */
  think() {
    if (!this.thinksWithAI) return;
    const s = this.s;
    const key = `${s.day}:${s.phase}`;
    if (this.thoughtFor === key) return;
    this.thoughtFor = key;
    if (s.phase === 'day') {
      for (const c of act(s)) {
        if (this.souls.get(soulIdOf(c.id))?.lod === 'offstage') continue;
        const it = s.intents?.[c.id];
        if (!it || it.by === 'ai') continue;
        if (this.ask({ kind: 'intent', id: c.id, day: s.day }, buildIntentPrompt(s, c.id), c.id)) it.asking = true;
      }
    } else if (s.phase === 'night') {
      for (const [id, w] of Object.entries(s.wants ?? {})) {
        if (!w.done && w.by === 'rule') this.ask({ kind: 'opener', id, day: s.day }, buildOpenerPrompt(s, id, w), id);
      }
      const pair = banterPair(s, (s.rng % 1000) / 1000);
      if (pair) this.ask({ kind: 'banter', a: pair[0], b: pair[1], day: s.day }, buildBanterPrompt(s, pair[0], pair[1]), pair[0]);
    }
    this.publish();
  }

  private ask(p: Exclude<Pending, { kind: 'talk' }>, prompt: string, soul: string) {
    const r = this.intel!.submit({ input: encodeEnvelope({ v: 1, soul: soulIdOf(soul), prompt, fallback: null }) });
    if (!r.ok) return false;
    this.pending.set(r.value.id, p);
    return true;
  }

  /** AI 想好了：校验通过才采用，过期的（已经换了一天）直接丢掉 */
  private land(p: Exclude<Pending, { kind: 'talk' }>, output: string) {
    const s = this.s;
    if (p.day !== s.day) return;
    if (p.kind === 'intent') {
      const it = s.phase === 'day' ? acceptIntent(s, p.id, output) : null;
      if (it && s.intents) s.intents[p.id] = it;
      else this.settle(p);
    } else if (p.kind === 'opener') {
      const w = s.wants?.[p.id];
      const r = acceptOpener(output);
      if (w && !w.done && r) {
        w.opener = r.reply;
        w.by = 'ai';
        w.reveals = r.revealed;
      }
    } else {
      const r = s.phase === 'night' ? acceptBanter(output, p.a, p.b) : null;
      if (r && ch(s, p.a)?.status === 'active' && ch(s, p.b)?.status === 'active') applyBanter(s, p.a, p.b, r);
    }
    this.publish();
  }

  /** AI 没想出来：保留规则给的结果 */
  private settle(p: Exclude<Pending, { kind: 'talk' }>) {
    if (p.kind === 'intent') {
      const it = this.s.intents?.[p.id];
      if (it) it.asking = false;
    }
    this.publish();
  }

  private finish(p: Extract<Pending, { kind: 'talk' }>, r: TalkResult | null, note: string | null) {
    this.thinking = null;
    this.note = note;
    const s = this.s;
    const log = s.chat[p.id];
    if (ch(s, p.id) && log) {
      if (r && canTalk(s, p.id)) {
        applyTalk(s, p.id, r, { topic: p.topic ?? null, said: log[log.length - 1]?.from === 'me' ? log[log.length - 1].text : '' });
        log.push({ from: 'them', text: r.reply });
      } else if (!r && log[log.length - 1]?.from === 'me') {
        log.pop();
      }
    }
    this.publish();
  }
}

function safeParse(t: string): GameState | null {
  try {
    const g = JSON.parse(t);
    return g && g.v === 1 && Array.isArray(g.chars) ? g : null;
  } catch {
    return null;
  }
}

function createClient(providerId: string, port: MessagePort) {
  port.start?.();
  return createIntelligencePortClient(providerId, port, { limits: TALK_LIMITS });
}
