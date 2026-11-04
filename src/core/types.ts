// 游戏里所有会被存档的数据都在这里定义。状态是纯 JSON，方便存档、热更新和无头模拟。

export type SkillKey = 'str' | 'wild' | 'craft' | 'med' | 'talk';

export type TaskId =
  | 'wood' | 'hunt' | 'scavenge' | 'explore' | 'build'
  | 'cook' | 'care' | 'comfort' | 'guard' | 'rest';

export type TraitId =
  | 'optimist' | 'pessimist' | 'diligent' | 'lazy' | 'bigeater'
  | 'timid' | 'reckless' | 'kind' | 'loner' | 'hothead' | 'leader'
  | 'coldproof' | 'coldfear' | 'gourmet' | 'child' | 'mute' | 'stubborn';

export type Tone = 'good' | 'bad' | 'story' | 'info';

export interface LogLine { day: number; text: string; tone: Tone }

export type Vars = Record<string, number | string | boolean>;

export interface PendingEvent { id: string; actors: string[]; vars: Vars }

export interface CharState {
  id: string;
  status: 'active' | 'dead' | 'left';
  health: number;
  stamina: number;
  mood: number;
  /** 对玩家（主事人）的信任 */
  trust: number;
  skills: Record<SkillKey, number>;
  task: TaskId;
  injured: number;
  sick: number;
  hungerDays: number;
  lowMoodDays: number;
  /** 被强制休息的天数（崩溃、重伤后） */
  restDays: number;
  joinedDay: number;
  endDay?: number;
  endNote?: string;
  /** 今晚已经聊了几次，以及今晚因聊天获得的信任/心情（有上限） */
  talks: number;
  trustTonight: number;
  moodTonight: number;
}

export interface GameState {
  v: number;
  seed: number;
  rng: number;
  day: number;
  phase: 'day' | 'evening' | 'night' | 'ending';
  res: { food: number; wood: number; mat: number; med: number };
  policy: { ration: 'normal' | 'half'; heat: 'normal' | 'save' };
  chars: CharState[];
  rel: Record<string, number>;
  built: string[];
  project: { id: string; progress: number } | null;
  weather: { kind: 'clear' | 'snow' | 'blizzard'; left: number };
  temp: number;
  flags: Vars;
  fired: Record<string, number>;
  log: LogLine[];
  report: LogLine[];
  pending: PendingEvent[];
  ambient: string[];
  chat: Record<string, { from: 'me' | 'them'; text: string }[]>;
  rescueDay: number;
  rescueBy: string;
  ending: { kind: 'rescued' | 'wiped'; day: number } | null;
}
