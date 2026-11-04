// 游戏门面：把插件按顺序装进引擎，给界面和无头模拟提供同一套操作。

import { Engine, commit, makeCtx } from './core/engine';
import { GameState, TaskId } from './core/types';
import { act, ch, ended, newGame as freshGame } from './core/world';
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
export function newGame(seed?: number) {
  const s = freshGame(seed);
  planDay(s);
  return s;
}

export function endDay(s: GameState) {
  if (s.phase !== 'day' || s.pending.length) return;
  engine.endDay(s);
  if (!ended(s)) s.phase = 'evening';
}

export function toNight(s: GameState) {
  if (s.phase !== 'evening' || s.pending.length) return;
  s.phase = 'night';
  const ctx = makeCtx(s);
  campfireScenes(ctx);
  commit(ctx);
  ruleWants(s);
}

export function endNight(s: GameState) {
  if (s.phase !== 'night') return;
  engine.endNight(s);
  if (!ended(s)) {
    s.phase = 'day';
    // 昨天的岗位如果今天干不了，自动改成休息
    for (const c of act(s)) if (blocked(s, c, c.task)) c.task = 'rest';
    s.wants = {};
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
