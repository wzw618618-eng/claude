// 《青冥录》的全部存档数据。状态是纯 JSON：存档、读档、无头模拟、发给 AI 都用它。

export type PlaceId = 'qinglan' | 'chixiao' | 'market' | 'vein' | 'cave' | 'forest' | 'village';
export type SectId = 'qinglan' | 'chixiao';

export type TraitId =
  | 'proud' | 'careful' | 'loyal' | 'greedy' | 'grudge' | 'bold' | 'cruel' | 'devoted'
  | 'kind' | 'lonely' | 'cunning' | 'rash';

/** 看重什么：力量、财富、情义、忠诚、正义（0–1） */
export interface Values { power: number; wealth: number; love: number; loyalty: number; justice: number }

/** 对某个人的看法 */
export interface Opinion { aff: number; trust: number; fear: number }

/** 记忆：谁（a）对谁（b）做了什么。tone 是这件事在记的人眼里的好坏（−3 到 3） */
export type MemKind =
  | 'save' | 'gift' | 'help' | 'teach' | 'talk_good' | 'talk_bad' | 'spar' | 'hurt' | 'kill' | 'rob'
  | 'betray' | 'refuse' | 'lie' | 'expose' | 'partner' | 'reject' | 'master' | 'insult' | 'ally' | 'avenge';
export interface Memory {
  y: number;
  k: MemKind;
  a: string;
  b?: string;
  at?: PlaceId;
  tone: number;
  /** 听谁说的；没有就是亲身经历或亲眼所见 */
  from?: string;
  /** 已经讲给别人听过几次（传得太多就不再讲） */
  told?: number;
}

export type GoalKind = 'revenge' | 'throne' | 'seekmaster' | 'love' | 'treasure' | 'longevity' | 'join';
export interface Goal {
  kind: GoalKind;
  /** 报仇、求道侣的对象；争位的宗门；夺宝的宝物 */
  target?: string;
  step: number;
  /** 这一步卡了几年 */
  stuck: number;
  secret: boolean;
  /** 对外的说法（秘密目标才有） */
  cover?: string;
  /** 找来的帮手（可能是主角 'me'） */
  ally?: string;
  since: number;
  done?: 'ok' | 'fail';
}

export interface Mind {
  traits: TraitId[];
  values: Values;
  goal: Goal | null;
  /** 做完的目标，留着写进小传 */
  past: Goal[];
  op: Record<string, Opinion>;
  mem: Memory[];
  mood: number;
  /** 知道的秘密：「secret:lu」「goal:wen」 */
  knows: string[];
}

export interface Being {
  id: string;
  name: string;
  gender: 'm' | 'f';
  alive: boolean;
  died?: { y: number; note: string };
  age: number;
  realm: number;
  stage: number;
  exp: number;
  talent: number;
  hp: number;
  stones: number;
  items: string[];
  place: PlaceId;
  sect: SectId | '';
  /** 宗门里的功劳（争位用） */
  merit: number;
  /** 延寿丹加的寿元 */
  bonus: number;
  master?: string;
  partner?: string;
}

export interface Npc extends Being {
  mind: Mind;
  /** 今年打算干什么（年初定下，年末结算） */
  plan: Plan;
}

/** 一年的打算：干什么、去哪、为什么；scheme 是谋划手段，target 是冲着谁 */
export interface Plan { act: string; place: PlaceId; why: string; by: 'rule' | 'ai'; scheme?: string; target?: string }

export interface News { y: number; text: string; tone: 'good' | 'bad' | 'story' | 'info'; about: string[]; big?: boolean }

/** NPC 主动找上主角的事 */
export interface Encounter { id: string; kind: string; who: string; vars: Record<string, string | number> }

export interface Sect { id: SectId; name: string; master: string }

export interface World {
  v: 1;
  seed: number;
  rng: number;
  year: number;
  phase: 'year' | 'ending';
  me: Being;
  people: Record<string, Npc>;
  sects: Record<SectId, Sect>;
  /** 宝物在哪：人 id、地点或已毁 */
  treasure: Record<string, string>;
  /** 主角知道的秘密：「goal:lu」「secret:wen」 */
  knows: string[];
  news: News[];
  pending: Encounter[];
  /** 这一年主角做了什么：去了哪、主事做了没、还能打几次交道 */
  turn: { moved: boolean; main: boolean; social: number };
  flags: Record<string, number | string | boolean>;
  ending: { kind: 'age' | 'dead' | 'ascend'; y: number } | null;
  /** 主角的经历（写小传用） */
  life: News[];
  nextId: number;
}
