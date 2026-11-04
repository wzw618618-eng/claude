// 规则数据：特质、岗位、营建工程、技能名。纯数据，改数值不用动逻辑。

import { SkillKey, TaskId, TraitId } from '../core/types';

export const SKILLS: Record<SkillKey, string> = {
  str: '体力',
  wild: '野外',
  craft: '手艺',
  med: '医术',
  talk: '口才',
};

export const TRAITS: Record<TraitId, { name: string; desc: string; good?: boolean }> = {
  optimist: { name: '乐观', desc: '心情下滑得慢一半。', good: true },
  pessimist: { name: '多虑', desc: '心情下滑得快一倍。' },
  diligent: { name: '勤快', desc: '干活产出 +15%，可闲着反而难受。', good: true },
  lazy: { name: '散漫', desc: '干活产出 −15%，休息时心情更好。' },
  bigeater: { name: '大胃口', desc: '每天要吃两份口粮。' },
  timid: { name: '胆小', desc: '不愿外出和守夜，但更小心，不容易受伤。' },
  reckless: { name: '莽撞', desc: '搜寻收获 +30%，受伤的概率也更高。' },
  kind: { name: '热心肠', desc: '和人处得更快，照料别人效果更好。', good: true },
  loner: { name: '孤僻', desc: '和人处得慢，一个人干活时心情好。' },
  hothead: { name: '暴躁', desc: '更容易和人起冲突。' },
  leader: { name: '主心骨', desc: '状态好的时候，全营地每天心情 +2。', good: true },
  coldproof: { name: '耐寒', desc: '受冻伤害减半。', good: true },
  coldfear: { name: '怕冷', desc: '受冻伤害 ×1.5。' },
  gourmet: { name: '掌勺好手', desc: '掌勺效果 +50%。', good: true },
  child: { name: '孩子', desc: '干不了重活和危险的活；开心的时候，大家也会开心一点。' },
  mute: { name: '沉默', desc: '几乎不说话，安抚别人的效果很弱。' },
  stubborn: { name: '倔', desc: '很难被说服，信任也涨得慢。' },
};

export interface TaskDef {
  name: string;
  desc: string;
  skill?: SkillKey;
  /** 消耗的体力，负数表示恢复 */
  cost: number;
  outdoor?: boolean;
  danger?: boolean;
}

export const TASKS: Record<TaskId, TaskDef> = {
  wood: { name: '砍柴', desc: '去林子里砍柴。取暖全靠它。', skill: 'str', cost: 22, outdoor: true },
  hunt: { name: '狩猎', desc: '下套、追踪、打猎。收获看本事，也看运气。', skill: 'wild', cost: 20, outdoor: true },
  scavenge: { name: '搜寻', desc: '翻找附近的废弃车辆和房子，带回物资，偶尔有药。', skill: 'wild', cost: 24, outdoor: true, danger: true },
  explore: { name: '探路', desc: '走得更远。可能遇见幸存者，也可能迷路受伤。', skill: 'wild', cost: 30, outdoor: true, danger: true },
  build: { name: '营建', desc: '推进当前的营建工程。', skill: 'craft', cost: 20 },
  cook: { name: '掌勺', desc: '把有限的食材做成热饭。大家心情好，也更省粮。', skill: 'craft', cost: 8 },
  care: { name: '照料', desc: '给伤员和病人治疗，必要时会用掉药品。', skill: 'med', cost: 10 },
  comfort: { name: '安抚', desc: '陪大家说说话，稳住人心。', skill: 'talk', cost: 8 },
  guard: { name: '守夜', desc: '夜里守着门口，防狼，也防有人偷东西。', skill: 'str', cost: 22, danger: true },
  rest: { name: '休息', desc: '恢复体力和健康。', cost: -35 },
};

export const TASK_ORDER: TaskId[] = ['wood', 'hunt', 'scavenge', 'explore', 'build', 'cook', 'care', 'comfort', 'guard', 'rest'];

export interface BuildingDef {
  name: string;
  desc: string;
  cost: { mat?: number; wood?: number };
  pts: number;
  needFlag?: string;
  lockedHint?: string;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  door: { name: '封窗堵缝', desc: '用木板和铁皮封住漏风的窗。保暖 +1。', cost: { mat: 4 }, pts: 6 },
  smoke: { name: '熏肉架', desc: '猎到的肉能熏干存放，不会坏。每个有收获的猎人额外 +1 食物。', cost: { mat: 2, wood: 3 }, pts: 5 },
  hearth: { name: '砌火塘', desc: '用石头砌个像样的火塘，热得匀、烟也少。保暖 +1，全营地每天心情 +2。', cost: { mat: 5, wood: 3 }, pts: 10 },
  clinic: { name: '医务角', desc: '隔出一个干净的角落。照料效果 +50%，病不容易传开。', cost: { mat: 4 }, pts: 6 },
  tower: { name: '瞭望台', desc: '在屋顶搭个瞭望台。狼群更难偷袭，探路也更安全。', cost: { mat: 5, wood: 3 }, pts: 8 },
  radio: {
    name: '修电台',
    desc: '把客车上的电台拆回来修好。修成了，也许能联系上山下。',
    cost: { mat: 6 },
    pts: 12,
    needFlag: 'radioUnlocked',
    lockedHint: '也许附近有能用的电台……',
  },
  phone: {
    name: '卫星电话供电',
    desc: '用电瓶和铜线给那部卫星电话做个供电装置。',
    cost: { mat: 4 },
    pts: 7,
    needFlag: 'phoneUnlocked',
    lockedHint: '有人藏着什么东西。',
  },
};

export const BUILD_ORDER = ['door', 'smoke', 'hearth', 'clinic', 'tower', 'radio', 'phone'];

export const RES_NAMES = { food: '食物', wood: '柴火', mat: '物资', med: '药品' } as const;
export const RES_UNITS = { food: '份', wood: '捆', mat: '件', med: '盒' } as const;

export const LAST_DAY = 30;
