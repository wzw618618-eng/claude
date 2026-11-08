// 无头平衡模拟：机器人宗主批量玩十年，看存活、修为、弟子走的路是否多样。
//   npm run sim -- [局数] [smart|random]

import { lvl, power, REALM_NAME } from '../src/game/cult';
import { HALLS, POLICIES, TECHS } from '../src/game/data/world';
import { resolveDecision } from '../src/game/decisions';
import { acceptChance, admit, dismiss, testRoot } from '../src/game/recruit';
import { diplomacy } from '../src/game/rivals';
import { advanceSeason, canLearn, choosePolicy, holdTourney, learnTech, planSeason } from '../src/game/season';
import { assignJob, fit, hallCap, hallHead, hallMembers, setHead, setRank } from '../src/game/sect';
import { newWorld, randomStart } from '../src/game/setup';
import type { HallId, World } from '../src/game/types';
import { endWar, fightRound, healTeam } from '../src/game/war';
import { members, rngOf, year } from '../src/game/world';

const N = Number(process.argv[2] ?? 200);
const MODE = (process.argv[3] ?? 'smart') as 'smart' | 'random';

function smartManage(w: World) {
  const r = rngOf(w);
  // 招人：测灵根，资质好的收
  for (const c of [...w.candidates]) {
    testRoot(w, c);
    const p = w.people[c.id];
    const spyish = c.rumor.includes('见过他');
    if (spyish || p.root.apt < 0.9 || members(w).length >= 24) { dismiss(w, c); continue; }
    const rank = c.via === 'genius' || p.root.apt >= 1.8 ? 'inner' : 'outer';
    if (acceptChance(w, c, rank) > 0.3) admit(w, r, c, rank);
  }
  // 安排岗位：每个殿堂挑最合适的人
  const order: HallId[] = ['herb', 'alchemy', 'guard', 'teach', 'diplomacy', 'law', 'recruit', 'forge'];
  const free = () => members(w).filter((p) => p.job === 'none');
  for (const h of order) {
    while (hallMembers(w, h).length < Math.min(hallCap(w, h), 2) && free().length) {
      const best = free().sort((a, b) => fit(b, h) - fit(a, h))[0];
      assignJob(w, best, h);
    }
    if (!hallHead(w, h)) {
      const cand = hallMembers(w, h).sort((a, b) => lvl(b) * 3 + fit(b, h) * 10 - (lvl(a) * 3 + fit(a, h) * 10))[0];
      if (cand) setHead(w, h, cand);
    }
  }
  for (const p of free()) assignJob(w, p, 'seclude');
  // 修为够了就升
  for (const p of members(w)) {
    if (p.rank === 'outer' && lvl(p) >= 6) setRank(w, p, 'inner');
    if (p.rank === 'inner' && lvl(p) >= 9) setRank(w, p, 'core');
  }
  // 年初
  if (w.needPolicy) {
    const angry = w.rivals.some((rv) => rv.alive && !rv.passive && rv.attitude < -30);
    choosePolicy(w, angry ? (r.chance(0.5) ? 'ally' : 'array') : w.t < 8 ? 'pill' : r.pick(POLICIES).id);
  }
  if (w.needTech) {
    const pref = ['technique_2', 'guard_array', 'pill_hall', 'foundation_recipe', 'rules', 'sword_array', 'arena', 'market_shop', 'technique_3', 'caravan', 'scouting', 'heart_array'];
    const id = pref.find((t) => canLearn(w, t));
    if (id) learnTech(w, id);
  }
  holdTourney(w);
  // 升级殿堂
  for (const h of ['herb', 'alchemy', 'guard'] as HallId[]) if (w.sect.stones > 500 && w.sect.halls[h] < 2) { w.sect.stones -= [80, 200, 450][w.sect.halls[h]]; w.sect.halls[h]++; }
  // 和气的宗门送礼
  for (const rv of w.rivals) if (rv.alive && !rv.passive && rv.status !== 'war' && rv.attitude < -25 && w.sect.stones >= 120) diplomacy(w, rv, 'gift');
  // 裁决
  for (const d of [...w.decisions]) {
    const pref = ['pill', 'treasure', 'go', 'yes', 'swap', 'punish', 'keep', 'raise', 'coopt', 'allow', 'help', 'slay', 'sell', 'fix', 'elite', 'fight', 'mediate', 'expel'];
    const o = d.options.find((x) => pref.includes(x.id))?.id ?? d.fallback;
    resolveDecision(w, r, d.id, o);
  }
  r.save();
}

function randomManage(w: World) {
  const r = rngOf(w);
  for (const c of [...w.candidates]) if (r.chance(0.5)) admit(w, r, c, 'outer'); else dismiss(w, c);
  for (const p of members(w)) if (p.job === 'none' || r.chance(0.2)) assignJob(w, p, r.pick(HALLS).id);
  for (const h of HALLS) if (!hallHead(w, h.id) && r.chance(0.5)) { const c = r.pick(members(w)); if (c) setHead(w, h.id, c); }
  if (w.needPolicy) choosePolicy(w, r.pick(POLICIES).id);
  if (w.needTech) { const t = TECHS.filter((x) => canLearn(w, x.id)); if (t.length) learnTech(w, r.pick(t).id); }
  for (const d of [...w.decisions]) resolveDecision(w, r, d.id, r.pick(d.options).id);
  r.save();
}

function playWar(w: World) {
  const r = rngOf(w);
  const war = w.war!;
  war.phase = 'round';
  while (war.round < 3) {
    const lowHp = war.team.some((id) => (w.people[id]?.hp ?? 100) < 40);
    if (lowHp && w.sect.pills >= 5) healTeam(w);
    fightRound(w, r, MODE === 'smart' && w.people[w.me].hp > 50);
    if (war.wins >= 2 || war.losses >= 2) break;
  }
  if (process.env.WARLOG) console.log(war.log.map((l) => l.text).join('\n'));
  const res = endWar(w, r);
  if (res.wiped) w.over = { win: false, text: res.text };
  w.war = null;
  r.save();
  return res;
}

const stats = { survived: 0, wiped: 0, members: 0, found: 0, core: 0, wars: 0, warWins: 0, defect: 0, deaths: 0, credited: 0, fulfilled: 0, acts: new Map<string, number>(), uniqueActsPerPerson: 0, persons: 0, stones: 0, years: 0 };
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const w = newWorld({ ...randomStart(1000 + g), endYear: 10 });
  let guard = 0;
  const actsBy = new Map<string, Set<string>>();
  while (!w.over && guard++ < 60) {
    if (MODE === 'smart') smartManage(w); else randomManage(w);
    if (w.war) {
      stats.wars++;
      const res = playWar(w);
      if (res.win) stats.warWins++;
      if (w.over) break;
    }
    const plan = planSeason(w, 'off');
    const before = new Set(w.members);
    const sum = advanceSeason(w, plan, {}, {});
    for (const p of members(w)) {
      if (!p.lastAct) continue;
      stats.acts.set(p.lastAct, (stats.acts.get(p.lastAct) ?? 0) + 1);
      if (!actsBy.has(p.id)) actsBy.set(p.id, new Set());
      actsBy.get(p.id)!.add(p.lastAct);
    }
    stats.fulfilled += sum.wishNews.length;
    stats.credited += sum.wishNews.filter((x) => x.credit).length;
    stats.deaths += sum.deaths.length;
    for (const id of before) if (!w.members.includes(id) && w.people[id].alive && w.people[id].sect && w.people[id].sect !== 'me') stats.defect++;
  }
  if (w.over?.win) stats.survived++; else stats.wiped++;
  const ms = members(w);
  stats.members += ms.length;
  stats.found += ms.filter((p) => p.realm >= 1).length;
  stats.core += ms.filter((p) => p.rank === 'core' || p.rank === 'chief').length;
  stats.stones += w.sect.stones;
  stats.years += year(w.t) - 1;
  for (const s of actsBy.values()) { stats.uniqueActsPerPerson += s.size; stats.persons++; }
  if (g === 0) {
    console.log(`第一局：${w.over?.text}`);
    for (const p of ms.slice(0, 6)) console.log(`  ${p.name} ${REALM_NAME[p.realm]} 战力${power(p)} 经历${p.life.length}条：${p.life.slice(-3).map((l) => l.text).join(' / ')}`);
  }
}
const avg = (x: number) => (x / N).toFixed(1);
console.log(`\n${MODE} × ${N} 局（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(`撑满十年 ${(stats.survived / N * 100).toFixed(0)}%，灭门/散伙 ${(stats.wiped / N * 100).toFixed(0)}%，平均坚持 ${avg(stats.years)} 年`);
console.log(`结束时弟子 ${avg(stats.members)} 人，筑基以上 ${avg(stats.found)} 人，真传/首席 ${avg(stats.core)} 人，灵石 ${avg(stats.stones)}`);
console.log(`宗门战 ${avg(stats.wars)} 场/局，胜率 ${stats.wars ? (stats.warWins / stats.wars * 100).toFixed(0) : 0}%；叛逃 ${avg(stats.defect)} 人/局；坐化 ${avg(stats.deaths)} 人/局`);
console.log(`心愿得偿 ${avg(stats.fulfilled)} 次/局，其中记在宗主头上 ${avg(stats.credited)} 次`);
console.log(`每人十年里做过 ${(stats.uniqueActsPerPerson / Math.max(1, stats.persons)).toFixed(1)} 种不同的事`);
console.log('各种做法的次数：', [...stats.acts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
