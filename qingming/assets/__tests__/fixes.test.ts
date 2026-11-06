// 第 4 阶段修掉的毛病：每个都有一条测试守着。
import { describe, expect, it } from 'vitest';
import { upgrade } from '../game/core/save.ts';
import { ME, moveTreasure, newWorld, op, titleOf } from '../game/core/world.ts';
import { goalWant, seize } from '../game/mind/goals.ts';
import { choose, doMain, endTurn, mainActs, moveTo, sell, viewEncounter } from '../game/player.ts';
import { endYear } from '../game/systems/year.ts';

describe('青冥录 · 修好的毛病', () => {
  it('玄冥剑已经不在洞府里，盟友不会再约你去空洞府；仇人死了也不再约', () => {
    const w = newWorld(29), liu = w.people.liu;
    liu.mind.goal = { kind: 'treasure', target: 'sword', step: 2, stuck: 0, secret: true, since: 1, ally: ME };
    moveTreasure(w, 'sword', 'cave', 'li');
    moveTo(w, 'market');
    expect(w.pending.some((e) => e.kind === 'call')).toBe(false);
    w.pending = [];
    endTurn(w);
    expect(liu.mind.goal?.ally).toBeUndefined();

    const v = newWorld(30), qin = v.people.qinyan;
    qin.mind.goal = { kind: 'revenge', target: 'lu', step: 3, stuck: 0, secret: false, since: 1, ally: ME };
    v.people.lu.alive = false;
    moveTo(v, 'chixiao');
    expect(v.pending.some((e) => e.kind === 'call')).toBe(false);
    v.pending = [];
    endTurn(v);
    expect(qin.mind.past.some((g) => g.kind === 'revenge' && g.done === 'fail')).toBe(true);
  });

  it('和盟友下洞府没成，就散伙重来，不会年年再约', () => {
    for (let seed = 31; seed < 41; seed++) {
      const w = newWorld(seed), li = w.people.li;
      li.mind.goal = { kind: 'treasure', target: 'sword', step: 2, stuck: 0, secret: false, since: 1, ally: ME };
      li.hp = 60;
      moveTo(w, 'chixiao');
      const call = w.pending.find((e) => e.kind === 'call');
      expect(call).toBeTruthy();
      w.pending = [call!];
      choose(w, 0);
      if (w.treasure.sword === 'cave' && li.alive) expect(li.mind.goal?.ally).toBeUndefined();
      else if (w.treasure.sword === 'li') expect(li.mind.goal?.step).toBe(3);
    }
  });

  it('心里有你的人会一步步走近，最后找你表白', () => {
    const w = newWorld(33), tang = w.people.tang;
    tang.mind.goal = { kind: 'love', target: ME, step: 0, stuck: 0, secret: true, since: 1 };
    op(tang, ME).aff = 70;
    op(tang, ME).trust = 60;
    let hit = false;
    for (let y = 0; y < 12 && !hit && w.phase === 'year'; y++) {
      moveTo(w, 'village');
      hit = w.pending.some((e) => e.kind === 'confess');
      if (!hit) { w.pending = []; endTurn(w); }
    }
    expect(hit).toBe(true);
    w.pending = w.pending.filter((e) => e.kind === 'confess');
    choose(w, 0);
    expect(w.me.partner).toBe('tang');
    expect(tang.partner).toBe(ME);
  });

  it('想要玄冥剑的人冲着你来：抢的是剑；有钱的上门求购', () => {
    const w = newWorld(43);
    moveTreasure(w, 'sword', 'cave', ME);
    const li = w.people.li;
    li.stones = 0;
    li.mind.goal = { kind: 'treasure', target: 'sword', step: 2, stuck: 0, secret: false, since: 1 };
    li.plan = { ...goalWant(w, li)!, by: 'rule' };
    expect(li.plan).toMatchObject({ scheme: 'rob', target: ME });
    moveTo(w, 'vein');
    const e = w.pending.find((x) => x.kind === 'attack')!;
    expect(viewEncounter(w, e).text).toContain('玄冥剑');
    expect(viewEncounter(w, e).text).not.toContain('延寿丹');
    w.pending = [e];
    choose(w, 2);
    expect(w.treasure.sword).toBe('li');
    expect(li.items).toContain('sword');

    const v = newWorld(44);
    moveTreasure(v, 'sword', 'cave', ME);
    const liu = v.people.liu;
    liu.mind.goal = { kind: 'treasure', target: 'sword', step: 2, stuck: 0, secret: true, since: 1 };
    liu.plan = { ...goalWant(v, liu)!, by: 'rule' };
    expect(liu.plan.scheme).toBe('buy');
    moveTo(v, 'vein');
    const b = v.pending.find((x) => x.kind === 'bid')!;
    const before = v.me.stones;
    v.pending = [b];
    choose(v, 0);
    expect(v.treasure.sword).toBe('liu');
    expect(v.me.stones).toBeGreaterThan(before);
  });

  it('在云渡坊能卖东西：丹药半价；遗书不卖；玄冥剑卖给柳如烟', () => {
    const w = newWorld(45, { root: 'mixed' });
    w.me.items.push('pill');
    moveTo(w, 'market');
    w.pending = [];
    const s0 = w.me.stones;
    sell(w, 'pill');
    expect(w.me.stones).toBe(s0 + 30);
    moveTreasure(w, 'letter', 'cave', ME);
    expect(sell(w, 'letter')).toBe('这东西不能卖。');
    expect(w.treasure.letter).toBe(ME);
    moveTreasure(w, 'sword', 'cave', ME);
    sell(w, 'sword');
    expect(w.treasure.sword).toBe('liu');
  });

  it('道侣、师父故去后名分解开；死人身上的玄冥剑有去处', () => {
    const w = newWorld(37);
    w.me.partner = 'hua'; w.people.hua.partner = ME; w.me.master = 'wen';
    w.people.hua.alive = false; w.people.wen.alive = false;
    moveTreasure(w, 'sword', 'cave', 'li');
    w.people.li.alive = false;
    w.turn.moved = true;
    endYear(w);
    expect(w.me.partner).toBeUndefined();
    expect(w.me.master).toBeUndefined();
    const h = w.treasure.sword;
    expect(h === 'cave' || !!w.people[h]?.alive).toBe(true);
  });

  it('你当上宗主：名分写对，争位的人冲着你来', () => {
    const w = newWorld(41);
    w.me.sect = 'qinglan';
    w.sects.qinglan.master = ME;
    w.me.place = 'qinglan';
    const lu = w.people.lu;
    lu.mind.goal!.step = 2;
    const want = goalWant(w, lu)!;
    expect(want.target).toBe(ME);
    expect(['ambush', 'scandal', 'wait']).toContain(want.scheme);
    expect(titleOf(w, ME)).toBe('青岚宗宗主');
    expect(titleOf(w, 'lu')).toBe('青岚宗弟子');
  });

  it('门主下了洞府，韩烈趁机夺位；你在山上，他会先来探你的口风', () => {
    const w = newWorld(47);
    const han = w.people.han, li = w.people.li;
    han.mind.goal = { kind: 'throne', target: 'chixiao', step: 2, stuck: 0, secret: true, since: 1 };
    li.place = 'cave';
    han.plan = { act: 'goal', place: 'chixiao', why: '', by: 'rule', scheme: 'seize', target: 'li' };
    w.me.sect = 'chixiao';
    moveTo(w, 'chixiao');
    const plot = w.pending.find((e) => e.kind === 'plot');
    expect(plot).toBeTruthy();
    w.pending = [plot!];
    choose(w, 0);
    expect(w.flags['plot:han']).toBe('me');
    seize(w, han, 'chixiao', li);
    expect(w.sects.chixiao.master).toBe('han');
    expect(li.sect).toBe('');
    expect(li.mind.goal?.kind).toBe('revenge');
  });

  it('修为不够圆满时点「闭关冲关」，不会白白耗掉今年的主事', () => {
    const w = newWorld(49);
    moveTo(w, 'vein');
    w.pending = [];
    expect(mainActs(w).find((a) => a.id === 'seclude')?.ok).toBe(false);
    expect(doMain(w, 'seclude')).toBe('');
    expect(w.turn.main).toBe(false);
    expect(doMain(w, 'cultivate')).not.toBe('');
  });

  it('读旧存档：补上新字段，修掉死人的名分和空洞府的约', () => {
    const w = JSON.parse(JSON.stringify(newWorld(51)));
    delete w.fame; delete w.rev; delete w.root; delete w.origin;
    w.me.partner = 'hua'; w.people.hua.alive = false;
    w.people.liu.mind.goal = { kind: 'treasure', target: 'sword', step: 2, stuck: 0, secret: true, since: 1, ally: ME };
    w.treasure.sword = 'li';
    w.people.li.items.push('sword');
    const u = upgrade(w);
    expect(u.fame).toBe(0);
    expect(u.rev).toBe(2);
    expect(u.root).toBe('dual');
    expect(u.me.partner).toBeUndefined();
    expect(u.people.liu.mind.goal?.ally).toBeUndefined();
  });
});
