// 世界数据：地方、境界、性格、宝物。纯数据，改数值不用动逻辑。

import type { PlaceId, SectId, TraitId, Values } from '../core/types';

export interface PlaceDef { name: string; desc: string; cultivate: number; danger: number }
export const PLACES: Record<PlaceId, PlaceDef> = {
  qinglan: { name: '青岚宗', desc: '正道大宗，山门藏在云雾里。本门弟子在这里修炼更快。', cultivate: 1.2, danger: 0 },
  chixiao: { name: '赤霄门', desc: '强者为尊，门里天天有人比斗。本门弟子在这里修炼更快。', cultivate: 1.2, danger: 0.05 },
  market: { name: '云渡坊', desc: '买卖丹药法宝的坊市，消息最灵通。', cultivate: 0.8, danger: 0.02 },
  vein: { name: '听泉谷', desc: '一条灵脉从谷底流过，谁来修炼都快。', cultivate: 1.5, danger: 0.02 },
  cave: { name: '玄冥洞府', desc: '上古修士留下的洞府，机缘多，埋的骨头也多。', cultivate: 0.9, danger: 0.25 },
  forest: { name: '黑松林', desc: '妖兽出没，历练的好去处。', cultivate: 1, danger: 0.12 },
  village: { name: '柳溪村', desc: '山脚下的凡人村子。帮村民做事能攒下名声。', cultivate: 0.7, danger: 0.01 },
};
export const PLACE_ORDER: PlaceId[] = ['qinglan', 'chixiao', 'market', 'vein', 'cave', 'forest', 'village'];
export const SECT_NAME: Record<SectId, string> = { qinglan: '青岚宗', chixiao: '赤霄门' };

export const REALMS = ['炼气', '筑基', '金丹', '元婴', '化神'];
export const STAGES = ['初期', '中期', '后期'];
/** 每个大境界的寿元上限 */
export const LIFE = [40, 70, 110, 170, 600];
/** 每个大境界的基础战力：差一个大境界，基本打不过 */
export const POWER = [1, 3, 9, 27, 81];
/** 每升一个小境界要的修为 */
export const stageCost = (realm: number) => Math.round(100 * 2.6 ** realm);
/** 冲击下一个大境界的基础成功率 */
export const BREAK = [0.55, 0.4, 0.28, 0.18];
/** 一年修炼的基础修为 */
export const YEAR_EXP = 40;

export const TRAITS: Record<TraitId, { name: string; desc: string }> = {
  proud: { name: '傲慢', desc: '看不起比自己弱的人，受不得挑衅。' },
  careful: { name: '谨慎', desc: '不打没把握的仗。' },
  loyal: { name: '忠义', desc: '对师门和朋友一条心。' },
  greedy: { name: '贪财', desc: '见到灵石和宝物就挪不动脚。' },
  grudge: { name: '记仇', desc: '坏事记得久，好事忘得快。' },
  bold: { name: '豪爽', desc: '交朋友快，出手也快。' },
  cruel: { name: '阴狠', desc: '为了目的不择手段，得手后可能翻脸。' },
  devoted: { name: '痴情', desc: '认准一个人就不回头。' },
  kind: { name: '心善', desc: '见不得别人受苦。' },
  lonely: { name: '孤僻', desc: '不爱和人打交道。' },
  cunning: { name: '城府深', desc: '心里想的和嘴上说的不一样。' },
  rash: { name: '莽撞', desc: '想到就做，不计后果。' },
};

export interface ItemDef { name: string; desc: string; price: number; unique?: boolean }
export const ITEMS: Record<string, ItemDef> = {
  pill: { name: '破境丹', desc: '冲击大境界时成功率 +20%。', price: 60 },
  heal: { name: '回春丹', desc: '伤势恢复五成。', price: 25 },
  life: { name: '延寿丹', desc: '寿元 +30 年。', price: 200 },
  sword: { name: '玄冥剑', desc: '上古修士的佩剑，战力 ×1.5。', price: 0, unique: true },
  letter: { name: '云鹤遗书', desc: '一封压在白骨下面的信，写着三十年前洞府里发生的事。', price: 0, unique: true },
};

export const ZERO_VALUES: Values = { power: 0.5, wealth: 0.3, love: 0.3, loyalty: 0.3, justice: 0.3 };
