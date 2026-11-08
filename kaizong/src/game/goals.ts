// 宗门品阶和年度大计：给十年一局定几个台阶、每年定一个目标。
// 品阶：攒够条件就晋一阶，各方来贺，解锁更多任务格、召见名额、供奉。只升不降。
// 大计：每年开春从三个里挑一个，做成了有赏；没做成，弟子们觉得宗主说话不算数。

import { lvl } from './cult';
import type { Rng } from './rng';
import type { Goal, Reward, World, YearReview, YearSnap } from './types';
import { addLife, clamp, me, members, report, year } from './world';

export const TIERS = ['草创', '下品宗门', '中品宗门', '上品宗门', '一方圣地'];
export const TIER_PERK = ['', '任务栏多一格，每季各方供奉 15 灵石', '召见多一人，每年开山多来一人，供奉 30', '任务栏再多一格，供奉 45', '召见再多一人，供奉 70，四方来朝'];

export const hallsTotal = (w: World) => Object.values(w.sect.halls).reduce((a, b) => a + b, 0);
export const tierIncome = (w: World) => [0, 15, 30, 45, 70][w.tier] ?? 0;
export const boardSize = (w: World) => [2, 3, 3, 4, 4][w.tier] ?? 2;
export const talkLimit = (w: World) => 3 + (w.tier >= 2 ? 1 : 0) + (w.tier >= 4 ? 1 : 0);

export interface Req { label: string; have: number; need: number }

/** 晋到第 tier 阶要满足的条件 */
export function tierReqs(w: World, tier: number): Req[] {
  const ms = members(w);
  const found = ms.filter((p) => p.realm >= 1).length;
  const rep = Math.round(w.sect.rep);
  switch (tier) {
    case 1: return [{ label: '弟子', have: ms.length, need: 8 }, { label: '名望', have: rep, need: 60 }, { label: '殿堂规模', have: hallsTotal(w), need: 4 }];
    case 2: return [{ label: '弟子', have: ms.length, need: 14 }, { label: '筑基弟子', have: found, need: 2 }, { label: '名望', have: rep, need: 150 }, { label: '殿堂规模', have: hallsTotal(w), need: 9 }];
    case 3: return [{ label: '弟子', have: ms.length, need: 20 }, { label: '筑基弟子', have: found, need: 5 }, { label: '名望', have: rep, need: 300 }, { label: '灵脉', have: w.sect.veins, need: 3 }];
    case 4: return [{ label: '名望', have: rep, need: 500 }, { label: '筑基弟子', have: found, need: 8 }, { label: '元婴宗主或结丹弟子', have: (me(w).realm >= 3 ? 1 : 0) + ms.filter((p) => p.realm >= 2).length, need: 1 }];
    default: return [];
  }
}

/** 季末查一次：够了就晋一阶 */
export function checkTier(w: World): boolean {
  if (w.tier >= TIERS.length - 1) return false;
  if (!tierReqs(w, w.tier + 1).every((r) => r.have >= r.need)) return false;
  w.tier += 1;
  const gift = 100 * w.tier;
  w.sect.stones += gift;
  w.sect.rep += 10;
  w.sect.authority = clamp(w.sect.authority + 10, 0, 100);
  for (const p of members(w)) { p.mood = clamp(p.mood + 8, 0, 100); p.loyalty = clamp(p.loyalty + 3, 0, 100); }
  addLife(w, me(w), `${w.sect.name}晋为${TIERS[w.tier]}`, 'good', true);
  report(w, { text: `${w.sect.name}晋为${TIERS[w.tier]}！各方来贺，送来 ${gift} 灵石。从此${TIER_PERK[w.tier]}。`, tone: 'good', about: [], big: true });
  return true;
}

// ───────────── 年度大计 ─────────────

interface GoalDef {
  kind: string;
  /** 只在年末算（"年末攒到多少"这种） */
  atYearEnd?: boolean;
  when?(w: World): boolean;
  make(w: World): { text: string; target: number; base: number; reward: Reward };
  progress(w: World, g: Goal): number;
}

const round5 = (x: number) => Math.round(x / 5) * 5;
const allies = (w: World) => w.rivals.filter((r) => r.alive && r.status === 'ally').length;

const GOALS: GoalDef[] = [
  {
    kind: 'recruit',
    make: (w) => { const n = Math.min(6, 3 + w.tier); return { text: `年内新收 ${n} 个弟子`, target: n, base: w.alumni.length, reward: { stones: 120 } }; },
    progress: (w, g) => w.alumni.length - g.base,
  },
  {
    kind: 'breaks',
    make: (w) => { const n = w.tier >= 2 ? 2 : 1; return { text: `年内有 ${n} 位弟子冲关成功`, target: n, base: w.stats.breaks, reward: { fpills: 1, authority: 5 } }; },
    progress: (w, g) => w.stats.breaks - g.base,
  },
  {
    kind: 'rep',
    make: (w) => { const x = round5(w.sect.rep + 35 + 15 * w.tier); return { text: `名望涨到 ${x}`, target: x, base: 0, reward: { stones: 100, authority: 5 } }; },
    progress: (w) => Math.round(w.sect.rep),
  },
  {
    kind: 'missions',
    make: (w) => { const n = Math.min(5, 2 + w.tier); return { text: `完成 ${n} 次宗门任务`, target: n, base: w.stats.missionsDone, reward: { stones: 150 } }; },
    progress: (w, g) => w.stats.missionsDone - g.base,
  },
  {
    kind: 'war',
    when: (w) => allies(w) === 0 && w.rivals.some((r) => r.alive && !r.passive && r.attitude < -20),
    make: (w) => ({ text: '打赢一场宗门战，或者和一家宗门结盟', target: 1, base: w.stats.warsWon, reward: { rep: 25, authority: 10 } }),
    progress: (w, g) => w.stats.warsWon - g.base + allies(w),
  },
  {
    kind: 'stones', atYearEnd: true,
    make: (w) => { const x = Math.max(400, Math.round((w.sect.stones + 250) / 50) * 50); return { text: `年末灵石攒到 ${x}`, target: x, base: 0, reward: { rep: 15, authority: 5 } }; },
    progress: (w) => Math.round(w.sect.stones),
  },
  {
    kind: 'harmony', atYearEnd: true,
    when: (w) => members(w).length >= 4,
    make: (w) => ({ text: '今年没有弟子离山，年末没人怨气过半', target: 1, base: goneCount(w), reward: { authority: 10, rep: 10 } }),
    progress: (w, g) => (goneCount(w) === g.base && !members(w).some((p) => p.grudge >= 50) ? 1 : 0),
  },
  {
    kind: 'halls',
    when: (w) => Object.values(w.sect.halls).filter((v) => v < 4).length >= 2,
    make: (w) => ({ text: '新建或扩建殿堂 2 次', target: 2, base: hallsTotal(w), reward: { stones: 120, rep: 8 } }),
    progress: (w, g) => hallsTotal(w) - g.base,
  },
  {
    kind: 'tier',
    when: (w) => w.tier < TIERS.length - 1 && tierReqs(w, w.tier + 1).filter((r) => r.have >= r.need).length >= 2,
    make: (w) => ({ text: `晋为${TIERS[w.tier + 1]}`, target: w.tier + 1, base: 0, reward: { stones: 200, authority: 10 } }),
    progress: (w) => w.tier,
  },
  {
    kind: 'master',
    when: (w) => me(w).realm < 4,
    make: (w) => ({ text: '宗主自己的修为再进一阶', target: 1, base: lvl(me(w)), reward: { authority: 10, rep: 10 } }),
    progress: (w, g) => lvl(me(w)) - g.base,
  },
];
const GOAL: Record<string, GoalDef> = Object.fromEntries(GOALS.map((g) => [g.kind, g]));

function goneCount(w: World) {
  return w.alumni.filter((id) => { const p = w.people[id]; return p?.alive && p.sect !== 'me'; }).length;
}

/** 年初挑三个给宗主选 */
export function offerGoals(w: World, r: Rng): Goal[] {
  const pool = GOALS.filter((g) => !g.when || g.when(w));
  const out: Goal[] = [];
  for (const g of r.shuffle([...pool]).slice(0, 3)) out.push({ kind: g.kind, ...g.make(w) });
  return out;
}

export function chooseGoal(w: World, i: number): string | null {
  const g = w.goalOffers[i];
  if (!g) return '没有这个大计';
  w.goal = { ...g };
  w.needGoal = false;
  w.acts.push({ kind: 'policy', text: `定下今年的大计：${g.text}` });
  return null;
}

export function goalProgress(w: World, g: Goal) {
  const d = GOAL[g.kind];
  return { have: d ? d.progress(w, g) : 0, atYearEnd: !!d?.atYearEnd };
}

const REWARD_KEYS: (keyof Reward)[] = ['stones', 'herbs', 'pills', 'fpills', 'armory', 'rep', 'authority', 'align', 'gear', 'exp', 'candidate'];
const KEY_NAME: Record<string, string> = { stones: '灵石', herbs: '灵草', pills: '丹药', fpills: '筑基丹', armory: '法器', rep: '名望', authority: '宗主威望', align: '正气', gear: '法宝', exp: '修为', candidate: '好苗子' };
export function rewardText(rw: Reward): string {
  return REWARD_KEYS.filter((k) => rw[k]).map((k) => `${KEY_NAME[k]} ${rw[k]! > 0 ? '+' : ''}${rw[k]}`).join('，');
}

/** 宗门拿到的东西（法宝、修为、好苗子要落到人头上，由调用的地方处理） */
export function grant(w: World, rw: Reward) {
  const s = w.sect;
  s.stones += rw.stones ?? 0; s.herbs += rw.herbs ?? 0; s.pills += rw.pills ?? 0; s.fpills += rw.fpills ?? 0; s.armory += rw.armory ?? 0;
  s.rep += rw.rep ?? 0;
  s.align = clamp(s.align + (rw.align ?? 0), -100, 100);
  s.authority = clamp(s.authority + (rw.authority ?? 0), 0, 100);
}

function complete(w: World, g: Goal) {
  g.done = true;
  grant(w, g.reward);
  for (const p of members(w)) p.mood = clamp(p.mood + 4, 0, 100);
  report(w, { text: `今年的大计成了：${g.text}。得${rewardText(g.reward)}。`, tone: 'good', about: [], big: true });
}

/** 季末查一次：随时能成的大计，成了就赏 */
export function checkGoal(w: World) {
  const g = w.goal;
  if (!g || g.done) return;
  const d = GOAL[g.kind];
  if (!d || d.atYearEnd) return;
  if (d.progress(w, g) >= g.target) complete(w, g);
}

export function snap(w: World, y = year(w.t)): YearSnap {
  const al = w.alumni.map((id) => w.people[id]).filter(Boolean);
  return {
    year: y, joined: w.alumni.length, gone: al.filter((p) => p.alive && p.sect !== 'me').length, dead: al.filter((p) => !p.alive).length,
    breaks: w.stats.breaks, missions: w.stats.missionsDone, warsWon: w.stats.warsWon, warsLost: w.stats.warsLost,
    halls: hallsTotal(w), stones: Math.round(w.sect.stones), rep: Math.round(w.sect.rep), members: members(w).length,
  };
}

/** 一年到头（冬季过完时）：结算大计，写去年回顾；开新的一年 */
export function turnYear(w: World, r: Rng) {
  const g = w.goal;
  let goal: YearReview['goal'];
  if (g) {
    const d = GOAL[g.kind];
    if (!g.done && d?.atYearEnd && d.progress(w, g) >= g.target) complete(w, g);
    if (!g.done) {
      w.sect.authority = clamp(w.sect.authority - 3, 0, 100);
      report(w, { text: `今年的大计没成：${g.text}。弟子们私下说宗主说话不算数。`, tone: 'bad', about: [] });
    }
    goal = { text: g.text, ok: !!g.done, reward: rewardText(g.reward) };
  }
  const a = w.yearStart, b = snap(w, year(w.t) + 1);
  if (a) {
    const lines: [string, string][] = [
      ['弟子', `${a.members} → ${b.members} 人`],
      ['新入门', `${b.joined - a.joined} 人`],
      ['离山', `${b.gone - a.gone} 人`],
      ['陨落', `${b.dead - a.dead} 人`],
      ['冲关成功', `${b.breaks - a.breaks} 次`],
      ['宗门任务', `完成 ${b.missions - a.missions} 次`],
      ['灵石', `${a.stones} → ${b.stones}`],
      ['名望', `${a.rep} → ${b.rep}`],
    ];
    if (b.warsWon + b.warsLost > a.warsWon + a.warsLost) lines.push(['宗门战', `${b.warsWon - a.warsWon} 胜 ${b.warsLost - a.warsLost} 负`]);
    w.lastYear = { year: a.year, goal, lines };
  }
  w.yearStart = b;
  w.goal = null;
  w.goalOffers = offerGoals(w, r);
  w.needGoal = true;
}
