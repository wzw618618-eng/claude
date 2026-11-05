// 长远目标：每种目标几步，一年推进一点。今年想干什么（want）年初定，年末结算（advance）。
// 冲着主角来的事（报仇、表白、拉你入伙、翻脸）不在这里自动结算，而是等主角到了地方，变成找上门的事（见 encounters.ts）。

import type { Rng } from '../core/rng';
import type { Goal, GoalKind, Npc, PlaceId, Plan, World } from '../core/types';
import { adjust, aff, being, giveItem, has, itemName, lifeLeft, ME, news, nm, npcs, power, takeItem } from '../core/world';
import { SECT_NAME } from '../data/world-data';
import { canBreak, fight } from '../systems/body';
import { remember, witness } from './memory';

export const GOALS: Record<GoalKind, { name: string; steps: string[] }> = {
  revenge: { name: '报仇', steps: ['打听仇人', '苦修', '找帮手', '动手'] },
  throne: { name: '争宗主', steps: ['攒功劳', '拉拢同门', '扳倒对手', '继位'] },
  seekmaster: { name: '寻师', steps: ['打听线索', '闯洞府', '真相'] },
  love: { name: '求道侣', steps: ['接近', '送礼', '表白'] },
  treasure: { name: '夺宝', steps: ['打听', '准备', '夺宝', '善后'] },
  longevity: { name: '求长生', steps: ['闭关冲关', '寻延寿丹', '不择手段'] },
  join: { name: '拜入宗门', steps: ['打基础', '上山拜师'] },
};

/** 洞府深处守着宝物的东西有多强 */
export const GUARDIAN = 10;

export function targetName(w: World, g: Goal) {
  if (!g.target) return '';
  if (g.kind === 'throne') return SECT_NAME[g.target as 'qinglan'] ?? g.target;
  if (g.kind === 'treasure') return itemName(g.target);
  return nm(w, g.target);
}
/** 「报仇：陆沉舟（苦修）」 */
export function goalText(w: World, g: Goal) {
  const d = GOALS[g.kind];
  const t = targetName(w, g);
  return `${d.name}${t ? `：${t}` : ''}（${d.steps[Math.min(g.step, d.steps.length - 1)]}）`;
}

type Want = Omit<Plan, 'by'>;
export const bestPlace = (n: Npc): PlaceId => (n.sect ? n.sect : 'vein');
const grow = (w: World, n: Npc, why: string): Want => (canBreak(n) ? { act: 'seclude', place: bestPlace(n), why } : { act: 'cultivate', place: bestPlace(n), why });
const holderOf = (w: World, item: string) => w.treasure[item];

/** 为了目标，今年想干什么；返回 null 就按平常的需要来 */
export function goalWant(w: World, n: Npc): Want | null {
  const g = n.mind.goal;
  if (!g) return null;
  const T = g.target ? being(w, g.target) : undefined;
  const tn = targetName(w, g);
  switch (g.kind) {
    case 'revenge':
      if (g.step === 0) return { act: 'goal', place: 'market', why: '四处打听当年的事' };
      if (g.step === 1) return grow(w, n, `要先变强，才能找${tn}算账`);
      if (g.step === 2) return { act: 'goal', place: n.place, why: `找人一起对付${tn}`, scheme: 'ally' };
      return { act: 'goal', place: T?.place ?? n.place, why: `去找${tn}算账`, scheme: 'ambush', target: g.target };
    case 'throne': {
      const sect = g.target as 'qinglan';
      if (g.step === 0) return { act: 'task', place: sect, why: '多替宗门办事，攒下功劳' };
      if (g.step === 1) return { act: 'goal', place: sect, why: '和同门多走动', scheme: 'woo' };
      if (g.step === 2) {
        const m = w.sects[sect].master;
        const master = m ? w.people[m] : undefined;
        const scheme = !master?.alive ? 'claim' : has(n, 'cruel') && power(n) >= power(master) * 0.8 ? 'ambush' : lifeLeft(master) < 12 ? 'wait' : 'scandal';
        return { act: 'goal', place: sect, why: scheme === 'ambush' ? '是时候动手了' : scheme === 'wait' ? '等那老东西自己坐化' : '让同门看清宗主的真面目', scheme, target: m || undefined };
      }
      return { act: 'goal', place: sect, why: '接下宗主之位', scheme: 'claim' };
    }
    case 'seekmaster':
      if (g.step === 0) return { act: 'goal', place: n.mind.knows.includes('clue') ? 'cave' : 'village', why: '打听师父失踪那年的事' };
      if (!bold(n) && delveOdds(n) < 0.25) return grow(w, n, '洞府深处太凶险，得先变强');
      return { act: 'goal', place: 'cave', why: '去洞府深处找师父的下落' };
    case 'love':
      if (!T?.alive) return null;
      return { act: 'goal', place: T.place, why: g.step === 2 ? `想对${tn}说出心里话` : `想多见见${tn}`, scheme: ['near', 'gift', 'confess'][g.step], target: g.target };
    case 'treasure': {
      const h = holderOf(w, g.target!);
      if (g.step === 0) return { act: 'goal', place: 'market', why: `打听${tn}的下落` };
      if (g.step === 1) return power(n) >= GUARDIAN * (has(n, 'careful') || has(n, 'cunning') ? 1.2 : 0.8) ? { act: 'goal', place: n.place, why: '准备下洞府' } : { act: 'goal', place: n.place, why: `找个帮手一起去取${tn}`, scheme: 'ally' };
      if (g.step === 2) {
        if (h === 'cave') return !bold(n) && delveOdds(n) < 0.25 ? grow(w, n, '洞府深处太凶险，得先变强') : { act: 'goal', place: 'cave', why: `下洞府取${tn}`, scheme: 'delve' };
        const holder = h ? being(w, h) : undefined;
        if (!holder?.alive) return null;
        if (n.stones < 300 && !has(n, 'cunning') && power(n) < power(holder) * 0.7) return grow(w, n, `${nm(w, h)}太强，硬抢不得`);
        const scheme = n.stones >= 300 ? 'buy' : has(n, 'cunning') ? 'steal' : 'rob';
        return { act: 'goal', place: holder.place, why: `从${nm(w, h)}手里弄到${tn}`, scheme, target: h };
      }
      return { act: 'goal', place: n.place, why: '处理后事', scheme: g.ally && (has(n, 'cruel') || has(n, 'greedy')) ? 'betray' : 'share', target: g.ally };
    }
    case 'longevity':
      if (g.step === 0) return grow(w, n, '寿元不多了，只能硬冲一把');
      if (g.step === 1) return n.stones >= 200 ? { act: 'goal', place: 'market', why: '去坊市买延寿丹', scheme: 'buy' } : { act: 'goal', place: 'cave', why: '去洞府找延寿的灵药', scheme: 'delve' };
      {
        const h = lifeHolder(w, n);
        return h ? { act: 'goal', place: being(w, h)!.place, why: '顾不得那么多了', scheme: 'rob', target: h } : grow(w, n, '寿元不多了');
      }
    case 'join':
      if (g.step === 0) return { act: 'cultivate', place: n.place, why: '先把根基打牢' };
      return { act: 'goal', place: joinSect(n), why: '上山求入门' };
  }
}

const joinSect = (n: Npc) => (n.mind.values.justice >= 0.5 ? 'qinglan' : 'chixiao');
/** 谁身上有延寿丹（不算自己） */
function lifeHolder(w: World, n: Npc) {
  if (w.me.alive && w.me.items.includes('life')) return ME;
  return npcs(w).find((x) => x.id !== n.id && x.items.includes('life'))?.id;
}

export function finish(w: World, n: Npc, done: 'ok' | 'fail') {
  const g = n.mind.goal;
  if (!g) return;
  g.done = done;
  n.mind.past.push(g);
  n.mind.goal = null;
  n.mind.mood = Math.max(0, Math.min(100, n.mind.mood + (done === 'ok' ? 20 : -15)));
}

export function setGoal(w: World, n: Npc, g: Omit<Goal, 'step' | 'stuck' | 'since'> & { step?: number }) {
  if (n.mind.goal) n.mind.past.push({ ...n.mind.goal, done: 'fail' });
  n.mind.goal = { step: 0, stuck: 0, since: w.year, ...g };
}

const next = (g: Goal) => { g.step++; g.stuck = 0; };
/** 主角是这件事的帮手、而且主角当面跟着去了，这里就不再结算 */
const handled = (w: World, n: Npc) => w.flags[`done:${n.id}`] === w.year;

/** 找个帮手：恨同一个人的、或者跟自己交情深的；主角另算（等主角上门时开口） */
function recruit(w: World, n: Npc, rng: Rng, against?: string) {
  // 城府深的人会编个好听的理由，拉得动交情一般的人
  const sly = has(n, 'cunning') ? 0.2 : 0;
  const cands = npcs(w).filter((x) => x.id !== n.id && x.id !== against && !x.mind.goal?.ally &&
    ((against && aff(x, against) <= -20) || aff(x, n.id) >= (sly ? 25 : 45)) && aff(x, n.id) >= 0);
  if (!cands.length) return null;
  cands.sort((a, b) => aff(b, n.id) - aff(a, n.id));
  const x = cands[0];
  if (!rng.chance(0.35 + sly + aff(x, n.id) / 200)) return null;
  remember(w, x, { k: 'ally', a: n.id, b: x.id, tone: 1 });
  return x.id;
}

/** 年末：按今年做的事推进目标 */
export function advanceGoal(w: World, n: Npc, rng: Rng) {
  const g = n.mind.goal;
  if (!g || !n.alive || handled(w, n)) return;
  g.stuck++;
  const T = g.target ? being(w, g.target) : undefined;
  const tn = targetName(w, g);
  switch (g.kind) {
    case 'revenge': {
      if (!T?.alive) { finish(w, n, 'fail'); return; }
      if (g.step === 0) {
        if (n.mind.knows.includes(`secret:${g.target}`) || rng.chance(0.08)) {
          if (!n.mind.knows.includes(`secret:${g.target}`)) n.mind.knows.push(`secret:${g.target}`);
          next(g);
          news(w, `${n.name}终于查到了，当年的事是${tn}干的。`, 'story', [n.id, g.target!]);
        }
        return;
      }
      if (g.step === 1) {
        if (power(n) >= power(T) * 0.85 || (g.stuck > 10 && has(n, 'rash'))) next(g);
        return;
      }
      if (g.step === 2) {
        if (power(n) >= power(T) * 1.2 || g.stuck >= 3) { next(g); return; }
        const ally = recruit(w, n, rng, g.target);
        if (ally) { g.ally = ally; next(g); }
        return;
      }
      if (g.target === ME) return;
      if (n.place !== T.place) return;
      let helper = g.ally && g.ally !== ME ? w.people[g.ally] : undefined;
      // 帮手临阵倒戈：他和仇人交情更深，或者本就是个阴狠的人
      // 城府深、贪财的帮手，可能被对方收买
      const sellout = (has(helper ?? n, 'cruel') ? 0.3 : 0) + (has(helper ?? n, 'cunning') || has(helper ?? n, 'greedy') ? 0.25 : 0);
      if (helper?.alive && T.id !== ME && (aff(helper, T.id) > aff(helper, n.id) || rng.chance(sellout))) {
        remember(w, n, { k: 'betray', a: helper.id, b: n.id, tone: -3 });
        remember(w, T as Npc, { k: 'save', a: helper.id, b: T.id, tone: 2 });
        news(w, `${helper.name}临阵倒戈，把${n.name}的埋伏告诉了${tn}。`, 'bad', [helper.id, n.id, T.id], true);
        const r0 = fight(w, n, T, rng, { lethal: true, helpB: [helper] });
        if (r0.killed) killed(w, r0.win.id, r0.lose.id, rng);
        if (r0.lose === n && n.alive) { g.step = 1; g.ally = undefined; }
        else if (r0.lose === T && !T.alive) finish(w, n, 'ok');
        return;
      }
      if (!helper?.alive) helper = undefined;
      const r = fight(w, n, T, rng, { lethal: true, ambush: 1.25, helpA: helper ? [helper] : [] });
      if (r.win === n) {
        if (r.killed) {
          news(w, `${n.name}在${placeOf(w, n)}截住${tn}，报了大仇。${tn}陨落。`, 'bad', [n.id, g.target!], true);
          killed(w, n.id, g.target!, rng);
          finish(w, n, 'ok');
        } else {
          news(w, `${n.name}找${tn}寻仇，把${tn}打成重伤，被${tn}逃了。`, 'bad', [n.id, g.target!]);
          remember(w, T as Npc, { k: 'hurt', a: n.id, b: T.id, tone: -2 });
        }
      } else {
        news(w, r.killed ? `${n.name}找${tn}寻仇，反被${tn}所杀。` : `${n.name}找${tn}寻仇，没打过，带伤逃走。`, 'bad', [n.id, g.target!], r.killed);
        if (r.killed) killed(w, g.target!, n.id, rng);
        else { g.step = 1; g.stuck = 0; }
      }
      return;
    }
    case 'throne': {
      const sect = w.sects[g.target as 'qinglan'];
      if (n.sect !== sect.id) { finish(w, n, 'fail'); return; }
      if (sect.master === n.id) { finish(w, n, 'ok'); return; }
      if (g.step === 0) { if (n.merit >= 30) next(g); return; }
      if (g.step === 1) {
        const mates = npcs(w).filter((x) => x.sect === sect.id && x.id !== n.id && x.id !== sect.master);
        for (const x of rng.shuffle(mates).slice(0, 2)) {
          if (n.stones >= 10) { n.stones -= 10; remember(w, x, { k: 'gift', a: n.id, b: x.id, tone: 1 }); }
          else remember(w, x, { k: 'talk_good', a: n.id, b: x.id, tone: 1 });
        }
        if (supporters(w, n) >= 2 || g.stuck >= 4) next(g);
        return;
      }
      if (g.step === 2) {
        const master = sect.master ? w.people[sect.master] : undefined;
        if (!master?.alive) { next(g); return; }
        const scheme = n.plan.scheme;
        if (scheme === 'ambush' && n.place === master.place) {
          const r = fight(w, n, master, rng, { lethal: true, ambush: 1.3 });
          if (r.win === n && r.killed) {
            killed(w, n.id, master.id, rng, false);
            news(w, `${sect.name}宗主${master.name}闭关时遇刺身亡。`, 'bad', [master.id], true);
            next(g);
          } else if (r.win !== n) {
            news(w, `${n.name}行刺${master.name}失手${r.killed ? '，当场毙命' : '，叛出了宗门'}。`, 'bad', [n.id, master.id], true);
            if (!r.killed) { n.sect = ''; finish(w, n, 'fail'); }
          }
        } else if (scheme === 'scandal') {
          const mates = npcs(w).filter((x) => x.sect === sect.id && x.id !== n.id && x.id !== master.id);
          const caught = rng.chance(has(n, 'cunning') ? 0.15 : 0.35);
          if (caught) {
            for (const x of mates) remember(w, x, { k: 'lie', a: n.id, b: master.id, tone: -2 });
            remember(w, master, { k: 'betray', a: n.id, b: master.id, tone: -3 });
            news(w, `有人在${sect.name}里散布宗主的坏话，查到最后是${n.name}。`, 'story', [n.id, master.id]);
            g.step = 1;
          } else {
            for (const x of mates) adjust(x, master.id, { aff: -12, trust: -8 });
            const known = n.mind.knows.includes(`secret:${master.id}`);
            if (known) for (const x of mates) if (!x.mind.knows.includes(`secret:${master.id}`)) x.mind.knows.push(`secret:${master.id}`);
            news(w, `${sect.name}里流言四起：${known ? '宗主当年的旧事被人翻了出来' : '都在说宗主的不是'}。`, 'story', [master.id]);
            if (deposable(w, sect.id)) depose(w, sect.id);
          }
        }
        return;
      }
      // 继位由宗门的选拔来定（见 year.ts），这里只看结果
      if (g.stuck >= 3) finish(w, n, 'fail');
      return;
    }
    case 'seekmaster': {
      if (g.step === 0) {
        const hua = w.people.hua;
        if (n.place === 'village' && hua?.alive && hua.place === 'village' && aff(hua, n.id) >= 20) {
          n.mind.knows.push('clue');
          news(w, `花婆婆给${n.name}讲了一段三十年前的旧事。`, 'story', [n.id, 'hua']);
          next(g);
        } else if (rng.chance(0.15)) { n.mind.knows.push('clue'); next(g); }
        return;
      }
      if (g.step === 1) {
        if (n.items.includes('letter') || n.mind.knows.includes('secret:wen')) { next(g); return; }
        if (n.place !== 'cave') return;
        const r = delve(w, n, rng, 'letter');
        if (r === 'found') {
          n.mind.knows.push('secret:wen');
          news(w, `${n.name}在玄冥洞府深处找到了师父的遗骨和一封遗书。`, 'story', [n.id], true);
          next(g);
        }
        return;
      }
      // 真相大白：师父是被宗主害的
      finish(w, n, 'ok');
      const wen = w.people.wen;
      if (wen?.alive) {
        adjust(n, 'wen', { aff: -120, trust: -80 });
        setGoal(w, n, { kind: 'revenge', target: 'wen', secret: false, step: 1 });
        for (const x of npcs(w)) if (x.sect === 'qinglan' && x.id !== 'wen' && aff(x, n.id) >= 20 && !x.mind.knows.includes('secret:wen')) x.mind.knows.push('secret:wen');
        news(w, `${n.name}当众说出了三十年前的真相：师父是被温玄害死的。`, 'bad', [n.id, 'wen'], true);
      }
      return;
    }
    case 'love': {
      if (!T?.alive) { finish(w, n, 'fail'); n.mind.mood = Math.max(0, n.mind.mood - 20); return; }
      if (T.partner && T.partner !== n.id) {
        finish(w, n, 'fail');
        if (T.partner !== ME) adjust(n, T.partner, { aff: has(n, 'grudge') ? -40 : -15 });
        return;
      }
      if (g.target === ME) return;
      const t = T as Npc;
      if (n.place !== t.place) return;
      if (g.step === 0) {
        remember(w, t, { k: 'talk_good', a: n.id, b: t.id, tone: 1 });
        if (aff(t, n.id) >= 25) next(g);
      } else if (g.step === 1) {
        if (n.stones >= 15) { n.stones -= 15; t.stones += 15; }
        remember(w, t, { k: 'gift', a: n.id, b: t.id, tone: 1 });
        if (aff(t, n.id) >= 45) next(g);
      } else {
        const free = !t.partner && (!t.mind.goal || t.mind.goal.kind !== 'love' || t.mind.goal.target === n.id);
        if (free && aff(t, n.id) >= 55) {
          n.partner = t.id; t.partner = n.id;
          remember(w, t, { k: 'partner', a: n.id, b: t.id, tone: 3 });
          remember(w, n, { k: 'partner', a: t.id, b: n.id, tone: 3 });
          if (t.mind.goal?.kind === 'love') finish(w, t, 'ok');
          news(w, `${n.name}与${t.name}结为道侣。`, 'good', [n.id, t.id], true);
          finish(w, n, 'ok');
        } else {
          remember(w, n, { k: 'reject', a: t.id, b: n.id, tone: -2 });
          news(w, `${n.name}向${t.name}表白，被婉拒了。`, 'story', [n.id, t.id]);
          if (has(n, 'devoted') && g.stuck < 6) g.step = 1;
          else finish(w, n, 'fail');
        }
      }
      return;
    }
    case 'treasure': {
      const item = g.target!;
      const h = holderOf(w, item);
      if (h === n.id && g.step < 3) { g.step = 3; return; }
      if (!h || h === 'gone') { finish(w, n, 'fail'); return; }
      if (g.step === 0) { if (rng.chance(0.4)) next(g); return; }
      if (g.step === 1) {
        if (power(n) >= GUARDIAN * (has(n, 'careful') || has(n, 'cunning') ? 1.2 : 0.8) || g.stuck >= 4) { next(g); return; }
        const ally = recruit(w, n, rng);
        if (ally) { g.ally = ally; next(g); }
        return;
      }
      if (g.step === 2) {
        if (h === 'cave') {
          if (n.place !== 'cave') return;
          const helper = g.ally && g.ally !== ME ? w.people[g.ally] : undefined;
          if (delve(w, n, rng, item, helper?.alive && helper.place === 'cave' ? helper : undefined) === 'found') {
            news(w, `${n.name}从玄冥洞府深处带出了${tn}。`, 'story', [n.id], true);
            next(g);
          }
          return;
        }
        const holder = being(w, h);
        if (!holder?.alive || holder.place !== n.place) return;
        const scheme = n.plan.scheme;
        if (scheme === 'buy' && n.stones >= 300 && h !== ME && (has(holder as Npc, 'greedy') || rng.chance(0.3))) {
          n.stones -= 300; holder.stones += 300;
          moveTreasure(w, item, holder.id, n.id);
          news(w, `${n.name}花三百灵石从${holder.name}手里买下了${tn}。`, 'info', [n.id, holder.id]);
          next(g);
        } else if (scheme === 'steal' && h !== ME && rng.chance(0.3)) {
          moveTreasure(w, item, holder.id, n.id);
          news(w, `${holder.name}的${tn}不翼而飞。`, 'story', [holder.id]);
          next(g);
        } else if (h !== ME) {
          const r = fight(w, n, holder, rng, { lethal: has(n, 'cruel') });
          if (r.win === n) {
            moveTreasure(w, item, holder.id, n.id);
            remember(w, holder as Npc, { k: 'rob', a: n.id, b: holder.id, tone: -3 });
            witness(w, n.place, { k: 'rob', a: n.id, b: holder.id, tone: -2 });
            news(w, `${n.name}从${holder.name}手里抢走了${tn}${r.killed ? `，${holder.name}当场陨落` : ''}。`, 'bad', [n.id, holder.id], true);
            if (r.killed) killed(w, n.id, holder.id, rng);
            next(g);
          } else {
            news(w, `${n.name}想抢${holder.name}的${tn}，没抢到。`, 'bad', [n.id, holder.id]);
            remember(w, holder as Npc, { k: 'hurt', a: n.id, b: holder.id, tone: -2 });
            // 抢了两回都不成，谨慎的人知难而退
            if (g.stuck >= 2 && (has(n, 'careful') || has(n, 'cunning') || power(n) < power(holder) * 0.8)) finish(w, n, 'fail');
          }
        }
        return;
      }
      // 善后：阴狠贪财的人，得手后对帮手翻脸
      const ally = g.ally && g.ally !== ME ? w.people[g.ally] : undefined;
      if (ally?.alive && n.plan.scheme === 'betray') {
        remember(w, ally, { k: 'betray', a: n.id, b: ally.id, tone: -3 });
        news(w, `${n.name}得手后独吞了${tn}，把同伴${ally.name}甩下了。`, 'bad', [n.id, ally.id]);
      } else if (ally?.alive) {
        const share = Math.min(n.stones, 40);
        n.stones -= share; ally.stones += share;
        remember(w, ally, { k: 'help', a: n.id, b: ally.id, tone: 2 });
      }
      if (g.ally !== ME) finish(w, n, 'ok');
      return;
    }
    case 'longevity': {
      if (lifeLeft(n) >= 40) { finish(w, n, 'ok'); return; }
      if (g.step === 0) { if (lifeLeft(n) < 12 && !canBreak(n)) next(g); return; }
      if (g.step === 1) {
        if (n.items.includes('life')) { useLife(w, n); finish(w, n, 'ok'); return; }
        if (n.place === 'market' && n.stones >= 200 && (w.flags.lifeStock as number) > 0) {
          n.stones -= 200; w.flags.lifeStock = (w.flags.lifeStock as number) - 1;
          useLife(w, n); finish(w, n, 'ok');
          news(w, `${n.name}在云渡坊买下了一颗延寿丹。`, 'info', [n.id]);
          return;
        }
        if (n.place === 'cave' && rng.chance(0.15)) { useLife(w, n); finish(w, n, 'ok'); news(w, `${n.name}在洞府里找到一株延寿灵药。`, 'story', [n.id]); return; }
        if (g.stuck >= 2 && (has(n, 'cruel') || has(n, 'cunning') || lifeLeft(n) < 5)) next(g);
        return;
      }
      const h = n.plan.target;
      const holder = h ? being(w, h) : undefined;
      if (!holder?.alive || h === ME || holder.place !== n.place) return;
      const r = fight(w, n, holder, rng, { lethal: true });
      if (r.win === n && takeItem(holder, 'life')) {
        useLife(w, n);
        remember(w, holder as Npc, { k: 'rob', a: n.id, b: holder.id, tone: -3 });
        news(w, `${n.name}为了一颗延寿丹，对${holder.name}下了狠手${r.killed ? `，${holder.name}陨落` : ''}。`, 'bad', [n.id, holder.id], true);
        if (r.killed) killed(w, n.id, holder.id, rng);
        finish(w, n, 'ok');
      }
      return;
    }
    case 'join': {
      if (g.step === 0) { if (n.stage >= 1 || n.realm > 0) next(g); return; }
      const sect = joinSect(n);
      if (n.place !== sect) return;
      const master = w.people[w.sects[sect].master];
      const p = 0.35 + n.talent * 0.15 + (master && aff(master, n.id) >= 20 ? 0.25 : 0) + (w.flags[`rec:${n.id}`] === sect ? 0.3 : 0);
      if (rng.chance(p)) {
        n.sect = sect;
        news(w, `${n.name}拜入了${SECT_NAME[sect]}。`, 'good', [n.id]);
        finish(w, n, 'ok');
      } else if (g.stuck >= 3) {
        n.mind.values.justice = 1 - n.mind.values.justice;
        g.stuck = 0;
      }
      return;
    }
  }
}

const placeOf = (w: World, n: Npc) => ({ qinglan: '青岚宗', chixiao: '赤霄门', market: '云渡坊', vein: '听泉谷', cave: '玄冥洞府', forest: '黑松林', village: '柳溪村' })[n.place];

export function useLife(w: World, n: Npc | World['me']) {
  takeItem(n, 'life');
  n.bonus += 30;
}

export function moveTreasure(w: World, item: string, from: string, to: string) {
  const a = being(w, from);
  if (a) takeItem(a, item);
  const b = being(w, to);
  if (b) giveItem(b, item);
  w.treasure[item] = to;
}

const bold = (n: Npc) => has(n, 'rash') || has(n, 'bold');
/** 下洞府深处能成的把握 */
export function delveOdds(n: Npc | World['me'], helper?: Npc) {
  const pa = power(n) + (helper ? power(helper) * 0.7 : 0);
  return pa * pa / (pa * pa + GUARDIAN * GUARDIAN);
}

/** 下洞府深处：和守护的东西打一场，赢了拿到宝物；会受伤，也可能死在里面 */
export function delve(w: World, n: Npc | World['me'], rng: Rng, item: string, helper?: Npc) {
  if (w.treasure[item] !== 'cave') return 'none';
  const p = delveOdds(n, helper);
  if (rng.chance(p)) {
    moveTreasure(w, item, 'cave', n.id);
    n.hp = Math.max(5, n.hp - 20);
    return 'found';
  }
  n.hp -= Math.round(15 + 30 * (1 - p));
  if (n.hp <= 0) {
    n.alive = false;
    n.hp = 0;
    n.died = { y: w.year, note: '陨落于玄冥洞府' };
    if (n.id !== ME) news(w, `${n.name}陨落于玄冥洞府。`, 'bad', [n.id], true);
    for (const it of n.items.filter((i) => w.treasure[i] === n.id)) w.treasure[it] = 'cave';
    return 'died';
  }
  return 'hurt';
}

/** 宗门里支持他的人 */
export const supporters = (w: World, n: Npc) => npcs(w).filter((x) => x.sect === n.sect && x.id !== n.id && aff(x, n.id) >= 30).length;

/** 宗门里多数人对宗主寒了心 */
export function deposable(w: World, sect: 'qinglan' | 'chixiao') {
  const m = w.sects[sect].master;
  const mates = npcs(w).filter((x) => x.sect === sect && x.id !== m);
  return mates.length >= 2 && mates.filter((x) => aff(x, m) < 0).length > mates.length / 2;
}
export function depose(w: World, sect: 'qinglan' | 'chixiao') {
  const m = w.people[w.sects[sect].master];
  w.sects[sect].master = '';
  if (m?.alive) {
    m.sect = '';
    news(w, `${SECT_NAME[sect]}众弟子逼宫，${m.name}被废去宗主之位，离开了山门。`, 'bad', [m.id], true);
  }
}

/**
 * 有人被杀之后：杀人的人背上一笔账。死者的道侣、师徒、至交会记下这笔仇，
 * 没有更要紧的事的，就会立誓报仇。
 */
export function killed(w: World, killer: string, victim: string, rng: Rng, witnessed = true) {
  const v = being(w, victim);
  for (const it of [...(v?.items ?? [])]) if (w.treasure[it] === victim) moveTreasure(w, it, victim, killer);
  const at = being(w, killer)?.place;
  for (const x of npcs(w)) {
    if (x.id === killer) continue;
    const close = x.partner === victim || x.master === victim || w.people[victim]?.master === x.id || aff(x, victim) >= 50;
    if (witnessed && x.place === at) remember(w, x, { k: 'kill', a: killer, b: victim, tone: -3, at });
    else if (close) remember(w, x, { k: 'kill', a: killer, b: victim, tone: -3, from: 'rumor' });
    if (close) {
      if (!x.mind.knows.includes(`secret:${killer}`)) x.mind.knows.push(`secret:${killer}`);
      const busy = x.mind.goal && ['revenge', 'longevity', 'throne'].includes(x.mind.goal.kind);
      if (!busy && (has(x, 'grudge') || has(x, 'loyal') || has(x, 'devoted') || rng.chance(0.5))) {
        setGoal(w, x, { kind: 'revenge', target: killer, secret: has(x, 'careful') || has(x, 'cunning'), step: 1, cover: '闭门苦修' });
        if (killer !== ME || x.place === w.me.place) news(w, `${x.name}立誓要为${nm(w, victim)}报仇。`, 'story', [x.id, killer]);
      }
    }
  }
}
