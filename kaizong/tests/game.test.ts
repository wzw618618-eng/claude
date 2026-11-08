import { describe, expect, it } from 'vitest';
import { choicesFor } from '../src/game/choices';
import { atBottleneck, breakChance, lvl, need, power, realmText, stepUp } from '../src/game/cult';
import { addDecision, resolveDecision } from '../src/game/decisions';
import { acceptChance, admit, testSkill } from '../src/game/recruit';
import { advanceSeason, planSeason } from '../src/game/season';
import { assignJob, fit, setHead, unconvinced, underqualified } from '../src/game/sect';
import { newWorld, randomStart } from '../src/game/setup';
import type { World } from '../src/game/types';
import { creditAct, settleWishes } from '../src/game/wishes';
import { members, rngOf } from '../src/game/world';

const fresh = (seed = 7): World => newWorld({ ...randomStart(seed), site: 'deep', origin: 'sword', heritage: 'mind' });

describe('修炼', () => {
  it('炼气九层修满会卡在门口，要冲关', () => {
    const w = fresh();
    const p = members(w)[0];
    p.realm = 0; p.stage = 9; p.exp = 0;
    p.exp = need(p) + 50;
    stepUp(p);
    expect(p.stage).toBe(9);
    expect(atBottleneck(p)).toBe(true);
    expect(breakChance(p, true)).toBeGreaterThan(breakChance(p, false));
  });
  it('隔一个大境界战力差距极大', () => {
    const w = fresh();
    const a = members(w)[0], b = members(w)[1];
    a.realm = 0; a.stage = 9; b.realm = 1; b.stage = 0;
    a.skills.combat = 100; b.skills.combat = 0;
    expect(power(b)).toBeGreaterThan(power(a) * 1.5);
    expect(realmText(b)).toBe('筑基初期');
    expect(lvl(b)).toBe(10);
  });
});

describe('岗位与服不服', () => {
  it('修为高的人在修为低的主事手下会不服', () => {
    const w = fresh(11);
    const [a, b] = members(w);
    a.realm = 0; a.stage = 2; a.merit = 0; a.fame = 0; a.favor = 0; a.seniority = 0;
    b.realm = 1; b.stage = 1; b.traits = ['proud'];
    setHead(w, 'herb', a);
    assignJob(w, b, 'herb');
    const u = unconvinced(w);
    expect(u.some((x) => x.who === b.id && x.over === a.id)).toBe(true);
    expect(underqualified(a)).toBeTruthy();
  });
  it('讨厌的活干不好', () => {
    const w = fresh(12);
    const p = members(w)[0];
    p.likes = ['herb']; p.dislikes = ['guard'];
    p.skills.herb = 40; p.skills.combat = 40;
    expect(fit(p, 'herb')).toBeGreaterThan(fit(p, 'guard'));
  });
  it('不服又积了怨气，会想挑战上级', () => {
    const w = fresh(13);
    const [a, b] = members(w);
    a.realm = 0; a.stage = 1; a.merit = 0; a.fame = 0;
    b.realm = 1; b.stage = 2; b.grudge = 60; b.traits = ['proud', 'fierce'];
    setHead(w, 'guard', a);
    assignJob(w, b, 'guard');
    const cs = choicesFor(w, b, { unc: unconvinced(w) });
    expect(cs.some((c) => c.kind === 'challenge' && c.target === a.id)).toBe(true);
  });
});

describe('心愿联动', () => {
  it('宗主任命谁当主事，正好成全他的心愿，记在宗主头上', () => {
    const w = fresh(21);
    const p = members(w)[0];
    p.wish = { kind: 'post', param: 'law', text: '想当执法堂主事', since: 0, by: 'rule' };
    const loyal = p.loyalty;
    setHead(w, 'law', p);
    expect(creditAct(w, p)?.kind).toBe('head');
    const news = settleWishes(w, rngOf(w));
    expect(news[0].credit).toBeTruthy();
    expect(p.loyalty).toBeGreaterThan(loyal);
    expect(p.wish).toBeNull();
  });
  it('宗门战里杀了某弟子的仇人：阴差阳错替他报了仇', () => {
    const w = fresh(22);
    const p = members(w)[0];
    const foe = w.people[w.rivals[0].named[0]];
    p.wish = { kind: 'revenge', target: foe.id, text: '此仇必报', since: 0, by: 'rule' };
    foe.alive = false;
    w.acts.push({ kind: 'war_kill', target: foe.id, text: '为抢灵脉和赤霄宗开战' });
    const news = settleWishes(w, rngOf(w));
    expect(news[0]?.credit?.kind).toBe('war_kill');
    expect(p.life.at(-1)?.text).toContain('为抢灵脉');
  });
});

describe('招募', () => {
  it('考核花耐心，奸细总是急着入门', () => {
    const w = fresh(31);
    const c = w.candidates[0];
    const before = c.patience;
    testSkill(w, c, 'combat');
    expect(c.patience).toBe(before - 1);
    expect(c.known.skills).toContain('combat');
    c.via = 'spy';
    expect(acceptChance(w, c, 'probation')).toBeGreaterThan(0.9);
  });
  it('收进门的人有身份、有经历', () => {
    const w = fresh(32);
    const r = rngOf(w);
    // 收人有可能被婉拒：挨个请，直到有人来
    const c = [...w.candidates].find((x) => { x.via = 'spy'; return admit(w, r, x, 'outer'); })!;
    expect(w.members).toContain(c.id);
    expect(w.people[c.id].life[0].text).toContain('拜入');
  });
});

describe('过季', () => {
  it('过二十季不出错，存档能来回 JSON', () => {
    const w = fresh(41);
    for (let i = 0; i < 20 && !w.over; i++) {
      for (const d of [...w.decisions]) resolveDecision(w, rngOf(w), d.id, d.options[0].id);
      if (w.war) { w.war = null; }
      if (w.needPolicy) { w.sect.policy = 'pill'; w.needPolicy = false; }
      advanceSeason(w, planSeason(w, 'off'), {}, {});
    }
    const copy = JSON.parse(JSON.stringify(w));
    expect(copy.t).toBe(w.t);
    expect(members(w).every((p) => p.life.length > 0)).toBe(true);
  });
  it('AI 选的做法不合法就退回规则', () => {
    const w = fresh(42);
    const plan = planSeason(w, 'normal');
    const id = members(w)[0].id;
    advanceSeason(w, plan, { [id]: { id: 'fly_to_moon', why: '我要飞', by: 'ai' } }, {});
    expect(w.people[id].lastWhy).toBeUndefined();
  });
  it('裁决会用默认选项兜底', () => {
    const w = fresh(43);
    const p = members(w)[0];
    addDecision(w, 'transfer', { who: p.id, hall: 'teach' });
    expect(w.decisions.length).toBeGreaterThan(0);
    advanceSeason(w, planSeason(w, 'off'), {}, {});
    expect(w.decisions.find((d) => d.kind === 'transfer' && d.params.who === p.id)).toBeUndefined();
  });
});
