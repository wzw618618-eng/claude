// 交情深浅：和主角打交道越多、爱恨越深的人，AI 越花心思去演他。
// 交情只决定「想得多深、记得多少、会不会自己开口」，不进任何规则结算，也不碰随机数。

import type { Npc, World } from '../core/types';
import { ME } from '../core/world';

/** 玩家选的 AI 用量：门槛（scale 越大越难变聪明）和每年 NPC 自己发起的 AI 请求上限 */
export const MODES = {
  save: { name: '省', scale: 1.6, cap: 8 },
  normal: { name: '标准', scale: 1, cap: 24 },
  rich: { name: '尽兴', scale: 0.6, cap: 64 },
} as const;
export type Mode = keyof typeof MODES;
export const isMode = (m: unknown): m is Mode => typeof m === 'string' && m in MODES;

export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAME = ['陌路', '相识', '相熟', '刻骨'] as const;
/** 交情分到多少进下一档 */
export const TIER_AT = [8, 25, 50] as const;

/** 打交道各加多少交情 */
export const TOUCH = { line: 3, social: 4, encounter: 5, offer: 3 } as const;
/** 每年淡多少 */
export const BOND_FADE = 0.85;
const BOND_MAX = 200;

/** 和主角打了一次交道 */
export function touch(w: World, id: string, amount: number) {
  const n = w.people[id];
  if (!n?.alive) return;
  n.mind.bond = Math.min(BOND_MAX, Math.round(((n.mind.bond ?? 0) + amount) * 10) / 10);
}

/** 过年：交情淡一些 */
export function fadeBonds(w: World) {
  for (const n of Object.values(w.people)) {
    if (!n.mind.bond) continue;
    const b = Math.round(n.mind.bond * BOND_FADE * 10) / 10;
    if (b < 0.5) delete n.mind.bond;
    else n.mind.bond = b;
  }
}

/** 交情分：打交道攒下的，加上爱恨、信任，和师徒、道侣、冲着你来的目标 */
export function bondScore(w: World, n: Npc) {
  let s = n.mind.bond ?? 0;
  const o = n.mind.op[ME];
  if (o) s += Math.abs(o.aff) / 4 + Math.max(0, o.trust - 30) / 5;
  if (w.me.master === n.id || n.master === ME) s += 25;
  if (n.partner === ME) s += 25;
  const g = n.mind.goal;
  if (g && (g.target === ME || g.ally === ME)) s += 15;
  return Math.round(s * 10) / 10;
}

export function tierOf(w: World, n: Npc, mode: Mode = 'normal'): Tier {
  if (!n.alive) return 0;
  const s = bondScore(w, n) / MODES[mode].scale;
  return s >= TIER_AT[2] ? 3 : s >= TIER_AT[1] ? 2 : s >= TIER_AT[0] ? 1 : 0;
}

/** 刻骨的人是知己还是宿敌 */
export function tierText(w: World, n: Npc, mode: Mode = 'normal') {
  const t = tierOf(w, n, mode);
  if (t < 3) return TIER_NAME[t];
  return (n.mind.op[ME]?.aff ?? 0) < 0 ? '宿敌' : '知己';
}

/** 今年和主角有没有过交集：说过话，或者记下了和主角有关的事 */
export function metThisYear(w: World, n: Npc) {
  return (w.chat[n.id] ?? []).some((l) => l.y === w.year && l.from !== 'note')
    || n.mind.mem.some((m) => m.y === w.year && (m.a === ME || m.b === ME));
}
