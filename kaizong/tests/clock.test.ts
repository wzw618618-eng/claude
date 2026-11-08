// 时间按天走：盖房子、出门办事、闭关、宗主的事、待裁决、宣战都要等日子到了才有结果。

import { describe, expect, it } from 'vitest';
import { BUILD, startWork } from '../src/game/build';
import { addDecision, DECISION_DAYS } from '../src/game/decisions';
import { drainFx } from '../src/game/fx';
import { MASTER_DAYS, setMasterPlan } from '../src/game/master';
import { dispatch, tripDays } from '../src/game/missions';
import { diplomacy } from '../src/game/rivals';
import { migrate } from '../src/game/save';
import { dayTick, WAR_DAYS } from '../src/game/season';
import { newWorld, randomStart } from '../src/game/setup';
import type { World } from '../src/game/types';
import { dateText, members, nowDay, SEASON_DAYS } from '../src/game/world';
import { chooseGoal } from '../src/game/goals';

const fresh = (seed = 7): World => {
  const w = newWorld({ ...randomStart(seed), site: 'deep', origin: 'sword', heritage: 'mind' });
  chooseGoal(w, 0); w.needPolicy = false; w.needTech = false;
  return w;
};
const days = (w: World, n: number) => { for (let i = 0; i < n; i++) dayTick(w); };

describe('时间按天走', () => {
  it('一天一天往前，九十天是一季', () => {
    const w = fresh(201);
    expect(nowDay(w)).toBe(0);
    days(w, 10);
    expect(w.day).toBe(10);
    expect(w.t).toBe(0);
    days(w, SEASON_DAYS - 10);
    expect(w.t).toBe(1);
    expect(w.day).toBe(0);
    expect(dateText(nowDay(w))).toContain('第1年夏');
  });

  it('灵石、修为天天在涨，不是一季跳一下', () => {
    const w = fresh(202);
    const p = members(w)[0];
    const exp0 = p.exp, stones0 = w.sect.stones;
    days(w, 1);
    // 月初先发了月例，第二天开始看收入
    const s1 = w.sect.stones;
    days(w, 5);
    expect(w.sect.stones).toBeGreaterThan(s1);
    expect(p.exp).toBeGreaterThan(exp0);
    expect(stones0).toBeGreaterThan(0);
  });

  it('盖殿堂要等够天数', () => {
    const w = fresh(203);
    expect(startWork(w, 'recruit')).toBeNull();
    days(w, BUILD.recruit.days - 1);
    expect(w.sect.halls.recruit).toBe(0);
    days(w, 2);
    expect(w.sect.halls.recruit).toBe(1);
    expect(w.sect.works.length).toBe(0);
  });

  it('派出去的人走满一趟才回来', () => {
    const w = fresh(204);
    const m = w.missions[0];
    const p = members(w)[0];
    expect(dispatch(w, m.id, [p.id])).toBeNull();
    const back = w.expeditions[0].back;
    expect(back - nowDay(w)).toBe(tripDays(m));
    days(w, tripDays(m) - 1);
    expect(w.expeditions.length).toBe(1);
    expect(p.job).toBe('travel');
    days(w, 2);
    expect(w.expeditions.length).toBe(0);
    expect(w.stats.missionsDone + w.stats.missionsFailed).toBe(1);
  });

  it('待裁决的事拖过期限就按默认办', () => {
    const w = fresh(205);
    const p = members(w)[0];
    const d = addDecision(w, 'transfer', { who: p.id, hall: 'guard' })!;
    expect(d.due).toBe(nowDay(w) + DECISION_DAYS);
    days(w, DECISION_DAYS - 1);
    expect(w.decisions.some((x) => x.id === d.id)).toBe(true);
    days(w, 2);
    expect(w.decisions.some((x) => x.id === d.id)).toBe(false);
    expect([...w.report, ...w.history.flatMap((h) => h.items)].some((it) => it.text.includes('一直没等到你拍板'))).toBe(true);
  });

  it('宗主亲传要做满一轮才出结果', () => {
    const w = fresh(206);
    const p = members(w).sort((a, b) => a.exp - b.exp)[0];
    p.job = 'herb';
    expect(setMasterPlan(w, 'teach', p.id)).toBeNull();
    const stage0 = p.stage;
    days(w, MASTER_DAYS.teach - 2);
    expect(p.life.some((l) => l.text.includes('宗主亲自传功'))).toBe(false);
    days(w, 3);
    expect(p.life.some((l) => l.text.includes('宗主亲自传功'))).toBe(true);
    expect(p.stage).toBeGreaterThan(stage0);
  });

  it('宣战以后过二十天才打起来', () => {
    const w = fresh(207);
    const rv = w.rivals.find((x) => !x.passive)!;
    expect(diplomacy(w, rv, 'war')).toBeNull();
    days(w, 1);
    expect(w.pendingWar?.at).toBe(nowDay(w) - 1 + WAR_DAYS);
    days(w, WAR_DAYS - 2);
    expect(w.war).toBeNull();
    days(w, 2);
    expect(w.war?.enemy).toBe(rv.id);
  });

  it('候选人等不及就走了', () => {
    const w = fresh(208);
    const n = w.candidates.length;
    expect(n).toBeGreaterThan(0);
    days(w, SEASON_DAYS * 2);
    expect(w.candidates.filter((c) => c.via === 'open').length).toBeLessThan(n);
  });

  it('产出、月例会飘字；新的待裁决会通知画面', () => {
    const w = fresh(209);
    drainFx();
    days(w, 20);
    expect(drainFx().some((f) => f.k === 'float' && f.text.includes('月例'))).toBe(true);
    addDecision(w, 'transfer', { who: members(w)[0].id, hall: 'guard' });
    expect(drainFx().some((f) => f.k === 'decision')).toBe(true);
  });

  it('按季算的旧存档读进来会换成按天算', () => {
    const w = fresh(210);
    startWork(w, 'recruit');
    const old = JSON.parse(JSON.stringify(w)) as World & { clock?: 1 };
    delete old.clock; old.day = undefined as unknown as number;
    old.sect.works[0].done = 0; delete old.sect.works[0].from;
    const m = migrate(old);
    expect(m.clock).toBe(1);
    expect(m.day).toBe(0);
    expect(m.sect.works[0].done).toBe(SEASON_DAYS);
    expect(m.sched).toBeDefined();
  });
});
