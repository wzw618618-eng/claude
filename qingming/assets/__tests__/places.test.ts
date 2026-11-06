// 第 4 阶段加的玩法：各地的事、途中意外、名声、揭发温玄、出身、后期的事、节奏。
import { describe, expect, it } from 'vitest';
import { makeRng } from '../game/core/rng.ts';
import type { World } from '../game/core/types.ts';
import { ME, moveTreasure, newWorld, op } from '../game/core/world.ts';
import { choose, doMain, endTurn, mainActs, moveTo, social, viewEncounter } from '../game/player.ts';
import { disciples, rollEvent } from '../game/systems/places.ts';

const arrive = (w: World, p: Parameters<typeof moveTo>[1]) => { moveTo(w, p); w.pending = []; };

describe('青冥录 · 各地的事和后期', () => {
  it('听泉悟道：下次冲关把握变大；不点「服丹冲关」就不耗破境丹', () => {
    const w = newWorld(61, { root: 'mixed' });
    arrive(w, 'vein');
    const local = mainActs(w).find((a) => a.id === 'local')!;
    expect(local.label).toBe('听泉悟道');
    doMain(w, 'local');
    expect(Number(w.flags.insight)).toBeGreaterThan(0);
    endTurn(w);
    w.me.stage = 2; w.me.exp = 999;
    arrive(w, 'vein');
    const pills = w.me.items.filter((i) => i === 'pill').length;
    expect(mainActs(w).find((a) => a.id === 'seclude')!.ok).toBe(true);
    doMain(w, 'seclude');
    expect(w.me.items.filter((i) => i === 'pill').length).toBe(pills);
    expect(w.flags.insight).toBeUndefined();
  });

  it('拿着云鹤遗书去青岚宗，沈清禾在场就没人不信：温玄倒台，沈清禾要报仇，温玄恨上你', () => {
    const w = newWorld(63);
    moveTreasure(w, 'letter', 'cave', ME);
    w.people.shen.place = 'qinglan';
    arrive(w, 'qinglan');
    const ex = mainActs(w).find((a) => a.id === 'expose');
    expect(ex?.ok).toBe(true);
    doMain(w, 'expose');
    expect(w.sects.qinglan.master).not.toBe('wen');
    expect(w.people.wen.sect).toBe('');
    expect(w.people.shen.mind.goal).toMatchObject({ kind: 'revenge', target: 'wen' });
    expect(w.people.wen.mind.op[ME].aff).toBeLessThan(-50);
    expect(w.fame).toBeGreaterThan(0);
    expect(w.flags.exposed).toBe(w.year);
  });

  it('越凶险的地方越容易出事；碰上的事有选项、能处理', () => {
    let cave = 0, sect = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const a = newWorld(seed); a.me.place = 'cave';
      if (rollEvent(a, makeRng(seed))) cave++;
      const b = newWorld(seed); b.me.place = 'qinglan';
      if (rollEvent(b, makeRng(seed))) sect++;
    }
    expect(cave).toBeGreaterThan(sect);
    const w = newWorld(65);
    w.me.place = 'forest';
    let ev = null;
    for (let i = 0; i < 50 && !ev; i++) ev = rollEvent(w, makeRng(i));
    expect(ev).toBeTruthy();
    w.turn.moved = true;
    w.pending = [ev!];
    const v = viewEncounter(w, ev!);
    expect(v.choices.length).toBeGreaterThan(0);
    expect(choose(w, 0)).not.toBe('');
    expect(w.pending.length).toBe(0);
  });

  it('金丹以后能收徒、传功；元婴能开坛讲道，名声跟着涨', () => {
    const w = newWorld(67);
    w.me.realm = 2;
    const aman = w.people.aman;
    aman.place = 'village';
    op(aman, ME).aff = 60; op(aman, ME).trust = 60;
    arrive(w, 'village');
    social(w, 'aman', 'disciple');
    expect(aman.master).toBe(ME);
    expect(disciples(w).map((d) => d.id)).toContain('aman');
    const exp = aman.exp + aman.stage * 1000;
    doMain(w, 'pass');
    expect(aman.exp + aman.stage * 1000).toBeGreaterThan(exp);
    endTurn(w);
    w.me.realm = 3;
    w.people.hua.place = 'village';
    aman.place = 'village';
    arrive(w, 'village');
    const f = w.fame ?? 0;
    expect(mainActs(w).some((a) => a.id === 'lecture')).toBe(true);
    doMain(w, 'lecture');
    expect(w.fame!).toBeGreaterThan(f);
  });

  it('你当了宗主：能主持宗务、收人入门、逐出门墙', () => {
    const w = newWorld(69);
    w.me.sect = 'qinglan';
    w.sects.qinglan.master = ME;
    w.people.aman.place = 'qinglan';
    w.people.lu.place = 'qinglan';
    arrive(w, 'qinglan');
    const s0 = w.me.stones;
    doMain(w, 'govern');
    expect(w.me.stones).toBe(s0 + 60);
    op(w.people.aman, ME).aff = 30;
    social(w, 'aman', 'admit');
    expect(w.people.aman.sect).toBe('qinglan');
    social(w, 'lu', 'expel');
    expect(w.people.lu.sect).toBe('');
  });

  it('出身：墨家遗孤开局就和墨九有交情，知道他的打算；赤霄门弃徒拜不进赤霄门', () => {
    const w = newWorld(71, { origin: 'mo' });
    expect(w.people.mojiu.mind.op[ME].aff).toBeGreaterThanOrEqual(50);
    expect(w.knows).toContain('goal:mojiu');
    const v = newWorld(72, { origin: 'outcast' });
    expect(v.me.place).toBe('forest');
    v.me.place = 'chixiao';
    arrive(v, 'chixiao');
    expect(mainActs(v).find((a) => a.id === 'local')?.ok).toBe(false);
    const u = newWorld(73, { origin: 'ledger' });
    expect(u.me.place).toBe('market');
    expect(u.people.liu.mind.op[ME].aff).toBeGreaterThan(0);
  });

  it('名角的大事不会在开局几年演完：前七年玄冥剑多半还在洞府，柳如烟、温玄都还活着', () => {
    let swordHome = 0, alive = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = newWorld(seed);
      for (let y = 0; y < 7 && w.phase === 'year'; y++) { moveTo(w, 'village'); w.pending = []; endTurn(w); }
      if (w.treasure.sword === 'cave') swordHome++;
      if (w.people.liu.alive && w.people.wen.alive) alive++;
    }
    expect(swordHome).toBeGreaterThanOrEqual(9);
    expect(alive).toBeGreaterThanOrEqual(9);
  });
});
