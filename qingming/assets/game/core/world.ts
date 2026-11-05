// 世界的基础操作：找人、战力、看法、新闻、开局。

import type { Being, Npc, Opinion, PlaceId, World } from './types';
import { ITEMS, LIFE, PLACES, POWER, REALMS, STAGES, stageCost } from '../data/world-data';
import { PEOPLE, type PersonDef } from '../data/people';

export const ME = 'me';
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

// ───────────── 开局 ─────────────

export function makeNpc(d: PersonDef, year: number): Npc {
  return {
    id: d.id, name: d.name, gender: d.gender, alive: true, age: d.age,
    realm: d.realm, stage: d.stage, exp: 0, talent: d.talent, hp: 100, stones: d.stones, items: [...(d.items ?? [])],
    place: d.home, sect: d.sect, merit: 0, bonus: 0,
    mind: {
      traits: [...d.traits], values: { ...d.values },
      goal: d.goal ? { ...d.goal, step: d.goal.kind === 'revenge' && d.goal.target && d.knows?.includes(`secret:${d.goal.target}`) ? 1 : 0, stuck: 0, since: year } : null,
      past: [],
      op: Object.fromEntries(Object.entries(d.ties ?? {}).map(([k, v]) => [k, { aff: v, trust: 30 + Math.max(0, v) / 2, fear: 0 }])),
      mem: [], mood: 60, knows: [...(d.knows ?? [])],
    },
    plan: { act: 'cultivate', place: d.home, why: '', by: 'rule' },
  };
}

export const ROOTS = {
  heaven: { name: '天灵根', desc: '修炼极快，可惜两手空空。', talent: 1.5, stones: 10, items: [] as string[] },
  dual: { name: '双灵根', desc: '资质不错，带着些盘缠。', talent: 1.2, stones: 60, items: ['heal'] },
  mixed: { name: '杂灵根', desc: '资质平平，但家底殷实。', talent: 0.9, stones: 150, items: ['pill', 'heal', 'heal'] },
} as const;
export type RootId = keyof typeof ROOTS;

export function newWorld(seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0, opts: { name?: string; root?: RootId; gender?: 'm' | 'f' } = {}): World {
  const root = ROOTS[opts.root ?? 'dual'];
  const w: World = {
    v: 1, seed, rng: seed, year: 1, phase: 'year',
    me: {
      id: ME, name: opts.name?.trim() || '无名', gender: opts.gender ?? 'm', alive: true, age: 16,
      realm: 0, stage: 0, exp: 0, talent: root.talent, hp: 100, stones: root.stones, items: [...root.items],
      place: 'village', sect: '', merit: 0, bonus: 0,
    },
    people: {},
    sects: { qinglan: { id: 'qinglan', name: '青岚宗', master: 'wen' }, chixiao: { id: 'chixiao', name: '赤霄门', master: 'li' } },
    treasure: { sword: 'cave', letter: 'cave' },
    knows: [], news: [], pending: [],
    turn: { moved: false, main: false, social: 2, talk: {} },
    chat: {}, offer: null,
    flags: {}, ending: null, life: [], nextId: 1,
  };
  for (const d of PEOPLE) w.people[d.id] = makeNpc(d, 1);
  news(w, `${w.me.name}${root.name}，十六岁，在柳溪村踏上了修行路。`, 'story', [ME]);
  return w;
}

export const isMaster = (w: World, id: string) => w.sects.qinglan.master === id || w.sects.chixiao.master === id;
export const expNeedText = (b: Being) => `${Math.floor(b.exp)}/${expNeed(b)}`;
