// 读档：旧版本的存档缺新字段，补上默认值；修掉旧版本留下的坏数据。

import { MASTER_DAYS } from './master';
import { refreshBoard } from './missions';
import { scheduleSeason } from './season';
import type { World } from './types';
import { nowDay, rngOf, SEASON_DAYS } from './world';

export function migrate(w: World): World {
  w.annals ??= [];
  w.alumni ??= [...w.members];
  w.stats ??= { warsWon: 0, warsLost: 0, credited: 0, breaks: 0, missionsDone: 0, missionsFailed: 0 };
  w.stats.breaks ??= 0; w.stats.missionsDone ??= 0; w.stats.missionsFailed ??= 0;
  w.delta ??= {};
  // 旧版本的殿堂开局就全有（等级 0–3），换成现在的 1–4
  if (!w.sect.works) {
    for (const h of Object.keys(w.sect.halls) as (keyof typeof w.sect.halls)[]) w.sect.halls[h] += 1;
    w.sect.works = [];
  }
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
  // 时间改成按天走以前的存档：季数换成天数，排上这一季的日程
  if (!w.clock) {
    w.day = 0;
    const now = nowDay(w);
    for (const x of w.sect.works) { x.from = now; x.done = (x.done + 1) * SEASON_DAYS; }
    for (const e of w.expeditions) { e.from = now; e.back = e.back * SEASON_DAYS; }
    for (const c of w.candidates) { if (c.checkAt !== undefined) c.checkAt = c.checkAt * SEASON_DAYS; c.leaveDay = now + c.stay * SEASON_DAYS; }
    w.masterPlan = { ...w.masterPlan, from: now, until: now + MASTER_DAYS[w.masterPlan.act] };
    w.decisions.forEach((d) => { d.at = now; d.due = now + 45; });
    const r = rngOf(w); scheduleSeason(w, r); r.save();
    w.clock = 1;
  }
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
