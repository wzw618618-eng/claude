// 宗门的日常：岗位合不合适、服不服、殿堂产出、修炼、月例。

import { atBottleneck, lvl, need, power as powerOf, stepUp } from './cult';
import { HALL, HALL_CAP, HALL_MULT, HALLS, HEAD_EXPECT, JOB_NAME, JOB_TIME, RANK_EXPECT, RANK_NAME, UPKEEP } from './data/world';
import type { Rng } from './rng';
import type { HallId, JobId, Person, Rank, World } from './types';
import { addLife, clamp, disp, everyone, members, prestige, standing } from './world';

export const hallMembers = (w: World, h: HallId) => members(w).filter((p) => p.job === h);
export const hallHead = (w: World, h: HallId) => everyone(w).find((p) => p.head === h);
export const hallCap = (w: World, h: HallId) => HALL_CAP[w.sect.halls[h]];

/** 意愿：喜欢的活干得起劲，讨厌的活干不好 */
export function will(p: Person, job: JobId): number {
  if (p.likes.includes(job)) return 1.25;
  if (p.dislikes.includes(job)) return 0.6;
  return 1;
}

/** 一个人干某个殿堂的活合不合适（0–2 左右）：才干 × 意愿 × 心情 */
export function fit(p: Person, h: HallId): number {
  const d = HALL[h];
  const sk = 0.3 + p.skills[d.skill] / 100 + (d.skill2 ? (0.3 * p.skills[d.skill2]) / 100 : 0);
  return sk * will(p, h) * (0.7 + p.mood / 250);
}

export function fitWord(p: Person, h: HallId): { text: string; tone: 'good' | 'bad' | 'info' } {
  const f = fit(p, h);
  const like = p.likes.includes(h) ? '，喜欢干这个' : p.dislikes.includes(h) ? '，讨厌干这个' : '';
  if (f >= 1.05) return { text: `很合适${like}`, tone: 'good' };
  if (f >= 0.7) return { text: `还行${like}`, tone: 'info' };
  return { text: `不合适${like}`, tone: 'bad' };
}

/** 能忍多大的落差：守规矩的人能忍，傲气的人一点都忍不了 */
export function tolerance(p: Person): number {
  return Math.max(0, 0.15 + 0.08 * disp(p, 'order') - 0.1 * disp(p, 'pride') + (p.loyalty - 50) / 250);
}

export interface Unconvinced { who: string; over: string; gap: number; why: 'head' | 'rank' }

/** 谁不服谁：修为、功劳比上级高出一截却屈居其下 */
export function unconvinced(w: World): Unconvinced[] {
  const out: Unconvinced[] = [];
  const ps = members(w);
  const pres = new Map(everyone(w).map((p) => [p.id, prestige(w, p)]));
  for (const p of ps) {
    const mine = pres.get(p.id)!;
    const tol = tolerance(p);
    // 殿堂主事
    if (p.job !== 'none' && p.job !== 'seclude' && p.job !== 'travel' && p.head !== p.job) {
      const h = hallHead(w, p.job as HallId);
      if (h && h.id !== w.me && mine > pres.get(h.id)! * (1 + tol) + 5) out.push({ who: p.id, over: h.id, gap: mine - pres.get(h.id)!, why: 'head' });
    }
    // 身份比他高的人
    let worst: Unconvinced | null = null;
    for (const q of ps) {
      if (q.id === p.id || standing(q) <= standing(p)) continue;
      const gap = mine - pres.get(q.id)!;
      if (mine > pres.get(q.id)! * (1 + tol) + 5 && (!worst || gap > worst.gap)) worst = { who: p.id, over: q.id, gap, why: 'rank' };
    }
    if (worst && !out.some((u) => u.who === p.id && u.over === worst!.over)) out.push(worst);
  }
  return out;
}

/** 德不配位：修为不够却坐在高位 */
export function underqualified(p: Person): string | null {
  if (p.rank === 'master') return null;
  if (lvl(p) < RANK_EXPECT[p.rank]) return `${RANK_NAME[p.rank]}一般要更高的修为`;
  if (p.head && lvl(p) < HEAD_EXPECT) return `修为太低，镇不住${HALL[p.head].name}`;
  return null;
}

/** 这一季各殿堂干出来的东西，和过季时其他环节要用的数 */
export interface Work {
  cultBonus: number;
  lawPower: number;
  recruitPower: number;
  guardPower: number;
  byHall: Record<HallId, number>;
}

const EFFORT: Record<string, number> = { diligent: 1.4, slack: 0.4, cultivate: 0.6 };

export function doWork(w: World, r: Rng, unc: Unconvinced[]): Work {
  const s = w.sect;
  const has = (t: string) => s.tech.includes(t);
  const pol = s.policy;
  const work: Work = { cultBonus: 1, lawPower: 0, recruitPower: 0, guardPower: 0, byHall: {} as Record<HallId, number> };
  const notConvinced = new Set(unc.filter((u) => u.why === 'head').map((u) => u.who));
  for (const h of HALLS) {
    // 还没建的殿堂没人干活
    if (!s.halls[h.id]) { work.byHall[h.id] = 0; continue; }
    const head = hallHead(w, h.id);
    const crew = hallMembers(w, h.id).slice(0, hallCap(w, h.id));
    if (head && head.id !== w.me && !crew.includes(head)) crew.push(head);
    let sum = 0;
    for (const p of crew) {
      let c = fit(p, h.id) * (EFFORT[p.lastAct ?? ''] ?? 1) * (p.hp < 40 ? 0.5 : 1);
      if (notConvinced.has(p.id)) c *= 0.7;
      sum += c;
      p.merit += c * 1.5;
      // 干久了才干长进；天分是上限
      const grow = (sk: keyof Person['skills'], k: number) => {
        p.skills[sk] = Math.min(p.caps[sk], p.skills[sk] + Math.max(0, p.caps[sk] - p.skills[sk]) * k * will(p, h.id));
      };
      grow(h.skill, 0.05);
      if (h.skill2) grow(h.skill2, 0.02);
    }
    let F = HALL_MULT[s.halls[h.id]];
    if (head) {
      F *= 1 + head.skills.manage / 220 + head.skills[h.skill] / 260;
      if (head.id !== w.me && underqualified(head)) F *= 0.85;
    } else F *= 0.85;
    const out = sum * F;
    work.byHall[h.id] = Math.round(out * 100) / 100;
    switch (h.id) {
      case 'herb': {
        const n = 9 * out * (pol === 'pill' ? 1.5 : 1) * (s.heritage === 'herb' ? 1.1 : 1) * (s.site === 'vein' ? 1.1 : 1);
        s.herbs += n; s.ledger.herbs = (s.ledger.herbs ?? 0) + n;
        break;
      }
      case 'alchemy': {
        const used = Math.min(s.herbs, 8 * out);
        s.herbs -= used;
        const pills = used * 0.4 * (has('pill_hall') ? 1.3 : 1) * (pol === 'pill' ? 1.3 : 1);
        s.pills += pills; s.ledger.pills = (s.ledger.pills ?? 0) + pills;
        if (has('foundation_recipe') && head && head.skills.alchemy >= 40 && s.herbs >= 30 && r.chance(0.2 + head.skills.alchemy / 300)) {
          s.herbs -= 30; s.fpills += 1; s.ledger.fpills = (s.ledger.fpills ?? 0) + 1;
        }
        break;
      }
      case 'forge': {
        const used = Math.min(s.stones, 8 * out);
        s.stones -= used;
        s.armory += used * 0.6 * (pol === 'craft' ? 2 : 1);
        s.ledger.forge = (s.ledger.forge ?? 0) - used;
        break;
      }
      case 'teach': work.cultBonus = 1 + Math.min(0.35, 0.06 * out); break;
      case 'law': work.lawPower = out * (has('rules') ? 1.3 : 1); break;
      case 'diplomacy': {
        const st = 14 * out * (pol === 'trade' ? 2 : 1) * (has('caravan') ? 1.5 : 1);
        s.stones += st; s.ledger.trade = (s.ledger.trade ?? 0) + st;
        s.rep += 1.2 * out * (has('caravan') ? 1.3 : 1) * (pol === 'ally' ? 1.5 : 1);
        break;
      }
      case 'recruit': work.recruitPower = out; break;
      case 'guard': work.guardPower = crew.reduce((t, p) => t + Math.sqrt(p.skills.combat + 10) * fit(p, 'guard'), 0) * F; break;
    }
  }
  return work;
}

/** 每季修炼：资质 × 悟性 × 功法 × 灵脉 × 时间 × 心情 × 丹药 × 传功殿 */
export function cultivate(w: World, r: Rng, work: Work): { pillTo: Set<string>; leveled: Person[]; bottleneck: Person[] } {
  const s = w.sect;
  const has = (t: string) => s.tech.includes(t);
  const tech = (has('technique_2') ? 1.2 : 1) * (has('technique_3') ? 1.25 : 1) * (has('blood_art') ? 1.3 : 1) * (s.heritage === 'mind' ? 1.1 : 1);
  const site = s.site === 'vein' ? 1.15 : 1;
  const veins = 1 + Math.max(-0.15, Math.min(0.3, (s.veins - 2) * 0.08));
  // 丹药怎么分
  const ps = everyone(w);
  const order = [...ps].filter((p) => p.id !== w.me).sort((a, b) => {
    switch (s.pillRule) {
      case 'merit': return b.merit - a.merit;
      case 'talent': return b.root.apt - a.root.apt || b.wit - a.wit;
      case 'core': return standing(b) - standing(a);
      default: return r.next() - 0.5;
    }
  });
  const pillTo = new Set<string>();
  let pills = Math.floor(s.pills);
  for (const p of order) {
    if (pills <= 0) break;
    if (s.pillRule === 'core' && !['core', 'chief', 'elder'].includes(p.rank)) continue;
    pillTo.add(p.id); pills--;
  }
  s.pills -= pillTo.size;
  s.ledger.pillsUsed = pillTo.size;
  const leveled: Person[] = [];
  const bottleneck: Person[] = [];
  for (const p of ps) {
    const effort = p.lastAct === 'cultivate' ? 1.4 : p.lastAct === 'diligent' ? 0.7 : 1;
    const time = p.id === w.me ? 0.35 : JOB_TIME[p.job] * (p.head ? 0.8 : 1);
    const gain = 12 * p.root.apt * (0.7 + (p.wit / 100) * 0.6) * tech * site * veins * time * effort *
      (0.7 + p.mood / 250) * (pillTo.has(p.id) ? 1.25 : 1) * work.cultBonus * (0.5 + p.hp / 200) * r.range(0.85, 1.15);
    const before = p.stage;
    const wasStuck = atBottleneck(p);
    p.exp += gain;
    stepUp(p);
    if (p.stage !== before) leveled.push(p);
    if (!wasStuck && atBottleneck(p)) bottleneck.push(p);
    if (atBottleneck(p)) p.exp = need(p);
  }
  return { pillTo, leveled, bottleneck };
}

/** 月例 */
export function payUpkeep(w: World): boolean {
  const s = w.sect;
  let cost = members(w).reduce((t, p) => t + UPKEEP[p.rank], 0);
  if (s.policy === 'hide') cost *= 0.8;
  s.ledger.upkeep = -cost;
  if (s.stones >= cost) { s.stones -= cost; return true; }
  s.stones = 0;
  for (const p of members(w)) {
    p.mood = clamp(p.mood - 8, 0, 100);
    p.grudge = clamp(p.grudge + 5, 0, 100);
    p.loyalty = clamp(p.loyalty - 3, 0, 100);
  }
  return false;
}

/** 任命：换岗、当主事、升降身份。都记成宗主亲手做的事 */
export function assignJob(w: World, p: Person, job: JobId) {
  if (p.job === job) return;
  if (p.head && p.head !== job) p.head = undefined;
  p.job = job;
  p.tenure = 0;
  notePairs(w, p);
  w.acts.push({ kind: 'job', who: p.id, hall: job, text: `把${p.name}调去${JOB_NAME[job]}` });
}

/** 记下宗主把谁和谁安排到了一处 */
function notePairs(w: World, p: Person) {
  if (p.job === 'none' || p.job === 'seclude') return;
  for (const q of members(w)) {
    if (q.id !== p.id && q.job === p.job) w.pairings[[p.id, q.id].sort().join('|')] = w.t;
  }
}

export function setHead(w: World, h: HallId, p: Person | null) {
  const old = hallHead(w, h);
  if (old) old.head = undefined;
  if (p) {
    if (p.head) p.head = undefined;
    p.head = h;
    p.job = h;
    p.tenure = 0;
    notePairs(w, p);
    w.acts.push({ kind: 'head', who: p.id, hall: h, text: `任命${p.name}为${HALL[h].name}主事` });
    if (old && old.id !== p.id) w.acts.push({ kind: 'unhead', who: old.id, hall: h, text: `撤了${old.name}的主事` });
  }
}

export function setRank(w: World, p: Person, rank: Rank) {
  if (p.rank === rank) return;
  const up = ['probation', 'outer', 'inner', 'core', 'chief', 'elder'].indexOf(rank) > ['probation', 'outer', 'inner', 'core', 'chief', 'elder'].indexOf(p.rank);
  if (rank === 'chief') for (const q of members(w)) if (q.rank === 'chief') q.rank = 'core';
  p.rank = rank;
  if (rank === 'probation') p.probation = 0;
  w.acts.push({ kind: up ? 'promote' : 'demote', who: p.id, text: `${up ? '把' : '将'}${p.name}${up ? '升为' : '降为'}${RANK_NAME[rank]}` });
  addLife(w, p, `被宗主${up ? '升为' : '降为'}${RANK_NAME[rank]}`, up ? 'good' : 'bad');
  if (up) { p.mood = clamp(p.mood + 10, 0, 100); p.grudge = clamp(p.grudge - 15, 0, 100); }
  else { p.mood = clamp(p.mood - 15, 0, 100); p.grudge = clamp(p.grudge + 15, 0, 100); }
}

/** 一个人在宗门里的位置，一句话 */
export function postText(w: World, p: Person): string {
  const parts = [RANK_NAME[p.rank]];
  if (p.head) parts.push(`${HALL[p.head].name}主事`);
  else if (p.job !== 'none') parts.push(JOB_NAME[p.job]);
  return parts.join(' · ');
}

/** 宗门战力（打仗、排名用） */
export function sectStrength(w: World): number {
  return everyone(w).reduce((t, p) => t + Math.sqrt(powerOf(p)) * 10, 0);
}

export function skillTop(w: World, sk: keyof Person['skills']): Person | undefined {
  return members(w).reduce<Person | undefined>((best, p) => (!best || p.skills[sk] > best.skills[sk] ? p : best), undefined);
}
