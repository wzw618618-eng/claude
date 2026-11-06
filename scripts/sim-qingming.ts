// 《青冥录》无头模拟：自动玩几百个世界，看世界是不是「活的」，也看节奏和平衡。
// 用法：npm run sim:qm [-- 局数]              随手玩的玩家，只走规则
//       npm run sim:qm -- 200 ai               和主角相识以上的人由一个「乱选合法选项」的假 AI 定打算，看世界会不会被 AI 搞乱
//       npm run sim:qm -- 300 optimal          一个精打细算的玩家（找最快的地方修炼、买丹药、按时冲关）
//       npm run sim:qm -- 300 optimal mixed    只玩某一种灵根（heaven / dual / mixed）
//       npm run sim:qm -- 5003 story           看一个世界前 60 年的江湖传闻

import { makeRng } from '../qingming/assets/game/core/rng';
import type { News, RootId, World } from '../qingming/assets/game/core/types';
import { lifeGain, lifeLeft, npcs, newWorld } from '../qingming/assets/game/core/world';
import { canBreak, yearExp } from '../qingming/assets/game/systems/body';
import { buy, choose, doMain, endTurn, mainActs, moveTo, social, useItem, viewEncounter } from '../qingming/assets/game/player';
import { applyDecision, whoDecides, yearChoices } from '../qingming/assets/game/ai/decide';
import { PLACE_ORDER } from '../qingming/assets/game/data/world-data';

declare const process: { argv: string[] };
type R = ReturnType<typeof makeRng>;

/** 假 AI：年初，身边相识以上的人、远处刻骨的人从合法选项里随便挑一件 */
function fakeAI(w: World, r: R) {
  for (const n of whoDecides(w, null)) {
    const c = r.pick(yearChoices(w, n));
    applyDecision(w, n, { ...c.want, by: 'ai' });
  }
}

/** 这一局的记录（w.news 只留最近 300 条，长局会丢掉前面的年份，所以自己记） */
interface Log { news: News[]; reach: Record<number, number>; calls: number; emptyCalls: number; callsBy: Record<string, number>; confess: number; events: number; lateYears: number; lateBusy: number; lateActs: Record<string, number> }
const newLog = (): Log => ({ news: [], reach: {}, calls: 0, emptyCalls: 0, callsBy: {}, confess: 0, events: 0, lateYears: 0, lateBusy: 0, lateActs: {} });

function handleEncounters(w: World, r: R, log: Log, careful: boolean) {
  let busy = false;
  while (w.pending.length && w.phase === 'year') {
    busy = true;
    const e = w.pending[0];
    if (e.kind === 'call') { log.calls++; log.callsBy[e.who] = (log.callsBy[e.who] ?? 0) + 1; }
    if (e.kind === 'confess') log.confess++;
    if (e.kind === 'event') log.events++;
    const v = viewEncounter(w, e);
    const ok = v.choices.map((c, i) => [c, i] as const).filter(([c]) => !c.disabled);
    let pick = r.chance(0.7) ? ok[0][1] : r.pick(ok)[1];
    if (careful) {
      if (e.kind === 'attack') {
        const odds = Number((v.choices[0].hint ?? '').match(/\d+/)?.[0] ?? 0);
        // 打不过、对方只是要东西：给他；要命的事：打得过就打，打不过就跑
        pick = e.vars.item && odds < 80 && !v.choices[2]?.disabled ? 2 : odds >= 50 ? 0 : 1;
      }
      else if (e.kind === 'call' || e.kind === 'ask') pick = 1;
      else if (e.kind === 'bid') pick = 1;
      else pick = ok[0][1];
    }
    const out = choose(w, pick);
    if (e.kind === 'call' && (out.includes('太凶') || out.includes('空空'))) log.emptyCalls++;
  }
  return busy;
}

/** 随手玩的玩家 */
function playYear(w: World, r: R, log: Log, ai?: R) {
  if (ai) fakeAI(w, ai);
  const me = w.me;
  const place = me.stones >= 60 && !me.items.includes('pill') && r.chance(0.3) ? 'market'
    : r.chance(0.15) ? r.pick(['forest', 'village', 'market', 'cave'] as const) : me.sect || 'vein';
  moveTo(w, place);
  const busy = handleEncounters(w, r, log, false);
  if (w.phase !== 'year') return busy;
  if (me.place === 'market' && me.stones >= 60) buy(w, 'pill');
  const acts: string[] = mainActs(w).filter((a) => a.ok).map((a) => a.id);
  const want = canBreak(me) ? (acts.includes('pill') ? 'pill' : 'seclude') : me.place === 'cave' || me.place === 'forest' ? 'adventure' : r.chance(0.8) ? 'cultivate' : r.pick(acts);
  doMain(w, (acts.includes(want) ? want : 'cultivate') as never);
  const here = npcs(w).filter((n) => n.place === me.place);
  for (const n of r.shuffle(here).slice(0, 2)) {
    const kind = !me.sect && n.sect && r.chance(0.5) ? 'join' : r.pick(['chat', 'news', 'goal', 'teach', 'gift'] as const);
    social(w, n.id, kind);
  }
  endTurn(w);
  return busy;
}

/** 精打细算的玩家：去修炼最快的地方，缺丹药就去坊市，按时冲关，伤了吃药，寿元见底吃延寿丹 */
function playOptimal(w: World, r: R, log: Log) {
  const me = w.me;
  const needPill = canBreak(me) || (me.stage === 2 && me.exp > 0);
  const needLife = lifeLeft(me) < 25 && lifeGain(me) > 0 && !me.items.includes('life') && Number(w.flags.lifeStock ?? 0) > 0 && me.stones >= 200;
  const best = [...PLACE_ORDER].sort((a, b) => yearExp(w, me, b) - yearExp(w, me, a))[0];
  const place = needLife || (needPill && !me.items.includes('pill') && me.stones >= 60) ? 'market' : best;
  moveTo(w, place);
  const busy = handleEncounters(w, r, log, true);
  if (w.phase !== 'year') return busy;
  if (me.place === 'market') {
    if (needLife) buy(w, 'life');
    while (me.stones >= 60 + 30 && me.items.filter((i) => i === 'pill').length < 2) if (!buy(w, 'pill').startsWith('买下')) break;
  }
  if (me.hp < 60 && me.items.includes('heal')) useItem(w, 'heal');
  if (lifeLeft(me) < 10 && me.items.includes('life') && lifeGain(me) > 0) useItem(w, 'life');
  const acts: string[] = mainActs(w).filter((a) => a.ok).map((a) => a.id);
  const order = ['pill', 'seclude', 'local', 'abode', 'array', 'cultivate'];
  const pick = canBreak(me) ? order.find((a) => acts.includes(a)) : acts.includes('local') && me.place === 'vein' ? 'local' : acts.includes('abode') && me.stones >= 260 ? 'abode' : acts.includes('array') && me.stones >= 120 ? 'array' : 'cultivate';
  doMain(w, (pick ?? 'cultivate') as never);
  const here = npcs(w).filter((n) => n.place === me.place);
  for (const n of here.slice(0, 2)) social(w, n.id, !me.sect && n.sect ? 'join' : n.realm > me.realm && !me.master ? 'master' : 'teach');
  endTurn(w);
  return busy;
}

const NAMED = ['wen', 'shen', 'lu', 'tang', 'li', 'han', 'qinyan', 'liu', 'bailu', 'mojiu', 'aman', 'hua'];
const med = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;

function run(n: number, mode: string, onlyRoot?: RootId) {
  const stat: Record<string, number> = {};
  const add = (k: string, v = 1) => { stat[k] = (stat[k] ?? 0) + v; };
  const endings: Record<string, number> = {};
  const deathYear: Record<string, number[]> = {};
  const killedBy: Record<string, Record<string, number>> = {};
  const story: Record<string, { n: number; years: number[]; strong: number }> = {};
  const byRoot: Record<string, { n: number; ascend: number; reach: Record<number, number[]>; stones: number[] }> = {};
  const bigByDecade: number[] = [];
  let years = 0, newsN = 0, bigN = 0, maxCallsOne = 0, calls = 0, emptyCalls = 0, confess = 0, lateYears = 0, lateBusy = 0;
  const lateActs: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const root = onlyRoot ?? (['heaven', 'dual', 'mixed'] as const)[i % 3];
    const w = newWorld(5000 + i, { root });
    const r = makeRng(i * 7919 + 1);
    const ai = mode === 'ai' ? makeRng(i * 104729 + 3) : undefined;
    const log = newLog();
    let guard = 0;
    const realmAt: number[] = [];
    while (w.phase === 'year' && guard++ < 260) {
      const y = w.year;
      realmAt[y] = w.me.realm;
      const lateBefore = w.me.realm >= 3;
      const doneBefore = { ...w.turn };
      const busy = mode === 'optimal' ? playOptimal(w, r, log) : playYear(w, r, log, ai);
      void doneBefore;
      if (lateBefore) { lateYears++; if (busy) lateBusy++; }
      log.news.push(...w.news.filter((x) => x.y === y));
      if (!(w.me.realm in log.reach)) log.reach[w.me.realm] = w.me.age;
    }
    years += w.year;
    const ek = w.ending?.kind ?? 'cap';
    endings[ek] = (endings[ek] ?? 0) + 1;
    if (ek === 'dead') add(`主角死因：${(w.me.died?.note ?? '?').replace(/死在(.+?)手里/, '死在某人手里：$1')}`);
    if (ek === 'dead') { const k = Object.values(w.people).find((p) => w.me.died?.note.includes(p.name)); const g = k?.mind.goal ?? k?.mind.past[k.mind.past.length - 1]; add(`主角死因·对方的目标：${g ? `${g.kind}${g.target === 'me' ? '→你' : ''}` : '无'}`); }
    newsN += log.news.length;
    bigN += log.news.filter((x) => x.big).length;
    for (const x of log.news) if (x.big) bigByDecade[Math.floor(x.y / 10)] = (bigByDecade[Math.floor(x.y / 10)] ?? 0) + 1;
    calls += log.calls; emptyCalls += log.emptyCalls; confess += log.confess;
    maxCallsOne = Math.max(maxCallsOne, ...Object.values(log.callsBy), 0);
    // 灵根
    const R = (byRoot[root] ??= { n: 0, ascend: 0, reach: {}, stones: [] });
    R.n++;
    if (ek === 'ascend') R.ascend++;
    for (const [k, age] of Object.entries(log.reach)) (R.reach[Number(k)] ??= []).push(age);
    R.stones.push(w.me.stones);
    // 名角什么时候死、死在谁手里
    for (const id of NAMED) {
      const p = w.people[id];
      (deathYear[id] ??= []).push(p.alive ? w.year + 1 : p.died!.y);
      if (!p.alive) {
        const by = p.died?.note.includes('寿元') ? '寿尽' : (p.died?.note.match(/死在(.+?)手里/)?.[1] ?? p.died?.note ?? '?');
        (killedBy[id] ??= {})[by] = (killedBy[id][by] ?? 0) + 1;
      }
    }
    // 关键事件：哪一年、那时主角是不是已经筑基
    const ev = (k: string, y?: number) => {
      if (y === undefined) return;
      const s = (story[k] ??= { n: 0, years: [], strong: 0 });
      s.n++; s.years.push(y);
      if ((realmAt[y] ?? w.me.realm) >= 1) s.strong++;
    };
    const flagY = (k: string) => (typeof w.flags[`story:${k}`] === 'number' ? (w.flags[`story:${k}`] as number) : undefined);
    const firstNews = (re: RegExp) => log.news.find((x) => re.test(x.text))?.y;
    ev('玄冥剑出洞', firstNews(/带出了玄冥剑|带出了玄冥剑/));
    ev('韩烈夺位', flagY('coup:chixiao'));
    ev('有人趁虚夺青岚宗', flagY('coup:qinglan'));
    ev('温玄倒台', firstNews(/温玄被废|废去宗主之位，离开了山门/));
    ev('云鹤真相', firstNews(/真相|云鹤遗书/));
    ev('秦焰报仇（成）', flagY('qinyan:revenge:ok'));
    ev('秦焰报仇（败）', flagY('qinyan:revenge:fail'));
    ev('墨九报仇（成）', flagY('mojiu:revenge:ok'));
    ev('沈清禾寻师（成）', flagY('shen:seekmaster:ok'));
    ev('陆沉舟坐上宗主', flagY('lu:throne:ok'));
    ev('柳如烟得剑', flagY('liu:treasure:ok'));
    ev('厉擎得剑', flagY('li:treasure:ok'));
    for (const p of Object.values(w.people)) {
      for (const g of [...p.mind.past, ...(p.mind.goal ? [p.mind.goal] : [])]) add(`目标 ${g.kind} ${g.done ?? '进行中'}`);
      if (p.mind.goal && p.mind.goal.target === 'me' && p.mind.goal.stuck >= 5) add('冲着你的目标卡了 5 年以上');
    }
    for (const x of log.news) if (x.text.includes('结为道侣')) add('结为道侣');
    add('主角知道的秘密', w.knows.filter((k) => k.startsWith('secret:')).length);
    add('名声', w.fame ?? 0);
    lateYears += log.lateYears; lateBusy += log.lateBusy;
    for (const [k, v] of Object.entries(log.lateActs)) lateActs[k] = (lateActs[k] ?? 0) + v;
  }
  const per = (k: string) => ((stat[k] ?? 0) / n).toFixed(2);
  console.log(`== ${n} 个世界 · ${mode === 'ai' ? '身边的人由乱选的假 AI 定打算' : mode === 'optimal' ? '精打细算的玩家' : '随手玩的玩家'}${onlyRoot ? ` · 只玩${onlyRoot}` : ''} ==`);
  console.log(`平均玩到第 ${(years / n).toFixed(1)} 年；每年 ${(newsN / years).toFixed(2)} 条传闻，其中大事 ${(bigN / years).toFixed(2)} 条`);
  console.log('主角结局', endings);
  console.log('\n— 灵根 —');
  for (const [k, v] of Object.entries(byRoot)) {
    const ages = [1, 2, 3, 4].map((rl) => `${['', '筑基', '金丹', '元婴', '化神'][rl]} ${v.reach[rl]?.length ? `${pct(v.reach[rl].length, v.n)} 中位${med(v.reach[rl])}岁` : '—'}`).join('，');
    console.log(`  ${k}: 化神 ${pct(v.ascend, v.n)}；${ages}；结局灵石中位 ${med(v.stones)}`);
  }
  console.log('\n— 名角的中位死亡年（活到最后算局末），死因 —');
  for (const id of NAMED) {
    const by = Object.entries(killedBy[id] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}${v}`).join(' ');
    console.log(`  ${id}: ${med(deathYear[id])} 年 ${by}`);
  }
  console.log('\n— 关键事件：几成的局发生、中位年份、发生时主角已筑基的比例 —');
  for (const [k, v] of Object.entries(story)) console.log(`  ${k}: ${pct(v.n, n)}，第 ${med(v.years)} 年，${pct(v.strong, v.n)}`);
  console.log('\n— 大事按十年分布 —');
  const totalBig = bigByDecade.reduce((a, b) => a + (b ?? 0), 0);
  console.log('  ' + bigByDecade.slice(0, 10).map((v, i) => `${i * 10}-${i * 10 + 9}年 ${pct(v ?? 0, totalBig)}`).join('，'));
  console.log('\n— 卡住的检查 —');
  console.log(`  盟友约你：${(calls / n).toFixed(2)} 次/局，其中空跑（太凶/空空如也）${emptyCalls} 次；同一个人一局最多约 ${maxCallsOne} 次`);
  console.log(`  有人向你表白：${(confess / n).toFixed(2)} 次/局`);
  console.log(`  元婴以后的年份里有事找上门：${pct(lateBusy, lateYears)}`);
  console.log('\n— 其他（每局）—');
  for (const k of Object.keys(stat).sort()) console.log(`  ${k}: ${per(k)}`);
}

const [a1, a2, a3] = [process.argv[2], process.argv[3], process.argv[4]];
if (a2 === 'story') {
  const w = newWorld(Number(a1));
  const r = makeRng(1);
  const log = newLog();
  const out: News[] = [];
  while (w.phase === 'year' && w.year <= 60) { const y = w.year; playYear(w, r, log); out.push(...w.news.filter((x) => x.y === y)); }
  for (const x of out) console.log(`${x.big ? '★' : ' '} ${x.y}年 ${x.text}`);
} else run(Number(a1 ?? 200), a2 ?? 'casual', a3 as RootId | undefined);
