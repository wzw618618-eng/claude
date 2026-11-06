// 规则写的台词：没接 AI 时十二个人怎么说话（AI 出错时也退回这里）。
// - 寒暄：按他怎么看你、记得你做过什么、眼下的处境说一句；
// - 打听消息：交情深的说秘密，其次是他亲历亲见的大事、江湖上的大新闻，同一件事不说两遍；
// - 自由对话：听你说的是什么——问修行、问人、问地方、问玄冥剑、问打算、问往事、要拜师切磋买东西、道谢、夸、骂、告辞——
//   按他的性子和对你的看法回答。能透露的、能提的事和 AI 一样受规则门槛约束（allow），绝不多说。
// 挑哪一句由世界种子、年份、说话次数算出来，不碰世界的随机数。

import type { Being, Npc, PlaceId, World } from '../core/types';
import { aff, being, has, ME, nm, op, placeName, titleOf } from '../core/world';
import { PLACES, ITEMS } from '../data/world-data';
import { PERSON } from '../data/people';
import { GENERIC, TRAIT_VOICE, type Voice, VOICES } from '../data/voices';
import { GOALS, targetName } from '../mind/goals';
import { describe } from '../mind/memory';

// ───────────── 挑一句 ─────────────

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** 同一年、同一句话、说到第几句都一样时挑同一句；换了就可能换一句 */
const pickBy = <T>(arr: readonly T[], key: string): T => arr[hash(key) % arr.length];

export function voiceOf(n: Npc): Voice {
  const own = VOICES[n.id];
  if (own) return own;
  const extra = n.mind.traits.map((t) => TRAIT_VOICE[t]).filter(Boolean) as Partial<Voice>[];
  return Object.assign({}, GENERIC, ...extra.reverse());
}

/** 他怎么称呼你：师徒、道侣另算，其余看他自己的叫法 */
export function callMe(w: World, n: Npc) {
  if (w.me.master === n.id) return '徒儿';
  if (n.master === ME) return '师父';
  if (n.partner === ME) return w.me.name;
  const v = VOICES[n.id];
  return v?.call ? v.call(w.me, !!n.sect && n.sect === w.me.sect) : w.me.name;
}

/** 把 {you} 换成称呼；去掉开头多余的标点 */
const fill = (w: World, n: Npc, s: string) => s.replaceAll('{you}', callMe(w, n));

/** 他上一句说的话 */
const lastSaid = (w: World, n: Npc) => [...(w.chat[n.id] ?? [])].reverse().find((l) => l.from === 'them')?.text ?? '';

function line(w: World, n: Npc, kind: keyof Omit<Voice, 'call'> | (keyof Omit<Voice, 'call'>)[], salt = '') {
  const v = voiceOf(n);
  const arr = (Array.isArray(kind) ? kind : [kind]).flatMap((k) => v[k]);
  const k = `${w.seed}|${w.year}|${n.id}|${kind}|${(w.chat[n.id] ?? []).length}|${salt}`;
  // 不把上一句原样再说一遍
  const last = lastSaid(w, n);
  const i = hash(k) % arr.length;
  const pick = arr.length > 1 && fill(w, n, arr[i]) === last ? arr[(i + 1) % arr.length] : arr[i];
  return fill(w, n, pick);
}

// ───────────── 寒暄 ─────────────

/** 心里记着的你做过的事（五年内、分量重的） */
function memoryOfMe(w: World, n: Npc) {
  const back = n.mind.mem.filter((m) => m.a === ME && Math.abs(m.tone) >= 2 && !m.note).sort((a, b) => b.y - a.y)[0];
  return back && w.year - back.y <= 5 ? back : null;
}

/** 寒暄：看你顺不顺眼、记着你什么、他眼下怎么样 */
export function greetLine(w: World, n: Npc) {
  const o = op(n, ME);
  const back = memoryOfMe(w, n);
  const key = `${w.seed}|${w.year}|${n.id}|greet|${(w.chat[n.id] ?? []).length}`;
  if (back && hash(key) % 2 === 0) {
    return back.tone > 0 ? `${describe(w, back, n.id)}，这份情我记着。` : `${describe(w, back, n.id)}，这笔账我还没忘。`;
  }
  const band = o.aff >= 40 ? 'warm' : o.aff <= -25 ? 'cold' : 'plain';
  let s = line(w, n, band);
  // 眼下的处境：带着伤、心里难受、在忙一件不瞒人的事
  if (n.hp < 50 && band !== 'cold') s = `（${n.gender === 'f' ? '她' : '他'}身上还带着伤）${s}`;
  else if (n.mind.mood < 35 && band !== 'cold') s = `（神色有些黯然）${s}`;
  const g = n.mind.goal;
  if (g && !g.secret && band !== 'cold' && hash(key + 'g') % 3 === 0) s += `最近在忙${GOALS[g.kind].name}的事。`;
  return s;
}

// ───────────── 打算和秘密 ─────────────

export function honestGoal(w: World, n: Npc) {
  const g = n.mind.goal!;
  const t = targetName(w, g);
  switch (g.kind) {
    case 'revenge': return g.target === ME ? '我要你的命。' : `我要找${t}报仇。`;
    case 'throne': return `${t}的位子，迟早是我的。`;
    case 'seekmaster': return '我在找我师父，活要见人，死要见尸。';
    case 'love': return g.target === ME ? '……我想多见见你。' : `我心里有${t}。`;
    case 'treasure': return `我想要${t}。`;
    case 'longevity': return '我的寿元不多了，得想办法续命。';
    case 'join': return '我想拜入宗门。';
  }
}

/** 对外的说法写成一句完整的话 */
export function coverLine(cover?: string) {
  const s = (cover ?? '').trim() || '没什么打算';
  return /[。！？…」）]$/.test(s) ? s : `${s}。`;
}

export function secretLine(w: World, who: string) {
  const s = PERSON[who]?.secret;
  if (who === 'lu') return '十年前杀秦烈的，是陆沉舟。';
  if (who === 'wen') return '三十年前云鹤真人失踪，是温玄害的。';
  if (who === 'mojiu') return '墨九是墨家活下来的人，他要找温玄报仇。';
  return s ?? `${nm(w, who)}手上沾过血。`;
}

// ───────────── 外人看得到的打算 ─────────────

/**
 * 今年的打算，外人眼里是什么样：为瞒着人的目标奔走时（你还没打听出来），
 * 只看得到他在修炼、闭关、办事，或者「不知在忙什么」。
 */
export function publicPlan(w: World, n: Npc): string {
  const p = n.plan;
  if (!p.why) return '';
  const g = n.mind.goal;
  if (!p.goal || !g?.secret || w.knows.includes(`goal:${n.id}`)) return p.why;
  if (p.act === 'seclude') return '闭关冲关';
  if (p.act === 'cultivate') return '静心修炼';
  if (p.act === 'task') return '替宗门办事';
  return '不知在忙些什么';
}

// ───────────── 打听消息 ─────────────

/** 他今年说过的话（免得同一件事说两遍） */
const saidBefore = (w: World, n: Npc, text: string) => (w.chat[n.id] ?? []).some((l) => l.from === 'them' && l.text.includes(text));

/**
 * 打听消息：先说他亲历、亲见的分量重的事（不说你，也不说他自己干的坏事），
 * 再说江湖上这几年的大事，最后才是鸡毛蒜皮。说过的不再说。
 */
export function newsLine(w: World, n: Npc): string | null {
  const mems = n.mind.mem
    .filter((x) => !x.note && !SMALL_TALK.includes(x.k) && x.a !== ME && x.b !== ME && Math.abs(x.tone) >= 1 && !(x.a === n.id && x.tone < 0) && w.year - x.y <= 6)
    .map((x) => ({ x, text: describe(w, x, n.id) }))
    .filter(({ text }) => !saidBefore(w, n, text));
  const weight = (m: (typeof mems)[number]) => Math.abs(m.x.tone) * 10 + (m.x.a !== n.id && m.x.b !== n.id ? 15 : 0) + (m.x.from ? 0 : 5) + m.x.y / 100;
  mems.sort((a, b) => weight(b) - weight(a));
  const top = mems[0];
  if (top && Math.abs(top.x.tone) >= 2) return `${top.text}。`;
  // 江湖上的事：先是这几年的大事，再是这两年别的动静（不说你的，也不说他自己的）
  const fresh = (x: (typeof w.news)[number], years: number) => w.year - x.y <= years && !x.about.includes(ME) && !x.about.includes(n.id) && !saidBefore(w, n, x.text.replace(/。$/, ''));
  const rumor = [...w.news].reverse().find((x) => x.big && fresh(x, 3)) ?? [...w.news].reverse().find((x) => x.tone !== 'info' && fresh(x, 2));
  if (rumor) return `听说${rumor.text.replace(/^听说/, '')}`;
  if (top) return `${top.text}。`;
  return null;
}

/** 闲聊算不上消息 */
const SMALL_TALK: string[] = ['talk_good', 'talk_bad'];

// ───────────── 自由对话 ─────────────

export type Topic =
  | 'rude' | 'person' | 'place' | 'sword' | 'master' | 'spar' | 'trade' | 'love' | 'advice' | 'plan' | 'past'
  | 'thanks' | 'praise' | 'help' | 'bye' | 'hello' | 'news' | 'who' | 'doing' | 'idle';

const RUDE = /滚|蠢|废物|找死|狗东西|去死|贱|老不死|蠢货|混账/;
const KEYS: [Topic, RegExp][] = [
  ['master', /拜师|拜你为师|收我|收徒|做你徒弟|当你徒弟/],
  ['love', /喜欢你|心悦|道侣|成亲|嫁给|娶你|在一起/],
  ['spar', /切磋|比划|过两招|过几招|打一架|比试|较量|比一场/],
  ['trade', /买|卖|丹药|破境丹|回春丹|延寿丹/],
  ['sword', /玄冥剑|那把剑|宝剑/],
  ['advice', /修炼|修行|修仙|境界|突破|冲关|筑基|金丹|元婴|化神|功法|心法|指点|请教|变强|悟道|怎么练/],
  ['news', /消息|新鲜事|传闻|江湖上|最近有什么事|出了什么事|听说了什么/],
  ['who', /你是谁|你叫什么|怎么称呼|尊姓大名|你是做什么的/],
  ['doing', /在干嘛|在干什么|在做什么|在忙什么|忙什么|最近在忙|今年做什么|今年干什么|今年忙/],
  ['plan', /打算|想做什么|目标|往后|以后|将来|计划|要去哪|拜入|想去/],
  ['past', /秘密|当年|过去|往事|从前|心事|身世|来历|隐情|藏着|瞒/],
  ['thanks', /谢/],
  ['praise', /厉害|佩服|仰慕|敬佩|了不起|好看|漂亮|英俊|威风|真强|高明/],
  ['help', /帮|需要|效劳|出力|尽管说/],
  ['bye', /告辞|再会|再见|保重|走了|后会有期|先走/],
  ['hello', /你好|您好|前辈好|婆婆好|好久不见|别来无恙|久仰|幸会|见过|在下|晚辈|又见面/],
];
const PLACE_KEYS: [PlaceId, RegExp][] = [
  ['qinglan', /青岚/], ['chixiao', /赤霄/], ['market', /云渡|坊市|茶楼/], ['vein', /听泉/], ['cave', /玄冥洞府|洞府/], ['forest', /黑松林/], ['village', /柳溪/],
];

/** 大家对几个人的叫法 */
const ALIAS: Record<string, string[]> = { hua: ['婆婆'], shen: ['大师姐'], lu: ['二师兄'], tang: ['小师妹'], li: ['厉门主'], wen: ['温宗主'] };

/** 话里提到的别人：全名、叫法，三个字的名字也认后两个字 */
export function mentioned(w: World, n: Npc, said: string): string | null {
  let best: { id: string; at: number } | null = null;
  for (const x of Object.values(w.people)) {
    if (x.id === n.id) continue;
    const keys = [x.name, ...(ALIAS[x.id] ?? [])];
    if ([...x.name].length === 3 && x.id !== 'hua') keys.push([...x.name].slice(1).join(''));
    for (const k of keys) {
      const at = said.indexOf(k);
      if (at >= 0 && (!best || at < best.at)) best = { id: x.id, at };
    }
  }
  return best?.id ?? null;
}

export function topicOf(w: World, n: Npc, said: string): { t: Topic; who?: string; place?: PlaceId } {
  if (RUDE.test(said)) return { t: 'rude' };
  for (const [t, re] of KEYS.slice(0, 4)) if (re.test(said)) return { t };
  // 当面问起他自己
  if ([n.name, ...(ALIAS[n.id] ?? [])].some((k) => said.includes(k)) && !/你好|您好/.test(said)) return { t: 'who' };
  const who = mentioned(w, n, said);
  if (who) return { t: 'person', who };
  if (KEYS[4][1].test(said)) return { t: 'sword' };
  const place = PLACE_KEYS.find(([, re]) => re.test(said))?.[0];
  if (place && !/修炼|修行/.test(said)) return { t: 'place', place };
  for (const [t, re] of KEYS.slice(5)) if (re.test(said)) return { t };
  return { t: 'idle' };
}

const PLACE_TALK: Record<PlaceId, (me: Being) => string> = {
  qinglan: () => '青岚宗是正道大宗，规矩多。拜进去了，替宗门办事攒下功劳，能进藏经阁。',
  chixiao: () => '赤霄门强者为尊。外人上门，少不了被刁难几句；门里天天有人上擂台。',
  market: () => '云渡坊消息最灵。茶楼里花十块灵石，有人在打听你，也打听得出来。',
  vein: () => '听泉谷的灵脉最旺，谁去修炼都快。冲关之前去悟一悟，把握大些。',
  cave: (me) => (me.realm < 1 ? '玄冥洞府？没到筑基就别去送死。' : '玄冥洞府深处有东西守着，没把握别往里闯。机缘多，骨头也多。'),
  forest: () => '黑松林妖兽多，是历练的好地方，草药也多，就是夜里别乱走。',
  village: () => '柳溪村是凡人村子。帮村里人做事、行医施药，攒下的名声比灵石值钱。',
};

/** 他眼里的某个人 */
function aboutPerson(w: World, n: Npc, id: string, said: string): { text: string; aff: number } {
  const x = being(w, id)!;
  const X = x.name;
  const ta = x.gender === 'f' ? '她' : '他';
  if (!x.alive) return { text: aff(n, id) >= 40 ? `${X}……已经不在了。（${n.gender === 'f' ? '她' : '他'}沉默了一会儿）` : `${X}已经不在了。`, aff: 0 };
  const g = n.mind.goal;
  // 心里藏着冲他去的打算：不露底
  const hiding = g?.secret && g.target === id && !w.knows.includes(`goal:${n.id}`);
  let text: string;
  if (n.partner === id) text = `那是我的道侣。`;
  else if (n.master === id) text = `那是我师父。`;
  else if (x.master === n.id) text = `${X}是我徒弟。`;
  else if (hiding) text = `${X}？不太熟。`;
  else {
    const a = aff(n, id);
    text = a >= 50 ? `${X}？我信得过${ta}。` : a >= 20 ? `${X}人不错。` : a <= -50 ? `别在我面前提${X}。` : a <= -20 ? `${X}？哼，合不来。` : `${X}？不太熟。`;
  }
  if (/在哪|哪里|去哪|何处/.test(said) && !hiding) text += `听说${ta}今年在${placeName(x.place)}。`;
  else if (!hiding) {
    const m = n.mind.mem.filter((m) => !m.note && !SMALL_TALK.includes(m.k) && (m.a === id || m.b === id) && m.a !== ME && m.b !== ME && Math.abs(m.tone) >= 1).sort((a, b) => b.y - a.y)[0];
    if (m && w.year - m.y <= 6) text += `${describe(w, m, n.id)}。`;
  }
  return { text, aff: 0 };
}

/** 玄冥剑在哪：大家都知道的事 */
function swordTalk(w: World, n: Npc) {
  const h = w.treasure.sword;
  const g = n.mind.goal;
  if (h === n.id) return '（按住了腰间的剑）问这个做什么？';
  if (g?.kind === 'treasure' && g.target === 'sword' && g.secret && !w.knows.includes(`goal:${n.id}`)) return '玄冥剑？那是传说罢了，我没兴趣。';
  if (h === 'cave') return '听说还插在玄冥洞府深处的石台上。守着它的东西凶得很，去了的人没几个回来。';
  if (h === 'gone') return '玄冥剑早离开青冥州了。';
  if (h === ME) return '听说在你手上？那可得当心，盯着它的人不少。';
  return `如今在${nm(w, h)}手里。`;
}

export interface Scripted { reply: string; affinity: number; trust: number; revealed: string; offer: string }

/** 规则允许他这一句能透露、能提出的事 */
export interface Allow { reveals: string[]; offers: string[] }

/**
 * 离线的自由对话：听你说了什么，按他的性子和规则的门槛回答。
 * allow 为空时（只要一句寒暄）什么也不透露、不提。
 */
export function offlineReply(w: World, n: Npc, said: string, allow: Allow = { reveals: [], offers: [] }, extra: { sellLine?: string } = {}): Scripted {
  const o = op(n, ME);
  const out = (reply: string, affinity = 0, trust = 0, revealed = 'none', offer = 'none'): Scripted => ({ reply, affinity, trust, revealed, offer });
  const can = (k: string) => allow.offers.includes(k);
  const tp = topicOf(w, n, said);
  const higher = n.realm > w.me.realm || (n.realm === w.me.realm && n.stage > w.me.stage);
  const warm = o.aff >= 0 ? 1 : 0;
  switch (tp.t) {
    case 'rude': {
      const reply = has(n, 'proud') || has(n, 'rash') || has(n, 'cruel') ? '你再说一遍试试？' : has(n, 'kind') ? '……何必说这种话。' : '哼。';
      return out(reply, -3, -1);
    }
    case 'master': {
      if (can('master')) return out(`……也好。你若真心，我便收下你。`, 1, 1, 'none', 'master');
      if (w.me.master) return out(w.me.master === n.id ? '你本来就是我徒弟，傻了？' : '你已经有师父了，别这山望着那山高。');
      if (n.realm <= w.me.realm) return out('我的修为还不如你，哪敢收徒。');
      if (has(n, 'lonely')) return out(line(w, n, 'deflect', 'm') + '我不收徒。');
      return out(o.aff >= 0 ? '你我缘分还不到这一步。' : '我不收徒。');
    }
    case 'love': {
      if (can('partner')) return out('……你、你是认真的？那……好。', 2, 1, 'none', 'partner');
      if (o.aff >= 40) return out('……你说什么呢。（别过脸去）', 0);
      return out('你在说什么胡话。', -1);
    }
    case 'spar': {
      if (can('spar')) return out(n.id === 'li' ? '好！痛快！来！' : '好啊，过几招。', 1, 0, 'none', 'spar');
      return out(o.aff <= -40 ? '跟你？不配。' : '改日吧。');
    }
    case 'trade': {
      if (can('trade') && extra.sellLine) return out(extra.sellLine, 0, 0, 'none', 'trade');
      return out(n.place === 'market' || has(n, 'greedy') ? '眼下没什么好卖给你的，去铺子里看看吧。' : '我又不是开铺子的。');
    }
    case 'person': return out(aboutPerson(w, n, tp.who!, said).text, warm ? 1 : 0);
    case 'sword': return out(swordTalk(w, n));
    case 'place': return out(PLACE_TALK[tp.place!](w.me));
    case 'advice': {
      if (!higher) return out(has(n, 'proud') ? '哼，你的修为在我之上，还用得着问我？' : '你的修为在我之上，该我问你才是。');
      if (o.aff < -20) return out(line(w, n, 'cold', 'a'));
      return out(line(w, n, 'advice'), warm, 0, 'none', can('teach') ? 'teach' : 'none');
    }
    case 'plan': {
      const g = n.mind.goal;
      if (!g) return out('没什么打算，好好修炼罢了。');
      if (allow.reveals.includes('goal')) return out(`这话我只跟你说：${honestGoal(w, n)}`, 0, 1, 'goal');
      if (!g.secret || w.knows.includes(`goal:${n.id}`)) return out(honestGoal(w, n));
      return out(coverLine(g.cover));
    }
    case 'past': {
      const s = allow.reveals.find((k) => k.startsWith('secret:'));
      if (s) return out(`这话我只跟你说……${secretLine(w, s.slice(7))}`, 0, 1, s);
      const pry = (has(n, 'careful') || has(n, 'cunning') || has(n, 'grudge')) && o.aff < 20;
      return out(line(w, n, 'deflect'), pry ? -1 : 0);
    }
    case 'thanks': return out(line(w, n, 'thanks'), 1, 1);
    case 'praise': return out(line(w, n, 'praised'), has(n, 'proud') ? 2 : has(n, 'careful') || has(n, 'cunning') ? 0 : 1);
    case 'help': {
      const g = n.mind.goal;
      if (can('ally') && g) return out(g.secret && !w.knows.includes(`goal:${n.id}`) ? '正好，我有件事缺个帮手……到时候再跟你细说。' : `正好，我要${GOALS[g.kind].name}${targetName(w, g) ? `，冲着${targetName(w, g)}` : ''}，缺个帮手。`, 1, 0, 'none', 'ally');
      return out('眼下没什么要帮的，有心了。', has(n, 'kind') || has(n, 'loyal') ? 2 : 1);
    }
    case 'bye': return out(line(w, n, 'bye'));
    case 'hello': return out(greetLine(w, n), warm);
    case 'news': return out(newsLine(w, n) ?? (o.trust < 15 ? '我跟你不熟。' : '最近没听说什么。'));
    case 'who': return out(introLine(w, n));
    // 接不上话：要么随口应一句，要么说说自己的事
    case 'doing': return out(doingLine(w, n));
    case 'idle': return out(line(w, n, o.aff <= -25 ? 'cold' : 'idle'), 0);
  }
}

/** 今年在忙什么：外人看得到的那一面（瞒着人的就拿说法搪塞） */
function doingLine(w: World, n: Npc) {
  const why = publicPlan(w, n);
  if (!why) return '没忙什么。';
  if (why === '不知在忙些什么') return coverLine(n.mind.goal?.cover);
  return `眼下嘛，${why}。`;
}

/** 自报家门 */
function introLine(w: World, n: Npc) {
  const t = titleOf(w, n.id);
  switch (n.id) {
    case 'wen': return `贫道温玄，${t}。`;
    case 'li': return `连我厉擎都不认得？${t}！`;
    case 'mojiu': return '……墨九。';
    case 'hua': return '婆婆姓花，村里人都管我叫花婆婆。';
    case 'aman': return '我叫阿蛮！柳溪村打猎的！';
    case 'tang': return `我、我叫苏小棠，${t}！`;
    case 'liu': return '云渡坊最大的丹药铺子，就是我柳如烟的。';
    case 'bailu': return '……他们都叫我白鹿。和那头鹿一个名字。';
  }
  return `在下${n.name}，${t}。`;
}

/** 卖东西时他开口的话 */
export function sellPitch(item: string, price: number) {
  return `正好我这有一颗${ITEMS[item]?.name ?? item}，${price}灵石，要不要？`;
}
