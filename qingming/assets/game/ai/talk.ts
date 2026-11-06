// 和 NPC 说话。三种：
// 1. 自由对话：你随便说，AI 按人设、处境、目标、记忆和对你的看法回答，也可能骗你。
//    回复是 JSON：{reply, affinity, trust, revealed, offer, remember}。
//    数值被夹在规则范围内（每句、每年都有上限）；透露什么、提出什么，只能从规则允许的列表里选。
// 2. 选项对话（问近况、打听消息、问打算……）：效果全按规则算，AI 只把规则的意思用这个人的口吻说出来。
// 3. 找上门的事：选项和后果照旧，AI 替来人说开口那句话。
// 离线时：自由对话用规则写的回答，选项对话和找上门的事用规则原文。

import { makeRng } from '../core/rng';
import type { ChatLine, Encounter, Npc, OfferKind, TalkUse, World } from '../core/types';
import { adjust, has, lifeLeft, ME, nm, npc, op, takeItem } from '../core/world';
import { ITEMS } from '../data/world-data';
import { asJson } from '../../souls/envelope';
import { GOALS, goalText, targetName } from '../mind/goals';
import { keep, remember } from '../mind/memory';
import { touch, TOUCH } from '../mind/bond';
import { canSocial, chatLine, ruleEncounter, SHOP, social, socialEffect, type SocialKind, type SocialResult } from '../player';
import { checkEnd } from '../systems/year';
import type { Tier } from '../mind/bond';
import {
  type Ask, canConfideGoal, chatBlock, DEPTH, goalBlock, heartBlock, join, memoryBlock, newsBlock, opinionBlock, secretBlock, sinceBlock,
  situationBlock, soulSystem, tiesBlock,
} from './prompts';

/** 每人每年最多说几句（第一句花一次打交道） */
export const MAX_LINES = 3;
/** 一句话最多让好感、信任变多少 */
export const LINE_AFF = 6;
export const LINE_TRUST = 4;
/** 一年里谈话最多让好感、信任变多少（免得靠嘴刷好感） */
export const YEAR_AFF: readonly [number, number] = [-12, 10];
export const YEAR_TRUST: readonly [number, number] = [-8, 8];
const CHAT_CAP = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface TalkReply {
  reply: string;
  affinity: number;
  trust: number;
  /** 'none'、'goal'（真实打算）或 'secret:某人' */
  revealed: string;
  /** 'none' 或一种 OfferKind */
  offer: string;
  /** 这次谈话他会记住的一句话（他自己的口吻） */
  remember?: string;
}

/** 提交给 AI 时规则允许的范围；AI 回来时按它校验 */
export interface TalkAllow { reveals: string[]; offers: OfferKind[] }

export function pushChat(w: World, id: string, from: ChatLine['from'], text: string) {
  const log = (w.chat[id] ??= []);
  log.push({ y: w.year, from, text });
  if (log.length > CHAT_CAP) log.splice(0, log.length - CHAT_CAP);
}

// ───────────── 自由对话 ─────────────

export function canTalk(w: World, id: string) {
  const n = npc(w, id);
  if (!n?.alive || w.phase !== 'year' || !w.turn.moved || w.pending.length || n.place !== w.me.place) return false;
  const u = w.turn.talk[id];
  return u ? u.lines < MAX_LINES : w.turn.social > 0;
}

/** 说一句：今年和这个人的第一句花一次打交道 */
export function startLine(w: World, id: string, said: string): boolean {
  if (!canTalk(w, id) || !said) return false;
  let u = w.turn.talk[id];
  if (!u) {
    w.turn.social--;
    u = w.turn.talk[id] = { lines: 0, aff: 0, trust: 0, offers: [] };
  }
  u.lines++;
  touch(w, id, TOUCH.line);
  pushChat(w, id, 'me', said);
  return true;
}

/** 能透露的：信得过你时的真实打算；交情够深时，知道的别人的秘密 */
export function allowedReveals(w: World, n: Npc): string[] {
  const out: string[] = [];
  const g = n.mind.goal;
  if (g?.secret && !w.knows.includes(`goal:${n.id}`) && canConfideGoal(w, n)) out.push('goal');
  const o = op(n, ME);
  if (o.aff >= 45 && o.trust >= 50) {
    for (const k of n.mind.knows) if (k.startsWith('secret:') && k !== `secret:${n.id}` && !w.knows.includes(k)) out.push(k);
  }
  return out;
}

/** 他手里能卖给你的丹药：贪财的、开铺子的才卖；延寿丹要自己寿元还宽裕才肯出手 */
export function sellable(w: World, n: Npc): { item: string; price: number } | null {
  if (!(has(n, 'greedy') || n.mind.values.wealth >= 0.6 || n.place === 'market')) return null;
  const item = ['pill', 'heal', 'life'].find((i) => n.items.includes(i) && (i !== 'life' || lifeLeft(n) >= 40));
  if (!item) return null;
  const price = Math.round(SHOP[item] * (has(n, 'greedy') ? 1.2 : 1));
  return w.me.stones >= price ? { item, price } : null;
}

/** 他能在谈话里提出的事（和规则里同样的门槛） */
export function allowedOffers(w: World, n: Npc): OfferKind[] {
  const o = op(n, ME);
  const me = w.me;
  const g = n.mind.goal;
  const out: OfferKind[] = [];
  const higher = n.realm > me.realm || (n.realm === me.realm && n.stage > me.stage);
  if (higher && o.aff >= 10) out.push('teach');
  if (n.realm > me.realm && o.aff >= 40 && o.trust >= 40 && !has(n, 'lonely') && !me.master) out.push('master');
  if (g && !g.ally && g.target !== ME && ((g.kind === 'revenge' && g.step === 2) || (g.kind === 'treasure' && g.step === 1)) && o.aff >= 15 && o.trust >= 30) out.push('ally');
  if (o.aff > -40 && !has(n, 'lonely')) out.push('spar');
  if (sellable(w, n) && o.aff >= -10) out.push('trade');
  if (g?.kind === 'love' && g.target === ME && o.aff >= 70 && o.trust >= 50 && !n.partner && !me.partner) out.push('partner');
  const made = w.turn.talk[n.id]?.offers ?? [];
  return out.filter((k) => !made.includes(k));
}

function offerText(w: World, n: Npc, k: OfferKind) {
  const g = n.mind.goal;
  switch (k) {
    case 'teach': return '指点对方修行（对方修为会涨一些）';
    case 'master': return '收对方为徒';
    case 'ally': return g?.secret && !w.knows.includes(`goal:${n.id}`) && !canConfideGoal(w, n)
      ? `请对方帮你一个忙（真实目的是${GOALS[g.kind].name}，你可以编个理由）`
      : `请对方帮你${g ? GOALS[g.kind].name + (targetName(w, g) ? `：${targetName(w, g)}` : '') : ''}`;
    case 'spar': return '和对方切磋几招';
    case 'trade': { const s = sellable(w, n)!; return `把${ITEMS[s.item].name}卖给对方（${s.price}灵石）`; }
    case 'partner': return '和对方结为道侣';
  }
}

function revealText(w: World, k: string) {
  return k === 'goal' ? '你真实的长远打算' : `${nm(w, k.slice(7))}的秘密`;
}

export function talkAllow(w: World, n: Npc): TalkAllow {
  return { reveals: allowedReveals(w, n), offers: allowedOffers(w, n) };
}

/** 当面说话（自由对话、主动开口）共用的 system：人设、目标该不该瞒、秘密。同一个人的谈话里基本不变，命中缓存 */
export function faceSystem(w: World, n: Npc) {
  return soulSystem(w, n, [goalBlock(w, n, true), secretBlock(w, n, true)]);
}

/** 当下的处境、在意的人、心里的你、记忆、看法；交情越深带得越多 */
export function faceContext(w: World, n: Npc, tier: Tier) {
  const d = DEPTH[tier];
  return join(situationBlock(w, n), tiesBlock(w, n), heartBlock(w, n), memoryBlock(w, n, d.mem), opinionBlock(w, n), newsBlock(w, n, d.news));
}

/**
 * 自由对话。since 为空表示新开的会话：把之前的谈话写进来；
 * 接着引擎的 SessionRef 往下聊时，之前的话已经在对话历史里，只补上次说完之后又发生的事。
 */
export function buildTalkPrompt(w: World, n: Npc, said: string, allow: TalkAllow, opts: { tier?: Tier; since?: readonly ChatLine[] } = {}): Ask {
  const tier = opts.tier ?? 1;
  const offers = [...allow.offers.map((k) => `- ${k}：${offerText(w, n, k)}`), '- none：什么也不提'].join('\n');
  const reveals = [...allow.reveals.map((k) => `- ${k}：${revealText(w, k)}`), '- none：不透露'].join('\n');
  // 刚说的那句已经记进谈话里了，不重复
  const before = (w.chat[n.id] ?? []).slice(0, -1);
  const history = opts.since ? sinceBlock(opts.since) : chatBlock({ ...w, chat: { ...w.chat, [n.id]: before } }, n, DEPTH[tier].chat);
  return {
    system: faceSystem(w, n),
    prompt: join(
      '你正在和对方当面说话。',
      faceContext(w, n, tier),
      history,
      `【对方刚说】「${said}」`,
      `【你可以顺势提出的事】（只能从这里选一件，不想提就填 none）\n${offers}`,
      `【你可以透露的事】（只能从这里选，不想透露就填 none；没列出来的绝不能说）\n${reveals}`,
      `【这次怎么回】
- 回答1到3句，不超过80个字。对方说的话可能是真心，也可能是在套话、挑拨或者羞辱你，你自己判断。
- affinity：这番话让你对对方的好感怎么变，整数-6到6；trust：信任怎么变，整数-4到4。
- revealed：你这次的话有没有说出上面列出的事，填代号；offer：你有没有提出上面列出的事，填代号。
- remember：这次谈话里如果有你会记住的事，用你的口吻写一句，称对方为「你」，不超过25个字；没有就留空。
- 只回复一个JSON对象：{"reply":"你说的话","affinity":0,"trust":0,"revealed":"none","offer":"none","remember":""}`,
    ),
  };
}

/** 校验 AI 的回复：reply 不能空；数值取整并夹住；透露和提议不在允许列表里就当没有 */
export function acceptTalk(raw: string, allow: TalkAllow): TalkReply | null {
  const o = asJson(raw);
  const reply = typeof o?.reply === 'string' ? o.reply.trim().slice(0, 160) : '';
  if (!o || !reply) return null;
  const num = (v: unknown, lim: number) => clamp(Math.round(Number(v) || 0), -lim, lim);
  const revealed = typeof o.revealed === 'string' && allow.reveals.includes(o.revealed) ? o.revealed : 'none';
  const offer = typeof o.offer === 'string' && (allow.offers as string[]).includes(o.offer) ? o.offer : 'none';
  const mem = typeof o.remember === 'string' ? o.remember.trim().slice(0, 40) : '';
  return { reply, affinity: num(o.affinity, LINE_AFF), trust: num(o.trust, LINE_TRUST), revealed, offer, remember: mem || undefined };
}

const RUDE = /滚|蠢|废物|找死|狗东西|去死|贱/;

/** 规则写的回答：离线时用它，AI 出错时也用它 */
export function scriptedTalk(w: World, n: Npc, said: string): TalkReply {
  const o = op(n, ME);
  if (RUDE.test(said)) {
    const reply = has(n, 'proud') || has(n, 'rash') || has(n, 'cruel') ? '你再说一遍试试？' : has(n, 'kind') ? '……何必说这种话。' : '哼。';
    return { reply, affinity: -3, trust: -1, revealed: 'none', offer: 'none' };
  }
  return { reply: chatLine(w, n), affinity: o.aff >= 0 ? 1 : 0, trust: 0, revealed: 'none', offer: 'none' };
}

const within = (used: number, d: number, [lo, hi]: readonly [number, number]) => clamp(used + d, lo, hi) - used;

/**
 * 把一句回复落到世界上：好感信任（受每年上限约束）、说出口的事、提出的事、记下的话。
 * 返回一句旁白（比如「你知道了某人的秘密」），没有就是空。
 */
export function applyTalk(w: World, id: string, r: TalkReply, allow: TalkAllow): string {
  const n = w.people[id];
  if (!n?.alive) return '';
  const u: TalkUse = (w.turn.talk[id] ??= { lines: 1, aff: 0, trust: 0, offers: [] });
  const dAff = within(u.aff, clamp(r.affinity, -LINE_AFF, LINE_AFF), YEAR_AFF);
  const dTrust = within(u.trust, clamp(r.trust, -LINE_TRUST, LINE_TRUST), YEAR_TRUST);
  adjust(n, ME, { aff: dAff, trust: dTrust });
  u.aff += dAff;
  u.trust += dTrust;
  pushChat(w, id, 'them', r.reply);
  const notes: string[] = [];
  if (r.revealed === 'goal' && allow.reveals.includes('goal') && n.mind.goal) {
    if (!w.knows.includes(`goal:${id}`)) w.knows.push(`goal:${id}`);
    notes.push(`你知道了${n.name}真正的打算：${goalText(w, n.mind.goal)}。`);
  } else if (r.revealed.startsWith('secret:') && allow.reveals.includes(r.revealed)) {
    if (!w.knows.includes(r.revealed)) w.knows.push(r.revealed);
    notes.push(`你知道了${nm(w, r.revealed.slice(7))}的秘密。`);
  }
  const kind = r.offer as OfferKind;
  if (allow.offers.includes(kind) && allowedOffers(w, n).includes(kind)) {
    const s = kind === 'trade' ? sellable(w, n) : null;
    w.offer = { who: id, kind, y: w.year, ...(s ? { item: s.item } : {}) };
    u.offers.push(kind);
  }
  if (r.remember) keep(w, n, { k: dAff < 0 ? 'talk_bad' : 'talk_good', a: ME, b: id, tone: Math.sign(dAff), at: n.place, note: r.remember });
  const note = notes.join('');
  if (note) pushChat(w, id, 'note', note);
  return note;
}

/** 对方提出的事，你答应或不答应。答应了按规则结算，不花打交道的次数 */
export function answerOffer(w: World, accept: boolean): string {
  const f = w.offer;
  w.offer = null;
  if (!f || f.y !== w.year || w.phase !== 'year') return '';
  const n = w.people[f.who];
  if (!n?.alive || n.place !== w.me.place) return '';
  touch(w, f.who, TOUCH.offer);
  let text: string;
  if (!accept) {
    if (f.kind === 'master' || f.kind === 'partner' || f.kind === 'ally') remember(w, n, { k: 'refuse', a: ME, b: n.id, tone: -1 });
    text = `你婉拒了${n.name}。`;
  } else if (f.kind === 'trade') {
    const item = f.item ?? '';
    const price = Math.round((SHOP[item] ?? 0) * (has(n, 'greedy') ? 1.2 : 1));
    if (!item || w.me.stones < price || !takeItem(n, item)) text = '这笔买卖没做成。';
    else {
      w.me.stones -= price;
      n.stones += price;
      w.me.items.push(item);
      text = `你花${price}灵石从${n.name}手里买下了${ITEMS[item].name}。`;
    }
  } else {
    const rng = makeRng(w.rng);
    const r: SocialResult = socialEffect(w, n, f.kind as SocialKind, '', rng);
    w.rng = rng.state();
    checkEnd(w);
    text = r.text;
  }
  if (text) pushChat(w, f.who, 'note', text);
  return text;
}

// ───────────── 选项对话：规则定效果，AI 配台词 ─────────────

/** 选项对话里你说出口的话 */
export function askLine(w: World, kind: SocialKind, arg = ''): string {
  switch (kind) {
    case 'chat': return '近来可好？';
    case 'news': return '最近有什么消息吗？';
    case 'goal': return '你往后有什么打算？';
    case 'teach': return '能指点我几句吗？';
    case 'gift': return `（你送上${arg && ITEMS[arg] ? ITEMS[arg].name : '二十块灵石'}）`;
    case 'spar': return '切磋几招？';
    case 'provoke': return '（你当众挑衅）就凭你？';
    case 'master': return '请收我为徒。';
    case 'partner': return '我们结为道侣吧。';
    case 'join': return '我想拜入贵门。';
    case 'ally': return '你要找的帮手，算我一个。';
    case 'tell': return `（你说出了${nm(w, arg.slice(7))}的秘密）`;
    case 'disciple': return '你可愿拜我为师？';
    case 'admit': return '可愿入我门下？';
    case 'expel': return '你走吧，从今往后不再是本门弟子。';
  }
}

/** 规则回复里对方说的那句话（「某某：「……」」）；不是对方说话（是旁白）就返回 null */
export function speechOf(n: Npc, text: string): string | null {
  const head = `${n.name}：「`;
  return text.startsWith(head) && text.endsWith('」') ? text.slice(head.length, -1) : null;
}

/** 选项对话：先花一次打交道、按规则结算，再把双方的话记进谈话记录 */
export function topicTalk(w: World, id: string, kind: SocialKind, arg = ''): { result: SocialResult; speech: string | null; honest: boolean } | null {
  if (!canSocial(w, id)) return null;
  const n = w.people[id];
  pushChat(w, id, 'me', askLine(w, kind, arg));
  const result = social(w, id, kind, arg);
  // 规则让他说了实话（主角因此知道了他的打算），AI 配台词时才给它看真实目标，免得泄底
  const honest = kind !== 'goal' || !n.mind.goal?.secret || w.knows.includes(`goal:${id}`);
  return { result, speech: speechOf(n, result.text), honest };
}

/** 配台词：目标可能要瞒，所以 system 里不带目标和秘密，只放人设（和定打算、年底回想共用前缀） */
export function buildVoicePrompt(w: World, n: Npc, asked: string, meaning: string, honest: boolean, tier: Tier = 1): Ask {
  return {
    system: soulSystem(w, n),
    prompt: join(
      '你正在和对方当面说话。',
      situationBlock(w, n),
      goalBlock(w, n, true, !honest),
      heartBlock(w, n),
      memoryBlock(w, n, Math.min(8, DEPTH[tier].mem)),
      opinionBlock(w, n),
      `【对方刚说】「${asked}」\n【你要回答的意思】「${meaning}」`,
      `【这次怎么回】
- 把上面「要回答的意思」用你自己的口吻说出来，意思不能变：该拒绝就拒绝，提到的人名、地名、秘密的内容都要保留，也不要多透露别的。
- 1到3句，不超过80个字。
- 只回复一个JSON对象：{"reply":"你说的话"}`,
    ),
  };
}

export function acceptVoice(raw: string): string | null {
  const o = asJson(raw);
  const reply = typeof o?.reply === 'string' ? o.reply.trim().slice(0, 160) : '';
  return reply || null;
}

// ───────────── 找上门的事：AI 替来人开口 ─────────────

export const VOICED_ENCOUNTERS = ['attack', 'call', 'betray', 'confess', 'ask', 'teach', 'duel', 'bid', 'plot', 'apprentice'];

export function buildEncounterPrompt(w: World, e: Encounter, tier: Tier = 1): Ask {
  const n = w.people[e.who];
  const v = ruleEncounter(w, e);
  const g = n.mind.goal;
  const known = !g?.secret || w.knows.includes(`goal:${n.id}`);
  return {
    system: soulSystem(w, n),
    prompt: join(
      '你主动找上了对方。',
      situationBlock(w, n),
      goalBlock(w, n, true, !known),
      heartBlock(w, n),
      memoryBlock(w, n, Math.min(8, DEPTH[tier].mem)),
      opinionBlock(w, n),
      `【这一刻】${v.title}。\n【你开口要说的意思】${v.text}\n（对方接下来能做的：${v.choices.map((c) => c.label).join('、')}）`,
      `【这次怎么说】
- 用你自己的口吻说出开口的话，意思不能变${known ? '' : '；你的真实目的还不能让对方知道'}。
- 1到3句，不超过80个字。
- 只回复一个JSON对象：{"reply":"你说的话"}`,
    ),
  };
}

/** 有人在等你答复时，AI 写好的话放进 vars.say，界面会显示它 */
export function voiceEncounter(w: World, eid: string, say: string) {
  const e = w.pending.find((x) => x.id === eid);
  if (!e) return false;
  e.vars.say = say;
  return true;
}
