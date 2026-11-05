// 局外成长：每局打分、攒薪火解锁开局行囊、通关解锁更冷的寒冬、结局图鉴和成就。
// 纯数据和纯函数；存在哪里由宿主（网页版 / 引擎版）决定。

import type { GameState } from './core/types';
import { def } from './core/world';
import { CHAR_ORDER } from './data/characters';
import { EVENTS } from './data/events';
import { LAST_DAY } from './data/rules';
import { SITUATIONS } from './data/situations';
import { progress, STORIES } from './data/stories';
import { fate, isPresentAtEnd } from './systems/camp';
import { multOf, nextPerk, PERKS, WINTER_NAME, WINTERS, type Perk } from './data/perks';

export interface Meta {
  v: 1;
  /** 一共攒下的薪火（不会花掉，只会越攒越多） */
  ember: number;
  runs: number;
  wins: number;
  best: number;
  /** 通关过的最高寒冬等级 */
  cleared: number;
  /** 见过的结局：「角色:去向」 */
  fates: string[];
  /** 每个人的心路最远走到第几章 */
  chapters: Record<string, number>;
  events: string[];
  sits: string[];
  ach: string[];
  /** 已经记过账的那一局，防止重复计分 */
  recorded?: string;
  last?: { winter: number; perk: string };
}

export const newMeta = (): Meta => ({ v: 1, ember: 0, runs: 0, wins: 0, best: 0, cleared: 0, fates: [], chapters: {}, events: [], sits: [], ach: [] });

export function parseMeta(raw: string | null): Meta {
  try {
    const m = raw ? JSON.parse(raw) : null;
    return m && m.v === 1 ? { ...newMeta(), ...m } : newMeta();
  } catch {
    return newMeta();
  }
}

export {
  WINTERS, WINTER_NAME, winterDesc, coldOf, multOf, winterOpen, PERKS, perkOpen, nextPerk, applyStart,
} from './data/perks';
export type { Perk } from './data/perks';

// ───────────── 打分 ─────────────

export interface Score {
  total: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  lines: { label: string; pts: number }[];
}

export function scoreRun(s: GameState): Score {
  const ids = s.chars.map((c) => c.id);
  const rescued = s.ending?.kind === 'rescued';
  const lines: Score['lines'] = [];
  const saved = ids.filter((id) => isPresentAtEnd(s, id)).length;
  const arcs = ids.filter((id) => s.flags[def(id).arcFlag]).length;
  const heard = ids.filter((id) => s.flags[`heard_${id}`]).length;
  const day = s.ending?.day ?? s.day;
  if (rescued) lines.push({ label: `${saved} 人活着下山`, pts: saved * 20 });
  else lines.push({ label: `撑了 ${day} 天`, pts: day * 2 });
  if (arcs) lines.push({ label: `${arcs} 人解开心结`, pts: arcs * 15 });
  if (heard) lines.push({ label: `${heard} 人对你说出心事`, pts: heard * 5 });
  if (rescued && day < LAST_DAY + 1) lines.push({ label: `提前 ${LAST_DAY + 1 - day} 天获救`, pts: (LAST_DAY + 1 - day) * 3 });
  const base = lines.reduce((t, l) => t + l.pts, 0);
  const w = s.winter ?? 1;
  const total = Math.round(base * multOf(w));
  if (w > 1) lines.push({ label: `寒冬 ${w} 级 ×${multOf(w)}`, pts: total - base });
  const grade = total >= 240 ? 'S' : total >= 180 ? 'A' : total >= 120 ? 'B' : total >= 60 ? 'C' : 'D';
  return { total, grade, lines };
}

// ───────────── 成就 ─────────────

export interface Ach { id: string; name: string; desc: string; test: (s: GameState) => boolean }
const rescued = (s: GameState) => s.ending?.kind === 'rescued';
const savedN = (s: GameState) => s.chars.filter((c) => isPresentAtEnd(s, c.id)).length;
export const ACHS: Ach[] = [
  { id: 'all', name: '一个都不能少', desc: '获救时，来过驿站的人一个不少。', test: (s) => rescued(s) && savedN(s) === s.chars.length },
  { id: 'eight', name: '八个人', desc: '八个人都来到了驿站。', test: (s) => s.chars.length >= 8 },
  { id: 'hearts', name: '解铃人', desc: '一局里解开三个人的心结。', test: (s) => s.chars.filter((c) => s.flags[def(c.id).arcFlag]).length >= 3 },
  { id: 'secrets', name: '知心人', desc: '一局里五个人对你说出心事。', test: (s) => s.chars.filter((c) => s.flags[`heard_${c.id}`]).length >= 5 },
  { id: 'early', name: '提前下山', desc: '第十四天以前获救。', test: (s) => rescued(s) && (s.ending?.day ?? 99) < 14 },
  { id: 'builder', name: '满屋子的火', desc: '一局里建好五个工程。', test: (s) => s.built.length >= 5 },
  { id: 'alone', name: '最后一个人', desc: '只剩一个人，也等到了救援。', test: (s) => rescued(s) && savedN(s) === 1 },
  { id: 'w3', name: '熬过冰封', desc: '寒冬 3 级获救。', test: (s) => rescued(s) && (s.winter ?? 1) >= 3 },
  { id: 'w5', name: '千年一遇', desc: '寒冬 5 级获救。', test: (s) => rescued(s) && (s.winter ?? 1) >= 5 },
];
export const ACH_BONUS = 30;

// ───────────── 图鉴 ─────────────

export const FATE_KINDS = ['good', 'ok', 'left', 'dead'] as const;
export const FATE_WORD = { good: '心安下山', ok: '平安下山', left: '下落不明', dead: '长眠于此' } as const;
/** 孩子不会自己走掉，就不算这个结局 */
export const fateKinds = (id: string) => FATE_KINDS.filter((k) => !(k === 'left' && def(id).traits.includes('child')));
const EVENT_IDS = () => Object.keys(EVENTS);

export function albumCount(m: Meta) {
  const fates = CHAR_ORDER.reduce((n, id) => n + fateKinds(id).length, 0);
  const chapters = CHAR_ORDER.reduce((n, id) => n + (STORIES[id]?.length ?? 0), 0);
  const parts = [
    { label: '结局', have: m.fates.length, all: fates },
    { label: '心路', have: CHAR_ORDER.reduce((n, id) => n + (m.chapters[id] ?? 0), 0), all: chapters },
    { label: '见过的事', have: m.events.filter((e) => EVENT_IDS().includes(e)).length, all: EVENT_IDS().length },
    { label: '今日情况', have: m.sits.length, all: SITUATIONS.length },
    { label: '成就', have: m.ach.length, all: ACHS.length },
  ];
  const have = parts.reduce((t, p) => t + p.have, 0), all = parts.reduce((t, p) => t + p.all, 0);
  return { parts, pct: Math.floor((have / all) * 100) };
}

// ───────────── 记账：一局结束时调用一次 ─────────────

export interface RunResult {
  score: Score;
  gained: number;
  best: boolean;
  /** 新解锁的东西、新收进图鉴的条目 */
  unlocks: string[];
  fresh: string[];
  ach: Ach[];
  next?: Perk;
}

export const runKey = (s: GameState) => `${s.seed}:${s.ending?.day ?? s.day}`;

export function recordRun(m: Meta, s: GameState): RunResult | null {
  if (!s.ending || m.recorded === runKey(s)) return null;
  m.recorded = runKey(s);
  const score = scoreRun(s);
  const fresh: string[] = [];
  for (const c of s.chars) {
    const f = fate(s, c.id).kind;
    const k = `${c.id}:${f}`;
    if (!m.fates.includes(k)) { m.fates.push(k); fresh.push(`${def(c.id).short} · ${FATE_WORD[f]}`); }
    const r = progress(s, c.id).reached;
    if (r > (m.chapters[c.id] ?? 0)) {
      for (let i = m.chapters[c.id] ?? 0; i < r; i++) fresh.push(`${def(c.id).short}的心路 · ${STORIES[c.id][i].title}`);
      m.chapters[c.id] = r;
    }
  }
  for (const e of Object.keys(s.fired)) if (!m.events.includes(e)) m.events.push(e);
  for (const x of String(s.flags.sitAll ?? '').split(',').filter(Boolean)) if (!m.sits.includes(x)) m.sits.push(x);
  const ach = ACHS.filter((a) => !m.ach.includes(a.id) && a.test(s));
  for (const a of ach) m.ach.push(a.id);
  const before = m.ember;
  const gained = score.total + ach.length * ACH_BONUS;
  m.ember += gained;
  m.runs++;
  const w = s.winter ?? 1;
  const unlocks: string[] = PERKS.filter((p) => p.need > before && p.need <= m.ember).map((p) => `行囊「${p.name}」`);
  if (s.ending.kind === 'rescued') {
    m.wins++;
    if (w > m.cleared) {
      m.cleared = w;
      if (w < WINTERS.length) unlocks.push(`寒冬 ${w + 1} 级「${WINTER_NAME[w + 1]}」`);
    }
  }
  const best = score.total > m.best;
  if (best) m.best = score.total;
  return { score, gained, best, unlocks, fresh, ach, next: nextPerk(m) };
}
