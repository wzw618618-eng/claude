// 游戏门面：把插件按顺序装进引擎，给界面和无头模拟提供同一套操作。

import { Engine, commit, makeCtx } from './core/engine';
import { GameState, TaskId } from './core/types';
import { act, addMood, addTrust, ch, ended, nm, newGame as freshGame } from './core/world';
import { makeRng } from './core/rng';
import { remember } from './ai/memory';
import { pickToday } from './data/situations';
import { applyStart } from './data/perks';
import { planDay, ruleWants } from './ai/intent';
import { buildPlugin, campfireScenes, endingPlugin, socialPlugin, weatherPlugin, startProject, cancelProject } from './systems/camp';
import { morningPlugin, prunePending, resolveChoice, storyPlugin } from './systems/story';
import { bodyPlugin, upkeepPlugin } from './systems/survival';
import { blocked, workPlugin } from './systems/work';

export const engine = new Engine()
  .use(workPlugin)
  .use(buildPlugin)
  .use(upkeepPlugin)
  .use(bodyPlugin)
  .use(socialPlugin)
  .use(storyPlugin)
  .use(weatherPlugin)
  .use(endingPlugin)
  .use(morningPlugin);

/** 开一局新游戏：第一天早上，每个人先说说自己想干什么 */
export function newGame(seed?: number, opts: { winter?: number; perk?: string } = {}) {
  const s = freshGame(seed);
  applyStart(s, opts.winter ?? 1, opts.perk ?? '');
  planDay(s);
  return s;
}

/** 收工：傍晚有事先处理，没事直接入夜 */
export function endDay(s: GameState) {
  if (s.phase !== 'day' || s.pending.length) return;
  engine.endDay(s);
  if (!ended(s)) s.phase = 'evening';
  toNight(s);
}

export function toNight(s: GameState) {
  if (s.phase !== 'evening' || s.pending.length) return;
  s.phase = 'night';
  s.sat = [];
  const ctx = makeCtx(s);
  campfireScenes(ctx);
  commit(ctx);
  ruleWants(s);
}

export function endNight(s: GameState) {
  if (s.phase !== 'night') return;
  const waited = Object.entries(s.wants ?? {}).filter(([id, w]) => !w.done && !(s.sat ?? []).includes(id)).map(([id]) => id);
  engine.endNight(s);
  // 有话想说却没等到你的人，心里会凉一截
  for (const id of waited) {
    const c = ch(s, id);
    if (!c || c.status !== 'active') continue;
    addMood(c, -3);
    addTrust(c, -2);
    remember(s, id, { kind: 'talk', text: '那晚我有话想跟你说，你没过来', tone: 'bad' });
    s.report.push({ day: s.day, text: `${nm(id)}昨晚等着跟你说话，你没顾上。`, tone: 'bad' });
  }
  if (!ended(s)) {
    s.phase = 'day';
    // 昨天的岗位如果今天干不了，自动改成休息
    for (const c of act(s)) if (blocked(s, c, c.task)) c.task = 'rest';
    s.wants = {};
    s.sat = [];
    const rng = makeRng(s.rng);
    pickToday(s, rng);
    s.rng = rng.state();
    planDay(s);
  }
}

export function choose(s: GameState, idx: number) {
  const r = resolveChoice(s, idx);
  prunePending(s);
  if (act(s).length === 0 && !ended(s)) {
    s.phase = 'ending';
    s.ending = { kind: 'wiped', day: s.day };
  }
  if (s.phase === 'evening') toNight(s);
  return r;
}

export function setTask(s: GameState, id: string, t: TaskId) {
  const c = ch(s, id);
  if (!c || c.status !== 'active' || s.phase !== 'day') return 'not-now';
  const why = blocked(s, c, t);
  if (why) return why;
  c.task = t;
  return null;
}

export { startProject, cancelProject };
