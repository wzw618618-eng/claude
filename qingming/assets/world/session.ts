// 游戏世界一侧的会话：唯一持有《青冥录》世界状态的地方。
// - 每个修士对应一个 NpcBrain 实体。认知 LOD 表示在不在场：和主角同处的是「在场」，正在和主角说话的是「聚光」，
//   其余的人「离场」。affordanceRef 写着他和主角的交情（qingming:0 陌路 … qingming:3 刻骨），
//   交情一变，引擎的 npcPlugin 看到签名变化就重新 sync，灵魂能做的事随之变多。
// - 交情决定 AI 花多少心思（见 game/mind/bond.ts、game/ai/prompts.ts 的 DEPTH）：
//   陌路人只在你开口时由 AI 回答；相识的人在你身边时自己拿主意、用自己的口吻说话；
//   相熟的人见面会主动开口、和身边人说话被你听见、想得更深；刻骨的人不在身边也会想着你，年底把这一年凝成「心里的你」。
// - 所有 AI 请求都是 Intelligence Activity，每帧 poll。自由对话和主动开口接着引擎的 SessionRef 往下聊。
// - 只有通过校验的结果才会改世界；过期的（换了一年、开了新局）直接取消，不再花钱；出错就用规则的结果。
// - NPC 自己发起的请求每年有上限（玩家选的用量档），你自己说的话不受限。

import type { EntityHandle, World as EcsWorld } from '@forgeax/engine/ecs';
import { type ActivityId, createIntelligencePortClient, type IntelligenceService, type SessionRef } from '@forgeax/engine/intelligence';
import {
  NPC_COGNITIVE_LOD_AMBIENT,
  NPC_COGNITIVE_LOD_OFFSTAGE,
  NPC_COGNITIVE_LOD_SPOTLIGHT,
  NpcBrain,
} from '@forgeax/engine/npc';
import type { ChatLine, Npc, PlaceId, World } from '../game/core/types.ts';
import { lifeLeft, ME, newWorld, nm, placeName, realmText, type RootId } from '../game/core/world.ts';
import { goalText } from '../game/mind/goals.ts';
import { describe, feel } from '../game/mind/memory.ts';
import { bondScore, isMode, MODES, type Mode, type Tier, tierOf, tierText } from '../game/mind/bond.ts';
import { buy, choose, doMain, endTurn, moveTo, retreat, type SocialKind, useItem } from '../game/player.ts';
import { acceptDecision, applyDecision, buildDecidePrompt, whoDecides, yearChoices } from '../game/ai/decide.ts';
import { type Ask, DEPTH, type Think } from '../game/ai/prompts.ts';
import {
  acceptOverhear, acceptReflect, applyOverhear, applyReflect, buildGreetPrompt, buildOverhearPrompt, buildReflectPrompt, greetTurn, greetWho,
  overhearPair, reflectWho,
} from '../game/ai/souls.ts';
import {
  acceptTalk, acceptVoice, allowedOffers, allowedReveals, answerOffer, applyTalk, askLine, buildEncounterPrompt, buildTalkPrompt, buildVoicePrompt,
  canTalk, pushChat, scriptedTalk, startLine, type TalkAllow, talkAllow, type TalkReply, topicTalk, VOICED_ENCOUNTERS, voiceEncounter,
} from '../game/ai/talk.ts';
import { type AskKind, encodeEnvelope, MAX_TOKENS, replySoFar } from '../souls/envelope.ts';
import { OFFLINE_PROVIDER, TALK_LIMITS } from '../souls/providers.ts';
import { type Affordance, type Perception, SoulClient, npcIdOf, soulIdOf } from '../souls/soul-client.ts';
import { type Act, type AiView, CHANNEL, type ToEngine, type ToHost } from './protocol.ts';

/** 一个在等 AI 的请求。gen 是第几局（开新局、读档都会换），y 是哪一年，tier 是当时的交情 */
type Base = { gen: number; y: number; id: string; tier: Tier };
type Pending =
  | Base & { kind: 'talk'; fallback: TalkReply; allow: TalkAllow; raw: string; shown: string }
  | Base & { kind: 'voice'; fallback: string; raw: string; shown: string }
  | Base & { kind: 'decide' }
  | Base & { kind: 'encounter'; eid: string }
  | Base & { kind: 'greet'; at: PlaceId }
  | Base & { kind: 'overhear'; b: string; at: PlaceId }
  | Base & { kind: 'reflect' };

type Spoken = Extract<Pending, { kind: 'talk' | 'voice' }>;
type Silent = Exclude<Pending, Spoken>;

/** 换了一年就没用了的请求（年底回想、你在等的回话除外） */
const YEARLY: readonly Pending['kind'][] = ['decide', 'encounter', 'greet', 'overhear'];

export class WorldSession {
  w: World;
  focus: string | null = null;
  readonly souls = new SoulClient();
  /** 玩家选的 AI 用量 */
  mode: Mode = 'normal';
  private ecs: EcsWorld | null = null;
  private readonly entities = new Map<string, EntityHandle>();
  private intel: IntelligenceService | null = null;
  private provider = '未连接';
  private readonly pending = new Map<ActivityId, Pending>();
  /** 每个人和主角那段谈话的 SessionRef（引擎的 Intelligence 会话，提供方按它续上对话历史） */
  private readonly sessions: Record<string, SessionRef> = {};
  /** 会话历史里最后一句对应的谈话记录：之后的事要另外补给 AI */
  private readonly sessionLast: Record<string, ChatLine> = {};
  private thinking: string | null = null;
  private note: string | null = null;
  private gen = 0;
  private thoughtFor = '';
  private decided: string[] = [];
  /** 今年 NPC 自己发起了几次 AI 请求 */
  private spent = { key: '', n: 0 };

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
        if (isMode(msg.mode)) this.mode = msg.mode;
        if (port) void this.connect(createClient(msg.providerId, port), msg.label);
        break;
      case 'budget':
        if (isMode(msg.mode)) {
          this.mode = msg.mode;
          this.align();
          this.publish();
        }
        break;
    }
  }

  private reset(w: World) {
    this.cancelWhere(() => true);
    this.w = w;
    this.gen++;
    this.focus = null;
    this.thinking = null;
    this.decided = [];
    this.forgetSessions();
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
          this.arrived();
        }
        break;
      case 'main': outcome = doMain(w, a.act) || null; break;
      case 'buy': outcome = buy(w, a.item); break;
      case 'use': outcome = useItem(w, a.item) || null; break;
      case 'choose': outcome = choose(w, a.i) || null; break;
      case 'offer': outcome = answerOffer(w, a.accept) || null; break;
      case 'endTurn': this.endYear(); break;
      case 'retreat': { const n = retreat(w, Math.max(1, Math.min(10, Math.floor(a.years)))); outcome = n ? `闭关${n}年。` : null; break; }
    }
    if (this.w.year !== year) {
      this.focus = null;
      // 去年的打算、开口、旁听都过时了：直接取消，不再花钱
      this.cancelWhere((p) => YEARLY.includes(p.kind) && p.y === year);
    }
    this.align();
    this.think();
    return outcome;
  }

  /** 结束这一年：先记下今年谁会在年底回想你（按今年的样子写），年过了再交给 AI */
  private endYear() {
    const w = this.w;
    if (w.phase !== 'year') return;
    if (!w.turn.moved) {
      // 没选地方就留在原地；有人找上门就先处理
      moveTo(w, w.me.place);
      if (w.pending.length) { this.voiceEncounters(); return; }
    }
    if (w.pending.length) return;
    const year = w.year;
    const gen = this.gen;
    const notes = this.thinksWithAI ? reflectWho(w, (n) => this.tier(n)).slice(0, this.left()).map((n) => ({ n, tier: this.tier(n), ask: buildReflectPrompt(w, n) })) : [];
    if (!endTurn(w)) return;
    for (const r of notes) this.background({ kind: 'reflect', gen, y: year, id: r.n.id, tier: r.tier }, 'reflect', r.ask, 'low', year);
  }

  publish(outcome: string | null = null) {
    this.align();
    const sessions: Record<string, string> = {};
    for (const [id, ref] of Object.entries(this.sessions)) sessions[id] = ref.id;
    const tiers: Record<string, string> = {};
    for (const n of Object.values(this.w.people)) if (n.alive) tiers[n.id] = tierText(this.w, n, this.mode);
    const ai: AiView = {
      thinking: this.thinking, note: this.note, provider: this.provider, online: this.thinksWithAI, sessions, decided: this.decided,
      mode: this.mode, tiers, used: this.used(), cap: MODES[this.mode].cap,
    };
    this.out({ channel: CHANNEL, kind: 'state', world: this.w, souls: this.souls.view(), ai, outcome });
  }

  // ───────────── NpcBrain 实体 ─────────────

  attach(ecs: EcsWorld) {
    this.ecs = ecs;
    this.align();
  }

  /** 他和主角的交情（按玩家选的用量档） */
  tier(n: Npc): Tier {
    return tierOf(this.w, n, this.mode);
  }

  /**
   * 每个修士的 NpcBrain 与世界一致：活着才启用；和主角同处是在场，正说话的是聚光；
   * affordanceRef 是交情档位，变了引擎就会重新 sync 他能做的事
   */
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
      const affordanceRef = `qingming:${this.tier(n)}`;
      const e = this.entities.get(n.id);
      if (e === undefined) {
        const spawned = ecs.spawn({ component: NpcBrain, data: { soulId: soulIdOf(n.id), affordanceRef, enabled, lod } }).unwrap();
        this.entities.set(n.id, spawned);
        continue;
      }
      const cur = ecs.get(e, NpcBrain);
      if (!cur.ok || cur.value.lod !== lod || cur.value.enabled !== enabled || cur.value.affordanceRef !== affordanceRef) {
        ecs.set(e, NpcBrain, { enabled, lod, affordanceRef }).unwrap();
      }
    }
  }

  /**
   * 灵魂「能做什么」：今年能选的事；在主角身边时，还有谈话里能提的事、能说出口的事；
   * 交情深了，还有他自己会做的事
   */
  affordances(soulId: string): Affordance[] {
    const w = this.w;
    const n = w.people[npcIdOf(soulId)];
    if (!n?.alive) return [];
    const out: Affordance[] = yearChoices(w, n).map((c) => ({ id: `plan:${c.id}`, kind: 'plan', label: c.label }));
    const here = n.place === w.me.place;
    if (here) {
      for (const k of allowedOffers(w, n)) out.push({ id: `offer:${k}`, kind: 'offer', label: k });
      for (const k of allowedReveals(w, n)) out.push({ id: `reveal:${k}`, kind: 'reveal', label: k === 'goal' ? '真实打算' : `${nm(w, k.slice(7))}的秘密` });
    }
    const t = this.tier(n);
    const soul = (id: string, label: string) => out.push({ id: `soul:${id}`, kind: 'soul', label });
    if (t >= 1) soul('voice', '用自己的口吻说话');
    if (t >= 1 && here) soul('decide', '年初自己拿主意');
    if (t >= 2) { soul('greet', '见面主动开口'); soul('overhear', '和身边的人说话（你听得见）'); soul('reflect', '年底回想你'); }
    if (t >= 3) soul('afar', '不在你身边也自己拿主意');
    return out;
  }

  /** 一次感知：这个人此刻眼里的自己、心里的事、在意的人、记得的事、和你的交情 */
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
      bond: `${tierText(w, n, this.mode)}（交情 ${bondScore(w, n)}）`,
      impression: n.mind.heart,
    };
  }

  // ───────────── 和人说话 ─────────────

  /** 自由对话：谁都会回答你，交情越深想得越深、记得越多；接着这个人的会话往下聊 */
  talk(id: string, text: string) {
    const w = this.w;
    const n = w.people[id];
    const said = (text ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (this.thinking || !said || !n || !canTalk(w, id)) return;
    // 你先开口了，他的招呼就不用了
    this.cancelWhere((p) => p.kind === 'greet' && p.id === id);
    const fallback = scriptedTalk(w, n, said);
    startLine(w, id, said);
    const tier = this.tier(n);
    const allow = talkAllow(w, n);
    const session = this.sessions[id];
    const ask = buildTalkPrompt(w, n, said, allow, { tier, since: session ? this.since(id) : undefined });
    this.focus = id;
    this.note = null;
    this.align();
    const p: Pending = { kind: 'talk', gen: this.gen, y: w.year, id, tier, fallback, allow, raw: '', shown: '' };
    this.speak(p, ask, DEPTH[tier].talk, fallback, said, session);
  }

  /** 选项对话：规则先结算；相识以上的人，AI 把规则的意思用他的口吻说出来 */
  social(id: string, topic: SocialKind, arg = '') {
    const w = this.w;
    if (this.thinking) return;
    const r = topicTalk(w, id, topic, arg);
    if (!r) return;
    this.focus = w.people[id]?.alive && w.people[id].place === w.me.place ? id : null;
    this.note = null;
    this.align();
    const n = w.people[id];
    const tier = n ? this.tier(n) : 0;
    if (r.speech && this.thinksWithAI && tier >= 1) {
      const ask = buildVoicePrompt(w, n, askLine(w, topic, arg), r.speech, r.honest, tier);
      const p: Pending = { kind: 'voice', gen: this.gen, y: w.year, id, tier, fallback: r.speech, raw: '', shown: '' };
      this.speak(p, ask, 'off', null);
      return;
    }
    if (r.speech) pushChat(w, id, 'them', r.speech);
    else if (r.result.text) pushChat(w, id, 'note', r.result.text);
    this.publish(r.speech ? null : r.result.text || null);
  }

  /** 会话历史之后又发生的事（不含刚说的那句）；找不到断点就当新会话 */
  private since(id: string): ChatLine[] | undefined {
    const log = this.w.chat[id] ?? [];
    const last = this.sessionLast[id];
    const i = last ? log.lastIndexOf(last) : -1;
    return i >= 0 ? log.slice(i + 1, -1) : undefined;
  }

  private envelope(p: Pending, ask: AskKind, a: Ask, think: Think, fallback: unknown, keep?: string) {
    return encodeEnvelope({ v: 2, soul: soulIdOf(p.id), ask, tier: p.tier, system: a.system, prompt: a.prompt, keep, think, maxTokens: MAX_TOKENS[think], fallback });
  }

  private speak(p: Spoken, a: Ask, think: Think, fallback: unknown, keep?: string, session?: SessionRef) {
    if (!this.intel) {
      this.finish(p, null, null);
      return;
    }
    const submitted = this.intel.submit({ input: this.envelope(p, p.kind, a, think, fallback, keep), session });
    if (!submitted.ok) {
      this.finish(p, null, `AI 没接这个请求（${submitted.error.code}），改用规则的回答。`);
      return;
    }
    this.pending.set(submitted.value.id, p);
    this.thinking = p.id;
    this.publish();
  }

  /** 说话的请求结束：校验通过就用 AI 的，否则用规则的 */
  private finish(p: Spoken, output: string | null, note: string | null, session?: SessionRef) {
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
    // AI 真的接着这段会话回答了，才把会话续上
    if (session && r) this.keepSession(p.id, session);
    this.publish();
  }

  private keepSession(id: string, session: SessionRef) {
    this.sessions[id] = session;
    const log = this.w.chat[id] ?? [];
    const last = log.at(-1);
    if (last) this.sessionLast[id] = last;
  }

  private forgetSessions() {
    for (const k of Object.keys(this.sessions)) delete this.sessions[k];
    for (const k of Object.keys(this.sessionLast)) delete this.sessionLast[k];
  }

  // ───────────── NPC 自己发起的：定打算、找上门开口、主动开口、旁听、年底回想 ─────────────

  private get thinksWithAI() {
    return !!this.intel && this.intel.providerId !== OFFLINE_PROVIDER;
  }

  private used() {
    const key = `${this.gen}:${this.w.year}`;
    return this.spent.key === key ? this.spent.n : 0;
  }

  /** 今年还能发起几次 */
  private left() {
    return Math.max(0, MODES[this.mode].cap - this.used());
  }

  /** 新的一年：身边相识以上的人、远处刻骨的人，用 AI 重新想今年做什么（每局每年只想一次；主角已经动身就不想了） */
  think() {
    const w = this.w;
    if (!this.thinksWithAI || w.phase !== 'year' || w.turn.moved) return;
    const key = `${this.gen}:${w.year}`;
    if (this.thoughtFor === key) return;
    this.thoughtFor = key;
    this.decided = [];
    for (const n of whoDecides(w, this.focus, { tier: (x) => this.tier(x), limit: this.left() })) {
      const tier = this.tier(n);
      if (this.background({ kind: 'decide', gen: this.gen, y: w.year, id: n.id, tier }, 'decide', buildDecidePrompt(w, n, tier), DEPTH[tier].decide)) {
        n.plan.asking = true;
        this.decided.push(n.id);
      }
    }
    this.publish();
  }

  /** 到了地方：找上门的人开口；相熟以上的人主动跟你说话；身边两个人说话被你听见 */
  private arrived() {
    if (!this.thinksWithAI) return;
    this.voiceEncounters();
    const w = this.w;
    const tier = (n: Npc) => this.tier(n);
    const busy = w.pending.map((e) => e.who);
    for (const n of greetWho(w, tier, busy, Math.min(2, this.left()))) {
      const t = tier(n);
      this.background({ kind: 'greet', gen: this.gen, y: w.year, id: n.id, tier: t, at: w.me.place }, 'greet', buildGreetPrompt(w, n, t), 'off', undefined, greetTurn(w), this.sessions[n.id]);
    }
    const pair = this.left() > 0 ? overhearPair(w, tier, busy) : null;
    if (pair) {
      const [a, b] = pair;
      this.background({ kind: 'overhear', gen: this.gen, y: w.year, id: a.id, tier: Math.max(tier(a), tier(b)) as Tier, b: b.id, at: w.me.place }, 'overhear', buildOverhearPrompt(w, a, b), 'off');
    }
  }

  /** 有人找上门：相识以上的人，AI 替他说开口那句话 */
  private voiceEncounters() {
    const w = this.w;
    if (!this.thinksWithAI) return;
    for (const e of w.pending) {
      const n = w.people[e.who];
      if (!VOICED_ENCOUNTERS.includes(e.kind) || e.vars.say || !n || this.tier(n) < 1 || this.left() <= 0) continue;
      this.background({ kind: 'encounter', gen: this.gen, y: w.year, id: e.who, tier: this.tier(n), eid: e.id }, 'encounter', buildEncounterPrompt(w, e, this.tier(n)), 'off');
    }
  }

  /** 提交一个 NPC 自己发起的请求，算进今年的用量 */
  private background(p: Silent, ask: AskKind, a: Ask, think: Think, year = this.w.year, keep?: string, session?: SessionRef) {
    if (!this.intel) return false;
    const r = this.intel.submit({ input: this.envelope(p, ask, a, think, null, keep), session });
    if (!r.ok) return false;
    this.pending.set(r.value.id, p);
    const key = `${this.gen}:${year}`;
    this.spent = this.spent.key === key ? { key, n: this.spent.n + 1 } : { key, n: 1 };
    return true;
  }

  /** AI 想好了：校验通过才采用。过期的丢掉；主角已经到了地方，就不许别人凭空走掉 */
  private land(p: Silent, output: string, session: SessionRef) {
    const w = this.w;
    if (p.gen !== this.gen) return;
    const n = w.people[p.id];
    if (p.kind === 'reflect') {
      // 年底回想本来就是过了年才回来的
      const heart = acceptReflect(output);
      if (heart && n?.alive) applyReflect(n, heart, p.y);
      this.publish();
      return;
    }
    if (p.y !== w.year || w.phase !== 'year') return;
    switch (p.kind) {
      case 'decide': {
        if (!n?.alive) return;
        n.plan.asking = false;
        const plan = acceptDecision(w, n, output);
        if (plan && (!w.turn.moved || plan.place === n.place)) applyDecision(w, n, plan);
        this.align();
        break;
      }
      case 'encounter': {
        const say = acceptVoice(output);
        if (say) voiceEncounter(w, p.eid, say);
        break;
      }
      case 'greet': {
        const say = acceptVoice(output);
        // 人还在、你也还在，而且你们这会儿没在说话，他的话才算数
        if (!say || !n?.alive || n.place !== p.at || w.me.place !== p.at || this.thinking === p.id) return;
        pushChat(w, p.id, 'them', say);
        this.keepSession(p.id, session);
        break;
      }
      case 'overhear': {
        const b = w.people[p.b];
        if (!n?.alive || !b?.alive || n.place !== p.at || b.place !== p.at || w.me.place !== p.at) return;
        const r = acceptOverhear(output, n, b);
        if (r) applyOverhear(w, n, b, r);
        break;
      }
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

  /** 取消还在跑的请求（不再等它，也不再为它花钱） */
  private cancelWhere(match: (p: Pending) => boolean) {
    for (const [id, p] of [...this.pending]) {
      if (!match(p)) continue;
      this.pending.delete(id);
      this.intel?.cancel(id);
      if (p.kind === 'talk' || p.kind === 'voice') { if (this.thinking === p.id) this.thinking = null; }
      else if (p.kind === 'decide' && p.gen === this.gen) {
        const n = this.w.people[p.id];
        if (n) n.plan.asking = false;
      }
    }
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
    // 会话是提供方各自的，换了提供方就从头聊
    this.forgetSessions();
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
      if (p.kind !== 'talk' && p.kind !== 'voice') {
        if (ev.type === 'text-delta') continue;
        this.pending.delete(ev.activityId);
        if (ev.type === 'completed') this.land(p, ev.output, ev.session);
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
      if (ev.type === 'completed') this.finish(p, ev.output, null, p.kind === 'talk' ? ev.session : undefined);
      else if (ev.type === 'failed') this.finish(p, null, `AI 出错了（${ev.error.code}），改用规则的回答。`);
      else this.finish(p, null, null);
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
    // 第 1 阶段的存档没有谈话记录；第 2 阶段的没有旁听
    w.chat ??= {};
    w.turn.talk ??= {};
    w.offer ??= null;
    w.heard ??= [];
    return w as World;
  } catch {
    return null;
  }
}

function createClient(providerId: string, port: MessagePort) {
  port.start?.();
  return createIntelligencePortClient(providerId, port, { limits: TALK_LIMITS });
}
