// 读档：旧版本的存档缺新字段，补上默认值；修掉旧版本留下的坏数据。

import { refreshBoard } from './missions';
import type { World } from './types';
import { rngOf } from './world';

export function migrate(w: World): World {
  w.annals ??= [];
  w.alumni ??= [...w.members];
  w.stats ??= { warsWon: 0, warsLost: 0, credited: 0, breaks: 0, missionsDone: 0, missionsFailed: 0 };
  w.stats.breaks ??= 0; w.stats.missionsDone ??= 0; w.stats.missionsFailed ??= 0;
  w.delta ??= {};
  w.masterPlan ??= { act: 'seclude' };
  w.missions ??= [];
  w.expeditions ??= [];
  w.tier ??= 0;
  w.goal ??= null;
  w.goalOffers ??= [];
  w.needGoal ??= false;
  w.yearStart ??= null;
  w.lastYear ??= null;
  if (!w.missions.length && !w.over) { const r = rngOf(w); refreshBoard(w, r); r.save(); }
  // 旧版本把奸细送信、偷东西写进了经历和季报，读档时抹掉（这些事别人本不该知道）
  const leaked = /送信，报这里的底细|顺走些灵石丹药|在背后给.+使了?绊子|暗中拉拢几个/;
  for (const p of Object.values(w.people)) {
    if (p.secret?.exposed) continue;
    p.life = p.life.filter((l) => !leaked.test(l.text));
  }
  w.report = w.report.filter((it) => !leaked.test(it.text));
  for (const h of w.history) h.items = h.items.filter((it) => !leaked.test(it.text));
  return w;
}
