// 游戏里所有能存档的数据。全部是纯数据（不含函数），整个 World 直接 JSON 存进浏览器。

/** 境界：0 炼气、1 筑基、2 结丹、3 元婴、4 化神 */
export type Realm = 0 | 1 | 2 | 3 | 4;

/** 才干：做事的本事，和修为分开 */
export type Skill = 'manage' | 'alchemy' | 'forge' | 'array' | 'herb' | 'social' | 'combat' | 'teach' | 'insight';

/** 价值取向：看重什么 */
export type Value = 'power' | 'wealth' | 'bond' | 'loyalty' | 'justice';

/** 性情倾向：由性格标签和价值取向合成，规则和 AI 都看它（-3 到 3 左右） */
export type Disp =
  | 'pride' | 'diligence' | 'temper' | 'greed' | 'ambition' | 'kindness' | 'trust' | 'courage'
  | 'cunning' | 'order' | 'envy' | 'grudge' | 'romance' | 'social';

/** 岗位：七个殿堂加巡山；另有闭关、历练、无职 */
export type HallId = 'herb' | 'alchemy' | 'forge' | 'teach' | 'law' | 'diplomacy' | 'recruit' | 'guard';
export type JobId = HallId | 'seclude' | 'travel' | 'none';

/** 身份，从低到高 */
export type Rank = 'probation' | 'outer' | 'inner' | 'core' | 'chief' | 'elder' | 'master';

export type RootKind = 'heaven' | 'dual' | 'triple' | 'mixed';
export interface Root { kind: RootKind; els: string[]; apt: number }

export type SecretKind = 'spy' | 'fugitive' | 'vendetta' | 'noble' | 'demon';

export type WishKind =
  | 'realm' | 'post' | 'rank' | 'revenge' | 'love' | 'best' | 'found' | 'recognition' | 'leave' | 'glory' | 'mentor' | 'treasure' | 'spy';

export interface Wish {
  kind: WishKind;
  /** 他自己的话（AI 写，或规则模板） */
  text: string;
  target?: string;
  /** 想当的岗位、想练到第一的才干、想到的境界等 */
  param?: string;
  since: number;
  /** AI 写的还是规则定的 */
  by: 'ai' | 'rule';
}

/** 一个人对另一个人的看法 */
export interface Opinion { aff: number; respect: number; tag?: 'friend' | 'rival' | 'lover' | 'enemy' | 'master' | 'pupil' | 'kin' }

/** 经历里的一条 */
export interface LifeEntry { t: number; text: string; tone: 'good' | 'bad' | 'story' | 'info'; big?: boolean }

export interface Person {
  id: string;
  name: string;
  gender: 'm' | 'f';
  age: number;
  alive: boolean;
  /** 所在宗门；null 表示散修或候选人 */
  sect: string | null;
  look: { hue: number; hair: number; face: number; portrait: number };
  root: Root;
  wit: number;
  realm: Realm;
  /** 炼气 1–9 层；筑基以上 0 初期、1 中期、2 后期、3 大圆满 */
  stage: number;
  exp: number;
  /** 突破失败的次数（越多越难） */
  fails: number;
  hp: number;
  skills: Record<Skill, number>;
  caps: Record<Skill, number>;
  traits: string[];
  values: Record<Value, number>;
  likes: JobId[];
  dislikes: JobId[];
  origin: string;
  quirk: string;
  secret?: { kind: SecretKind; text: string; patron?: string; exposed: boolean };
  rank: Rank;
  job: JobId;
  /** 当着某个殿堂的主事 */
  head?: HallId;
  /** 在这个岗位上干了几季 */
  tenure: number;
  /** 各岗位累计干了几季（性格变化看它） */
  served: Partial<Record<JobId, number>>;
  merit: number;
  /** 入门几季 */
  seniority: number;
  /** 宗主的恩宠，背书和赏赐来 */
  favor: number;
  fame: number;
  mood: number;
  grudge: number;
  loyalty: number;
  /** 法宝、灵宠这类，战力加成 */
  gear: number;
  ops: Record<string, Opinion>;
  wish: Wish | null;
  life: LifeEntry[];
  /** 拉拢了几个人 */
  factionSize?: number;
  /** 正在等 AI 写心愿 */
  wishPending?: boolean;
  /** 外出历练到第几季回来 */
  travelUntil?: number;
  /** 记名弟子试用了几季 */
  probation?: number;
  starred?: boolean;
  /** 本季由 AI 拿主意的理由（季报里显示） */
  lastWhy?: string;
  lastAct?: string;
  /** 已经死了的话，怎么死的 */
  death?: string;
  /** 是不是候选人身上的真话（自述来历是假的就为 false） */
  honestOrigin: boolean;
  /** 说话的口气（给 AI 和离线台词） */
  voice: string;
  /** 被宗主敲打过的那一季：这一季不敢乱来 */
  warned?: number;
  /** 这一季被宗主召见过，聊过哪些话题 */
  talked?: { t: number; topics: string[] };
  /** 出门执行宗门任务：回来后回到原来的差事 */
  mission?: { id: string; job: JobId; head?: HallId };
}

/** 任务、大计的奖励 */
export interface Reward { stones?: number; herbs?: number; pills?: number; fpills?: number; armory?: number; rep?: number; align?: number; authority?: number; gear?: number; exp?: number; candidate?: number }

/** 任务栏上的一件差事 */
export interface Mission {
  id: string;
  kind: string;
  title: string;
  desc: string;
  /** 凶险 1–5 */
  danger: number;
  skill: Skill;
  skill2?: Skill;
  /** 要不要打：1 全看修为战力，0 全看本事 */
  fight: number;
  /** 要去几季 */
  seasons: number;
  reward: Reward;
  /** 过了这一季就没了 */
  expires: number;
}

/** 派出去的队伍 */
export interface Expedition { mission: Mission; team: string[]; back: number; chance: number }

/** 宗主这一季亲自做的事 */
export type MasterAct = 'seclude' | 'teach' | 'preside' | 'roam' | 'craft' | 'visit';

/** 年度大计 */
export interface Goal { kind: string; text: string; target: number; base: number; reward: Reward; done?: boolean }

/** 年初记下的家底，年末拿来比 */
export interface YearSnap { year: number; joined: number; gone: number; dead: number; breaks: number; missions: number; warsWon: number; warsLost: number; halls: number; stones: number; rep: number; members: number }

export interface YearReview { year: number; goal?: { text: string; ok: boolean; reward: string }; lines: [string, string][] }

export interface Candidate {
  id: string;
  /** 从哪来：开山收徒、上门投奔、敌宗奸细、引荐 */
  via: 'open' | 'walkin' | 'spy' | 'refer' | 'genius';
  /** 自述来历 */
  claim: string;
  rumor: string;
  /** 他想要什么 */
  wants: 'technique' | 'status' | 'safety' | 'food' | 'revenge' | 'fame' | 'wealth';
  patience: number;
  known: { root: boolean; skills: Skill[]; traits: boolean; origin: 'unknown' | 'checking' | 'true' | 'false' };
  /** 根据外表和言谈的印象（可能不准） */
  hints: string[];
  /** 还能等几季 */
  stay: number;
  /** 敌宗也在请他 */
  courtedBy?: string;
  /** 打听来历什么时候出结果 */
  checkAt?: number;
  /** 考核太多，不耐烦了 */
  annoyed?: boolean;
}

export type Stance = 'hold' | 'sally' | 'ambush';

export interface War {
  enemy: string;
  /** 谁先动手 */
  byPlayer: boolean;
  /** 打的是什么：山门还是灵脉 */
  stake: 'mountain' | 'vein';
  round: number;
  wins: number;
  losses: number;
  team: string[];
  stance: Stance;
  masterUsed: boolean;
  log: { text: string; tone: 'good' | 'bad' | 'info' }[];
  /** 等玩家做战前部署 */
  phase: 'prep' | 'round' | 'done';
  enemyTeam: string[];
  startedAt: number;
}

export interface Rival {
  id: string;
  name: string;
  color: string;
  master: string;
  /** 有名有姓的长老和弟子 */
  named: string[];
  /** 无名弟子：各境界人数 */
  crowd: { qi: number; found: number };
  stones: number;
  rep: number;
  /** 对你的态度 -100 … 100 */
  attitude: number;
  status: 'neutral' | 'ally' | 'hostile' | 'war' | 'truce';
  truceUntil?: number;
  veins: number;
  /** 不主动掺和 */
  passive?: boolean;
  alive: boolean;
  /** 上一季做了什么 */
  lastMove?: string;
  lastWhy?: string;
  style: 'aggressive' | 'cunning' | 'proper' | 'aloof';
  /** 上一季的动作是暗地里的（玩家看不到） */
  hidden?: boolean;
  /** 上次派奸细是哪一季 */
  lastSpy?: number;
  /** 奸细送回去的消息 */
  intel?: number;
}

/** 选这一项要花的东西；不够就选不了 */
export interface Cost { stones?: number; pills?: number; fpills?: number }

export interface DecisionOption { id: string; label: string; hint?: string; cost?: Cost }

export interface Decision {
  id: string;
  kind: string;
  title: string;
  text: string;
  about: string[];
  options: DecisionOption[];
  params: Record<string, string | number>;
  /** 不处理会怎么样（过季时自动选） */
  fallback: string;
}

export interface ReportItem {
  t: number;
  text: string;
  tone: 'good' | 'bad' | 'story' | 'info';
  about: string[];
  big?: boolean;
  /** 弟子自己的话 */
  quote?: { who: string; text: string };
  /** 大事但年年有（被抢、发不出月例），不写进宗门志 */
  chronicle?: false;
}

/** 本季玩家亲手做的事：用来判断心愿被成全时是不是该记在宗主头上 */
export interface PlayerAct { kind: string; who?: string; target?: string; hall?: string; text: string }

export interface Sect {
  name: string;
  site: 'vein' | 'deep' | 'market';
  origin: string;
  heritage: string;
  stones: number;
  herbs: number;
  pills: number;
  /** 筑基丹 */
  fpills: number;
  armory: number;
  rep: number;
  authority: number;
  /** 正邪：-100 魔道 … 100 正道 */
  align: number;
  veins: number;
  /** 殿堂等级：0 空地，1 刚建成 … 4 最高 */
  halls: Record<HallId, number>;
  /** 在建的工程：done 是完工那一季 */
  works: { hall: HallId; to: number; done: number }[];
  tech: string[];
  policy: string | null;
  /** 丹药怎么分 */
  pillRule: 'merit' | 'talent' | 'equal' | 'core';
  /** 本季的产出和开销（季报用） */
  ledger: Record<string, number>;
  /** 灵脉衰减到第几季 */
  veinDebuff?: number;
  /** 夜观星象，预知刀兵到第几季 */
  foresight?: number;
  /** 宗门大比哪年办过 */
  tourneyYear?: number;
  /** 宗门大比定下的座次，一年内大家认 */
  tourneyRank?: string[];
}

export interface World {
  v: 1;
  seed: number;
  rng: number;
  /** 第几季（0 = 第一年春） */
  t: number;
  me: string;
  sect: Sect;
  people: Record<string, Person>;
  members: string[];
  candidates: Candidate[];
  rivals: Rival[];
  war: War | null;
  decisions: Decision[];
  report: ReportItem[];
  /** 往年的季报（只留最近几季） */
  history: { t: number; items: ReportItem[] }[];
  acts: PlayerAct[];
  /** 年初要选方略和传承 */
  needPolicy: boolean;
  needTech: boolean;
  over: null | { win: boolean; text: string };
  nextId: number;
  /** 一局结束的年份（试玩版十年） */
  endYear: number;
  /** 两个人被宗主安排到一处的时间（求道侣联动用） */
  pairings: Record<string, number>;
  /** 下一季要开打的仗 */
  pendingWar?: { enemy: string; byPlayer: boolean };
  /** 敌宗正在挖谁：弟子 id → 敌宗 id */
  offers: Record<string, string>;
  /** 本季谁干了坏事（告发用） */
  misdeeds: { who: string; what: string; t: number }[];
  /** 宗门志：开山以来的大事，结局时回顾 */
  annals: { t: number; text: string; tone: ReportItem['tone'] }[];
  /** 入过山门的所有人（结局时看他们的去向） */
  alumni: string[];
  /** 一局的战绩 */
  stats: { warsWon: number; warsLost: number; credited: number; breaks: number; missionsDone: number; missionsFailed: number };
  /** 上一季过完，各项家底变了多少 */
  delta: Record<string, number>;
  /** 新手指引已经关掉 */
  guideOff?: boolean;
  /** 宗主这一季做什么（不改就一直这样） */
  masterPlan: { act: MasterAct; target?: string };
  /** 任务栏 */
  missions: Mission[];
  /** 在外面的队伍 */
  expeditions: Expedition[];
  /** 宗门品阶：0 草创 … 4 一方圣地 */
  tier: number;
  /** 今年的大计 */
  goal: Goal | null;
  /** 年初给宗主挑的几个大计 */
  goalOffers: Goal[];
  needGoal: boolean;
  yearStart: YearSnap | null;
  lastYear: YearReview | null;
}
