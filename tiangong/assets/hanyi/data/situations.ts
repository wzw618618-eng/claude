// 每天早上的「今日情况」：一件让今天和昨天不一样的事。每件都有实打实的后果，逼你调整派活。

import type { Rng } from '../core/rng';
import type { GameState, TaskId } from '../core/types';
import { act, nm, rel } from '../core/world';

export interface Today { id: string; actors: string[] }

export interface SitDef {
  id: string;
  title: string;
  /** 一句话：发生了什么，该怎么应对 */
  text: (s: GameState, a: string[]) => string;
  /** 能不能出现；返回角色名单（可以为空） */
  bind: (s: GameState, rng: Rng) => string[] | null;
  weight: number;
  /** 今天干这些活的产出倍数 */
  yield?: Partial<Record<TaskId, number>>;
  /** 今天干这些活的受伤概率倍数 */
  risk?: Partial<Record<TaskId, number>>;
  /** 选中时立刻生效 */
  start?: (s: GameState) => void;
}

const OUT: TaskId[] = ['wood', 'hunt', 'scavenge', 'explore'];
const notStorm = (s: GameState) => (s.weather.kind !== 'blizzard' ? [] : null);

export const SITUATIONS: SitDef[] = [
  {
    id: 'deer',
    title: '鹿群下山',
    text: () => '雪地里有一串新鲜的鹿蹄印。今天打猎收获翻倍。',
    bind: notStorm,
    weight: 3,
    yield: { hunt: 2 },
  },
  {
    id: 'pines',
    title: '风倒木',
    text: () => '昨夜的大风刮倒了一片枯松。今天砍柴收获翻倍。',
    bind: notStorm,
    weight: 3,
    yield: { wood: 2 },
  },
  {
    id: 'wreck',
    title: '露出来的车',
    text: () => '雪塌了一块，山道下面露出一辆车的车顶。今天搜寻收获翻倍。',
    bind: notStorm,
    weight: 2.5,
    yield: { scavenge: 2 },
  },
  {
    id: 'clear',
    title: '难得放晴',
    text: () => '万里无云。今天外出受伤的风险减半。',
    bind: (s) => (s.weather.kind === 'clear' ? [] : null),
    weight: 2,
    risk: { wood: 0.5, hunt: 0.5, scavenge: 0.5, explore: 0.5 },
  },
  {
    id: 'wolves',
    title: '狼的脚印',
    text: () => '门外一圈狼爪印，绕着柴房转了好几圈。今晚狼群多半会来，留人守夜。',
    bind: (s) => (s.day >= 3 ? [] : null),
    weight: 3,
  },
  {
    id: 'cold',
    title: '寒流',
    text: () => '风向变了，比昨天冷得多。今天要多烧柴，省着烧会有人冻着。',
    bind: (s) => (s.day >= 3 ? [] : null),
    weight: 2.5,
    start: (s) => { s.temp = Math.max(-40, s.temp - 7); },
  },
  {
    id: 'storm',
    title: '要变天了',
    text: (s) => `${act(s).some((c) => c.id === 'gesang') ? '格桑' : act(s).some((c) => c.id === 'qin') ? '老秦' : '你'}看了看天：明天要起暴风雪，出不了门。今天能存多少存多少。`,
    bind: (s) => (s.day >= 4 && s.weather.kind !== 'blizzard' && !s.flags.stormNext ? [] : null),
    weight: 2.5,
    start: (s) => { s.flags.stormNext = true; },
  },
  {
    id: 'feud',
    title: '呛起来了',
    text: (_s, [a, b]) => `${nm(a)}和${nm(b)}一早就呛起来了。今天别让他们干同一样活。`,
    bind: (s) => {
      const A = act(s);
      let best: [string, string] | null = null, low = -8;
      for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
        const r = rel(s, A[i].id, A[j].id);
        if (r < low) { low = r; best = [A[i].id, A[j].id]; }
      }
      return best;
    },
    weight: 3,
  },
  {
    id: 'fever',
    title: '发烧前兆',
    text: (_s, [a]) => `${nm(a)}一早就打喷嚏，额头发烫。今天让${nm(a)}歇着，或者有人照料，不然要病倒。`,
    bind: (s, rng) => {
      const ok = act(s).filter((c) => !c.sick && !c.injured);
      return s.day >= 3 && ok.length ? [rng.pick(ok).id] : null;
    },
    weight: 2,
  },
];

const BY_ID = Object.fromEntries(SITUATIONS.map((x) => [x.id, x]));
export const sitDef = (id: string) => BY_ID[id] as SitDef | undefined;
export const today = (s: GameState) => (s.today ? sitDef(s.today.id) : undefined);

/** 早上挑一件今天的事（第一天不挑；同一件事四天内不重复） */
export function pickToday(s: GameState, rng: Rng) {
  s.today = null;
  if (s.day <= 1 || s.phase !== 'day') return;
  const seen = (s.flags.todaySeen as string | undefined)?.split(',') ?? [];
  const cands: { d: SitDef; a: string[] }[] = [];
  for (const d of SITUATIONS) {
    if (seen.slice(-4).includes(d.id)) continue;
    const a = d.bind(s, rng);
    if (a) cands.push({ d, a });
  }
  if (!cands.length) return;
  let r = rng.next() * cands.reduce((t, x) => t + x.d.weight, 0);
  const hit = cands.find((x) => (r -= x.d.weight) <= 0) ?? cands[cands.length - 1];
  s.today = { id: hit.d.id, actors: hit.a };
  s.flags.todaySeen = [...seen, hit.d.id].slice(-6).join(',');
  const all = String(s.flags.sitAll ?? '').split(',').filter(Boolean);
  if (!all.includes(hit.d.id)) s.flags.sitAll = [...all, hit.d.id].join(',');
  hit.d.start?.(s);
}

export const todayYield = (s: GameState, t: TaskId) => today(s)?.yield?.[t] ?? 1;
export const todayRisk = (s: GameState, t: TaskId) => today(s)?.risk?.[t] ?? 1;
export const todayText = (s: GameState) => {
  const d = today(s);
  return d && s.today ? { title: d.title, text: d.text(s, s.today.actors) } : null;
};
export const isOutdoor = (t: TaskId) => OUT.includes(t);
