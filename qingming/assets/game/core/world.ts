// 世界的基础操作：找人、战力、看法、新闻、开局。

import type { Being, Npc, Opinion, OriginId, PlaceId, RootId, World } from './types';
import { makeRng } from './rng';
import { ITEMS, LIFE, PLACES, POWER, REALMS, STAGES, stageCost } from '../data/world-data';
import { PEOPLE, type PersonDef } from '../data/people';

export const ME = 'me';
/** 存档修订号：每次加了需要补的字段就加一（见 save.ts） */
export const SAVE_REV = 2;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const npcs = (w: World) => Object.values(w.people).filter((n) => n.alive);
export const npc = (w: World, id: string): Npc | undefined => w.people[id];
export const being = (w: World, id: string): Being | undefined => (id === ME ? w.me : w.people[id]);
export const alive = (w: World, id: string) => !!being(w, id)?.alive;
export const here = (w: World, place: PlaceId) => npcs(w).filter((n) => n.place === place);
export const has = (n: Npc, t: string) => n.mind.traits.includes(t as never);

/** 名字：主角就叫主角起的名字 */
export const nm = (w: World, id: string) => (id === ME ? w.me.name : w.people[id]?.name ?? '某人');
export const ta = (w: World, id: string) => (being(w, id)?.gender === 'f' ? '她' : '他');
export const placeName = (p: PlaceId) => PLACES[p].name;
export const realmText = (b: Being) => (b.realm >= 4 ? REALMS[4] : `${REALMS[b.realm]}${STAGES[b.stage]}`);
export const lifeOf = (b: Being) => LIFE[b.realm] + b.bonus;
export const lifeLeft = (b: Being) => lifeOf(b) - b.age;
export const expNeed = (b: Being) => stageCost(b.realm);

/** 战力：境界为主，伤势和法宝为辅 */
export function power(b: Being) {
  let p = POWER[b.realm] * (1 + 0.3 * b.stage) * (0.35 + 0.65 * (b.hp / 100));
  if (b.items.includes('sword')) p *= 1.5;
  return p;
}

/** 甲对乙的看法（没有就按「初见」建一个） */
export function op(n: Npc, id: string): Opinion {
  return (n.mind.op[id] ??= { aff: 0, trust: 30, fear: 0 });
}
export function adjust(n: Npc, id: string, d: Partial<Opinion>) {
  if (id === n.id) return;
  const o = op(n, id);
  if (d.aff) o.aff = clamp(Math.round(o.aff + d.aff), -100, 100);
  if (d.trust) o.trust = clamp(Math.round(o.trust + d.trust), 0, 100);
  if (d.fear) o.fear = clamp(Math.round(o.fear + d.fear), 0, 100);
}
export const aff = (n: Npc, id: string) => n.mind.op[id]?.aff ?? 0;

export function news(w: World, text: string, tone: 'good' | 'bad' | 'story' | 'info', about: string[], big = false) {
  // 同一件事几年内不重复报
  if (w.news.slice(-60).some((x) => x.text === text && w.year - x.y < 5)) return;
  const line = { y: w.year, text, tone, about, big };
  w.news.push(line);
  if (about.includes(ME)) w.life.push(line);
  if (w.news.length > 300) w.news.splice(0, w.news.length - 300);
}
export const thisYear = (w: World) => w.news.filter((x) => x.y === w.year);

export function giveItem(b: Being, item: string) {
  b.items.push(item);
}
export function takeItem(b: Being, item: string) {
  const i = b.items.indexOf(item);
  if (i < 0) return false;
  b.items.splice(i, 1);
  return true;
}
export const itemName = (id: string) => ITEMS[id]?.name ?? id;

/** 宝物换手：从谁身上拿走，交到谁手里（也可以是地方：'cave'、'gone'） */
export function moveTreasure(w: World, item: string, from: string, to: string) {
  const a = being(w, from);
  if (a) takeItem(a, item);
  const b = being(w, to);
  if (b) giveItem(b, item);
  w.treasure[item] = to;
}

/** 名分：宗主、门主、弟子、散修 */
export function titleOf(w: World, id: string) {
  const b = being(w, id);
  if (!b?.sect) return '散修';
  const s = w.sects[b.sect];
  return s.master === id ? `${s.name}${s.id === 'qinglan' ? '宗主' : '门主'}` : `${s.name}弟子`;
}

/** 记下一件大事第一次发生在哪一年（模拟统计用，也给结局小传） */
export function mark(w: World, key: string) {
  w.flags[`story:${key}`] ??= w.year;
}

/** 杂灵根五行俱全，丹药的药力吸收得足（只有主角有灵根之分） */
export const strongPills = (w: World | undefined, b: Being) => !!w && b.id === ME && w.root === 'mixed';

/** 延寿越吃越不灵：第一次 +30 年，再 +20，再 +10，之后就没用了（杂灵根每次多 10 年，但也只能吃三次） */
export function lifeGain(b: Being, w?: World) {
  const [gains, at] = strongPills(w, b) ? [[40, 30, 20, 0], [40, 70, 90]] : [[30, 20, 10, 0], [30, 50, 60]];
  const used = at.filter((x) => b.bonus >= x).length;
  return gains[used];
}
export function extendLife(b: Being, w?: World) {
  const g = lifeGain(b, w);
  b.bonus += g;
  return g;
}

/**
 * 死了的人留下的事：道侣、师徒的名分解开；身上的宝物有个去处——
 * 道侣 → 徒弟 → 宗门之主；都没有，玄冥剑回到洞府的石台上，遗书就此失散。
 */
export function sweepDead(w: World) {
  const all: Being[] = [w.me, ...Object.values(w.people)];
  for (const [item, h] of Object.entries(w.treasure)) {
    if (h === 'cave' || h === 'gone' || alive(w, h)) continue;
    const dead = being(w, h);
    if (!dead) { w.treasure[item] = item === 'sword' ? 'cave' : 'gone'; continue; }
    const disciple = all.find((x) => x.alive && x.master === h);
    const sectHead = dead.sect ? w.sects[dead.sect].master : '';
    const heir = [dead.partner, disciple?.id, sectHead].find((id) => id && id !== h && alive(w, id));
    if (heir) {
      moveTreasure(w, item, h, heir);
      news(w, `${dead.name}留下的${itemName(item)}，到了${nm(w, heir)}手里。`, 'story', [heir, h], item === 'sword');
    } else {
      moveTreasure(w, item, h, item === 'sword' ? 'cave' : 'gone');
      if (item === 'sword') news(w, '玄冥剑又回到了洞府深处的石台上。', 'story', [], true);
    }
  }
  for (const b of all) {
    if (b.partner && !alive(w, b.partner)) b.partner = undefined;
    if (b.master && !alive(w, b.master)) b.master = undefined;
  }
}

// ───────────── 开局 ─────────────

export function makeNpc(d: PersonDef, year: number): Npc {
  return {
    id: d.id, name: d.name, gender: d.gender, alive: true, age: d.age,
    realm: d.realm, stage: d.stage, exp: 0, talent: d.talent, hp: 100, stones: d.stones, items: [...(d.items ?? [])],
    place: d.home, sect: d.sect, merit: 0, bonus: 0,
    mind: {
      traits: [...d.traits], values: { ...d.values },
      goal: d.goal ? { ...d.goal, step: d.goal.kind === 'revenge' && d.goal.target && d.knows?.includes(`secret:${d.goal.target}`) ? 1 : 0, stuck: 0, since: year, ...(d.goal.after ? { after: year - 1 + d.goal.after } : {}) } : null,
      past: [],
      op: Object.fromEntries(Object.entries(d.ties ?? {}).map(([k, v]) => [k, { aff: v, trust: 30 + Math.max(0, v) / 2, fear: 0 }])),
      mem: [], mood: 60, knows: [...(d.knows ?? [])],
    },
    plan: { act: 'cultivate', place: d.home, why: '', by: 'rule' },
  };
}

export type { RootId, OriginId };
/** 灵根是天生的资质，和家底无关（家底看出身） */
export const ROOTS: Record<RootId, { name: string; desc: string; talent: number; perk: string }> = {
  heaven: { name: '天灵根', desc: '万中无一。修炼极快，悟性过人：听泉悟道、请教前辈都格外有得。', talent: 1.3, perk: '悟性' },
  dual: { name: '双灵根', desc: '资质不错，福缘深厚：在外多遇好事，历练所得多三成。', talent: 1.2, perk: '福缘' },
  mixed: { name: '杂灵根', desc: '五行混杂，修炼慢些。好在根基扎实：冲关失败只跌两成修为；五行俱全，丹药的药力吸收得更足。', talent: 1.05, perk: '根基' },
};
/** 人人身上都有的一点灵石，其余看出身 */
const BASE_STONES = 30;

/** 出身：把你和青冥州的几个人绑在一起 */
export interface OriginDef {
  name: string;
  /** 一句话，卡片上写的 */
  short: string;
  desc: string;
  /** 从哪里出发 */
  at: PlaceId;
  stones?: number;
  items?: string[];
  stage?: number;
  /** 开局时他们怎么看你 */
  ties?: Record<string, Partial<Opinion>>;
  /** 开局就知道的事 */
  knows?: string[];
  /** 写进小传的第一句 */
  line: string;
  /** 开场：你是谁（第二人称） */
  story: string;
  /** 开场：在哪测的灵根 */
  test: string;
  /** 开场：测出来以后，旁边的人（或你自己）怎么样 */
  react: Record<RootId, string>;
  /** 测灵根是好些年前的事（赤霄门弃徒） */
  past?: boolean;
}
export const ORIGINS: Record<OriginId, OriginDef> = {
  wild: {
    name: '山野无名', short: '无牵无挂，多些盘缠', desc: '无牵无挂，没人认得你，也没人欠你。攒下了一小袋碎灵石。', at: 'village', stones: 40, line: '在柳溪村踏上了修行路',
    story: '你生在柳溪村外的山坳里，爹娘走得早，靠给人放牛、打零工长大，攒下了一小袋铜钱和几块碎灵石。',
    test: '十六岁那年，一位云游的仙师路过柳溪村，让村里的半大孩子挨个去摸测灵石。轮到你时，你的手心全是汗。',
    react: { heaven: '仙师愣了半晌，把你从人堆里拉了出来：「好一个天灵根！」', dual: '仙师点点头：「不错，是块修行的料子。」', mixed: '仙师摇了摇头：「能修，只是慢些。」村里的孩子们笑成一团。' },
  },
  mo: {
    name: '墨家遗孤', short: '墨九认你，温玄起疑', desc: '二十年前墨家满门被灭，你是漏掉的那个孩子。墨九会来认你，温玄也许会起疑。', at: 'village', stones: 10,
    ties: { mojiu: { aff: 55, trust: 60 }, wen: { aff: -15, fear: 0 } }, knows: ['goal:mojiu'], line: '带着墨家的旧事，在柳溪村踏上了修行路',
    story: '你不记得爹娘的样子，只记得一场烧红了半边天的大火。把你养大的老仆临终前攥着你的手说：你姓墨，墨家只剩你了；云渡坊有个少了两根手指的人，他会认得你。',
    test: '十六岁那年，一位云游的仙师路过柳溪村。你在人群后面站了很久，才走上前去摸那块测灵石。',
    react: { heaven: '仙师愣了半晌，问你姓什么。你想起老仆的话，没敢说实话。', dual: '仙师点点头：「不错。」你攥紧了拳头——墨家的仇，总算有了指望。', mixed: '仙师摇了摇头：「能修，只是慢些。」你没吭声，心里那团火却没灭。' },
  },
  hua: {
    name: '药婆婆家的孩子', short: '花婆婆带大，懂草药', desc: '花婆婆在柳溪村口捡了你，一手带大。认得草药，采药、行医都更拿手。', at: 'village', items: ['heal', 'heal'],
    ties: { hua: { aff: 70, trust: 75 }, aman: { aff: 45, trust: 55 } }, line: '辞别了花婆婆，在柳溪村踏上了修行路',
    story: '你是花婆婆在村口捡回来的。跟着她认草药、熬汤药、给村里人看病，一晃长到了十六岁；隔壁猎户家的阿蛮，从小跟你一块儿掏鸟窝。',
    test: '十六岁生辰那天，花婆婆从箱底翻出一块蒙了灰的测灵石：「娃儿，把手按上去。」',
    react: { heaven: '花婆婆手一抖：「娃儿……这是天灵根啊。」她转过身去，抹了抹眼角。', dual: '花婆婆笑出了眼泪：「好，好，是块修行的料子。」', mixed: '花婆婆摸了摸你的头：「慢些就慢些，婆婆这些年攒下的东西，都给你带上。」' },
  },
  ledger: {
    name: '坊市账房出身', short: '灵石多，卖得上价', desc: '在云渡坊替人记过几年账：柳如烟认得你，韩烈还欠着你东家的钱。灵石多，卖东西也卖得上价。', at: 'market', stones: 130,
    ties: { liu: { aff: 30, trust: 45 }, han: { aff: -15 } }, line: '扔了算盘，在云渡坊踏上了修行路',
    story: '你在云渡坊的铺子里替人记了几年账，算盘打得比谁都快。柳老板常来对账，认得你；赤霄门的韩长老欠着东家一笔钱，一拖就是三年。',
    test: '东家收来一块测灵石当摆设。一天夜里铺子打烊，你鬼使神差地把手按了上去。',
    react: { heaven: '你盯着那道光，半天没敢把手拿开。第二天，你辞了工。', dual: '你心口怦怦直跳，把算盘往柜台上一推。', mixed: '你叹了口气。好在这些年攒下的灵石，够你慢慢修。' },
  },
  outcast: {
    name: '赤霄门弃徒', short: '底子好，赤霄门不容', desc: '在赤霄门当过几年外门弟子，犯了门规被赶下山。底子好些；秦焰是旧识，门主和韩烈不待见你。', at: 'forest', stage: 1, stones: 10,
    ties: { qinyan: { aff: 40, trust: 45 }, li: { aff: -20 }, han: { aff: -30 } }, line: '被赶出赤霄门，在黑松林边上重新开始修行',
    story: '你在赤霄门当过几年外门弟子，和秦焰一起挨过罚、一起偷过酒。后来替秦焰出头，顶撞了韩长老，被门主亲口赶下了山。',
    test: '你还记得当年入赤霄门时测灵根的那一天。',
    react: { heaven: '管事写下「天灵根」三个字时，手都在抖。可惜天灵根也挡不住门规。', dual: '管事在名册上写了「双灵根」，说你是块料子——后来赶你下山的，也是他。', mixed: '管事在名册上写了「杂灵根」，从此没人正眼看过你。' },
    past: true,
  },
  servant: {
    name: '青岚外门杂役', short: '大师姐照顾过你', desc: '在青岚宗山门扫过三年地，大师姐照顾过你，小师妹和你最熟；想入青岚宗容易些。陆沉舟看你，像看一枚棋子。', at: 'qinglan', stones: 10,
    ties: { shen: { aff: 35, trust: 50 }, tang: { aff: 45, trust: 50 }, lu: { aff: 10, trust: 40 } }, line: '放下扫帚，在青岚宗山门外踏上了修行路',
    story: '你在青岚宗山门扫了三年地，看着一个个弟子御剑而过。大师姐沈清禾冬天给过你一件旧棉袍，小师妹苏小棠常偷偷塞给你点心。',
    test: '青岚宗开山收徒那天，你放下扫帚，悄悄排进了队伍，把手按上了测灵石。',
    react: { heaven: '执事愣了半天才喊出声：「天灵根！」可宗门收不收你，还得过了拜山那一关。', dual: '执事看了你一眼：「双灵根。想入门，拜山那天再来。」', mixed: '执事摇了摇头：「杂灵根……先回去扫地吧。」' },
  },
};

// ───────────── 天定的：灵根和出身 ─────────────

export const ELEMENTS = ['金', '木', '水', '火', '土'] as const;
/** 测灵石上的光 */
export const EL_LIGHT: Record<string, string> = { 金: '白', 木: '青', 水: '蓝', 火: '赤', 土: '黄' };
/** 灵根多少：天灵根少见，杂灵根最多 */
const ROOT_ODDS: [RootId, number][] = [['heaven', 12], ['dual', 38], ['mixed', 50]];
const ORIGIN_ODDS: [OriginId, number][] = [['wild', 26], ['mo', 12], ['hua', 16], ['ledger', 16], ['outcast', 14], ['servant', 16]];

/** 投胎：灵根、五行、出身都由天定，同一个种子投出来一样 */
export function rollBirth(seed: number): { root: RootId; origin: OriginId; el: string } {
  const rng = makeRng((seed ^ 0x5bd1e995) >>> 0);
  const root = rng.weighted(ROOT_ODDS)!;
  const origin = rng.weighted(ORIGIN_ODDS)!;
  const k = root === 'heaven' ? 1 : root === 'dual' ? 2 : rng.int(3, 5);
  const el = rng.shuffle([...ELEMENTS]).slice(0, k).sort((a, b) => ELEMENTS.indexOf(a) - ELEMENTS.indexOf(b)).join('');
  return { root, origin, el };
}

/** 「天灵根（火）」「杂灵根（金、木、土）」 */
export const rootText = (w: World) => {
  const r = ROOTS[w.root ?? 'dual'].name;
  return w.rootEl ? `${r}（${[...w.rootEl].join('、')}）` : r;
};

export function newWorld(seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0, opts: { name?: string; root?: RootId; gender?: 'm' | 'f'; origin?: OriginId; el?: string } = {}): World {
  const rootId = opts.root ?? 'dual';
  const root = ROOTS[rootId];
  const originId = opts.origin ?? 'wild';
  const origin = ORIGINS[originId];
  const w: World = {
    v: 1, seed, rng: seed, year: 1, phase: 'year',
    me: {
      id: ME, name: opts.name?.trim() || '无名', gender: opts.gender ?? 'm', alive: true, age: 16,
      realm: 0, stage: origin.stage ?? 0, exp: 0, talent: root.talent, hp: 100, stones: BASE_STONES + (origin.stones ?? 0), items: [...(origin.items ?? [])],
      place: origin.at, sect: '', merit: 0, bonus: 0,
    },
    people: {},
    sects: { qinglan: { id: 'qinglan', name: '青岚宗', master: 'wen' }, chixiao: { id: 'chixiao', name: '赤霄门', master: 'li' } },
    treasure: { sword: 'cave', letter: 'cave' },
    knows: [], news: [], pending: [],
    turn: { moved: false, main: false, social: 2, talk: {} },
    chat: {}, offer: null, heard: [],
    flags: { lifeStock: 1 }, ending: null, life: [], nextId: 1,
    rev: SAVE_REV, fame: 0, root: rootId, origin: originId, ...(opts.el ? { rootEl: opts.el } : {}),
  };
  for (const d of PEOPLE) w.people[d.id] = makeNpc(d, 1);
  for (const [id, d] of Object.entries(origin.ties ?? {})) {
    const n = w.people[id];
    if (!n) continue;
    const o = op(n, ME);
    if (d.aff !== undefined) o.aff = d.aff;
    if (d.trust !== undefined) o.trust = d.trust;
    if (d.fear !== undefined) o.fear = d.fear;
  }
  w.knows.push(...(origin.knows ?? []));
  news(w, `${w.me.name}，${rootText(w)}，十六岁，${origin.line}。`, 'story', [ME]);
  return w;
}

export const isMaster = (w: World, id: string) => w.sects.qinglan.master === id || w.sects.chixiao.master === id;
export const expNeedText = (b: Being) => `${Math.floor(b.exp)}/${expNeed(b)}`;
