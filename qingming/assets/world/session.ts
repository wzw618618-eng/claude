// 游戏世界一侧的会话：唯一持有《青冥录》世界状态的地方。
// - 每个修士对应一个 NpcBrain 实体。和主角在同一处的是「在场」，正在和主角说话的是「聚光」，
//   其余的人「离场」：只跑规则，不花 AI 额度。
// - 四类 AI 请求都作为 Intelligence Activity 提交，每帧 poll：
//   年初定打算（decide）、自由对话（talk）、给规则的回答配台词（voice）、找上门时开口（encounter）。
// - 只有通过校验的结果才会改世界；过期的（换了一年、开了新局）直接丢掉；出错就用规则的结果。

import type { EntityHandle, World as EcsWorld } from '@forgeax/engine/ecs';
import { type ActivityId, createIntelligencePortClient, type IntelligenceService, type SessionRef } from '@forgeax/engine/intelligence';
import {
  NPC_COGNITIVE_LOD_AMBIENT,
  NPC_COGNITIVE_LOD_OFFSTAGE,
  NPC_COGNITIVE_LOD_SPOTLIGHT,
  NpcBrain,
} from '@forgeax/engine/npc';
import type { Npc, World } from '../game/core/types.ts';
import { lifeLeft, ME, newWorld, nm, placeName, realmText, type RootId } from '../game/core/world.ts';
import { goalText } from '../game/mind/goals.ts';
import { describe, feel } from '../game/mind/memory.ts';
import { buy, choose, doMain, endTurn, moveTo, retreat, type SocialKind, useItem } from '../game/player.ts';
import { acceptDecision, applyDecision, buildDecidePrompt, whoDecides, yearChoices } from '../game/ai/decide.ts';
import {
  acceptTalk, acceptVoice, allowedOffers, allowedReveals, answerOffer, applyTalk, askLine, buildEncounterPrompt, buildTalkPrompt, buildVoicePrompt,
  canTalk, pushChat, scriptedTalk, startLine, type TalkAllow, talkAllow, type TalkReply, topicTalk, VOICED_ENCOUNTERS, voiceEncounter,
} from '../game/ai/talk.ts';
import { type AskKind, encodeEnvelope, replySoFar } from '../souls/envelope.ts';
import { OFFLINE_PROVIDER, TALK_LIMITS } from '../souls/providers.ts';
import { type Affordance, type Perception, SoulClient, npcIdOf, soulIdOf } from '../souls/soul-client.ts';
import { type Act, type AiView, CHANNEL, type ToEngine, type ToHost } from './protocol.ts';

/** 一个在等 AI 的请求。gen 是第几局（开新局、读档都会换），y 是哪一年 */
type Pending =
  | { kind: 'talk'; gen: number; y: number; id: string; fallback: TalkReply; allow: TalkAllow; raw: string; shown: string }
  | { kind: 'voice'; gen: number; y: number; id: string; fallback: string; raw: string; shown: string }
  | { kind: 'decide'; gen: number; y: number; id: string }
  | { kind: 'encounter'; gen: number; y: number; id: string; eid: string };

type Spoken = Extract<Pending, { kind: 'talk' | 'voice' }>;
type Silent = Exclude<Pending, Spoken>;

export class WorldSession {
  w: World;
  focus: string | null = null;
  readonly souls = new SoulClient();
  private ecs: EcsWorld | null = null;
  private readonly entities = new Map<string, EntityHandle>();
  private intel: IntelligenceService | null = null;
  private provider = '未连接';
  private readonly pending = new Map<ActivityId, Pending>();
  private readonly sessions: Record<string, SessionRef> = {};
  private thinking: string | null = null;
  private note: string | null = null;
  private gen = 0;
  private thoughtFor = '';
  private decided: string[] = [];

  constructor(private readonly out: (m: ToHost) => void, seed?: number, opts?: { name?: string; root?: RootId; gender?: 'm' | 'f' }) {
    this.w = newWorld(seed, opts);
  }

  // ───────────── 消息 ─────────────

  receive(msg: ToEngine, port?: MessagePort) {
    if (!msg || msg.channel !== CHANNEL) return;
    switch (msg.kind) {
      case 'hello': {
        const saved = msg.save ? safeParse(msg.save) : null;
        if (saved) this.reset(saved);
        this.align();
        this.publish();
        this.think();
        break;
      }
      case 'act': this.publish(this.act(msg.act)); break;
      case 'social': this.social(msg.id, msg.topic, msg.arg); break;
      case 'talk': this.talk(msg.id, msg.text); break;
      case 'focus':
        this.focus = msg.id && this.w.people[msg.id]?.place === this.w.me.place ? msg.id : null;
        this.align();
        this.publish();
        break;
      case 'intelligence':
        if (port) void this.connect(createClient(msg.providerId, port), msg.label);
        break;
    }
  }

  private reset(w: World) {
    this.w = w;
    this.gen++;
    this.focus = null;
    this.thinking = null;
    this.decided = [];
    for (const k of Object.keys(this.sessions)) delete this.sessions[k];
  }

  act(a: Act): string | null {
    const w = this.w;
    const year = w.year;
    let outcome: string | null = null;
    switch (a.type) {
      case 'new': this.reset(newWorld(a.seed, { name: a.name, root: a.root, gender: a.gender })); break;
      case 'move':
        if (moveTo(w, a.place)) {
          this.focus = null;
          this.voiceEncounters();
        }
        break;
      case 'main': outcome = doMain(w, a.act) || null; break;
      case 'buy': outcome = buy(w, a.item); break;
      case 'use': outcome = useItem(w, a.item) || null; break;
      case 'choose': outcome = choose(w, a.i) || null; break;
      case 'offer': outcome = answerOffer(w, a.accept) || null; break;
      case 'endTurn': endTurn(w); break;
      case 'retreat': { const n = retreat(w, Math.max(1, Math.min(10, Math.floor(a.years)))); outcome = n ? `闭关${n}年。` : null; break; }
    }
    if (this.w.year !== year) this.focus = null;
    this.align();
    this.think();
    return outcome;
  }

  publish(outcome: string | null = null) {
    const sessions: Record<string, string> = {};
    for (const [id, ref] of Object.entries(this.sessions)) sessions[id] = ref.id;
    const ai: AiView = { thinking: this.thinking, note: this.note, provider: this.provider, online: this.thinksWithAI, sessions, decided: this.decided };
    this.out({ channel: CHANNEL, kind: 'state', world: this.w, souls: this.souls.view(), ai, outcome });
  }

  // ───────────── NpcBrain 实体 ─────────────

  attach(ecs: EcsWorld) {
    this.ecs = ecs;
    this.align();
  }

  /** 每个修士的 NpcBrain 与世界一致：活着才启用；和主角同处是在场，正说话的是聚光 */
  align() {
    const ecs = this.ecs;
    if (!ecs) return;
    const w = this.w;
    for (const [id, e] of this.entities) {
      if (w.people[id]) continue;
      ecs.despawn(e).unwrap();
      this.entities.delete(id);
    }
    for (const n of Object.values(w.people)) {
      const enabled = n.alive;
      const lod = !n.alive || n.place !== w.me.place ? NPC_COGNITIVE_LOD_OFFSTAGE
        : this.focus === n.id ? NPC_COGNITIVE_LOD_SPOTLIGHT
          : NPC_COGNITIVE_LOD_AMBIENT;
      const e = this.entities.get(n.id);
      if (e === undefined) {
        const spawned = ecs.spawn({ component: NpcBrain, data: { soulId: soulIdOf(n.id), affordanceRef: 'qingming', enabled, lod } }).unwrap();
        this.entities.set(n.id, spawned);
        continue;
      }
      const cur = ecs.get(e, NpcBrain);
      if (!cur.ok || cur.value.lod !== lod || cur.value.enabled !== enabled) ecs.set(e, NpcBrain, { enabled, lod }).unwrap();
    }
  }

  /** 灵魂「能做什么」：今年能选的事；在主角身边时，还有谈话里能提的事、能说出口的事 */
  affordances(soulId: string): Affordance[] {
    const w = this.w;
    const n = w.people[npcIdOf(soulId)];
    if (!n?.alive) return [];
    const out: Affordance[] = yearChoices(w, n).map((c) => ({ id: `plan:${c.id}`, kind: 'plan', label: c.label }));
    if (n.place === w.me.place) {
      for (const k of allowedOffers(w, n)) out.push({ id: `offer:${k}`, kind: 'offer', label: k });
      for (const k of allowedReveals(w, n)) out.push({ id: `reveal:${k}`, kind: 'reveal', label: k === 'goal' ? '真实打算' : `${nm(w, k.slice(7))}的秘密` });
    }
    return out;
  }

  /** 一次感知：这个人此刻眼里的自己、心里的事、在意的人、记得的事 */
  perceive(soulId: string): Perception | undefined {
    const w = this.w;
    const n = w.people[npcIdOf(soulId)];
    if (!n?.alive) return undefined;
    const o = n.mind.op[ME];
    const ties = Object.entries(n.mind.op)
      .filter(([id]) => id !== ME && w.people[id]?.alive)
      .sort((a, b) => Math.abs(b[1].aff) - Math.abs(a[1].aff))
      .slice(0, 3)
      .map(([id, x]) => `${nm(w, id)}${x.aff >= 0 ? '+' : ''}${x.aff}`)
      .join('、');
    const g = n.mind.goal;
    return {
      year: w.year,
      place: placeName(n.place),
      body: `${realmText(n)} · 伤势 ${100 - n.hp} · 寿元余 ${lifeLeft(n)} 年`,
      heart: `心情 ${n.mind.mood} · 对你${o ? `${feel(n)}（${o.aff}/${o.trust}/${o.fear}）` : '素不相识'}${g ? ` · ${g.secret ? '暗中' : ''}${goalText(w, g)}` : ''}`,
      ties: ties || '无人在意',
      recent: n.mind.mem.slice(-3).map((m) => `第${m.y}年：${describe(w, m, n.id)}`),
    };
  }

  // ───────────── 和人说话 ─────────────

  /** 自由对话 */
  talk(id: string, text: string) {
    const w = this.w;
    const n = w.people[id];
    const said = (text ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (this.thinking || !said || !n || !canTalk(w, id)) return;
    const allow = talkAllow(w, n);
    const prompt = buildTalkPrompt(w, n, said, allow);
    const fallback = scriptedTalk(w, n, said);
    startLine(w, id, said);
    this.focus = id;
    this.note = null;
    this.align();
    const p: Pending = { kind: 'talk', gen: this.gen, y: w.year, id, fallback, allow, raw: '', shown: '' };
    this.speak(p, 'talk', prompt, fallback);
  }

  /** 选项对话：规则先结算，接了大模型就让 AI 把规则的意思用这个人的口吻说出来 */
  social(id: string, topic: SocialKind, arg = '') {
    const w = this.w;
    if (this.thinking) return;
    const r = topicTalk(w, id, topic, arg);
    if (!r) return;
    this.focus = w.people[id]?.alive && w.people[id].place === w.me.place ? id : null;
    this.note = null;
    this.align();
    if (r.speech && this.thinksWithAI) {
      const n = w.people[id];
      const prompt = buildVoicePrompt(w, n, askLine(w, topic, arg), r.speech, r.honest);
      const p: Pending = { kind: 'voice', gen: this.gen, y: w.year, id, fallback: r.speech, raw: '', shown: '' };
      this.speak(p, 'voice', prompt, null);
      return;
    }
    if (r.speech) pushChat(w, id, 'them', r.speech);
    else if (r.result.text) pushChat(w, id, 'note', r.result.text);
    this.publish(r.speech ? null : r.result.text || null);
  }

  private speak(p: Spoken, ask: AskKind, prompt: string, fallback: unknown) {
    if (!this.intel) {
      this.finish(p, null, null);
      return;
    }
    const submitted = this.intel.submit({
      input: encodeEnvelope({ v: 1, soul: soulIdOf(p.id), ask, prompt, fallback }),
      session: p.kind === 'talk' ? this.sessions[p.id] : undefined,
    });
    if (!submitted.ok) {
      this.finish(p, null, `AI 没接这个请求（${submitted.error.code}），改用规则的回答。`);
      return;
    }
    this.pending.set(submitted.value.id, p);
    this.thinking = p.id;
    this.publish();
  }

  /** 说话的请求结束：校验通过就用 AI 的，否则用规则的 */
  private finish(p: Spoken, output: string | null, note: string | null) {
    this.thinking = null;
    this.note = note;
    const w = this.w;
    if (p.gen !== this.gen) { this.publish(); return; }
    if (p.kind === 'voice') {
      pushChat(w, p.id, 'them', (output !== null ? acceptVoice(output) : null) ?? p.fallback);
      this.publish();
      return;
    }
    const r = output !== null ? acceptTalk(output, p.allow) : null;
    if (output !== null && !r) this.note = '回复格式不对，改用规则的回答。';
    const reply = r ?? p.fallback;
    // 换了一年才回来的话，只记下说了什么，不再改看法
    if (p.y !== w.year || w.phase !== 'year') pushChat(w, p.id, 'them', reply.reply);
    else applyTalk(w, p.id, reply, p.allow);
    this.publish();
  }

  // ───────────── 年初定打算、找上门时开口 ─────────────

  private get thinksWithAI() {
    return !!this.intel && this.intel.providerId !== OFFLINE_PROVIDER;
  }

  /** 新的一年：主角身边的几个人用 AI 重新想今年做什么（每局每年只想一次；主角已经动身就不想了） */
  think() {
    const w = this.w;
    if (!this.thinksWithAI || w.phase !== 'year' || w.turn.moved) return;
    const key = `${this.gen}:${w.year}`;
    if (this.thoughtFor === key) return;
    this.thoughtFor = key;
    this.decided = [];
    for (const n of whoDecides(w, this.focus)) {
      if (this.ask({ kind: 'decide', gen: this.gen, y: w.year, id: n.id }, 'decide', buildDecidePrompt(w, n), n)) {
        n.plan.asking = true;
        this.decided.push(n.id);
      }
    }
    this.publish();
  }

  /** 到了地方，有人找上门：AI 替来人说开口那句话 */
  private voiceEncounters() {
    const w = this.w;
    if (!this.thinksWithAI) return;
    for (const e of w.pending) {
      if (!VOICED_ENCOUNTERS.includes(e.kind) || e.vars.say) continue;
      this.ask({ kind: 'encounter', gen: this.gen, y: w.year, id: e.who, eid: e.id }, 'encounter', buildEncounterPrompt(w, e), w.people[e.who]);
    }
  }

  private ask(p: Silent, ask: AskKind, prompt: string, n: Npc) {
    const r = this.intel!.submit({ input: encodeEnvelope({ v: 1, soul: soulIdOf(n.id), ask, prompt, fallback: null }) });
    if (!r.ok) return false;
    this.pending.set(r.value.id, p);
    return true;
  }

  /** AI 想好了：校验通过才采用。过期的丢掉；主角已经到了地方，就不许他凭空走掉 */
  private land(p: Silent, output: string) {
    const w = this.w;
    if (p.gen !== this.gen || p.y !== w.year || w.phase !== 'year') return;
    const n = w.people[p.id];
    if (p.kind === 'decide') {
      if (!n?.alive) return;
      n.plan.asking = false;
      const plan = acceptDecision(w, n, output);
      if (plan && (!w.turn.moved || plan.place === n.place)) applyDecision(w, n, plan);
      this.align();
    } else {
      const say = acceptVoice(output);
      if (say) voiceEncounter(w, p.eid, say);
    }
    this.publish();
  }

  /** AI 没想出来：保留规则的结果 */
  private settle(p: Silent) {
    if (p.kind === 'decide' && p.gen === this.gen) {
      const n = this.w.people[p.id];
      if (n) n.plan.asking = false;
    }
    this.publish();
  }

  // ───────────── AI 连接 ─────────────

  async connect(service: IntelligenceService, label: string) {
    const old = this.intel;
    this.intel = service;
    this.provider = label;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      if (p.kind === 'talk' || p.kind === 'voice') this.finish(p, null, '换了 AI 提供方，这句改用规则的回答。');
      else this.settle(p);
    }
    this.thoughtFor = '';
    this.publish();
    this.think();
    if (old && old !== service) await old.close().catch(() => undefined);
  }

  /** 每帧调用：取出 AI 的新事件 */
  poll() {
    if (!this.intel) return;
    for (const ev of this.intel.poll()) {
      const p = this.pending.get(ev.activityId);
      if (!p) continue;
      if (p.kind === 'decide' || p.kind === 'encounter') {
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
        if (p.kind === 'talk') this.sessions[p.id] = ev.session;
        this.finish(p, ev.output, null);
      } else if (ev.type === 'failed') {
        this.finish(p, null, `AI 出错了（${ev.error.code}），改用规则的回答。`);
      } else {
        this.finish(p, null, null);
      }
    }
  }

  /** 还有几个请求在等 AI（测试和界面用） */
  get waiting() {
    return this.pending.size;
  }
}

function safeParse(t: string): World | null {
  try {
    const w = JSON.parse(t);
    if (!(w && w.v === 1 && w.people && w.me && w.turn)) return null;
    // 第 1 阶段的存档没有谈话记录
    w.chat ??= {};
    w.turn.talk ??= {};
    w.offer ??= null;
    return w as World;
  } catch {
    return null;
  }
}

function createClient(providerId: string, port: MessagePort) {
  port.start?.();
  return createIntelligencePortClient(providerId, port, { limits: TALK_LIMITS });
}
