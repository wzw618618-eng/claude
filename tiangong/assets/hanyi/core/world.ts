// 读写游戏状态的小工具，所有插件和事件都通过它们改数据，规则集中在一处。

import { CHARS, CHAR_ORDER, CharDef, START_REL } from '../data/characters';
import { CharState, GameState, SkillKey, TraitId } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const def = (id: string): CharDef => CHARS[id];
export const nm = (id: string) => CHARS[id].short;
export const ta = (id: string) => (CHARS[id].gender === 'f' ? '她' : '他');

export function ch(s: GameState, id: string): CharState | undefined {
  return s.chars.find((c) => c.id === id);
}
export function act(s: GameState): CharState[] {
  return s.chars.filter((c) => c.status === 'active');
}
export function isAct(s: GameState, id: string) {
  return ch(s, id)?.status === 'active';
}
export function has(c: CharState | string, t: TraitId) {
  return def(typeof c === 'string' ? c : c.id).traits.includes(t);
}
export const sk = (c: CharState, k: SkillKey) => c.skills[k];
export const lvl = (c: CharState, k: SkillKey) => Math.floor(c.skills[k] + 1e-6);

export const relKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const rel = (s: GameState, a: string, b: string) => s.rel[relKey(a, b)] ?? 0;

export function addRel(s: GameState, a: string, b: string, n: number) {
  if (a === b) return;
  let m = 1;
  if (n > 0) {
    for (const id of [a, b]) {
      if (has(id, 'kind')) m *= 1.25;
      if (has(id, 'loner')) m *= 0.6;
    }
  } else {
    for (const id of [a, b]) if (has(id, 'hothead')) m *= 1.3;
  }
  const k = relKey(a, b);
  s.rel[k] = clamp(Math.round((s.rel[k] ?? 0) + n * m), -100, 100);
}

export function addMood(c: CharState, n: number) {
  c.mood = clamp(c.mood + n, 0, 100);
}
export function addHealth(c: CharState, n: number) {
  c.health = clamp(c.health + n, 0, 100);
}
export function addStamina(c: CharState, n: number) {
  c.stamina = clamp(c.stamina + n, 0, 100);
}
export function addTrust(c: CharState, n: number) {
  const m = n > 0 && has(c, 'stubborn') ? 0.7 : 1;
  c.trust = clamp(Math.round(c.trust + n * m), 0, 100);
}
export function addSkill(c: CharState, k: SkillKey, n: number) {
  const before = lvl(c, k);
  c.skills[k] = clamp(c.skills[k] + n, 0, 5);
  return lvl(c, k) > before;
}

export function moodWord(m: number) {
  if (m < 12) return '崩溃';
  if (m < 30) return '低落';
  if (m < 55) return '平静';
  if (m < 75) return '安心';
  return '振奋';
}
export function trustWord(t: number) {
  if (t < 20) return '戒备';
  if (t < 40) return '观望';
  if (t < 60) return '信得过';
  if (t < 80) return '信赖';
  return '托付';
}
export function relWord(r: number) {
  if (r <= -40) return '不和';
  if (r <= -15) return '有隔阂';
  if (r < 15) return '泛泛';
  if (r < 40) return '处得来';
  if (r < 65) return '朋友';
  return '挚友';
}

/** 口才最好的在场者（可排除某些人） */
export function bestTalker(s: GameState, exclude: string[] = []) {
  return act(s)
    .filter((c) => !exclude.includes(c.id) && !has(c, 'mute') && !has(c, 'child'))
    .sort((a, b) => b.skills.talk - a.skills.talk)[0];
}

/** 玩家亲自劝说某人的成功率 */
export function persuade(c: CharState, base = 0.25) {
  let p = base + c.trust / 140;
  if (has(c, 'stubborn')) p -= 0.15;
  return clamp(p, 0.05, 0.95);
}
/** 由某个角色出面劝说的成功率 */
export function persuadeBy(s: GameState, speaker: CharState, target: CharState, base = 0.2) {
  let p = base + speaker.skills.talk * 0.1 + rel(s, speaker.id, target.id) / 200;
  if (has(target, 'stubborn')) p -= 0.15;
  return clamp(p, 0.05, 0.95);
}
export const pct = (p: number) => `${Math.round(p * 100)}%`;

export function insulation(s: GameState) {
  return (s.built.includes('door') ? 1 : 0) + (s.built.includes('hearth') ? 1 : 0);
}

export function baseTemp(day: number) {
  const x = Math.min(1, ((day - 1) / 19) * 1.1);
  return Math.round(-8 - 18 * Math.sin(Math.PI * x));
}
export function heatNeed(s: GameState) {
  let n = Math.max(1, Math.ceil(-s.temp / 5) - insulation(s));
  if (s.policy.heat === 'save') n = Math.max(1, n - 1);
  return n;
}
export function eats(c: CharState) {
  return has(c, 'bigeater') ? 2 : 1;
}

export function newChar(id: string, day: number): CharState {
  const d = def(id);
  return {
    id,
    status: 'active',
    health: 100,
    stamina: 80,
    mood: d.mood,
    trust: d.trust,
    skills: { ...d.skills },
    task: 'rest',
    injured: 0,
    sick: 0,
    hungerDays: 0,
    lowMoodDays: 0,
    restDays: 0,
    joinedDay: day,
    talks: 0,
    trustTonight: 0,
    moodTonight: 0,
  };
}

/** 新角色加入营地，和现有成员建立初始关系 */
export function join(s: GameState, id: string, opts: Partial<CharState> = {}) {
  if (ch(s, id)) return ch(s, id)!;
  const c = Object.assign(newChar(id, s.day), opts);
  s.chars.push(c);
  return c;
}

export function newGame(seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0): GameState {
  const s: GameState = {
    v: 1,
    seed,
    rng: seed,
    day: 1,
    phase: 'day',
    res: { food: 15, wood: 12, mat: 6, med: 3 },
    policy: { ration: 'normal', heat: 'normal' },
    chars: [],
    rel: { ...START_REL },
    built: [],
    project: null,
    weather: { kind: 'snow', left: 1 },
    temp: -9,
    flags: {},
    fired: {},
    log: [],
    report: [],
    pending: [],
    ambient: [],
    chat: {},
    rescueDay: 21,
    rescueBy: 'road',
    ending: null,
  };
  for (const id of CHAR_ORDER) if (def(id).starter) s.chars.push(newChar(id, 1));
  const preset: Record<string, CharState['task']> = { qin: 'hunt', lin: 'care', jie: 'wood', ma: 'cook', su: 'scavenge' };
  for (const c of s.chars) c.task = preset[c.id] ?? 'rest';
  s.log.push({ day: 1, text: '寒潮来得毫无征兆。客车在山道上抛锚，五个陌生人躲进了半山腰一座废弃的驿站。广播里最后一条消息说：大雪封山，道路至少二十天才能打通。', tone: 'story' });
  return s;
}

export const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function cnDay(n: number) {
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return '十' + CN_NUM[n - 10];
  const t = Math.floor(n / 10), o = n % 10;
  return CN_NUM[t] + '十' + (o ? CN_NUM[o] : '');
}

/** 状态会被插件改写，用函数读取阶段可以避免 TypeScript 的错误收窄 */
export const ended = (s: GameState) => s.phase === 'ending';
