// 《青冥录》无头模拟：自动玩几百个世界，看世界是不是「活的」——每年发生多少事，报仇、道侣、背叛、争位、陨落各有多少。
// 用法：npm run sim:qm [-- 局数]          只走规则
//       npm run sim:qm -- 200 ai           主角身边的人由一个「乱选合法选项」的假 AI 定打算，看世界会不会被 AI 搞乱

import { makeRng } from '../qingming/assets/game/core/rng';
import type { World } from '../qingming/assets/game/core/types';
import { npcs, newWorld } from '../qingming/assets/game/core/world';
import { canBreak } from '../qingming/assets/game/systems/body';
import { buy, choose, doMain, endTurn, moveTo, social, viewEncounter } from '../qingming/assets/game/player';
import { applyDecision, whoDecides, yearChoices } from '../qingming/assets/game/ai/decide';

declare const process: { argv: string[] };

/** 假 AI：年初，主角身边最多三个人从合法选项里随便挑一件 */
function fakeAI(w: World, r: ReturnType<typeof makeRng>) {
  for (const n of whoDecides(w, null)) {
    const c = r.pick(yearChoices(w, n));
    applyDecision(w, n, { ...c.want, by: 'ai' });
  }
}

function playYear(w: World, r: ReturnType<typeof makeRng>, ai?: ReturnType<typeof makeRng>) {
  if (ai) fakeAI(w, ai);
  const me = w.me;
  const place = me.stones >= 60 && !me.items.includes('pill') && r.chance(0.3) ? 'market'
    : r.chance(0.15) ? r.pick(['forest', 'village', 'market', 'cave'] as const) : me.sect || 'vein';
  moveTo(w, place);
  while (w.pending.length && w.phase === 'year') {
    const v = viewEncounter(w, w.pending[0]);
    const ok = v.choices.map((c, i) => [c, i] as const).filter(([c]) => !c.disabled);
    choose(w, r.chance(0.7) ? ok[0][1] : r.pick(ok)[1]);
  }
  if (w.phase !== 'year') return;
  if (me.place === 'market' && me.stones >= 60) buy(w, 'pill');
  doMain(w, canBreak(me) ? 'seclude' : me.place === 'cave' || me.place === 'forest' ? 'adventure' : r.chance(0.8) ? 'cultivate' : 'work');
  const here = npcs(w).filter((n) => n.place === me.place);
  for (const n of r.shuffle(here).slice(0, 2)) {
    const kind = !me.sect && n.sect && r.chance(0.5) ? 'join' : r.pick(['chat', 'news', 'goal', 'teach', 'gift'] as const);
    social(w, n.id, kind);
  }
  endTurn(w);
}

function run(n: number, useAI: boolean) {
  const stat: Record<string, number> = {};
  const add = (k: string, v = 1) => { stat[k] = (stat[k] ?? 0) + v; };
  const endings: Record<string, number> = {};
  let years = 0, newsN = 0, bigN = 0, worldYears = 0;
  for (let i = 0; i < n; i++) {
    const w = newWorld(5000 + i, { root: (['heaven', 'dual', 'mixed'] as const)[i % 3] });
    const r = makeRng(i * 7919 + 1);
    const ai = useAI ? makeRng(i * 104729 + 3) : undefined;
    let guard = 0;
    while (w.phase === 'year' && guard++ < 200) playYear(w, r, ai);
    years += w.year;
    endings[`${w.ending?.kind ?? 'cap'}`] = (endings[`${w.ending?.kind ?? 'cap'}`] ?? 0) + 1;
    add(`主角最终境界:${w.me.realm}`);
    newsN += w.news.length;
    bigN += w.news.filter((x) => x.big).length;
    worldYears += w.year;
    for (const p of Object.values(w.people)) {
      if (!p.alive) add(p.died?.note.includes('寿元') ? 'NPC 坐化' : 'NPC 横死');
      for (const g of [...p.mind.past, ...(p.mind.goal ? [p.mind.goal] : [])]) add(`目标 ${g.kind} ${g.done ?? '进行中'}`);
      if (p.partner) add('有道侣的 NPC');
      for (const g of [...p.mind.past, ...(p.mind.goal ? [p.mind.goal] : [])]) if (g.ally) add(`找到帮手 ${g.kind}${g.ally === 'me' ? '（主角）' : ''}`);
      if (p.id.startsWith('n')) add('后起之秀');
    }
    for (const x of w.news) {
      if (x.text.includes('继任')) add('换宗主');
      if (x.text.includes('叛出')) add('叛出宗门');
      if (x.text.includes('独吞') || x.text.includes('翻脸') || x.text.includes('倒戈')) add('背叛');
      if (x.text.includes('报了大仇') || x.text.includes('大仇得报') || x.text.includes('联手，杀了')) add('报仇成功');
      if (x.text.includes('立誓')) add('立誓报仇');
      if (x.text.includes('结为道侣')) add('结为道侣');
      if (x.text.includes('真相')) add('揭开云鹤真相');
      if (x.text.includes('逼宫')) add('逼宫');
    }
    add('主角知道的秘密', w.knows.filter((k) => k.startsWith('secret:')).length);
    add('主角的人情（有好感的 NPC）', Object.values(w.people).filter((p) => (p.mind.op.me?.aff ?? 0) >= 40).length);
    add('主角的仇人（恨你的 NPC）', Object.values(w.people).filter((p) => (p.mind.op.me?.aff ?? 0) <= -40).length);
  }
  console.log(`== ${n} 个世界${useAI ? '（身边的人由乱选的假 AI 定打算）' : ''} ==`);
  console.log(`平均玩到第 ${(years / n).toFixed(1)} 年；每年 ${(newsN / worldYears).toFixed(2)} 条传闻，其中大事 ${(bigN / worldYears).toFixed(2)} 条`);
  console.log('主角结局', endings);
  const per = (k: string) => (stat[k] ?? 0) / n;
  for (const k of Object.keys(stat).sort()) console.log(`  ${k}: ${per(k).toFixed(2)} / 局`);
}

if (process.argv[3] === 'story') {
  const w = newWorld(Number(process.argv[2]));
  const r = makeRng(1);
  while (w.phase === 'year' && w.year <= 40) playYear(w, r);
  for (const x of w.news) console.log(`${x.big ? '★' : ' '} ${x.y}年 ${x.text}`);
} else run(Number(process.argv[2] ?? 200), process.argv[3] === 'ai');
