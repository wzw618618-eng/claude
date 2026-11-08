import { describe, expect, it } from 'vitest';
import { createMeter, type AiConfig } from '../src/ai/config';
import { atBottleneck, lvl, need } from '../src/game/cult';
import { checkGoal, checkTier, chooseGoal, offerGoals, talkLimit, TIERS, turnYear } from '../src/game/goals';
import { masterSeason, setMasterPlan } from '../src/game/master';
import { canSend, dispatch, missionChance, refreshBoard, settleExpeditions } from '../src/game/missions';
import { migrate } from '../src/game/save';
import { advanceSeason, planSeason } from '../src/game/season';
import { setHead } from '../src/game/sect';
import { newWorld, randomStart } from '../src/game/setup';
import type { Mission, Person, World } from '../src/game/types';
import { me, members, rngOf } from '../src/game/world';
import { gameView, type Ui } from '../src/ui/views';

const fresh = (seed = 7): World => newWorld({ ...randomStart(seed), site: 'deep', origin: 'sword', heritage: 'mind' });
const offline: AiConfig = { kind: 'offline', apiKey: '', mode: 'normal' };
const ui = (over: Partial<Ui> = {}): Ui => ({ screen: 'game', tab: 'report', modal: null, setup: randomStart(7), busy: null, toast: null, sort: 'rank', chats: {}, streaming: null, testPick: {}, showHistory: false, hasSave: true, team: {}, ...over });
const work = () => ({ cultBonus: 1, lawPower: 1, recruitPower: 0, guardPower: 0, byHall: {} as Record<string, number> }) as Parameters<typeof masterSeason>[2];

/** 一件凶险 1 的剿妖差事 */
function easyMission(w: World): Mission {
  const m: Mission = { id: 'mtest', kind: 'beast', title: '清剿妖兽', desc: '', danger: 1, skill: 'combat', fight: 0.85, seasons: 1, reward: { stones: 30, rep: 2 }, expires: w.t + 1 };
  w.missions.push(m);
  return m;
}

describe('宗门任务', () => {
  it('开局就有任务栏；派出去的人放下差事，回来后回到原位', () => {
    const w = fresh(71);
    expect(w.missions.length).toBeGreaterThanOrEqual(2);
    const m = easyMission(w);
    const p = members(w)[0];
    setHead(w, 'herb', p);
    expect(dispatch(w, m.id, [p.id])).toBeNull();
    expect(p.job).toBe('travel');
    expect(p.head).toBeUndefined();
    expect(canSend(w, p)).toBe(false);
    expect(dispatch(w, w.missions[0].id, [p.id])).toContain('走不开');
    settleExpeditions(w, rngOf(w));
    expect(w.expeditions.length).toBe(0);
    if (p.alive) { expect(p.job).toBe('herb'); expect(p.head).toBe('herb'); }
    expect(w.stats.missionsDone + w.stats.missionsFailed).toBe(1);
  });
  it('人多、修为高，把握大；最多派三个', () => {
    const w = fresh(72);
    const m = easyMission(w);
    const [a, b, c] = members(w);
    const one = missionChance(m, [a]);
    const three = missionChance(m, [a, b, c]);
    expect(three).toBeGreaterThan(one);
    a.realm = 1; a.stage = 0;
    expect(missionChance(m, [a])).toBeGreaterThan(one);
    const extra = w.candidates[0] && w.people[w.candidates[0].id];
    if (extra) { extra.sect = 'me'; w.members.push(extra.id); expect(dispatch(w, m.id, [a.id, b.id, c.id, extra.id])).toContain('最多'); }
  });
  it('过季时任务栏会补满，过期的撤下', () => {
    const w = fresh(73);
    w.missions = [{ ...easyMission(w), expires: -1 }];
    refreshBoard(w, rngOf(w));
    expect(w.missions.some((m) => m.expires < w.t)).toBe(false);
    expect(w.missions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('宗主亲为', () => {
  it('闭关长修为；圆满了就冲关', () => {
    const w = fresh(74);
    const m = me(w);
    const before = m.exp;
    masterSeason(w, rngOf(w), work());
    expect(m.exp).toBeGreaterThan(before);
    m.stage = 3; m.exp = need(m);
    expect(atBottleneck(m)).toBe(true);
    masterSeason(w, rngOf(w), work());
    expect(m.realm === 3 || m.fails === 1).toBe(true);
  });
  it('亲传：弟子修为大进、更忠心，记在宗主头上', () => {
    const w = fresh(75);
    const p = members(w)[0];
    const lv = lvl(p), loyal = p.loyalty;
    expect(setMasterPlan(w, 'teach', p.id)).toBeNull();
    masterSeason(w, rngOf(w), work());
    expect(lvl(p)).toBeGreaterThan(lv);
    expect(p.loyalty).toBeGreaterThan(loyal);
    expect(w.acts.some((a) => a.kind === 'teach' && a.who === p.id)).toBe(true);
  });
  it('教的人走了，就退回闭关；坐镇让执法更得力', () => {
    const w = fresh(76);
    const p = members(w)[0];
    setMasterPlan(w, 'teach', p.id);
    p.job = 'travel';
    masterSeason(w, rngOf(w), work());
    expect(w.masterPlan.act).toBe('seclude');
    setMasterPlan(w, 'preside');
    const wk = work();
    masterSeason(w, rngOf(w), wk);
    expect(wk.lawPower).toBe(3);
  });
});

describe('品阶和大计', () => {
  it('攒够条件就晋阶，召见名额变多', () => {
    const w = fresh(77);
    expect(checkTier(w)).toBe(false);
    for (const c of w.candidates) { const q = w.people[c.id]; q.sect = 'me'; w.members.push(q.id); }
    while (members(w).length < 14) { const c = w.candidates[0] ?? null; if (!c) { const p = { ...members(w)[0], id: `px${w.nextId++}` } as Person; w.people[p.id] = p; w.members.push(p.id); } else w.candidates.shift(); }
    w.sect.rep = 160; w.sect.halls.herb = 3; w.sect.halls.alchemy = 3;
    members(w).slice(0, 2).forEach((p) => { p.realm = 1; p.stage = 0; });
    expect(checkTier(w)).toBe(true);
    expect(checkTier(w)).toBe(true);
    expect(TIERS[w.tier]).toBe('中品宗门');
    expect(talkLimit(w)).toBe(4);
  });
  it('年初给三个不同的大计；办成了有赏', () => {
    const w = fresh(78);
    expect(w.needGoal).toBe(true);
    const offers = offerGoals(w, rngOf(w));
    expect(new Set(offers.map((g) => g.kind)).size).toBe(offers.length);
    w.goalOffers = [{ kind: 'recruit', text: '年内新收 3 个弟子', target: 3, base: w.alumni.length, reward: { stones: 120 } }];
    chooseGoal(w, 0);
    expect(w.needGoal).toBe(false);
    const stones = w.sect.stones;
    w.alumni.push('a', 'b', 'c');
    checkGoal(w);
    expect(w.goal?.done).toBe(true);
    expect(w.sect.stones).toBe(stones + 120);
  });
  it('一年到头没办成，宗主威望掉；写下去年回顾，再给新的大计', () => {
    const w = fresh(79);
    w.goalOffers = [{ kind: 'rep', text: '名望涨到 999', target: 999, base: 0, reward: { stones: 100 } }];
    chooseGoal(w, 0);
    const auth = w.sect.authority;
    turnYear(w, rngOf(w));
    expect(w.sect.authority).toBe(auth - 3);
    expect(w.lastYear?.goal?.ok).toBe(false);
    expect(w.lastYear?.lines.length).toBeGreaterThan(5);
    expect(w.needGoal).toBe(true);
    expect(w.goalOffers.length).toBeGreaterThan(0);
  });
  it('四季过完回到开春：要先定大计才能过季', () => {
    const w = fresh(80);
    chooseGoal(w, 0); w.needPolicy = false; w.needTech = false;
    for (let i = 0; i < 4; i++) advanceSeason(w, planSeason(w, 'off'), {}, {});
    expect(w.t).toBe(4);
    expect(w.needGoal).toBe(true);
    expect(w.lastYear?.year).toBe(1);
  });
});

describe('界面', () => {
  it('任务页、宗主安排、开春回顾都能画出来', () => {
    const w = fresh(81);
    let html = gameView(w, ui({ tab: 'mission' }), offline, createMeter());
    expect(html).toContain('data-act="team"');
    expect(html).toContain('宗主这一季');
    html = gameView(w, ui({ modal: { kind: 'master' } }), offline, createMeter());
    expect(html).toContain('data-act="master-act"');
    turnYear(w, rngOf(w));
    html = gameView(w, ui({ modal: { kind: 'year' } }), offline, createMeter());
    expect(html).toContain('年回顾');
    expect(html).toContain('data-act="goal"');
  });
  it('旧存档读进来有任务栏、宗主安排', () => {
    const w = fresh(82) as Partial<World>;
    delete w.missions; delete w.masterPlan; delete w.tier; delete w.goalOffers;
    const m = migrate(JSON.parse(JSON.stringify(w)));
    expect(m.missions.length).toBeGreaterThan(0);
    expect(m.masterPlan.act).toBe('seclude');
    expect(m.tier).toBe(0);
  });
});
