// 世界设定：殿堂、身份、方略、传承树、开局选项、敌宗、起名用的字。

import type { HallId, JobId, Rank, Skill, Value } from '../types';

export const SKILL_NAME: Record<Skill, string> = {
  manage: '管理', alchemy: '炼丹', forge: '炼器', array: '阵法', herb: '灵植', social: '交际', combat: '斗法', teach: '教导', insight: '眼光',
};
export const SKILLS = Object.keys(SKILL_NAME) as Skill[];

export const VALUE_NAME: Record<Value, string> = { power: '力量', wealth: '财富', bond: '情义', loyalty: '忠诚', justice: '正义' };
export const VALUES = Object.keys(VALUE_NAME) as Value[];

export interface HallDef {
  id: HallId;
  name: string;
  /** 干这活主要靠哪项才干 */
  skill: Skill;
  /** 次要才干 */
  skill2?: Skill;
  desc: string;
  /** 在宗门地图上的位置（0–1） */
  x: number;
  y: number;
}

export const HALLS: HallDef[] = [
  { id: 'herb', name: '灵植园', skill: 'herb', desc: '种灵草，是丹房的根本', x: 0.2, y: 0.7 },
  { id: 'alchemy', name: '丹房', skill: 'alchemy', skill2: 'herb', desc: '把灵草炼成丹药', x: 0.36, y: 0.5 },
  { id: 'forge', name: '器阁', skill: 'forge', skill2: 'array', desc: '炼法器，打仗时有用', x: 0.66, y: 0.5 },
  { id: 'teach', name: '传功殿', skill: 'teach', skill2: 'insight', desc: '指点同门，全宗修炼更快', x: 0.5, y: 0.3 },
  { id: 'law', name: '执法堂', skill: 'manage', skill2: 'insight', desc: '压住怨气和歪风，揪出奸细', x: 0.78, y: 0.33 },
  { id: 'diplomacy', name: '外事堂', skill: 'social', skill2: 'manage', desc: '做买卖、攒名望、和别宗打交道', x: 0.82, y: 0.7 },
  { id: 'recruit', name: '迎客堂', skill: 'insight', skill2: 'social', desc: '招人：来的人多不多、好不好，看得准不准', x: 0.6, y: 0.82 },
  { id: 'guard', name: '巡山队', skill: 'combat', desc: '守山门、护灵脉、挡偷袭', x: 0.4, y: 0.84 },
];
export const HALL: Record<HallId, HallDef> = Object.fromEntries(HALLS.map((h) => [h.id, h])) as Record<HallId, HallDef>;

export const JOB_NAME: Record<JobId, string> = {
  herb: '灵植园', alchemy: '丹房', forge: '器阁', teach: '传功殿', law: '执法堂', diplomacy: '外事堂', recruit: '迎客堂', guard: '巡山队',
  seclude: '闭关', travel: '外出历练', none: '无职',
};
/** 每种活计占掉多少修炼时间（1 = 全力修炼） */
export const JOB_TIME: Record<JobId, number> = {
  herb: 0.6, alchemy: 0.6, forge: 0.6, teach: 0.65, law: 0.55, diplomacy: 0.5, recruit: 0.6, guard: 0.6, seclude: 1, travel: 0.5, none: 0.7,
};

export const RANK_NAME: Record<Rank, string> = {
  probation: '记名弟子', outer: '外门弟子', inner: '内门弟子', core: '真传弟子', chief: '首席弟子', elder: '长老', master: '宗主',
};
export const RANK_ORDER: Rank[] = ['probation', 'outer', 'inner', 'core', 'chief', 'elder', 'master'];
export const rankLv = (r: Rank) => RANK_ORDER.indexOf(r);
/** 每季月例（灵石） */
export const UPKEEP: Record<Rank, number> = { probation: 1, outer: 3, inner: 6, core: 10, chief: 14, elder: 20, master: 0 };
/** 这个身份大家觉得至少该有的修为（境界刻度，见 cult.lvl） */
export const RANK_EXPECT: Record<Rank, number> = { probation: 0, outer: 0, inner: 5, core: 8, chief: 9, elder: 10, master: 14 };
/** 殿堂主事大家觉得至少该有的修为 */
export const HEAD_EXPECT = 7;

/** 殿堂规模：等级 0 是空地，1–4 的人数上限和产出倍数（建造花费见 build.ts） */
export const HALL_CAP = [0, 2, 4, 6, 8];
export const HALL_MULT = [0, 1, 1.2, 1.4, 1.65];

export interface PolicyDef { id: string; name: string; desc: string; mood?: string }
export const POLICIES: PolicyDef[] = [
  { id: 'sword', name: '剑道', desc: '斗法长进快，打仗更狠；人人想比试', mood: '今年宗门崇武，弟子们都憋着劲想比试' },
  { id: 'pill', name: '丹道', desc: '灵植、炼丹产出多五成', mood: '今年宗门主攻丹道，丹房最受看重' },
  { id: 'craft', name: '器道', desc: '器阁产出翻倍，打仗时法器更足', mood: '今年宗门主攻器道' },
  { id: 'array', name: '阵道', desc: '守山更稳，阵法长进快', mood: '今年宗门主攻阵道，一切以守为先' },
  { id: 'trade', name: '商道', desc: '外事堂多赚一倍灵石', mood: '今年宗门重商，人人想着赚钱' },
  { id: 'ally', name: '合纵', desc: '各宗对你的态度慢慢变好，名望涨得快', mood: '今年宗门以和为贵，和各家多走动' },
  { id: 'recruit', name: '广纳门徒', desc: '开山收徒多来一半人，候选人更愿意来', mood: '今年宗门广开山门，新面孔多' },
  { id: 'hide', name: '韬光养晦', desc: '别宗不容易盯上你，月例省两成，但名望会降', mood: '今年宗门闭门修炼，不问外事' },
];
export const POLICY: Record<string, PolicyDef> = Object.fromEntries(POLICIES.map((p) => [p.id, p]));

export interface TechDef { id: string; name: string; branch: string; desc: string; needs?: string[]; align?: number }
export const TECHS: TechDef[] = [
  { id: 'sword_array', name: '剑阵', branch: '武', desc: '打仗时战力 +15%' },
  { id: 'arena', name: '演武场', branch: '武', desc: '每年可办宗门大比，按名次定座次，最能服众；斗法长进更快', needs: ['sword_array'] },
  { id: 'pill_hall', name: '丹房扩建', branch: '丹', desc: '丹药产出 +30%' },
  { id: 'foundation_recipe', name: '筑基丹方', branch: '丹', desc: '丹房能炼筑基丹（大幅提高突破筑基的成算）', needs: ['pill_hall'] },
  { id: 'guard_array', name: '护山大阵', branch: '阵', desc: '据守山门时战力 ×1.5' },
  { id: 'heart_array', name: '问心阵', branch: '阵', desc: '招人时能看清候选人的性格', needs: ['guard_array'] },
  { id: 'market_shop', name: '坊市铺面', branch: '商', desc: '每季多 40 灵石' },
  { id: 'caravan', name: '商路', branch: '商', desc: '外事堂赚的灵石 +50%，名望涨得快', needs: ['market_shop'] },
  { id: 'rules', name: '门规戒律', branch: '人', desc: '怨气消得快，执法堂更有用' },
  { id: 'scouting', name: '寻访阁', branch: '人', desc: '每年开山收徒多来两个人，印象更准', needs: ['rules'] },
  { id: 'technique_2', name: '玄阶功法', branch: '法', desc: '全宗修炼速度 ×1.2' },
  { id: 'technique_3', name: '地阶功法', branch: '法', desc: '全宗修炼速度再 ×1.25', needs: ['technique_2'] },
  { id: 'blood_art', name: '血炼之法', branch: '魔', desc: '修炼速度 ×1.3，但正道不容，正派弟子心寒', align: -35 },
];
export const TECH: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export interface StartOption { id: string; name: string; desc: string }
export const SITES: StartOption[] = [
  { id: 'vein', name: '灵脉宝地', desc: '灵气足，收入高，修炼快；但夹在两个大宗中间，人人眼红' },
  { id: 'deep', name: '深山', desc: '偏僻安全，没人惦记；但穷，少有人来拜师' },
  { id: 'market', name: '坊市旁', desc: '人来人往，好招人、来钱快；是非也多，奸细也多' },
];
export const ORIGINS: StartOption[] = [
  { id: 'sword', name: '剑修', desc: '你是一名剑修，斗法极强；开局会剑阵' },
  { id: 'alchemist', name: '丹师', desc: '你是一名丹师，开局多带丹药；丹房扩建已有' },
  { id: 'array', name: '阵法师', desc: '你精通阵法；开局就有护山大阵' },
  { id: 'renegade', name: '叛门者', desc: '你从赤霄宗叛出，修为更高、带走了玄阶功法；但赤霄宗恨你入骨' },
  { id: 'demon', name: '魔道回头', desc: '你曾是魔修，修为高、手段狠；正道宗门不信你，正派弟子不愿来' },
];
export const HERITAGES: StartOption[] = [
  { id: 'sword', name: '《青锋诀》', desc: '剑修传承：弟子斗法长进快' },
  { id: 'herb', name: '《百草经》', desc: '丹道传承：灵植、炼丹长进快' },
  { id: 'mind', name: '《清心诀》', desc: '心法传承：修炼快一成，怨气消得快' },
  { id: 'trade', name: '《陶朱策》', desc: '经商传承：交际长进快，开局多 150 灵石' },
];

export interface RivalDef { id: string; name: string; color: string; style: 'aggressive' | 'cunning' | 'proper' | 'aloof'; master: { name: string; gender: 'm' | 'f'; realm: number; stage: number; traits: string[]; voice: string; bio: string }; passive?: boolean }
export const RIVALS: RivalDef[] = [
  {
    id: 'chixiao', name: '赤霄宗', color: '#c0392b', style: 'aggressive',
    master: { name: '厉千锋', gender: 'm', realm: 2, stage: 2, traits: ['fierce', 'proud', 'ambitious'], voice: '声如洪钟，开口就是威胁', bio: '赤霄宗宗主，以力服人，最看不得小宗门在眼皮底下坐大。' },
  },
  {
    id: 'xuanshui', name: '玄水阁', color: '#2e6da4', style: 'cunning',
    master: { name: '柳含烟', gender: 'f', realm: 2, stage: 1, traits: ['scheming', 'smooth', 'greedy'], voice: '笑意盈盈，话里藏针', bio: '玄水阁阁主，做买卖起家，最会挖墙脚、两头下注。' },
  },
  {
    id: 'taiyi', name: '太一门', color: '#8e6f2e', style: 'aloof', passive: true,
    master: { name: '玄真子', gender: 'm', realm: 3, stage: 1, traits: ['steady', 'detached', 'righteous'], voice: '惜字如金，一派宗师气度', bio: '太一门掌门，元婴老祖，一州正道之首。' },
  },
];

export const SURNAMES = ['林', '沈', '顾', '萧', '叶', '苏', '陆', '江', '温', '秦', '白', '宋', '方', '程', '谢', '孟', '韩', '楚', '柳', '燕', '凌', '慕', '洛', '云', '姜', '许', '卫', '褚', '岳', '司徒', '欧阳', '上官', '南宫', '赵', '钱', '石', '唐', '杜', '傅', '裴'];
export const GIVEN_M = ['长风', '子期', '承影', '怀瑾', '远山', '问舟', '景行', '惊鸿', '无尘', '青崖', '寒松', '逸之', '少白', '砚秋', '铁柱', '大牛', '二狗', '守拙', '知远', '临渊', '北辰', '昭明', '星河', '墨白', '不语', '归鸿', '石头', '小满', '千里', '一舟'];
export const GIVEN_F = ['若溪', '听雪', '晚晴', '素衣', '映月', '书瑶', '念秋', '采薇', '清禾', '小棠', '如烟', '红缨', '灵犀', '疏影', '月华', '紫苏', '青黛', '阿蛮', '二丫', '杏儿', '流萤', '霜华', '知意', '半夏', '云舒', '白芷', '沉香', '月见', '朝颜', '宁宁'];

export const ORIGIN_TEXT = [
  '山下猎户之子，从小在林子里摸爬滚打', '落魄书香门第，读过几年书', '坊市里的小伙计，见过世面', '孤儿，在破庙里长大',
  '镖局出身，会些拳脚', '药铺学徒，认得不少草药', '铁匠铺的学徒，力气大', '渔家出身，水性好', '小世家的旁支，没人看重',
  '散修之后，父母死在秘境里', '戏班子里长大，会察言观色', '农家子弟，种过三十亩地', '大户人家的丫鬟/书童，跑出来求仙',
  '在别的小宗门待过，那宗门散了', '逃荒来的流民', '凡人王朝的落第秀才', '赌坊里混过日子', '道观里打杂的小道童',
];
export const QUIRKS = [
  '吃饭特别快', '总爱哼小曲', '睡觉说梦话', '有洁癖', '收集奇石', '怕黑', '爱养猫', '算账从不出错', '讲话爱引经据典', '看见好吃的走不动道',
  '左撇子', '一紧张就结巴', '记性奇好', '路痴', '爱给人起外号', '喜欢半夜看星星', '酒量奇大', '一喝酒就脸红', '字写得极好', '袖子里总揣着糖',
];
export const VOICES = [
  '说话简短，有一说一', '文绉绉，爱掉书袋', '大大咧咧，嗓门大', '轻声细语，礼数周全', '油嘴滑舌，爱开玩笑', '冷冰冰的，惜字如金',
  '满口乡音，朴实', '说话带刺', '慢条斯理，像个老学究', '急吼吼的，话赶话',
];

export const ELEMENTS = ['金', '木', '水', '火', '土'];
