// 修炼、突破、打斗、老去：所有人（主角和 NPC）共用一套规则。

import type { Rng } from '../core/rng';
import type { Being, PlaceId, World } from '../core/types';
import { BREAK, LIFE, PLACES, REALMS, YEAR_EXP } from '../data/world-data';
import { clamp, expNeed, lifeLeft, nm, power, realmText, takeItem } from '../core/world';

/** 在某地修炼一年能得多少修为 */
export function yearExp(w: World, b: Being, at: PlaceId, extra = 1) {
  let k = PLACES[at].cultivate;
  if (b.sect && b.sect === at) k += 0.15;
  if (b.master && w.people[b.master]?.alive && w.people[b.master].place === at) k += 0.25;
  if (b.partner && (b.partner === 'me' ? w.me : w.people[b.partner])?.place === at) k += 0.1;
  return YEAR_EXP * b.talent * k * extra * (0.5 + 0.5 * (b.hp / 100));
}

/** 加修为：小境界自动升，到了后期圆满就卡住，要闭关冲关 */
export function gainExp(b: Being, n: number) {
  if (b.realm >= 4) return;
  b.exp += n;
  while (b.exp >= expNeed(b) && b.stage < 2) {
    b.exp -= expNeed(b);
    b.stage++;
  }
  if (b.stage === 2) b.exp = Math.min(b.exp, expNeed(b));
}
export const canBreak = (b: Being) => b.realm < 4 && b.stage === 2 && b.exp >= expNeed(b);
export const breakChance = (b: Being, pill: boolean) => clamp(BREAK[b.realm] * (0.7 + 0.3 * b.talent) + (pill ? 0.2 : 0), 0.05, 0.95);

/** 闭关冲击下一个大境界。失败会受伤、掉一截修为 */
export function tryBreak(w: World, b: Being, rng: Rng) {
  if (!canBreak(b)) return null;
  const pill = takeItem(b, 'pill');
  const ok = rng.chance(breakChance(b, pill));
  if (ok) {
    b.realm++;
    b.stage = 0;
    b.exp = 0;
    b.hp = 100;
  } else {
    b.exp = Math.floor(expNeed(b) * 0.6);
    b.hp = clamp(b.hp - 30, 5, 100);
  }
  return { ok, pill, to: REALMS[Math.min(4, b.realm)] };
}

/** 两个人动手。lethal 为真时输的一方可能丧命；ambush 是偷袭加成 */
export function fight(w: World, a: Being, b: Being, rng: Rng, opts: { lethal?: boolean; ambush?: number; helpA?: Being[]; helpB?: Being[] } = {}) {
  const pa = (power(a) + (opts.helpA ?? []).reduce((t, x) => t + power(x) * 0.7, 0)) * (opts.ambush ?? 1);
  const pb = power(b) + (opts.helpB ?? []).reduce((t, x) => t + power(x) * 0.7, 0);
  const pA = pa * pa / (pa * pa + pb * pb);
  const aWins = rng.chance(pA);
  const [win, lose] = aWins ? [a, b] : [b, a];
  const gap = aWins ? pA : 1 - pA;
  lose.hp = clamp(lose.hp - Math.round(25 + 45 * gap), 0, 100);
  win.hp = clamp(win.hp - Math.round(30 * (1 - gap)), 1, 100);
  let killed = false;
  if (opts.lethal && (lose.hp <= 0 || rng.chance(0.25 + 0.5 * gap))) killed = true;
  if (!opts.lethal && lose.hp <= 0) lose.hp = 5;
  if (killed) die(w, lose, `死在${nm(w, win.id)}手里`);
  return { win, lose, killed, odds: pA };
}

export function die(w: World, b: Being, note: string) {
  if (!b.alive) return;
  b.alive = false;
  b.hp = 0;
  b.died = { y: w.year, note };
}

/** 一年过去：长一岁、养伤；寿元到了就坐化 */
export function age(w: World, b: Being) {
  b.age++;
  b.hp = clamp(b.hp + 20, 0, 100);
  if (b.alive && lifeLeft(b) <= 0) die(w, b, `寿元耗尽，坐化于${realmText(b)}`);
}
export const lifeMax = (b: Being) => LIFE[b.realm] + b.bonus;
