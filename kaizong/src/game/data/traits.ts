// 性格标签：每人随机抽两三个，合成他的性情倾向（Disp）。
// d：对性情的加减；likes / dislikes：天生喜欢或讨厌的活计；clash：不能同时有的标签。

import type { Disp, JobId } from '../types';

export interface TraitDef {
  id: string;
  name: string;
  desc: string;
  d: Partial<Record<Disp, number>>;
  likes?: JobId[];
  dislikes?: JobId[];
  clash?: string[];
}

export const TRAITS: TraitDef[] = [
  { id: 'proud', name: '傲气', desc: '心高气傲，只服比自己强的人', d: { pride: 2, order: -1 }, clash: ['humble'] },
  { id: 'humble', name: '谦和', desc: '不争不抢，肯低头', d: { pride: -2, order: 1 }, clash: ['proud'] },
  { id: 'diligent', name: '勤勉', desc: '做事肯下死力气', d: { diligence: 2 }, clash: ['lazy'] },
  { id: 'lazy', name: '懒散', desc: '能躺着绝不坐着', d: { diligence: -2 }, dislikes: ['law', 'herb'], clash: ['diligent'] },
  { id: 'fierce', name: '好斗', desc: '一言不合就想动手', d: { temper: 2, courage: 1 }, likes: ['guard', 'travel'], dislikes: ['herb', 'teach'], clash: ['gentle'] },
  { id: 'gentle', name: '温和', desc: '脾气好，很少与人红脸', d: { temper: -2, kindness: 1 }, likes: ['herb', 'teach'], dislikes: ['guard'], clash: ['fierce'] },
  { id: 'greedy', name: '贪财', desc: '见了灵石眼睛发亮', d: { greed: 2 }, likes: ['diplomacy'], clash: ['detached'] },
  { id: 'detached', name: '淡泊', desc: '名利看得很淡', d: { greed: -2, ambition: -1 }, likes: ['seclude', 'herb'], clash: ['greedy', 'ambitious'] },
  { id: 'ambitious', name: '野心勃勃', desc: '想往上爬，想做人上人', d: { ambition: 3 }, dislikes: ['herb'], clash: ['detached', 'content'] },
  { id: 'content', name: '随遇而安', desc: '有口饭吃就心满意足', d: { ambition: -2, temper: -1 }, clash: ['ambitious'] },
  { id: 'warm', name: '重情', desc: '把同门当家人', d: { kindness: 2, social: 1 }, likes: ['teach'], clash: ['cold'] },
  { id: 'cold', name: '冷漠', desc: '对谁都淡淡的', d: { kindness: -2, social: -1 }, dislikes: ['diplomacy', 'teach'], clash: ['warm'] },
  { id: 'suspicious', name: '多疑', desc: '总觉得别人另有所图', d: { trust: -2 }, likes: ['law'], clash: ['naive'] },
  { id: 'naive', name: '天真', desc: '谁说什么都信', d: { trust: 2, cunning: -1 }, clash: ['suspicious', 'scheming'] },
  { id: 'timid', name: '胆小', desc: '遇事先想退路', d: { courage: -2 }, dislikes: ['guard', 'travel'], clash: ['reckless', 'brave'] },
  { id: 'reckless', name: '莽撞', desc: '想到就做，不计后果', d: { courage: 2, cunning: -1 }, likes: ['travel'], clash: ['timid', 'steady'] },
  { id: 'brave', name: '胆大心细', desc: '敢冒险，也知分寸', d: { courage: 2, cunning: 1 }, likes: ['travel', 'guard'], clash: ['timid'] },
  { id: 'scheming', name: '城府深', desc: '心里的话从不说全', d: { cunning: 2, trust: -1 }, likes: ['diplomacy'], clash: ['naive', 'blunt'] },
  { id: 'blunt', name: '直率', desc: '心直口快，藏不住话', d: { cunning: -2 }, clash: ['scheming'] },
  { id: 'grudging', name: '记仇', desc: '谁得罪过他，他记一辈子', d: { grudge: 2 }, clash: ['forgiving'] },
  { id: 'forgiving', name: '宽厚', desc: '不和人计较', d: { grudge: -2, kindness: 1 }, clash: ['grudging'] },
  { id: 'orderly', name: '守规矩', desc: '门规怎么说就怎么做', d: { order: 2 }, likes: ['law'], clash: ['rebel'] },
  { id: 'rebel', name: '叛逆', desc: '越不让做越要做', d: { order: -2, pride: 1 }, dislikes: ['law'], clash: ['orderly'] },
  { id: 'amorous', name: '多情', desc: '容易动心', d: { romance: 2, social: 1 }, clash: ['loner'] },
  { id: 'devoted', name: '痴情', desc: '一旦认定一个人就不回头', d: { romance: 1, grudge: 1 } },
  { id: 'envious', name: '善妒', desc: '见不得别人比自己好', d: { envy: 2 } },
  { id: 'protective', name: '护短', desc: '自己人只能自己骂', d: { kindness: 1, temper: 1 } },
  { id: 'vain', name: '爱面子', desc: '宁可吃亏也不能丢脸', d: { pride: 1, envy: 1 } },
  { id: 'studious', name: '好学', desc: '什么都想学一点', d: { diligence: 1 }, likes: ['teach', 'seclude'] },
  { id: 'swordnut', name: '剑痴', desc: '心里只有剑', d: { diligence: 1, social: -1 }, likes: ['guard', 'seclude'], dislikes: ['diplomacy', 'herb'] },
  { id: 'pillnut', name: '丹痴', desc: '闻到药香就挪不动脚', d: { diligence: 1 }, likes: ['alchemy', 'herb'], dislikes: ['guard'] },
  { id: 'craftnut', name: '器痴', desc: '喜欢敲敲打打', d: { diligence: 1 }, likes: ['forge'], dislikes: ['diplomacy'] },
  { id: 'filial', name: '孝顺', desc: '心里惦记着家里', d: { kindness: 1 } },
  { id: 'chatty', name: '话痨', desc: '一张嘴停不下来', d: { social: 2 }, likes: ['diplomacy', 'recruit'], dislikes: ['seclude'] },
  { id: 'loner', name: '孤僻', desc: '喜欢一个人待着', d: { social: -2 }, likes: ['seclude', 'herb'], dislikes: ['diplomacy', 'recruit'], clash: ['amorous', 'chatty', 'smooth'] },
  { id: 'smooth', name: '八面玲珑', desc: '跟谁都说得上话', d: { social: 2, cunning: 1 }, likes: ['diplomacy', 'recruit'], clash: ['loner', 'blunt'] },
  { id: 'sharp', name: '毒舌', desc: '说话专挑人痛处', d: { temper: 1, kindness: -1 } },
  { id: 'ruthless', name: '狠辣', desc: '下手从不留情', d: { kindness: -2, courage: 1 }, likes: ['law', 'guard'], clash: ['softhearted'] },
  { id: 'softhearted', name: '心善', desc: '见不得别人受苦', d: { kindness: 2 }, likes: ['herb', 'alchemy'], clash: ['ruthless'] },
  { id: 'vainglorious', name: '虚荣', desc: '喜欢被人捧着', d: { pride: 1, greed: 1 } },
  { id: 'hasty', name: '急躁', desc: '等不得，熬不住', d: { temper: 1, diligence: -1 }, dislikes: ['seclude', 'herb'], clash: ['steady'] },
  { id: 'steady', name: '沉稳', desc: '遇大事有静气', d: { temper: -1, order: 1 }, clash: ['hasty', 'reckless'] },
  { id: 'patient', name: '隐忍', desc: '能忍常人所不能忍', d: { temper: -1, grudge: 1, cunning: 1 } },
  { id: 'extreme', name: '偏激', desc: '认死理，容易走极端', d: { temper: 1, order: -1, grudge: 1 } },
  { id: 'honest', name: '忠厚', desc: '老实本分，不会算计人', d: { cunning: -1, kindness: 1, order: 1 }, clash: ['scheming', 'sly'] },
  { id: 'sly', name: '狡黠', desc: '鬼点子多', d: { cunning: 2 }, likes: ['diplomacy'], clash: ['honest'] },
  { id: 'curious', name: '好奇', desc: '什么都想去看看', d: { courage: 1 }, likes: ['travel', 'forge'] },
  { id: 'cheerful', name: '乐天', desc: '天塌下来也笑嘻嘻', d: { temper: -1, social: 1 }, clash: ['gloomy'] },
  { id: 'gloomy', name: '阴郁', desc: '心事重，难得笑一回', d: { social: -1, grudge: 1 }, clash: ['cheerful'] },
  { id: 'righteous', name: '嫉恶如仇', desc: '看不惯就要管', d: { temper: 1, order: 1 }, likes: ['law', 'guard'] },
];

export const TRAIT: Record<string, TraitDef> = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

/** 后天会长出来的性格：经历和岗位会让人变成这样 */
export const DRIFT: Record<string, { to: string; why: string }[]> = {
  law: [{ to: 'orderly', why: '执法日久，越来越认死理' }, { to: 'ruthless', why: '执法日久，心肠越来越硬' }],
  diplomacy: [{ to: 'smooth', why: '迎来送往久了，越发圆滑' }, { to: 'scheming', why: '和各路人物打交道久了，城府渐深' }],
  guard: [{ to: 'brave', why: '巡山多年，胆气练出来了' }, { to: 'fierce', why: '刀口舔血久了，脾气越来越冲' }],
  herb: [{ to: 'steady', why: '侍弄灵草多年，性子磨稳了' }, { to: 'gentle', why: '整日和草木打交道，脾气软了' }],
  alchemy: [{ to: 'pillnut', why: '守着丹炉多年，成了丹痴' }, { to: 'steady', why: '守炉看火久了，沉得住气' }],
  forge: [{ to: 'craftnut', why: '敲打多年，成了器痴' }],
  teach: [{ to: 'warm', why: '带了一茬又一茬弟子，心越来越软' }],
  recruit: [{ to: 'smooth', why: '看人看多了，说话越来越周全' }, { to: 'suspicious', why: '见过太多骗子，越来越多疑' }],
  seclude: [{ to: 'loner', why: '闭关太久，越发不爱见人' }, { to: 'detached', why: '久坐枯禅，名利心淡了' }],
  travel: [{ to: 'curious', why: '走南闯北，见识多了' }, { to: 'brave', why: '在外历练多年，胆气壮了' }],
  betrayed: [{ to: 'suspicious', why: '被人背叛之后，再也不轻信别人' }],
  saved: [{ to: 'warm', why: '被人救过一命，心里暖了' }],
  oppressed: [{ to: 'patient', why: '长年受压，学会了隐忍' }, { to: 'extreme', why: '长年受压，心思越来越偏' }],
  humiliated: [{ to: 'grudging', why: '当众受辱，从此记仇' }],
  triumph: [{ to: 'proud', why: '一战成名，难免傲气起来' }],
  heartbreak: [{ to: 'gloomy', why: '情伤之后，难得笑了' }],
};
