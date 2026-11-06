// 站在玩家这边看：该随机的随机，看不到的看不到，说出口的话对得上，出身里许下的事要兑现。
import { describe, expect, it } from 'vitest';
import { makeRng } from '../game/core/rng.ts';
import type { World } from '../game/core/types.ts';
import { ME, newWorld, rollBirth, ROOTS } from '../game/core/world.ts';
import { breakChance } from '../game/systems/body.ts';
import { openWorld, planYear } from '../game/systems/year.ts';
import { choose, encounters, moveTo, ruleEncounter, social, socialHint } from '../game/player.ts';
import { advanceGoal, setGoal } from '../game/mind/goals.ts';
import { greetLine, newsLine, offlineReply, publicPlan, topicOf } from '../game/ai/lines.ts';
import { scriptedTalk, talkAllow } from '../game/ai/talk.ts';

const arrive = (w: World, p: Parameters<typeof moveTo>[1]) => { moveTo(w, p); w.pending = []; };

describe('青冥录 · 玩家的视角', () => {
  it('灵根和出身由天定：同一个种子投出来一样，五行数对得上，几种都投得出来', () => {
    expect(rollBirth(42)).toEqual(rollBirth(42));
    const seen = { root: new Set<string>(), origin: new Set<string>() };
    for (let s = 0; s < 400; s++) {
      const b = rollBirth(s);
      seen.root.add(b.root);
      seen.origin.add(b.origin);
      const k = [...b.el].length;
      if (b.root === 'heaven') expect(k).toBe(1);
      else if (b.root === 'dual') expect(k).toBe(2);
      else expect(k).toBeGreaterThanOrEqual(3);
    }
    expect(seen.root.size).toBe(3);
    expect(seen.origin.size).toBe(6);
  });

  it('灵根只管资质，家底看出身：孤儿不会每年收到家里的灵石；杂灵根的丹药药力足', () => {
    for (const r of Object.values(ROOTS)) expect(r.desc).not.toMatch(/家底|盘缠|两手空空|捎来/);
    const poor = newWorld(3, { root: 'mixed', origin: 'mo' });
    const rich = newWorld(3, { root: 'mixed', origin: 'ledger' });
    expect(rich.me.stones).toBeGreaterThan(poor.me.stones);
    const w = newWorld(5, { root: 'mixed' }), v = newWorld(5, { root: 'dual' });
    for (const x of [w, v]) { x.me.stage = 2; x.me.exp = 9999; }
    expect(breakChance(w.me, true, w) - breakChance(w.me, false, w)).toBeCloseTo(0.3);
    expect(breakChance(v.me, true, v) - breakChance(v.me, false, v)).toBeCloseTo(0.2);
  });

  it('开局第一年每个人就有打算', () => {
    const w = openWorld(newWorld(11));
    for (const n of Object.values(w.people)) expect(n.plan.why).not.toBe('');
  });

  it('瞒着人的目标：没打听出来之前，看不到他今年在为它奔走；知道了才看得到', () => {
    const w = newWorld(13), lu = w.people.lu;
    lu.mind.goal = { kind: 'throne', target: 'qinglan', step: 2, stuck: 0, secret: true, since: 1, cover: '只想潜心修炼' };
    planYear(w, makeRng(3));
    lu.plan = { act: 'goal', place: 'qinglan', why: '让同门看清宗主的真面目', by: 'rule', goal: true, scheme: 'scandal' };
    expect(publicPlan(w, lu)).toBe('不知在忙些什么');
    w.knows.push('goal:lu');
    expect(publicPlan(w, lu)).toBe('让同门看清宗主的真面目');
  });

  it('别人私下查到的秘密，江湖上只传个影子；你本来就知道才写明', () => {
    const w = newWorld(17), q = w.people.qinyan;
    q.mind.knows = q.mind.knows.filter((k) => k !== 'secret:lu');
    q.mind.goal = { kind: 'revenge', target: 'lu', step: 0, stuck: 0, secret: false, since: 1 };
    q.mind.knows.push('secret:lu');
    advanceGoal(w, q, makeRng(1));
    const line = w.news.at(-1)!.text;
    expect(line).not.toContain('陆沉舟');
  });

  it('出身里认得你的人：第一次碰上有一场戏，兑现开局说的话，只演一次', () => {
    const w = newWorld(19, { origin: 'mo' }), mo = w.people.mojiu;
    mo.place = 'market';
    moveTo(w, 'market');
    const e = w.pending.find((x) => x.kind === 'meet');
    expect(e?.who).toBe('mojiu');
    w.pending = [e!];
    expect(ruleEncounter(w, e!).text).toContain('温玄');
    const before = mo.mind.op[ME].aff;
    choose(w, 0);
    expect(mo.mind.op[ME].aff).toBeGreaterThan(before);
    expect(encounters(w, makeRng(2)).some((x) => x.kind === 'meet')).toBe(false);
  });

  it('选项对话：注定不成的事先说明原因，不白花打交道；碰运气的写上把握', () => {
    const w = newWorld(23);
    arrive(w, 'qinglan');
    const wen = w.people.wen;
    expect(socialHint(w, wen, 'master').no).toBe('好感不够');
    expect(socialHint(w, wen, 'spar').odds).toMatch(/%$/);
    expect(socialHint(w, wen, 'join').odds).toMatch(/%$/);
  });

  it('同一个人比斗过，几年内不会年年来找你', () => {
    const w = newWorld(29);
    const tang = w.people.tang;
    w.me.realm = 0; w.me.stage = 1;
    tang.mind.op[ME] = { aff: 0, trust: 30, fear: 0 };
    let n = 0;
    for (let y = 0; y < 3; y++) {
      tang.place = 'qinglan';
      w.turn.moved = false;
      moveTo(w, 'qinglan');
      const d = w.pending.findIndex((e) => e.kind === 'duel' && e.who === 'tang');
      if (d >= 0) { n++; w.pending = [w.pending[d]]; choose(w, 1); }
      w.pending = [];
      w.year++;
    }
    expect(n).toBeLessThanOrEqual(1);
  });

  it('离线说话：听得懂你问的是什么，按他的性子答；规则不许的事绝不说', () => {
    const w = newWorld(31, { origin: 'hua' });
    arrive(w, 'village');
    const hua = w.people.hua;
    hua.place = 'village';
    expect(topicOf(w, hua, '沈清禾在哪？').t).toBe('person');
    expect(topicOf(w, hua, '你最近在干嘛？').t).toBe('doing');
    expect(topicOf(w, hua, '玄冥剑现在在谁手里？').t).toBe('sword');
    expect(scriptedTalk(w, hua, '沈清禾在哪？', talkAllow(w, hua)).reply).toContain('今年在');
    expect(scriptedTalk(w, hua, '你好').reply).toContain('娃儿');
    // 秘密：规则允许才说；不给 allow 就一个字不漏
    const allow = talkAllow(w, hua);
    const told = offlineReply(w, hua, '你心里藏着什么事？', allow);
    if (allow.reveals.some((k) => k.startsWith('secret:'))) expect(told.revealed).toMatch(/^secret:/);
    expect(offlineReply(w, hua, '你心里藏着什么事？').revealed).toBe('none');
    // 骂人掉好感
    expect(scriptedTalk(w, hua, '老不死的').affinity).toBeLessThan(0);
    expect(greetLine(w, hua).length).toBeGreaterThan(2);
  });

  it('打听消息：先说要紧的事，闲聊算不上消息', () => {
    const w = newWorld(37);
    arrive(w, 'qinglan');
    const wen = w.people.wen;
    wen.mind.op[ME] = { aff: 0, trust: 40, fear: 0 };
    wen.mind.mem.push({ y: 1, k: 'talk_good', a: 'shen', b: 'tang', tone: 1 });
    expect(newsLine(w, wen) ?? '').not.toContain('聊得投机');
    wen.mind.mem.push({ y: 1, k: 'hurt', a: 'lu', b: 'tang', tone: -2, at: 'qinglan' });
    expect(newsLine(w, wen)).toContain('打伤了');
    const r = social(w, 'wen', 'goal');
    expect(r.text).toMatch(/。」$/);
  });

  it('早就认得你的人，开口不会像初次见面', () => {
    const w = newWorld(41, { origin: 'hua' });
    arrive(w, 'village');
    const text = ruleEncounter(w, { id: 'teach:hua', kind: 'teach', who: 'hua', vars: {} }).text;
    expect(text).not.toContain('打量了你很久');
    setGoal(w, w.people.wen, { kind: 'revenge', target: ME, secret: false, step: 3 });
    w.people.wen.mind.mem.push({ y: 1, k: 'insult', a: ME, b: 'wen', tone: -2, at: 'qinglan' });
    expect(ruleEncounter(w, { id: 'attack:wen', kind: 'attack', who: 'wen', vars: {} }).text).toContain('羞辱');
  });
});
