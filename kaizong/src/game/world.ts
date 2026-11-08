// 世界的基本操作：取人、改看法、记经历和季报、性情合成、威望。

import { realmPrestige } from './cult';
import { TRAIT } from './data/traits';
import { rankLv } from './data/world';
import { makeRng, type Rng } from './rng';
import type { Disp, LifeEntry, Opinion, Person, ReportItem, World } from './types';

export const year = (t: number) => Math.floor(t / 4) + 1;
export const seasonName = (t: number) => '春夏秋冬'[t % 4];
export const timeText = (t: number) => `第${year(t)}年${seasonName(t)}`;

/** 每次要随机数时从存档里的状态接着往下走，保证读档后结果一样 */
export function rngOf(w: World): Rng & { save(): void } {
  const r = makeRng(w.rng);
  return Object.assign(r, { save: () => { w.rng = r.state(); } });
}

export const P = (w: World, id: string | undefined | null): Person | undefined => (id ? w.people[id] : undefined);
export const nm = (w: World, id: string | undefined | null) => P(w, id)?.name ?? '某人';
export const me = (w: World) => w.people[w.me];

/** 本宗活着的弟子（不含宗主） */
export const members = (w: World) => w.members.map((id) => w.people[id]).filter((p) => p && p.alive && p.id !== w.me);
/** 本宗所有活人（含宗主） */
export const everyone = (w: World) => w.members.map((id) => w.people[id]).filter((p) => p && p.alive);

export function op(a: Person, b: string): Opinion {
  return a.ops[b] ?? (a.ops[b] = { aff: 0, respect: 0 });
}

export function adjust(a: Person, b: string, aff: number, respect = 0) {
  const o = op(a, b);
  o.aff = clamp(o.aff + aff, -100, 100);
  o.respect = clamp(o.respect + respect, -100, 100);
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 性情：性格标签的加减 + 价值取向 */
export function disp(p: Person, k: Disp): number {
  let v = 0;
  for (const t of p.traits) v += TRAIT[t]?.d[k] ?? 0;
  if (k === 'ambition') v += (p.values.power - 0.5) * 2;
  if (k === 'greed') v += (p.values.wealth - 0.5) * 2;
  if (k === 'kindness') v += (p.values.bond - 0.5) * 1.5;
  if (k === 'order') v += (p.values.loyalty - 0.5) * 1.5;
  if (k === 'temper') v += (p.values.justice - 0.5) * 0.8;
  return v;
}

export function hasTrait(p: Person, id: string) {
  return p.traits.includes(id);
}

export function addLife(w: World, p: Person, text: string, tone: LifeEntry['tone'] = 'info', big = false) {
  p.life.push({ t: w.t, text, tone, big });
  if (p.life.length > 80) p.life.splice(0, p.life.length - 80);
}

export function report(w: World, item: Omit<ReportItem, 't'>) {
  w.report.push({ t: w.t, ...item });
}

/** 威望：修为、功劳、资历、战绩、宗主恩宠 */
export function prestige(w: World, p: Person): number {
  let v = realmPrestige(p) + p.merit * 0.4 + p.seniority * 0.5 + p.fame * 0.6 + p.favor;
  // 宗门大比的名次一年内作数
  const tr = w.sect.tourneyRank;
  if (tr && w.sect.tourneyYear !== undefined && year(w.t) - w.sect.tourneyYear <= 1) {
    const i = tr.indexOf(p.id);
    if (i >= 0) v += Math.max(0, 30 - i * 5);
  }
  return Math.round(v);
}

/** 谁的地位更高：身份先比，同身份时殿堂主事高于普通弟子 */
export function standing(p: Person): number {
  return rankLv(p.rank) * 10 + (p.head ? 5 : 0);
}

export function newId(w: World, prefix: string) {
  return `${prefix}${w.nextId++}`;
}

export function pronoun(p: Person) {
  return p.gender === 'f' ? '她' : '他';
}
