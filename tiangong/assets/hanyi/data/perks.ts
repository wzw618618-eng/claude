// 寒冬等级和开局行囊：开局怎么改状态、行囊对干活的加成。被 systems/ 引用，所以不依赖别的玩法模块。

import type { GameState } from '../core/types';

export interface MetaLike { ember: number; cleared: number }

// ───────────── 寒冬等级 ─────────────

export const WINTERS = [1, 2, 3, 4, 5];
export const WINTER_NAME = ['', '初雪', '大寒', '冰封', '白灾', '千年一遇'];
export const winterDesc = (w: number) =>
  w === 1 ? '正常难度。' : `更冷 ${coldOf(w)}℃，开局少 ${2 * (w - 1)} 份食物、${w - 1} 捆柴。得分 ×${multOf(w)}。`;
export const coldOf = (w = 1) => Math.round(1.5 * (w - 1));
export const multOf = (w = 1) => 1 + 0.25 * (w - 1);
export const winterOpen = (m: MetaLike, w: number) => w <= m.cleared + 1;

// ───────────── 开局行囊 ─────────────

export interface Perk { id: string; name: string; desc: string; need: number }
export const PERKS: Perk[] = [
  { id: 'rice', name: '一袋大米', desc: '开局食物 +6。', need: 0 },
  { id: 'logs', name: '一捆干柴', desc: '开局柴火 +6。', need: 0 },
  { id: 'kit', name: '急救箱', desc: '开局药品 +3。', need: 80 },
  { id: 'axe', name: '好斧头', desc: '砍柴产出 +30%。', need: 250 },
  { id: 'gun', name: '旧猎枪', desc: '打猎产出 +30%，狼来了更好赶。', need: 450 },
  { id: 'map', name: '护林图', desc: '外出受伤的风险减半。', need: 700 },
  { id: 'radio', name: '收音机零件', desc: '一开始就能修电台求救。', need: 1000 },
  { id: 'photo', name: '一张合影', desc: '开局所有人心情 +15、信任 +5。', need: 1400 },
];
export const perkOpen = (m: MetaLike, id: string) => (PERKS.find((p) => p.id === id)?.need ?? Infinity) <= m.ember;
export const nextPerk = (m: MetaLike) => PERKS.find((p) => p.need > m.ember);

/** 开局时把寒冬和行囊用到新的一局上 */
export function applyStart(s: GameState, winter = 1, perk = '') {
  s.winter = winter;
  s.perk = perk;
  s.res.food = Math.max(4, s.res.food - 2 * (winter - 1));
  s.res.wood = Math.max(4, s.res.wood - (winter - 1));
  s.temp -= coldOf(winter);
  if (perk === 'rice') s.res.food += 6;
  if (perk === 'logs') s.res.wood += 6;
  if (perk === 'kit') s.res.med += 3;
  if (perk === 'radio') s.flags.radioUnlocked = true;
  if (perk === 'photo') for (const c of s.chars) { c.mood = Math.min(100, c.mood + 15); c.trust = Math.min(100, c.trust + 5); }
}
/** 行囊对干活的加成 */
export const perkYield = (s: GameState, t: string) => (s.perk === 'axe' && t === 'wood') || (s.perk === 'gun' && t === 'hunt') ? 1.3 : 1;
export const perkRisk = (s: GameState) => (s.perk === 'map' ? 0.5 : 1);

