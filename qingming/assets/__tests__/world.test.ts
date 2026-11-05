import { describe, expect, it } from 'vitest';
import { makeRng } from '../game/core/rng.ts';
import type { World } from '../game/core/types.ts';
import { aff, ME, newWorld, npcs, op } from '../game/core/world.ts';
import { PLACE_ORDER } from '../game/data/world-data.ts';
import { goalWant } from '../game/mind/goals.ts';
import { gossip, remember } from '../game/mind/memory.ts';
import { choose, doMain, endTurn, moveTo, retreat, social, viewEncounter } from '../game/player.ts';
import { endYear, planYear } from '../game/systems/year.ts';

const ACTS = ['cultivate', 'seclude', 'adventure', 'task', 'trade', 'heal', 'help', 'visit', 'goal'];

function idleYears(w: World, n: number) {
  for (let i = 0; i < n && w.phase === 'year'; i++) {
    moveTo(w, 'village');
    while (w.pending.length) choose(w, 0);
    endTurn(w);
  }
}

describe('青冥录 · 世界', () => {
  it('同一个种子、同样的操作，结果完全一样', () => {
    const a = newWorld(42), b = newWorld(42);
    idleYears(a, 25);
    idleYears(b, 25);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('规则 AI 只挑合法的事、去存在的地方', () => {
    const w = newWorld(7);
    for (let y = 0; y < 40 && w.phase === 'year'; y++) {
      for (const n of npcs(w)) {
        expect(ACTS).toContain(n.plan.act);
        expect(PLACE_ORDER).toContain(n.plan.place);
        expect(n.place).toBe(n.plan.place);
      }
      idleYears(w, 1);
    }
  });

  it('目标会一步步推进，有成有败', () => {
    let ok = 0, fail = 0, moved = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const w = newWorld(seed);
      idleYears(w, 50);
      for (const n of Object.values(w.people)) {
        for (const g of n.mind.past) { if (g.done === 'ok') ok++; else fail++; }
        if (n.mind.goal && n.mind.goal.step > 0) moved++;
      }
    }
    expect(ok).toBeGreaterThan(20);
    expect(fail).toBeGreaterThan(5);
    expect(ok + moved).toBeGreaterThan(30);
  });

  it('传闻会传开，听来的事分量减半', () => {
    const w = newWorld(3);
    const liu = w.people.liu, li = w.people.li;
    remember(w, liu, { k: 'save', a: ME, b: 'liu', tone: 3 });
    expect(aff(liu, ME)).toBeGreaterThanOrEqual(24);
    op(li, 'liu').trust = 80;
    const before = aff(li, ME);
    const told = gossip(w, liu, li, { next: () => 0, chance: () => true, pick: (a: unknown[]) => a[0] } as never);
    expect(told?.k).toBe('save');
    const heard = li.mind.mem.find((m) => m.k === 'save' && m.a === ME)!;
    expect(heard.from).toBe('liu');
    expect(heard.tone).toBe(1);
    expect(aff(li, ME) - before).toBeGreaterThan(0);
    expect(aff(li, ME) - before).toBeLessThan(aff(liu, ME));
  });

  it('你对一个人做过的事，他记着，态度跟着变', () => {
    const w = newWorld(5);
    moveTo(w, 'market');
    while (w.pending.length) choose(w, 0);
    const liu = w.people.liu;
    const before = aff(liu, ME);
    social(w, 'liu', 'gift');
    expect(aff(liu, ME)).toBeGreaterThan(before);
    expect(liu.mind.mem.some((m) => m.k === 'gift' && m.a === ME)).toBe(true);
    const mid = aff(liu, ME);
    social(w, 'liu', 'provoke');
    expect(aff(liu, ME)).toBeLessThan(mid);
  });

  it('有秘密目标的人会编个说法骗你，知道真相后就骗不了', () => {
    const w = newWorld(9);
    w.people.lu.place = 'qinglan';
    moveTo(w, 'qinglan');
    w.pending = [];
    const lie = social(w, 'lu', 'goal');
    expect(lie.text).toContain('潜心修炼');
    w.knows.push('goal:lu');
    const truth = social(w, 'lu', 'goal');
    expect(truth.text).toContain('青岚宗的位子');
  });

  it('把陆沉舟的秘密告诉秦焰：秦焰的报仇往前走，陆沉舟迟早会知道是你说的', () => {
    const w = newWorld(11);
    w.knows.push('secret:lu');
    w.people.qinyan.place = 'chixiao';
    moveTo(w, 'chixiao');
    w.pending = [];
    expect(w.people.qinyan.mind.goal?.step).toBe(0);
    social(w, 'qinyan', 'tell', 'secret:lu');
    expect(w.people.qinyan.mind.goal?.step).toBe(1);
    expect(w.people.qinyan.mind.knows).toContain('secret:lu');
    expect(w.people.lu.mind.mem.some((m) => m.k === 'expose' && m.a === ME)).toBe(true);
    expect(aff(w.people.lu, ME)).toBeLessThan(0);
  });

  it('要找你报仇的人，到了动手那年在哪都找得到你', () => {
    const w = newWorld(13);
    const han = w.people.han;
    han.mind.goal = { kind: 'revenge', target: ME, step: 3, stuck: 0, secret: false, since: 1 };
    planYear(w, makeRng(1));
    expect(goalWant(w, han)?.target).toBe(ME);
    han.plan = { act: 'goal', place: 'village', why: '', by: 'rule', scheme: 'ambush', target: ME };
    moveTo(w, 'vein');
    expect(w.pending[0]?.kind).toBe('attack');
    expect(viewEncounter(w, w.pending[0]).choices.length).toBe(3);
  });

  it('闭关几年，有人找上门就停下', () => {
    const w = newWorld(17);
    const y = w.year;
    const n = retreat(w, 3);
    expect(w.year).toBe(y + n);
    expect(w.me.exp + w.me.stage * 100).toBeGreaterThan(0);
    const han = npcs(w)[0];
    han.mind.goal = { kind: 'revenge', target: ME, step: 3, stuck: 0, secret: false, since: 1 };
    han.plan = { act: 'goal', place: 'village', why: '', by: 'rule', scheme: 'ambush', target: ME };
    const y2 = w.year;
    expect(retreat(w, 5)).toBe(0);
    expect(w.year).toBe(y2);
    expect(w.pending.length).toBeGreaterThan(0);
  });

  it('宗主死了，宗门会选出新宗主', () => {
    const w = newWorld(19);
    w.people.wen.alive = false;
    w.turn.moved = true;
    endYear(w);
    expect(w.sects.qinglan.master).not.toBe('wen');
    expect(w.people[w.sects.qinglan.master]?.sect).toBe('qinglan');
  });

  it('主事一年只能做一次', () => {
    const w = newWorld(23);
    moveTo(w, 'vein');
    while (w.pending.length) choose(w, 0);
    expect(doMain(w, 'cultivate')).not.toBe('');
    expect(doMain(w, 'cultivate')).toBe('');
  });
});
