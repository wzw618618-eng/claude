// 十二个有名有姓的修士。他们的目标和秘密是互相咬合的：
// 温玄当年把师兄云鹤丢在洞府里，还剿灭了墨家；沈清禾在找师父，墨九要报灭门之仇；
// 陆沉舟想夺宗主之位，也是十年前暗杀秦焰哥哥的人；苏小棠喜欢陆沉舟；白鹿暗恋沈清禾；
// 厉擎和柳如烟都盯着洞府深处的玄冥剑；韩烈想趁门主不在篡位；阿蛮想拜入宗门；花婆婆什么都知道一点。

import type { GoalKind, PlaceId, SectId, TraitId, Values } from '../core/types';

export interface PersonDef {
  id: string;
  name: string;
  short: string;
  gender: 'm' | 'f';
  age: number;
  realm: number;
  stage: number;
  talent: number;
  sect: SectId | '';
  home: PlaceId;
  traits: TraitId[];
  values: Values;
  goal?: { kind: GoalKind; target?: string; secret: boolean; cover?: string; /** 动手最早在第几年 */ after?: number };
  stones: number;
  items?: string[];
  /** 一句话来历 */
  bio: string;
  /** 说话方式（给 AI） */
  voice: string;
  /** 心底的秘密（给 AI）；secretKey 是主角知道它时记下的钥匙 */
  secret?: string;
  /** 开局知道的别人的秘密 */
  knows?: string[];
  ties?: Record<string, number>;
}

const V = (power: number, wealth: number, love: number, loyalty: number, justice: number): Values => ({ power, wealth, love, loyalty, justice });

export const PEOPLE: PersonDef[] = [
  {
    id: 'wen', name: '温玄', short: '温玄', gender: 'm', age: 86, realm: 2, stage: 2, talent: 0.9, sect: 'qinglan', home: 'qinglan',
    traits: ['careful', 'cunning'], values: V(0.6, 0.2, 0.2, 0.5, 0.3),
    goal: { kind: 'longevity', secret: true, cover: '贫道近来闭关参悟大道' }, stones: 400, items: ['pill'],
    bio: '青岚宗宗主，三十年前接下宗主之位，寿元只剩二十来年了。',
    voice: '说话慢，滴水不漏，自称「贫道」。',
    secret: '三十年前和师兄云鹤同闯玄冥洞府，为了独吞机缘，把重伤的师兄丢在洞府深处，回来说师兄失踪了。二十年前又以「剿灭魔修」为名灭了墨家满门。',
    ties: { shen: 25, lu: 20, li: -40, mojiu: -10 },
  },
  {
    id: 'shen', name: '沈清禾', short: '沈清禾', gender: 'f', age: 34, realm: 1, stage: 1, talent: 1.2, sect: 'qinglan', home: 'qinglan',
    traits: ['careful', 'loyal', 'kind'], values: V(0.4, 0.1, 0.5, 0.8, 0.7),
    goal: { kind: 'seekmaster', secret: false, after: 14 }, stones: 40,
    bio: '青岚宗大师姐，云鹤真人唯一的亲传弟子。师父失踪那年她才四岁。',
    voice: '清冷，话不多，礼数周全。',
    secret: '她一直觉得师父失踪另有隐情，偷偷去过三次玄冥洞府。',
    ties: { wen: 30, lu: -25, tang: 45, bailu: 15 },
  },
  {
    id: 'lu', name: '陆沉舟', short: '陆沉舟', gender: 'm', age: 41, realm: 1, stage: 2, talent: 1.1, sect: 'qinglan', home: 'qinglan',
    traits: ['proud', 'cruel', 'cunning'], values: V(0.9, 0.4, 0.1, 0.1, 0.1),
    goal: { kind: 'throne', target: 'qinglan', secret: true, cover: '只想潜心修炼，为宗门出力', after: 18 }, stones: 120,
    bio: '青岚宗二师兄，人人都说他将来要接宗主的位子。',
    voice: '温文尔雅，笑里藏刀，爱叫人「师弟」「师妹」。',
    secret: '十年前两宗冲突，他在背后下黑手杀了赤霄门的秦烈，就是秦焰的亲哥哥。',
    ties: { wen: 15, shen: -25, tang: 10, han: 20 },
  },
  {
    id: 'tang', name: '苏小棠', short: '苏小棠', gender: 'f', age: 19, realm: 0, stage: 1, talent: 1, sect: 'qinglan', home: 'qinglan',
    traits: ['devoted', 'kind', 'rash'], values: V(0.2, 0.1, 0.9, 0.6, 0.4),
    goal: { kind: 'love', target: 'lu', secret: true, cover: '想早点筑基，别拖师兄师姐后腿' }, stones: 15,
    bio: '青岚宗最小的师妹，爱笑，跑起来辫子一甩一甩。',
    voice: '活泼，话多，一着急就结巴。',
    secret: '她喜欢陆沉舟，绣了一个香囊一直没敢送。',
    ties: { lu: 60, shen: 50, wen: 20 },
  },
  {
    id: 'li', name: '厉擎', short: '厉擎', gender: 'm', age: 72, realm: 2, stage: 1, talent: 1, sect: 'chixiao', home: 'chixiao',
    traits: ['proud', 'bold'], values: V(0.9, 0.5, 0.2, 0.3, 0.2),
    goal: { kind: 'treasure', target: 'sword', secret: false, after: 12 }, stones: 250, items: ['heal'],
    bio: '赤霄门门主，一身横练，脾气和嗓门一样大。',
    voice: '直来直去，三句不离「打一架」。',
    ties: { wen: -40, han: 30, qinyan: 30, lu: -20 },
  },
  {
    id: 'han', name: '韩烈', short: '韩烈', gender: 'm', age: 44, realm: 1, stage: 2, talent: 0.95, sect: 'chixiao', home: 'chixiao',
    traits: ['cruel', 'cunning', 'grudge'], values: V(0.8, 0.5, 0.1, 0.2, 0.1),
    goal: { kind: 'throne', target: 'chixiao', secret: true, cover: '不过是替门主分忧罢了', after: 14 }, stones: 150,
    bio: '赤霄门长老，管着门里的账和刑罚。',
    voice: '阴阳怪气，说话爱留半句。',
    secret: '他和青岚宗的陆沉舟暗中有来往，想趁厉擎闯洞府的时候夺门主之位。',
    ties: { li: 10, lu: 25, qinyan: -10 },
  },
  {
    id: 'qinyan', name: '秦焰', short: '秦焰', gender: 'm', age: 22, realm: 0, stage: 2, talent: 1.3, sect: 'chixiao', home: 'chixiao',
    traits: ['rash', 'grudge', 'loyal'], values: V(0.6, 0.1, 0.3, 0.7, 0.6),
    goal: { kind: 'revenge', target: 'lu', secret: false, after: 20 }, stones: 20,
    bio: '赤霄门年轻弟子。十年前哥哥秦烈死在两宗冲突里，凶手一直没找到。',
    voice: '冲，急，一提哥哥眼睛就红。',
    ties: { li: 45, han: -5 },
  },
  {
    id: 'liu', name: '柳如烟', short: '柳如烟', gender: 'f', age: 34, realm: 1, stage: 0, talent: 0.9, sect: '', home: 'market',
    traits: ['greedy', 'cunning'], values: V(0.4, 0.9, 0.2, 0.1, 0.1),
    goal: { kind: 'treasure', target: 'sword', secret: true, cover: '做点小买卖，混口饭吃', after: 14 }, stones: 320, items: ['pill', 'pill', 'heal', 'heal', 'life'],
    bio: '云渡坊最大的丹药铺子是她开的。',
    voice: '笑盈盈的，开口就谈价钱。',
    secret: '她在找帮手下玄冥洞府取玄冥剑，打算得手以后转手卖个天价，帮手嘛，用完就扔。',
    knows: ['goal:li'],
    ties: { li: 5, mojiu: 15, hua: 10 },
  },
  {
    id: 'bailu', name: '白鹿', short: '白鹿', gender: 'm', age: 58, realm: 2, stage: 0, talent: 1, sect: '', home: 'vein',
    traits: ['lonely', 'devoted', 'kind'], values: V(0.3, 0.1, 0.7, 0.4, 0.5),
    goal: { kind: 'love', target: 'shen', secret: true, cover: '在谷里听泉修行，不问世事' }, stones: 90,
    bio: '听泉谷里独居的散修，养着一头白鹿，人也就叫他白鹿。',
    voice: '慢条斯理，常常说着说着走神。',
    secret: '他暗恋沈清禾很多年，每年她生辰都托人送一枝谷里的梅花，从不署名。',
    ties: { shen: 55, wen: -10, hua: 20 },
  },
  {
    id: 'mojiu', name: '墨九', short: '墨九', gender: 'm', age: 42, realm: 1, stage: 1, talent: 1.1, sect: '', home: 'market',
    traits: ['cruel', 'grudge', 'careful'], values: V(0.7, 0.4, 0.1, 0.2, 0.5),
    goal: { kind: 'revenge', target: 'wen', secret: true, cover: '云游的散修，路过而已', after: 22 }, stones: 80,
    bio: '来历不明的散修，左手少了两根手指。',
    voice: '话少，阴沉，从不先开口。',
    secret: '他是墨家唯一活下来的人。二十年前温玄以剿魔为名灭了墨家满门。',
    knows: ['secret:wen'],
    ties: { wen: -90, liu: 15 },
  },
  {
    id: 'aman', name: '阿蛮', short: '阿蛮', gender: 'm', age: 17, realm: 0, stage: 0, talent: 1.4, sect: '', home: 'village',
    traits: ['bold', 'kind', 'rash'], values: V(0.6, 0.2, 0.5, 0.6, 0.7),
    goal: { kind: 'join', secret: false }, stones: 5,
    bio: '柳溪村的猎户少年，力气大得吓人，做梦都想拜入宗门。',
    voice: '憨直，嗓门大，叫谁都叫「哥」「姐」。',
    ties: { hua: 60 },
  },
  {
    id: 'hua', name: '花婆婆', short: '花婆婆', gender: 'f', age: 50, realm: 1, stage: 2, talent: 0.7, sect: '', home: 'village',
    traits: ['kind', 'careful'], values: V(0.1, 0.3, 0.6, 0.5, 0.6),
    stones: 60, items: ['heal', 'heal', 'pill'],
    bio: '柳溪村的老药婆，年轻时在两宗都待过，山里的事她知道得最多。',
    voice: '絮絮叨叨，管谁都叫「娃儿」。',
    secret: '她年轻时是云鹤真人的道侣。',
    knows: ['goal:mojiu', 'secret:lu'],
    ties: { aman: 60, bailu: 20, wen: -15, liu: 5, shen: 30 },
  },
];

export const PERSON: Record<string, PersonDef> = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));

// ───────────── 后起之秀：老人死了，新人会来 ─────────────

const SURNAME = ['林', '许', '顾', '萧', '江', '叶', '宋', '方', '程', '谢', '孟', '洛'];
const GIVEN_M = ['长风', '子期', '承影', '怀瑾', '远山', '问舟', '景行', '惊鸿'];
const GIVEN_F = ['若溪', '听雪', '晚晴', '素衣', '映月', '书瑶', '念秋', '采薇'];
const TRAIT_POOL: TraitId[] = ['proud', 'careful', 'loyal', 'greedy', 'grudge', 'bold', 'cruel', 'devoted', 'kind', 'lonely', 'cunning', 'rash'];

const VOICE: Record<TraitId, string> = {
  proud: '说话带刺，看不起修为比自己低的人。', careful: '说话前总要想一想。', loyal: '重情重义，说话实在。', greedy: '三句话不离灵石。',
  grudge: '说话冷，记仇。', bold: '爽快，爱笑。', cruel: '笑里带着狠劲。', devoted: '温和，说起在意的人就脸红。',
  kind: '和气，见谁都想帮一把。', lonely: '话很少。', cunning: '说话滴水不漏。', rash: '说话又快又急。',
};

/** 后起之秀。maxRealm：年头越久，从外州来的人修为可能越高（给后期的你添些对手和徒弟） */
export function newcomer(id: string, pick: <T>(a: readonly T[]) => T, r: () => number, maxRealm = 0): PersonDef {
  const gender = r() < 0.5 ? 'm' : 'f';
  const name = pick(SURNAME) + pick(gender === 'm' ? GIVEN_M : GIVEN_F);
  const t1 = pick(TRAIT_POOL);
  let t2 = pick(TRAIT_POOL);
  if (t2 === t1) t2 = TRAIT_POOL[(TRAIT_POOL.indexOf(t1) + 5) % TRAIT_POOL.length];
  const sect = r() < 0.6 ? (r() < 0.5 ? 'qinglan' : 'chixiao') : '';
  const realm = maxRealm > 0 && r() < 0.5 ? Math.min(maxRealm, 1 + Math.floor(r() * maxRealm)) : 0;
  const age = realm === 0 ? 16 + Math.floor(r() * 10) : realm === 1 ? 30 + Math.floor(r() * 20) : 60 + Math.floor(r() * 30);
  const sectName = sect === 'qinglan' ? '青岚宗' : '赤霄门';
  const bio = realm === 0 ? (sect ? `新入${sectName}的弟子。` : '刚走上修行路的散修。')
    : `从外州来的${realm >= 2 ? '金丹' : '筑基'}修士${sect ? `，投在了${sectName}门下` : '，来历不明'}。`;
  return {
    id, name, short: name, gender, age, realm, stage: Math.floor(r() * 2), talent: 0.8 + r() * 0.6,
    sect, home: sect || pick(['market', 'village', 'vein'] as PlaceId[]),
    traits: [t1, t2], values: V(r(), r() * 0.8, r(), r(), r()),
    stones: 10 + Math.floor(r() * 40) + realm * 60,
    bio, voice: VOICE[t1],
  };
}
