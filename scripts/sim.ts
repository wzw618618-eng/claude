// 无头模拟：用简单的策略连玩几百局，看平衡性（存活率、死亡时间、各结局占比、事件触发频率）。
// 用法：npm run sim

import { CharState, GameState, TaskId } from '../tiangong/assets/hanyi/core/types';
import { act, def, heatNeed, eats, ended } from '../tiangong/assets/hanyi/core/world';

declare const process: { argv: string[] };
import { makeRng } from '../tiangong/assets/hanyi/core/rng';
import { BUILD_ORDER, BUILDINGS } from '../tiangong/assets/hanyi/data/rules';
import { choose, endDay, endNight, newGame, setTask, startProject, toNight } from '../tiangong/assets/hanyi/game';
import { currentEvent } from '../tiangong/assets/hanyi/systems/story';
import { applyTalk, canTalk, knownTaste, satWith, scriptedReply, seats, sitWith, Topic, TOPICS } from '../tiangong/assets/hanyi/ai/dialogue';
import { adoptAll, openChat } from '../tiangong/assets/hanyi/ai/intent';
import { scoreRun } from '../tiangong/assets/hanyi/meta';
import { blocked, careScore, cookScore, huntOut, woodOut, scavOut } from '../tiangong/assets/hanyi/systems/work';

type Policy = 'smart' | 'random' | 'idle' | 'listen';

function plan(s: GameState, policy: Policy, r: ReturnType<typeof makeRng>) {
  const A = act(s);
  if (policy === 'idle') { for (const c of A) setTask(s, c.id, 'rest'); return; }
  if (policy === 'random') {
    const all: TaskId[] = ['wood', 'hunt', 'scavenge', 'explore', 'build', 'cook', 'care', 'comfort', 'guard', 'rest'];
    for (const c of A) {
      const ok = all.filter((t) => !blocked(s, c, t));
      setTask(s, c.id, r.pick(ok));
    }
    return;
  }
  if (policy === 'listen') {
    if (!s.project) for (const id of BUILD_ORDER) { const b = BUILDINGS[id]; if (s.built.includes(id) || (b.needFlag && !s.flags[b.needFlag])) continue; if (startProject(s, id) === null) break; }
    adoptAll(s);
    return;
  }
  // smart
  if (!s.project) {
    for (const id of BUILD_ORDER) {
      const b = BUILDINGS[id];
      if (s.built.includes(id)) continue;
      if (b.needFlag && !s.flags[b.needFlag]) continue;
      if (startProject(s, id) === null) break;
    }
  }
  const free = new Set(A.filter((c) => !blocked(s, c, 'wood') || !blocked(s, c, 'cook')).map((c) => c.id));
  for (const c of A) { if (blocked(s, c, 'cook')) setTask(s, c.id, 'rest'); }
  const take = (t: TaskId, score: (c: any) => number, n = 1) => {
    const cs = A.filter((c) => free.has(c.id) && !blocked(s, c, t) && c.stamina >= 25).sort((a, b) => score(b) - score(a)).slice(0, n);
    for (const c of cs) { setTask(s, c.id, t); free.delete(c.id); }
    return cs.length;
  };
  const foodNeed = A.reduce((n, c) => n + eats(c), 0);
  const hn = heatNeed(s);
  const td = s.today;
  if (td?.id === 'fever' && free.has(td.actors[0])) { setTask(s, td.actors[0], 'rest'); free.delete(td.actors[0]); }
  if (td?.id === 'wolves') take('guard', (c) => c.skills.str);
  if (td?.id === 'deer') take('hunt', (c) => huntOut(s, c), 2);
  if (td?.id === 'pines') take('wood', (c) => woodOut(s, c), 2);
  if (td?.id === 'wreck') take('scavenge', (c) => scavOut(s, c), 2);
  if (A.some((c) => c.sick || c.injured || c.health < 60)) take('care', (c) => careScore(s, c));
  if (s.res.wood < hn * 3) take('wood', (c) => woodOut(s, c), s.res.wood < hn ? 2 : 1);
  if (s.res.food < foodNeed * 4) take('hunt', (c) => huntOut(s, c), s.res.food < foodNeed * 2 ? 2 : 1);
  if (A.length >= 4) take('cook', (c) => cookScore(s, c));
  if (s.day >= 2 && s.day <= 10) take('explore', (c) => c.skills.wild + c.stamina / 50);
  if (s.project) take('build', (c) => c.skills.craft);
  if (s.day >= 4 && A.length >= 5) take('guard', (c) => c.skills.str);
  if (A.some((c) => c.mood < 30)) take('comfort', (c) => c.skills.talk);
  take('scavenge', (c) => scavOut(s, c));
  if (s.res.wood < hn * 5) take('wood', (c) => woodOut(s, c));
  take('hunt', (c) => huntOut(s, c), 9);
  for (const id of free) setTask(s, id, 'rest');
  if (td?.id === 'feud') {
    const [a, b] = td.actors.map((id) => A.find((c) => c.id === id));
    if (a && b && a.task === b.task && a.task !== 'rest') setTask(s, b.id, b.task === 'wood' ? 'hunt' : 'wood');
  }
}

/** 夜里：聪明的玩家先去找有话想说的人，再找快说出心事或者心情最差的人；记得谁吃哪一套 */
function nightTalk(s: GameState, policy: Policy, r: ReturnType<typeof makeRng>) {
  for (let k = 0; k < seats(s); k++) {
    const A = act(s).filter((c) => canTalk(s, c.id) && !satWith(s).includes(c.id));
    if (!A.length) return;
    let c: CharState;
    if (policy === 'random') c = r.pick(A);
    else {
      const score = (x: CharState) => {
        const w = s.wants?.[x.id];
        const near = !s.flags[`heard_${x.id}`] ? Math.max(0, 20 - Math.abs(def(x.id).secretTrust - x.trust)) : 0;
        return (w && !w.done ? 100 : 0) + near + (x.mood < 30 ? 30 - x.mood : 0) + r.next();
      };
      c = A.sort((a, b) => score(b) - score(a))[0];
    }
    openChat(s, c.id);
    sitWith(s, c.id);
    while (canTalk(s, c.id)) {
      let t: Topic;
      if (policy === 'random') t = r.pick(TOPICS).id;
      else if (!s.flags[`heard_${c.id}`] && c.trust >= def(c.id).secretTrust) t = 'past';
      else {
        const liked = TOPICS.filter((x) => knownTaste(s, c.id, x.id) === 'like' && x.id !== 'past');
        const fresh = TOPICS.filter((x) => !knownTaste(s, c.id, x.id) && x.id !== 'past');
        t = liked.length && (!fresh.length || r.chance(0.7)) ? r.pick(liked).id : fresh.length ? r.pick(fresh).id : 'sit';
      }
      applyTalk(s, c.id, scriptedReply(s, c.id, t, r), { topic: t });
    }
  }
}

function play(seed: number, policy: Policy, winter = 1, perk = '') {
  const s = newGame(seed, { winter, perk });
  const r = makeRng(seed ^ 0x9e3779b9);
  const fired: string[] = [];
  let guard = 0;
  let minH = 100;
  while (!ended(s) && guard++ < 400) {
    while (s.pending.length && !ended(s)) {
      const cur = currentEvent(s)!;
      fired.push(cur.ev.id);
      const ok = cur.choices.map((c, i) => [c, i] as const).filter(([c]) => !c.disabled);
      choose(s, policy === 'smart' ? r.pick(ok)[1] : ok[0][1]);
    }
    if (ended(s)) break;
    if (s.phase === 'day') { plan(s, policy, r); endDay(s); for (const c of act(s)) minH = Math.min(minH, c.health); }
    else if (s.phase === 'evening') toNight(s);
    else if (s.phase === 'night') {
      if (policy !== 'idle') nightTalk(s, policy, r);
      endNight(s);
    }
  }
  return { s, fired, minH };
}

function run(policy: Policy, n: number, winter = 1, perk = '') {
  const grades: Record<string, number> = {};
  let scoreSum = 0;
  let alive = 0, total = 0, wiped = 0, firstDeath = 0, deaths = 0, recruited = 0, gamesWithDeath = 0;
  const by: Record<string, number> = {};
  const ev: Record<string, number> = {};
  const arcs: Record<string, number> = {};
  const deadWho: Record<string, number> = {};
  let endDaySum = 0;
  const mins: number[] = [];
  for (let i = 0; i < n; i++) {
    const { s, fired, minH } = play(1000 + i, policy, winter, perk);
    const sc = scoreRun(s);
    scoreSum += sc.total;
    grades[sc.grade] = (grades[sc.grade] ?? 0) + 1;
    mins.push(minH);
    const present = s.chars.filter((c) => c.status === 'active' || s.flags[`back_${c.id}`]).length;
    alive += present; total += s.chars.length;
    recruited += s.chars.length - 5;
    if (s.ending?.kind === 'wiped') wiped++;
    endDaySum += s.ending?.day ?? s.day;
    by[s.rescueBy] = (by[s.rescueBy] ?? 0) + 1;
    const d = s.chars.filter((c) => c.status === 'dead');
    for (const c of d) deadWho[c.id] = (deadWho[c.id] ?? 0) + 1;
    deaths += d.length;
    if (d.length) { gamesWithDeath++; firstDeath += Math.min(...d.map((c) => c.endDay ?? 99)); }
    for (const id of new Set(fired)) ev[id] = (ev[id] ?? 0) + 1;
    for (const k of Object.keys(s.flags)) if (k.startsWith('arc_') && s.flags[k]) arcs[k] = (arcs[k] ?? 0) + 1;
  }
  const f = (x: number) => (x / n).toFixed(2);
  console.log(`\n== 策略 ${policy}，${n} 局，寒冬 ${winter}${perk ? '，行囊 ' + perk : ''} ==`);
  console.log(`平均得分 ${f(scoreSum)}　评级`, grades);
  console.log(`团灭 ${(wiped / n * 100).toFixed(0)}%　平均结束于第 ${f(endDaySum)} 天　存活 ${alive}/${total}（${(alive / total * 100).toFixed(0)}%）　平均死亡 ${f(deaths)} 人　平均招募 ${f(recruited)} 人`);
  console.log(`有人死亡的局 ${(gamesWithDeath / n * 100).toFixed(0)}%，首个死亡平均第 ${gamesWithDeath ? (firstDeath / gamesWithDeath).toFixed(1) : '-'} 天`);
  mins.sort((a, b) => a - b);
  console.log(`最低健康 分位数 p10=${mins[Math.floor(n * 0.1)]} p50=${mins[Math.floor(n * 0.5)]} p90=${mins[Math.floor(n * 0.9)]}`);
  console.log('救援方式', by);
  console.log('死亡次数', deadWho);
  console.log('心结', arcs);
  console.log('事件出现局数', Object.fromEntries(Object.entries(ev).sort((a, b) => b[1] - a[1])));
}

const n = Number(process.argv[2] ?? 300);
export function trace(seed: number) {
  const s = newGame(seed);
  const r = makeRng(seed ^ 0x9e3779b9);
  let g = 0;
  while (!ended(s) && g++ < 400) {
    while (s.pending.length && !ended(s)) {
      const cur = currentEvent(s)!;
      const ok = cur.choices.map((c, i) => [c, i] as const).filter(([c]) => !c.disabled);
      choose(s, r.pick(ok)[1]);
    }
    if (ended(s)) break;
    if (s.phase === 'day') {
      plan(s, 'smart', r);
      const A = act(s);
      console.log(`D${s.day} ${s.temp}℃ ${s.weather.kind} 粮${s.res.food} 柴${s.res.wood} 料${s.res.mat} 药${s.res.med} 建${s.built.join(',')}${s.project ? '+' + s.project.id : ''} | ` +
        A.map((c) => `${c.id}:${c.task} h${c.health} s${c.stamina} m${c.mood} t${c.trust}`).join(' '));
      endDay(s);
    } else if (s.phase === 'evening') toNight(s);
    else if (s.phase === 'night') endNight(s);
  }
  console.log('END', s.ending, s.rescueBy, s.chars.map((c) => c.id + ':' + c.status).join(' '));
}

if (process.argv[3] === "trace") { trace(n); } else if (process.argv[3] === "winters") {
  for (const w of [1, 2, 3, 4, 5]) run('smart', n, w);
  run('smart', n, 3, 'gun');
} else {
run('smart', n);
run('listen', n);
run('random', Math.min(n, 200));
run('idle', 50);
}
