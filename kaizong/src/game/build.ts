// 营造：殿堂是一座座建起来的。开局只有灵植园和巡山队，其余要花灵石、满足条件，建一两季才落成。
// 等级 0 是空地，1 刚建成（放 2 人），往上每扩建一次多放 2 人、产出更高。工匠有限，同时只能建一处（中品宗门以后两处）。

import { HALL, HALLS } from './data/world';
import type { HallId, World } from './types';
import { addLife, clamp, me, members, report, timeText } from './world';

export const MAX_LV = 4;

interface BuildDef { cost: number; seasons: number; need?: (w: World) => string | null }

export const BUILD: Record<HallId, BuildDef> = {
  herb: { cost: 80, seasons: 1 },
  guard: { cost: 80, seasons: 1 },
  recruit: { cost: 80, seasons: 1 },
  alchemy: { cost: 100, seasons: 1, need: (w) => (w.sect.halls.herb > 0 ? null : '先建灵植园：丹房要灵草') },
  diplomacy: { cost: 120, seasons: 1, need: (w) => (w.sect.rep >= 30 ? null : `名望要到 30（现在 ${Math.round(w.sect.rep)}）`) },
  forge: { cost: 140, seasons: 2, need: (w) => (members(w).length >= 6 ? null : `弟子要有 6 人（现在 ${members(w).length}）`) },
  law: { cost: 140, seasons: 1, need: (w) => (members(w).length >= 8 ? null : `弟子要有 8 人（现在 ${members(w).length}）`) },
  teach: { cost: 180, seasons: 2, need: (w) => (members(w).some((p) => p.realm >= 1) || members(w).length >= 10 ? null : '要有一位筑基弟子，或者弟子满 10 人') },
};

/** 扩建：下标是现在的等级 */
const UPGRADE_COST = [0, 100, 240, 480];
const UPGRADE_SEASONS = [0, 1, 2, 2];

export const isBuilt = (w: World, h: HallId) => w.sect.halls[h] > 0;
export const builtHalls = (w: World) => HALLS.filter((h) => isBuilt(w, h.id));
export const maxWorks = (w: World) => 1 + (w.tier >= 2 ? 1 : 0);
export const workOn = (w: World, h: HallId) => w.sect.works.find((x) => x.hall === h);

/** 下一步（新建或扩建）要花多少、几季 */
export function nextStep(w: World, h: HallId): { cost: number; seasons: number; to: number } | null {
  const lv = w.sect.halls[h];
  if (lv >= MAX_LV) return null;
  if (lv === 0) return { cost: BUILD[h].cost, seasons: BUILD[h].seasons, to: 1 };
  return { cost: UPGRADE_COST[lv], seasons: UPGRADE_SEASONS[lv], to: lv + 1 };
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
  w.sect.works.push({ hall: h, to: step.to, done: w.t + step.seasons - 1 });
  w.acts.push({ kind: 'build', hall: h, text: `${step.to === 1 ? '动工建' : '扩建'}${HALL[h].name}` });
  return null;
}

/** 什么时候完工（界面用） */
export function doneText(w: World, done: number) {
  return done <= w.t ? '这一季过完落成' : `${timeText(done + 1)}落成`;
}

/** 季末：到期的工程完工 */
export function finishWorks(w: World) {
  const left = [];
  for (const x of w.sect.works) {
    if (x.done > w.t) { left.push(x); continue; }
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
