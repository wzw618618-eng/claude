// 修炼体系：境界、修为进度、突破、寿元、战力。
// 数值是自定的：同一大境界内小阶差距不大，隔一个大境界基本没法打。

import type { Person, Realm, RootKind } from './types';

export const REALM_NAME = ['炼气', '筑基', '结丹', '元婴', '化神'];
export const STAGE_NAME = ['初期', '中期', '后期', '大圆满'];
export const ROOT_NAME: Record<RootKind, string> = { heaven: '天灵根', dual: '双灵根', triple: '三灵根', mixed: '杂灵根' };
export const ROOT_APT: Record<RootKind, number> = { heaven: 2, dual: 1.4, triple: 1, mixed: 0.6 };

/** 寿元上限 */
export const LIFESPAN = [120, 200, 500, 1000, 2000];

export function realmText(p: Pick<Person, 'realm' | 'stage'>): string {
  if (p.realm === 0) return `炼气${'一二三四五六七八九'[Math.max(0, p.stage - 1)]}层`;
  return REALM_NAME[p.realm] + STAGE_NAME[p.stage];
}

/** 境界刻度：炼气 1–9，筑基 10–13，结丹 14–17，元婴 18–21，化神 22 */
export function lvl(p: Pick<Person, 'realm' | 'stage'>): number {
  return p.realm === 0 ? p.stage : 10 + (p.realm - 1) * 4 + p.stage;
}

/** 这一阶修满要多少修为 */
export function need(p: Pick<Person, 'realm' | 'stage'>): number {
  if (p.realm === 0) return p.stage >= 9 ? 100 : 30 + 6 * p.stage;
  return [0, 200, 600, 1500, 4000][p.realm] * (p.stage === 3 ? 1.5 : 1);
}

/** 卡在大境界门口了：修为满了，要冲关才能上去 */
export function atBottleneck(p: Person): boolean {
  const top = p.realm === 0 ? p.stage >= 9 : p.stage >= 3;
  return top && p.exp >= need(p) && p.realm < 4;
}

/** 冲关成算：基础 + 资质 + 悟性 + 丹药 + 心境；失败次数多了越来越难 */
export function breakChance(p: Person, pill: boolean): number {
  const base = [0.28, 0.14, 0.07, 0.03][p.realm] ?? 0;
  const apt = (p.root.apt - 1) * 0.12;
  const wit = (p.wit - 50) / 400;
  const mood = (p.mood - 50) / 500;
  const aid = pill ? [0.35, 0.28, 0.22, 0.15][p.realm] ?? 0 : 0;
  return Math.max(0.03, Math.min(0.92, base + apt + wit + mood + aid - p.fails * 0.04));
}

/** 突破需要的丹药叫什么 */
export const BREAK_PILL = ['筑基丹', '结金丹', '化婴丹', '天元丹'];

/** 修为往上走一阶（不跨大境界） */
export function stepUp(p: Person): boolean {
  let moved = false;
  for (;;) {
    const n = need(p);
    if (p.exp < n) break;
    const top = p.realm === 0 ? p.stage >= 9 : p.stage >= 3;
    if (top) { p.exp = n; break; }
    p.exp -= n;
    p.stage += 1;
    moved = true;
  }
  return moved;
}

/** 冲关成功：进入下一个大境界 */
export function breakthrough(p: Person) {
  p.realm = Math.min(4, p.realm + 1) as Realm;
  p.stage = 0;
  p.exp = 0;
  p.fails = 0;
}

export function lifespan(p: Pick<Person, 'realm'>): number {
  return LIFESPAN[p.realm];
}

/** 还能活几年 */
export const yearsLeft = (p: Person) => lifespan(p) - p.age;

/** 战力：境界打底，斗法才干、法宝、伤势再调 */
export function power(p: Person): number {
  let base: number;
  if (p.realm === 0) base = 10 + 4 * p.stage;
  else base = [0, 150, 800, 4000, 20000][p.realm] * (1 + 0.25 * p.stage);
  const skill = 0.85 + (p.skills.combat / 100) * 0.3;
  const gear = 1 + Math.min(0.6, p.gear * 0.08);
  const hurt = 0.5 + (p.hp / 100) * 0.5;
  return Math.round(base * skill * gear * hurt);
}

/** 境界带来的威望 */
export function realmPrestige(p: Pick<Person, 'realm' | 'stage'>): number {
  if (p.realm === 0) return p.stage * 4;
  return [0, 50, 120, 250, 500][p.realm] + p.stage * [0, 10, 18, 30, 60][p.realm];
}
