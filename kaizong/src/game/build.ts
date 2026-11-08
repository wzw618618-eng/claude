// 营造：殿堂是一座座建起来的。开局只有灵植园和巡山队，其余要花灵石、满足条件，按天数慢慢盖好。
// 等级 0 是空地，1 刚建成（放 2 人），往上每扩建一次多放 2 人、产出更高。工匠有限，同时只能建一处（中品宗门以后两处）。

import { HALL, HALLS } from './data/world';
import type { HallId, World } from './types';
import { emit } from './fx';
import { addLife, clamp, dateText, daysLeft, me, members, nowDay, report } from './world';

export const MAX_LV = 4;

interface BuildDef { cost: number; days: number; need?: (w: World) => string | null }

/** 新建要花的灵石和天数（一季九十天） */
export const BUILD: Record<HallId, BuildDef> = {
  herb: { cost: 80, days: 30 },
  guard: { cost: 80, days: 30 },
  recruit: { cost: 80, days: 36 },
  alchemy: { cost: 100, days: 45, need: (w) => (w.sect.halls.herb > 0 ? null : '先建灵植园：丹房要灵草') },
  diplomacy: { cost: 120, days: 45, need: (w) => (w.sect.rep >= 30 ? null : `名望要到 30（现在 ${Math.round(w.sect.rep)}）`) },
  forge: { cost: 140, days: 75, need: (w) => (members(w).length >= 6 ? null : `弟子要有 6 人（现在 ${members(w).length}）`) },
  law: { cost: 140, days: 50, need: (w) => (members(w).length >= 8 ? null : `弟子要有 8 人（现在 ${members(w).length}）`) },
  teach: { cost: 180, days: 90, need: (w) => (members(w).some((p) => p.realm >= 1) || members(w).length >= 10 ? null : '要有一位筑基弟子，或者弟子满 10 人') },
};

/** 扩建：下标是现在的等级 */
const UPGRADE_COST = [0, 100, 240, 480];
const UPGRADE_DAYS = [0, 40, 70, 90];

export const isBuilt = (w: World, h: HallId) => w.sect.halls[h] > 0;
export const builtHalls = (w: World) => HALLS.filter((h) => isBuilt(w, h.id));
export const maxWorks = (w: World) => 1 + (w.tier >= 2 ? 1 : 0);
export const workOn = (w: World, h: HallId) => w.sect.works.find((x) => x.hall === h);

/** 下一步（新建或扩建）要花多少、几天 */
export function nextStep(w: World, h: HallId): { cost: number; days: number; to: number } | null {
  const lv = w.sect.halls[h];
  if (lv >= MAX_LV) return null;
  if (lv === 0) return { cost: BUILD[h].cost, days: BUILD[h].days, to: 1 };
  return { cost: UPGRADE_COST[lv], days: UPGRADE_DAYS[lv], to: lv + 1 };
}

/** 现在能不能动工；不能就说为什么 */
export function buildBlock(w: World, h: HallId): string | null {
  const step = nextStep(w, h);
  if (!step) return '已经最高了';
  if (workOn(w, h)) return '正在建';
  if (w.sect.works.length >= maxWorks(w)) return `工匠都在忙（同时只能建 ${maxWorks(w)} 处）`;
  if (step.to === 1) { const no = BUILD[h].need?.(w); if (no) return no; }
  if (w.sect.stones < step.cost) return `灵石不够（要 ${step.cost}）`;
  return null;
}

export function startWork(w: World, h: HallId): string | null {
  const no = buildBlock(w, h);
  if (no) return no;
  const step = nextStep(w, h)!;
  w.sect.stones -= step.cost;
  const now = nowDay(w);
  w.sect.works.push({ hall: h, to: step.to, from: now, done: now + step.days });
  emit({ k: 'float', at: h, text: `动工 −${step.cost}灵石`, tone: 'info' });
  w.acts.push({ kind: 'build', hall: h, text: `${step.to === 1 ? '动工建' : '扩建'}${HALL[h].name}` });
  return null;
}

/** 什么时候完工（界面用） */
export function doneText(w: World, done: number) {
  const n = daysLeft(w, done);
  return n <= 0 ? '今天落成' : `还有 ${n} 日 · ${dateText(done)}落成`;
}

/** 盖到几成了（0–1） */
export function workProgress(w: World, x: World['sect']['works'][number]) {
  const from = x.from ?? x.done - 30;
  return Math.max(0, Math.min(1, (nowDay(w) - from) / Math.max(1, x.done - from)));
}

/** 每天：到期的工程完工 */
export function finishWorks(w: World) {
  const left = [];
  const now = nowDay(w);
  for (const x of w.sect.works) {
    if (x.done > now) { left.push(x); continue; }
    emit({ k: 'built', hall: x.hall });
    w.sect.halls[x.hall] = Math.max(w.sect.halls[x.hall], x.to);
    const name = HALL[x.hall].name;
    if (x.to === 1) {
      w.sect.authority = clamp(w.sect.authority + 2, 0, 100);
      for (const p of members(w)) if (p.likes.includes(x.hall)) p.mood = clamp(p.mood + 5, 0, 100);
      addLife(w, me(w), `建成${name}`, 'good');
      report(w, { text: `${name}落成了。可以派人进去了。`, tone: 'good', about: [], big: true });
    } else {
      report(w, { text: `${name}扩建好了，现在能放 ${[0, 2, 4, 6, 8][x.to]} 人，产出也更高。`, tone: 'good', about: [] });
    }
  }
  w.sect.works = left;
}
