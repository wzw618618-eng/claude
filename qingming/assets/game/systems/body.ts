// 修炼、突破、打斗、老去：所有人（主角和 NPC）共用一套规则。

import type { Rng } from '../core/rng';
import type { Being, Npc, PlaceId, World } from '../core/types';
import { BREAK, LIFE, PLACES, REALMS, YEAR_EXP } from '../data/world-data';
import { clamp, expNeed, lifeLeft, ME, news, nm, placeName, power, realmText, takeItem } from '../core/world';

/** 在某地修炼一年能得多少修为 */
export function yearExp(w: World, b: Being, at: PlaceId, extra = 1) {
  let k = PLACES[at].cultivate;
  if (b.sect && b.sect === at) k += 0.15;
  const master = b.master ? (b.master === ME ? w.me : w.people[b.master]) : undefined;
  if (master?.alive && master.place === at) k += 0.25;
  if (b.id === ME && w.flags.abode === at) k += 0.3;
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
/** 冲关的把握：境界越高越难；资质、破境丹、悟道所得、之前失败攒下的经验都有帮助 */
export function breakChance(b: Being, pill: boolean, w?: World) {
  const insight = w && b.id === ME ? Number(w.flags.insight ?? 0) : 0;
  return clamp(BREAK[b.realm] * (0.7 + 0.3 * b.talent) + (pill ? 0.2 : 0) + insight + 0.05 * Math.min(4, b.tries ?? 0), 0.05, 0.95);
}

/**
 * 闭关冲击下一个大境界。失败会受伤、掉一截修为（杂灵根根基稳，掉得少）。
 * pill：用不用破境丹；不填就是有就用（NPC 都这样）
 */
export function tryBreak(w: World, b: Being, rng: Rng, opts: { pill?: boolean } = {}) {
  if (!canBreak(b)) return null;
  const pill = (opts.pill ?? true) && takeItem(b, 'pill');
  const ok = rng.chance(breakChance(b, pill, w));
  if (b.id === ME) delete w.flags.insight;
  if (ok) {
    b.realm++;
    b.stage = 0;
    b.exp = 0;
    b.hp = 100;
    b.tries = 0;
  } else {
    b.exp = Math.floor(expNeed(b) * (b.id === ME && w.root === 'mixed' ? 0.8 : 0.6));
    b.hp = clamp(b.hp - 30, 5, 100);
    b.tries = (b.tries ?? 0) + 1;
  }
  return { ok, pill, to: REALMS[Math.min(4, b.realm)] };
}

/** 各地妖兽有多凶：越危险的地方越凶 */
export function beastRange(place: PlaceId): [number, number] {
  const d = PLACES[place].danger;
  return [0.3 + 6 * d, 1.5 + 42 * d];
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

/** 和妖兽打一场：赢了有灵石，偶尔有丹药；输了受伤，很少丢命 */
export function beast(w: World, b: Being | Npc, rng: Rng, lo: number, hi: number) {
  const foe = rng.range(lo, hi);
  const p = power(b);
  const win = rng.chance(p * p / (p * p + foe * foe));
  if (win) {
    const loot = Math.round(10 + foe * 6 + rng.int(0, 20));
    b.stones += loot;
    gainExp(b, 12 + foe * 3);
    let item = '';
    if (rng.chance(hi > 6 ? 0.2 : 0.1)) { item = rng.chance(0.6) ? 'heal' : 'pill'; b.items.push(item); }
    if (hi > 6 && rng.chance(0.03)) { item = 'life'; b.items.push('life'); }
    b.hp = Math.max(1, b.hp - rng.int(0, 15));
    return { win, loot, item, foe };
  }
  b.hp -= Math.round(15 + foe * 4);
  if (b.hp <= 0) {
    if (rng.chance(0.5)) {
      b.alive = false; b.hp = 0;
      b.died = { y: w.year, note: `葬身${placeName(b.place)}的妖兽之口` };
      if (b.id !== ME) news(w, `${b.name}在${placeName(b.place)}遇上大妖，没能回来。`, 'bad', [b.id], true);
    } else b.hp = 5;
  }
  return { win, loot: 0, item: '', foe };
}

