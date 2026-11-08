// 离线时弟子心里的一句话：按做的事和性格挑写好的台词。接了 AI 就换成 AI 写的。

import type { ActKind, Choice } from './choices';
import type { Rng } from './rng';
import type { Person, World } from './types';
import { disp, nm } from './world';

const L: Partial<Record<ActKind, string[]>> = {
  diligent: ['多干点，总有人看得见。', '趁年轻，多出点力。', '这活我要干出个样子来。', '别人歇着，我不歇。'],
  slack: ['干多干少一个样，何必呢。', '凭什么累死累活的是我。', '今天就到这儿吧。', '反正也没人记得我的好。'],
  cultivate: ['活是干不完的，修为才是自己的。', '再不抓紧，就被人甩下了。', '少干点活，多打会儿坐。'],
  spar: ['{t}，咱俩过两招。', '光练不打，练不出真本事。', '我倒要看看{t}有几斤几两。'],
  befriend: ['{t}这人不错，值得一交。', '同门一场，多走动走动。'],
  woo: ['{t}今天好像多看了我一眼。', '给{t}带了点山下的点心。', '不知道{t}喜欢什么。'],
  confess: ['再不说，这辈子都没机会了。', '{t}，我有话想跟你说。'],
  mentor: ['{t}根骨不错，指点几句。', '当年也有人这样教过我。'],
  help: ['{t}这样子，看着心疼。', '搭把手的事。'],
  scheme: ['{t}也该吃点苦头了。', '有些事，不必我亲自出面。', '挡我路的人，总得让一让。'],
  report: ['门规就是门规。', '{t}的事，我不能装没看见。'],
  request_post: ['这差事不适合我，得找宗主说说。', '我想去做我拿手的事。'],
  request_rank: ['论修为、论功劳，我也该往上走一走了。', '总不能一辈子在原地打转。'],
  challenge: ['凭什么{t}压我一头？', '是骡子是马，拉出来遛遛。', '我不服{t}。'],
  faction: ['这山上不痛快的，不止我一个。', '人多了，说话才有分量。'],
  steal: ['这么多灵石，少几块谁知道。', '宗门亏待我，我自己拿。'],
  leak: ['该给主家递个消息了。', '这里的底细，摸得差不多了。'],
  defect: ['人往高处走。', '这里容不下我，自有容得下我的地方。'],
  leave: ['这山上，没什么可留恋的了。', '想家了。'],
  adventure: ['山外的天地，总得去看看。', '闷在山上，修不出名堂。'],
  seclude: ['等不及了，成败在此一举。', '再拖下去，寿元就不够了。'],
  found: ['宁为鸡头，不为凤尾。', '是时候自己闯一闯了。'],
};

const FIERY: Partial<Record<ActKind, string[]>> = {
  challenge: ['{t}算什么东西，也配坐在我上头！', '今天不分个高下，我咽不下这口气。'],
  slack: ['爱谁干谁干，老子不伺候了。'],
  spar: ['{t}，来！今天非打服你不可。'],
};
const SHY: Partial<Record<ActKind, string[]>> = {
  woo: ['……就当是顺路给{t}送的。'],
  confess: ['要、要是{t}不答应……也没关系。'],
};

export function templateWhy(w: World, r: Rng, p: Person, c: Choice): string | undefined {
  let pool = L[c.kind];
  if (disp(p, 'temper') >= 2 && FIERY[c.kind]) pool = FIERY[c.kind];
  else if (disp(p, 'courage') <= -1 && SHY[c.kind]) pool = SHY[c.kind];
  if (!pool) return undefined;
  return r.pick(pool).replace(/\{t\}/g, c.target ? nm(w, c.target) : '');
}

/** 平常山上的闲话：看他在干什么、心情、心愿，随口一句。只是画面上的气泡，不进纪事、不改数值 */
const WORK_TALK: Partial<Record<string, string[]>> = {
  herb: ['这片灵草长得不错。', '又该松土了。', '今年雨水足，药苗壮。'],
  alchemy: ['火候差一点就废一炉。', '这炉丹快成了。', '咳咳，烟太大了。'],
  forge: ['再淬一遍火。', '这把剑还差点意思。', '叮叮当当一整天。'],
  teach: ['今天讲到第三卷。', '这几个孩子悟性不错。'],
  law: ['门规第一条，背熟了没有？', '最近山上不太平。'],
  diplomacy: ['山下的行情又涨了。', '这笔买卖做得。'],
  recruit: ['今天山门外又有人来了。', '看人，先看眼神。'],
  guard: ['后山有动静，去看看。', '今晚我守夜。'],
  seclude: ['……', '灵气又顺了一分。'],
  none: ['宗主还没给我派活。', '闲着也是闲着。', '干点什么好呢？'],
};

export function idleLine(w: World, p: Person, roll: number): string | null {
  if (p.wish && roll < 0.22) return p.wish.kind === 'spy' ? null : p.wish.text;
  if (p.grudge >= 55 && roll < 0.45) return ['哼，凭什么。', '这日子没法过了。', '早晚有一天……'][Math.floor(roll * 100) % 3];
  if (p.mood >= 75 && roll < 0.4) return ['今天心情真好。', '山上的日子不错。', '修为又长了一点！'][Math.floor(roll * 100) % 3];
  if (p.hp < 45) return '伤口还疼着……';
  const pool = WORK_TALK[p.job];
  if (!pool) return null;
  void w;
  return pool[Math.floor(roll * 997) % pool.length];
}
