// 一年的结算：年初每个人定下今年的打算，年末按打算结算，再推进目标、彼此打交道、传开消息、老去、选宗主、生出新的念头。

import { makeRng, type Rng } from '../core/rng';
import type { Npc, PlaceId, World } from '../core/types';
import { adjust, aff, being, has, lifeLeft, makeNpc, ME, news, nm, npcs, op, placeName, power, realmText, takeItem } from '../core/world';
import { newcomer, PERSON } from '../data/people';
import { REALMS, SECT_NAME } from '../data/world-data';
import { advanceGoal, bestPlace, finish, goalWant, setGoal, supporters } from '../mind/goals';
import { gossip, remember } from '../mind/memory';
import { age, canBreak, fight, gainExp, tryBreak, yearExp } from './body';

type Want = { act: string; place: PlaceId; why: string; scheme?: string; target?: string };

/** 没有要紧的目标时，按性子和处境挑一件事 */
export function needWant(w: World, n: Npc, rng: Rng): Want {
  const home = bestPlace(n);
  if (n.hp < 40) return { act: 'heal', place: home, why: '先把伤养好' };
  if (canBreak(n)) return { act: 'seclude', place: home, why: '修为圆满，闭关冲关' };
  const opts = needOptions(w, n);
  let best = opts[0][0], bv = -Infinity;
  for (const [o, s] of opts) { const x = s + rng.range(0, 1.5); if (x > bv) { bv = x; best = o; } }
  return best;
}

/** 平常能做的事和各自的分量（AI 定打算时也从这里挑） */
export function needOptions(w: World, n: Npc): [Want, number][] {
  const v = n.mind.values;
  const home = bestPlace(n);
  const opts: [Want, number][] = [
    [{ act: 'cultivate', place: home, why: '静心修炼' }, 2.5 + v.power * 2],
    [{ act: 'adventure', place: 'forest', why: '去黑松林历练' }, 0.8 + v.wealth + v.power + (has(n, 'bold') || has(n, 'rash') ? 1 : 0) - (has(n, 'careful') ? 0.8 : 0)],
  ];
  if (n.realm >= 1) opts.push([{ act: 'adventure', place: 'cave', why: '去洞府碰碰机缘' }, 0.4 + v.wealth + (has(n, 'rash') ? 0.8 : 0) - (has(n, 'careful') ? 0.6 : 0)]);
  if (n.sect) opts.push([{ act: 'task', place: n.sect, why: '替宗门办事' }, 1 + v.loyalty * 2]);
  if (n.stones >= 60 && !n.items.includes('pill')) opts.push([{ act: 'trade', place: 'market', why: '去坊市置办丹药' }, 1 + v.wealth]);
  if (v.justice >= 0.5 || has(n, 'kind')) opts.push([{ act: 'help', place: 'village', why: '下山帮帮村里人' }, 0.5 + v.justice]);
  const friend = Object.entries(n.mind.op).filter(([id, o]) => o.aff >= 50 && id !== ME && w.people[id]?.alive).sort((a, b) => b[1].aff - a[1].aff)[0];
  if (friend && !has(n, 'lonely')) opts.push([{ act: 'visit', place: w.people[friend[0]].place, why: `去看看${nm(w, friend[0])}`, target: friend[0] }, 0.6 + v.love * 2]);
  return opts;
}

/** 规则给出的今年打算：有目标就为目标奔走，偶尔也得顾顾修炼和伤 */
export function ruleWant(w: World, n: Npc, rng: Rng): Want {
  if (n.hp < 30) return needWant(w, n, rng);
  const g = goalWant(w, n);
  if (g && rng.chance(0.85)) return g;
  return needWant(w, n, rng);
}

/** 年初：每个人定下今年的打算和去处；帮手跟着出手的人走 */
export function planYear(w: World, rng: Rng) {
  for (const n of npcs(w)) {
    const want = ruleWant(w, n, rng);
    n.plan = { ...want, by: 'rule' };
    n.place = want.place;
  }
  for (const n of npcs(w)) follow(w, n);
}

/** 出手那一年，NPC 帮手陪着去 */
export function follow(w: World, n: Npc) {
  const g = n.mind.goal;
  const strike = g && ((g.kind === 'revenge' && g.step === 3) || (g.kind === 'treasure' && g.step === 2));
  if (!strike || !g.ally || g.ally === ME) return;
  const a = w.people[g.ally];
  if (!a?.alive) { g.ally = undefined; return; }
  a.plan = { act: 'help', place: n.plan.place, why: `陪${n.name}去${placeName(n.plan.place)}`, by: 'rule', target: n.id };
  a.place = n.plan.place;
}

/** 年末：按今年的打算结算（为目标奔走的部分在 advanceGoal 里） */
function doAct(w: World, n: Npc, rng: Rng) {
  const act = n.plan.act;
  if (act === 'cultivate' || act === 'goal' || act === 'help' || act === 'visit') gainExp(n, yearExp(w, n, n.place, act === 'cultivate' ? 1 : 0.4));
  if (act === 'seclude') {
    const r = tryBreak(w, n, rng);
    if (r?.ok && n.realm >= 2) news(w, `${n.name}闭关出关，突破到了${REALMS[n.realm]}。`, 'good', [n.id], n.realm >= 3);
    else if (r && !r.ok && n.realm >= 2) news(w, `${n.name}冲击${REALMS[n.realm + 1]}失败，受了内伤。`, 'info', [n.id]);
  }
  if (act === 'adventure') beast(w, n, rng, n.place === 'cave' ? 2 : 0.5, n.place === 'cave' ? 12 : 4);
  if (act === 'task') { n.merit += 8 + rng.int(0, 6); n.stones += 15; gainExp(n, yearExp(w, n, n.place, 0.4)); }
  if (act === 'trade' && n.stones >= 60) { n.stones -= 60; n.items.push('pill'); }
  if (act === 'heal') { if (takeItem(n, 'heal')) n.hp = Math.min(100, n.hp + 50); n.hp = Math.min(100, n.hp + 25); }
  if (act === 'help') n.stones += 3;
}

/** 和妖兽打一场：赢了有灵石，偶尔有丹药；输了受伤，很少丢命 */
export function beast(w: World, b: World['me'] | Npc, rng: Rng, lo: number, hi: number) {
  const foe = rng.range(lo, hi);
  const p = power(b);
  const win = rng.chance(p * p / (p * p + foe * foe));
  if (win) {
    const loot = Math.round(10 + foe * 6 + rng.int(0, 20));
    b.stones += loot;
    gainExp(b, 12 + foe * 3);
    let item = '';
    if (rng.chance(hi > 6 ? 0.2 : 0.1)) { item = rng.chance(0.6) ? 'heal' : 'pill'; b.items.push(item); }
    if (hi > 6 && rng.chance(0.03)) { item = 'life'; b.items.push('life'); }
    b.hp = Math.max(1, b.hp - rng.int(0, 15));
    return { win, loot, item, foe };
  }
  b.hp -= Math.round(15 + foe * 4);
  if (b.hp <= 0) {
    if (rng.chance(0.5)) {
      b.alive = false; b.hp = 0;
      b.died = { y: w.year, note: `葬身${placeName(b.place)}的妖兽之口` };
      if (b.id !== ME) news(w, `${b.name}在${placeName(b.place)}遇上大妖，没能回来。`, 'bad', [b.id], true);
    } else b.hp = 5;
  }
  return { win, loot: 0, item: '', foe };
}

/** 同一处的人彼此打交道：论道、冲突、闲聊，见面就会把听来的事讲给对方 */
export function socialize(w: World, rng: Rng) {
  const by: Partial<Record<PlaceId, Npc[]>> = {};
  for (const n of npcs(w)) (by[n.place] ??= []).push(n);
  for (const [, list] of Object.entries(by)) {
    if (!list || list.length < 2) continue;
    const pairs: [Npc, Npc][] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) pairs.push([list[i], list[j]]);
    rng.shuffle(pairs);
    for (const [a, b] of pairs.slice(0, 4)) {
      if (!a.alive || !b.alive) continue;
      const s = aff(a, b.id) + aff(b, a.id);
      if (s >= 60) {
        gainExp(a, yearExp(w, a, a.place, 0.15));
        gainExp(b, yearExp(w, b, b.place, 0.15));
        remember(w, a, { k: 'talk_good', a: b.id, b: a.id, tone: 1, at: a.place });
        remember(w, b, { k: 'talk_good', a: a.id, b: b.id, tone: 1, at: a.place });
      } else if (s <= -60 && [a, b].some((x) => has(x, 'proud') || has(x, 'rash') || has(x, 'cruel')) && w.flags[`clash:${a.id}:${b.id}`] === undefined && rng.chance(0.5)) {
        // 打过一场，几年内就互相避着
        const r = fight(w, a, b, rng, { lethal: false });
        remember(w, r.lose as Npc, { k: 'hurt', a: r.win.id, b: r.lose.id, tone: -2, at: a.place });
        adjust(r.lose as Npc, r.win.id, { fear: 15 });
        w.flags[`clash:${a.id}:${b.id}`] = w.year;
        news(w, `${a.name}和${b.name}在${placeName(a.place)}起了冲突，${r.win.name}占了上风。`, 'info', [a.id, b.id]);
      } else if (rng.chance(0.5)) {
        // 闲聊：脾气合不合，慢慢拉近或拉远
        const close = Math.abs(a.mind.values.justice - b.mind.values.justice) + Math.abs(a.mind.values.power - b.mind.values.power) < 0.6;
        adjust(a, b.id, { aff: close ? 3 : -2 });
        adjust(b, a.id, { aff: close ? 3 : -2 });
      }
      if (rng.chance(0.7)) gossip(w, a, b, rng);
      if (rng.chance(0.7)) gossip(w, b, a, rng);
    }
  }
}

/** 宗主没了：按战力、支持的人、功劳选新宗主（主角在宗门里也有份） */
function succession(w: World, rng: Rng) {
  for (const sect of Object.values(w.sects)) {
    const m = sect.master ? being(w, sect.master) : undefined;
    if (m?.alive && m.sect === sect.id) continue;
    const cands = npcs(w).filter((x) => x.sect === sect.id);
    const scored: [string, number][] = cands.map((x) => [x.id, power(x) * 2 + supporters(w, x) * 2 + x.merit / 15 + (x.mind.goal?.kind === 'throne' ? 3 : 0) + rng.range(0, 2)]);
    if (w.me.alive && w.me.sect === sect.id) {
      const sup = cands.filter((x) => aff(x, ME) >= 30).length;
      scored.push([ME, power(w.me) * 2 + sup * 2 + w.me.merit / 15 + rng.range(0, 2)]);
    }
    if (!scored.length) { sect.master = ''; continue; }
    scored.sort((a, b) => b[1] - a[1]);
    sect.master = scored[0][0];
    news(w, `${nm(w, sect.master)}继任${sect.name}${sect.id === 'qinglan' ? '宗主' : '门主'}。`, 'story', [sect.master], true);
    for (const x of cands) {
      if (x.mind.goal?.kind !== 'throne' || x.mind.goal.target !== sect.id) continue;
      finish(w, x, x.id === sect.master ? 'ok' : 'fail');
      if (x.id !== sect.master) adjust(x, sect.master, { aff: -30 });
    }
  }
}

/** 没有目标的人，会因为处境生出新的念头 */
function spawnGoals(w: World, rng: Rng) {
  for (const n of npcs(w)) {
    if (n.mind.goal) continue;
    const secretive = has(n, 'careful') || has(n, 'cunning') || has(n, 'lonely');
    if (lifeLeft(n) < 15 && n.realm < 4) { setGoal(w, n, { kind: 'longevity', secret: secretive, cover: '闭关参悟' }); continue; }
    if (!n.partner && (has(n, 'devoted') || n.mind.values.love >= 0.6) && rng.chance(0.3)) {
      // 长辈晚辈、年纪差太多的，交情再深也只是交情
      const fit = (id: string) => { const b = being(w, id); return !!b?.alive && !b.partner && b.age >= 18 && n.age >= 18 && Math.abs(b.age - n.age) <= 20 && b.master !== n.id && n.master !== id; };
      const t = Object.entries(n.mind.op).filter(([id, o]) => o.aff >= 65 && fit(id)).sort((a, b) => b[1].aff - a[1].aff)[0];
      if (t) { setGoal(w, n, { kind: 'love', target: t[0], secret: secretive, cover: '没什么，随便走走' }); continue; }
    }
    const sword = w.treasure.sword;
    if (sword && sword !== 'gone' && sword !== n.id && (has(n, 'greedy') || n.mind.values.power >= 0.8) && rng.chance(0.08)) {
      setGoal(w, n, { kind: 'treasure', target: 'sword', secret: secretive || has(n, 'greedy'), cover: '四处走走' });
      continue;
    }
    if (n.sect && w.sects[n.sect].master !== n.id && n.realm >= 1 && n.mind.values.power >= 0.8 && (has(n, 'cruel') || has(n, 'proud')) && rng.chance(0.06)) {
      setGoal(w, n, { kind: 'throne', target: n.sect, secret: true, cover: '一心为宗门' });
      continue;
    }
    if (!n.sect && n.age < 30 && rng.chance(0.2)) setGoal(w, n, { kind: 'join', secret: false });
  }
  // 对宗主寒透了心的人，会叛出宗门
  for (const n of npcs(w)) {
    if (!n.sect) continue;
    const m = w.sects[n.sect].master;
    if (!m || m === n.id) continue;
    if (aff(n, m) <= -50 && n.mind.values.loyalty < 0.7 && rng.chance(0.4)) {
      news(w, `${n.name}叛出了${SECT_NAME[n.sect]}。`, 'bad', [n.id, m], true);
      n.sect = '';
      if (n.mind.goal?.kind === 'throne') finish(w, n, 'fail');
    }
  }
}

/** 老人走了，新人会来：活着的人少于十二个时，偶尔来一个后起之秀 */
function newcomers(w: World, rng: Rng) {
  if (npcs(w).length >= 12 || !rng.chance(0.35)) return;
  const id = `n${w.nextId++}`;
  const d = newcomer(id, rng.pick, rng.next);
  const n = makeNpc(d, w.year);
  n.bio = d.bio;
  n.voice = d.voice;
  w.people[id] = n;
  news(w, `${d.name}${d.sect ? `拜入了${SECT_NAME[d.sect]}` : '来到了云渡坊'}，是个${REALMS[d.realm]}期的年轻修士。`, 'info', [id]);
}

export function endYear(w: World) {
  if (w.phase !== 'year') return;
  const rng = makeRng(w.rng);
  for (const n of npcs(w)) doAct(w, n, rng);
  for (const n of npcs(w)) advanceGoal(w, n, rng);
  socialize(w, rng);
  for (const n of Object.values(w.people)) {
    if (!n.alive) continue;
    age(w, n);
    if (!n.alive) {
      news(w, `${n.name}寿元耗尽，坐化于${realmText(n)}。`, 'bad', [n.id], n.realm >= 2);
      for (const x of npcs(w)) if (aff(x, n.id) >= 40) x.mind.mood = Math.max(0, x.mind.mood - 15);
    }
  }
  if (w.me.alive) age(w, w.me);
  succession(w, rng);
  spawnGoals(w, rng);
  newcomers(w, rng);
  if (rng.chance(0.15)) w.flags.lifeStock = Math.min(1, Number(w.flags.lifeStock ?? 0) + 1);
  for (const n of npcs(w)) n.mind.mood = Math.round(n.mind.mood + (60 - n.mind.mood) * 0.2);
  for (const k of Object.keys(w.flags)) if (k.startsWith('clash:') && w.year - Number(w.flags[k]) >= 6) delete w.flags[k];
  w.year++;
  w.turn = { moved: false, main: false, social: 2, talk: {} };
  w.pending = [];
  w.offer = null;
  checkEnd(w);
  if (w.phase === 'year') planYear(w, rng);
  w.rng = rng.state();
}

export function checkEnd(w: World) {
  if (w.phase === 'ending') return;
  if (!w.me.alive) {
    w.phase = 'ending';
    w.ending = { kind: w.me.died?.note.startsWith('寿元') ? 'age' : 'dead', y: w.year };
  } else if (w.me.realm >= 4) {
    w.phase = 'ending';
    w.ending = { kind: 'ascend', y: w.year };
  }
}

export const opinionOfMe = (n: Npc) => op(n, ME);
export const personDef = (id: string) => PERSON[id];
