// 过季：一季发生的所有事按顺序结算。
// planSeason 先列出每个人能做的事和谁该交给 AI；界面拿去问 AI（或不问），再交回 advanceSeason。

import { aiOptions, choicesFor, rulePick, type Choice } from './choices';
import { lifespan, lvl, power as powerOf, realmText } from './cult';
import { addDecision, drift, refreshDecision, resolveDecision } from './decisions';
import { HALL, POLICY, SKILLS, TECH } from './data/world';
import { rollEvents, travelTick } from './events';
import { ageCandidates, newCandidates, probationTick } from './recruit';
import { templateWhy } from './lines';
import { applyChoice, socialize } from './resolve';
import { applyRivalMove, ruleRivalPick, rivalChoices, rivalTick, type RivalChoice } from './rivals';
import { cultivate, doWork, payUpkeep, underqualified, unconvinced, type Unconvinced } from './sect';
import type { Person, World } from './types';
import { startWar } from './war';
import { ruleWish, settleWishes, thwarted, type WishNews } from './wishes';
import { addLife, clamp, disp, everyone, members, nm, op, P, report, rngOf, year } from './world';

export type AiMode = 'save' | 'normal' | 'rich';
export const AI_LIMIT: Record<AiMode, number> = { save: 3, normal: 8, rich: 16 };

export interface Plan {
  unc: Unconvinced[];
  options: Record<string, Choice[]>;
  /** 交给 AI 挑的人 */
  aiWho: string[];
  rivalOptions: Record<string, RivalChoice[]>;
  aiRivals: string[];
}

export interface Pick { id: string; why?: string; by: 'ai' | 'rule' }

/** 谁值得交给 AI 想：你标记的、长老主事、真传首席、心里有大事的 */
export function whoDecides(w: World, limit: number): string[] {
  const scored = members(w).map((p) => {
    let s = 0;
    if (p.starred) s += 100;
    if (p.head || p.rank === 'elder') s += 30;
    if (p.rank === 'chief' || p.rank === 'core') s += 20;
    if (p.grudge >= 40) s += 15;
    if (p.wish && ['revenge', 'love', 'found', 'spy'].includes(p.wish.kind)) s += 12;
    if (p.secret && !p.secret.exposed) s += 6;
    s += lvl(p);
    return [p.id, s] as const;
  });
  return scored.sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

export function planSeason(w: World, mode: AiMode | 'off'): Plan {
  const unc = unconvinced(w);
  const options: Record<string, Choice[]> = {};
  for (const p of members(w)) {
    if (p.job === 'travel') continue;
    options[p.id] = choicesFor(w, p, { unc });
  }
  const limit = mode === 'off' ? 0 : AI_LIMIT[mode];
  const aiWho = whoDecides(w, limit).filter((id) => options[id]);
  for (const id of aiWho) options[id] = aiOptions(options[id]);
  const rivalOptions: Record<string, RivalChoice[]> = {};
  const aiRivals: string[] = [];
  for (const rv of w.rivals) {
    if (!rv.alive || rv.passive || rv.status === 'war') continue;
    rivalOptions[rv.id] = rivalChoices(w, rv);
    if (mode === 'normal' || mode === 'rich') aiRivals.push(rv.id);
  }
  return { unc, options, aiWho, rivalOptions, aiRivals };
}

export interface Summary {
  t: number;
  wishNews: WishNews[];
  /** 新生出心愿、等 AI 改写的人 */
  newWishes: string[];
  deaths: Person[];
}

export function advanceSeason(w: World, plan: Plan, picks: Record<string, Pick>, rivalPicks: Record<string, Pick>): Summary {
  const r = rngOf(w);
  const s = w.sect;
  if (w.report.length) w.history.unshift({ t: w.t - 1 < 0 ? 0 : w.t, items: w.report });
  w.history = w.history.slice(0, 8);
  w.report = [];
  s.ledger = {};
  w.misdeeds = w.misdeeds.filter((m) => w.t - m.t <= 1);
  // 没处理的事按默认办
  for (const d of [...w.decisions]) resolveDecision(w, r, d.id, d.fallback);

  // 一、各人做自己挑的事
  const unc = unconvinced(w);
  const order = r.shuffle(members(w).filter((p) => plan.options[p.id]));
  const notable: { p: Person; c: Choice; why?: string; routine: boolean }[] = [];
  for (const p of order) {
    if (!p.alive || p.sect !== 'me') continue;
    const cs = choicesFor(w, p, { unc });
    const pk = picks[p.id];
    const c = (pk && cs.find((x) => x.id === pk.id)) || rulePick(r, cs);
    p.lastWhy = pk?.why && pk.id === c.id ? pk.why : undefined;
    if (!p.lastWhy && c.kind !== 'work' && r.chance(0.6)) p.lastWhy = templateWhy(w, r, p, c);
    applyChoice(w, r, p, c, emptyWork());
    const routine = ['work', 'diligent', 'cultivate', 'slack'].includes(c.kind);
    if (!routine || p.starred || p.lastWhy) notable.push({ p, c, why: p.lastWhy, routine });
  }
  for (const p of members(w)) if (!plan.options[p.id]) p.lastAct = 'travel';

  // 二、干活
  const work = doWork(w, r, unc);
  // 三、修炼
  const cul = cultivate(w, r, work);
  for (const p of cul.bottleneck) {
    if (p.id === w.me) continue;
    addDecision(w, 'breakthrough', { who: p.id });
  }
  for (const p of cul.leveled) if (p.realm >= 1 || p.starred) addLife(w, p, `修为精进到${realmText(p)}`, 'good');

  // 四、服不服、心情、忠心
  const lawCalm = 3 + work.lawPower * 1.5 + (s.tech.includes('rules') ? 2 : 0) + (s.heritage === 'mind' ? 1 : 0);
  for (const p of members(w)) {
    let g = -lawCalm;
    if (p.dislikes.includes(p.job)) g += 4;
    if (p.likes.includes(p.job)) g -= 2;
    for (const u of unc.filter((x) => x.who === p.id)) {
      g += (4 + u.gap * 0.08) * (1 + Math.max(0, disp(p, 'pride')) * 0.3);
      op(p, u.over).respect = clamp(op(p, u.over).respect - 3, -100, 100);
    }
    if (!cul.pillTo.has(p.id) && disp(p, 'envy') > 0 && members(w).some((q) => cul.pillTo.has(q.id) && q.rank === p.rank)) g += 2 * disp(p, 'envy');
    p.grudge = clamp(p.grudge + g, 0, 100);
    // 心情慢慢回到中间
    let m = (55 - p.mood) * 0.15 + (p.likes.includes(p.job) ? 3 : 0) - (p.dislikes.includes(p.job) ? 3 : 0) - (p.hp < 50 ? 4 : 0);
    if (Object.values(p.ops).some((o) => o.tag === 'lover')) m += 2;
    if (s.policy === 'sword' && disp(p, 'temper') > 0) m += 1;
    p.mood = clamp(p.mood + m, 0, 100);
    if (p.grudge >= 60) p.loyalty = clamp(p.loyalty - 2, 0, 100);
    if (p.grudge <= 10 && p.mood >= 60) p.loyalty = clamp(p.loyalty + 1, 0, 100);
    p.hp = clamp(p.hp + 10, 0, 100);
  }
  // 德不配位的人，下面的人看不起
  for (const p of members(w)) {
    const why = underqualified(p);
    if (!why) continue;
    for (const q of members(w)) if (q.id !== p.id && (q.job === p.head || q.job === p.job)) op(q, p.id).respect = clamp(op(q, p.id).respect - 4, -100, 100);
    if (r.chance(0.12)) { report(w, { text: `${p.name}${why}，手下的人阳奉阴违。`, tone: 'bad', about: [p.id] }); p.mood = clamp(p.mood - 5, 0, 100); }
  }
  socialize(w, r);

  // 五、收支
  const base = { vein: 60, deep: 25, market: 35 }[s.site] + (s.veins - 2) * 30 + (s.tech.includes('market_shop') ? 40 : 0) + (s.site === 'market' ? 25 : 0);
  const income = Math.round(base * (s.veinDebuff && s.veinDebuff > w.t ? 0.8 : 1));
  s.stones += income;
  s.ledger.income = income;
  if (!payUpkeep(w)) report(w, { text: '灵石不够发月例了！弟子们怨声载道。', tone: 'bad', about: [], big: true });
  if (s.policy === 'hide') s.rep = Math.max(0, s.rep - 1.5);

  // 六、历练、事件、奇遇
  travelTick(w, r);
  rollEvents(w, r);

  // 七、敌宗
  rivalTick(w, r);
  for (const rv of w.rivals) {
    const cs = plan.rivalOptions[rv.id];
    if (!cs || !rv.alive || rv.status === 'war') continue;
    const fresh = rivalChoices(w, rv);
    const pk = rivalPicks[rv.id];
    const c = (pk && fresh.find((x) => x.id === pk.id)) || ruleRivalPick(r, fresh);
    rv.lastWhy = pk?.why && pk.id === c.id ? pk.why : undefined;
    applyRivalMove(w, r, rv, c, work);
  }
  if (w.pendingWar && !w.war) startWar(w, w.pendingWar.enemy, w.pendingWar.byPlayer);
  for (const [pid, rid] of Object.entries(w.offers)) {
    const p = P(w, pid);
    const rv = w.rivals.find((x) => x.id === rid);
    if (!p?.alive || p.sect !== 'me' || !rv?.alive) delete w.offers[pid];
  }

  // 八、试用期、心愿
  probationTick(w);
  const wishNews = settleWishes(w, r);
  for (const x of thwarted(w)) report(w, { text: x.text, tone: 'bad', about: [x.p.id] });
  const newWishes: string[] = [];
  for (const p of members(w)) {
    if (p.wish) continue;
    // 心愿成了或者断了以后，过一阵才生新的
    if (r.chance(0.5)) { p.wish = ruleWish(w, r, p); if (p.wish) { p.wishPending = true; newWishes.push(p.id); } }
  }

  // 九、才干退步、性情随岗位变、资历
  for (const p of members(w)) {
    const used = p.job in HALL ? [HALL[p.job as keyof typeof HALL].skill, HALL[p.job as keyof typeof HALL].skill2] : [];
    for (const sk of SKILLS) if (!used.includes(sk) && p.skills[sk] > p.caps[sk] * 0.4) p.skills[sk] = Math.max(0, p.skills[sk] - 0.3);
    p.tenure += 1;
    p.served[p.job] = (p.served[p.job] ?? 0) + 1;
    p.seniority += 1;
    if ((p.served[p.job] ?? 0) >= 8 && r.chance(0.05)) drift(w, r, p, p.job as 'law', 1);
    if (p.grudge >= 70 && r.chance(0.05)) drift(w, r, p, 'oppressed', 1);
  }

  // 十、寿元
  const deaths: Person[] = [];
  if (w.t % 4 === 3) for (const p of everyone(w)) p.age += 1;
  for (const p of everyone(w)) {
    if (p.age >= lifespan(p) && r.chance(0.35)) {
      p.alive = false; p.death = '寿元耗尽，坐化了';
      addLife(w, p, '寿元耗尽，坐化了', 'bad', true);
      report(w, { text: `${p.name}寿元耗尽，坐化了。`, tone: 'bad', about: [p.id], big: true });
      deaths.push(p);
    }
  }
  for (const p of Object.values(w.people)) if (p.alive && p.sect !== 'me' && p.age >= lifespan(p) && w.t % 4 === 3 && r.chance(0.3)) { p.alive = false; p.death = '坐化'; }
  w.members = w.members.filter((id) => P(w, id)?.alive && P(w, id)?.sect === 'me');

  // 十一、季报：谁做了什么
  // 季报：大事都报；日常的事（偷懒、拼命、挤时间修炼）标记的人和 AI 说了话的优先，其余最多三条
  let routineLeft = 3;
  const shown = notable.filter((n) => n.p.alive)
    .sort((a, b) => Number(!!b.p.starred) - Number(!!a.p.starred) || Number(picks[b.p.id]?.by === 'ai') - Number(picks[a.p.id]?.by === 'ai') || Number(a.routine) - Number(b.routine))
    .filter((n) => !n.routine || n.p.starred || picks[n.p.id]?.by === 'ai' || routineLeft-- > 0)
    .slice(0, 12);
  for (const n of shown) {
    if (n.c.kind === 'work' && !n.why) continue;
    report(w, { text: `${n.p.name}：${n.c.label}。`, tone: 'story', about: [n.p.id], quote: n.why ? { who: n.p.id, text: n.why } : undefined });
    // 经历只记有分量的事；日常的事只在 AI 替他说了话时记
    const fresh = n.why && !n.p.life.slice(-6).some((l) => l.text.includes(n.why!));
    if (!n.routine || (fresh && picks[n.p.id]?.by === 'ai')) addLife(w, n.p, n.why ? `${n.c.label}——"${n.why}"` : n.c.label, 'story');
  }
  // 敌宗明面上的动作才报；挖人、派奸细是暗地里的
  for (const rv of w.rivals) if (rv.lastMove && rv.lastWhy && rv.alive && !rv.passive && !rv.hidden) report(w, { text: `${rv.name}宗主${nm(w, rv.master)}：${rv.lastMove}。`, tone: 'info', about: [], quote: { who: rv.master, text: rv.lastWhy } });

  // 十二、来人走人，时间往前
  ageCandidates(w);
  w.acts = [];
  w.t += 1;
  if (w.t % 4 === 0) {
    w.needPolicy = true;
    w.needTech = true;
    s.policy = null;
  }
  newCandidates(w, r, work.recruitPower);
  for (const d of w.decisions) refreshDecision(w, d);
  if (year(w.t) > w.endYear && !w.war) w.over = endText(w);
  if (members(w).length === 0) w.over = { win: false, text: '弟子走的走、死的死，山上只剩你一个人。宗门散了。' };
  if (!w.people[w.me].alive) w.over = { win: false, text: '你寿元耗尽，坐化了。' };
  r.save();
  return { t: w.t, wishNews, newWishes, deaths };
}

function emptyWork() { return { cultBonus: 1, lawPower: 1, recruitPower: 0, guardPower: 0, byHall: {} as Record<string, number> } as Parameters<typeof applyChoice>[4]; }

/** 试玩版十年到了 */
function endText(w: World): { win: boolean; text: string } {
  const ms = members(w);
  const top = [...ms].sort((a, b) => lvl(b) - lvl(a))[0];
  const rank = w.rivals.filter((x) => x.alive).filter((x) => x.rep > w.sect.rep).length + 1;
  return {
    win: true,
    text: `${w.endYear}年过去了。${w.sect.name}有弟子${ms.length}人，名望${Math.round(w.sect.rep)}，在一州宗门里排第${rank}。${top ? `修为最高的弟子是${top.name}（${realmText(top)}）。` : ''}`,
  };
}

/** 年初定方略 */
export function choosePolicy(w: World, id: string) {
  w.sect.policy = id;
  w.needPolicy = false;
  w.acts.push({ kind: 'policy', text: `定下今年的方略：${POLICY[id].name}` });
  if (POLICY[id].mood) report(w, { text: POLICY[id].mood!, tone: 'info', about: [] });
}

export function canLearn(w: World, id: string) {
  const t = TECH[id];
  return !w.sect.tech.includes(id) && (t.needs ?? []).every((n) => w.sect.tech.includes(n));
}

export function learnTech(w: World, id: string): string | null {
  if (!canLearn(w, id)) return '还不能学';
  const t = TECH[id];
  w.sect.tech.push(id);
  w.needTech = false;
  if (t.align) {
    w.sect.align = clamp(w.sect.align + t.align, -100, 100);
    for (const p of members(w)) if (p.values.justice > 0.6) { p.loyalty = clamp(p.loyalty - 10, 0, 100); p.grudge = clamp(p.grudge + 10, 0, 100); addLife(w, p, `宗门修起了${t.name}，${p.gender === 'f' ? '她' : '他'}心里发寒`, 'bad'); }
    for (const rv of w.rivals) if (rv.style === 'proper' || rv.style === 'aloof') rv.attitude -= 20;
  }
  w.acts.push({ kind: 'tech', text: `点亮传承：${t.name}` });
  return null;
}

/** 宗门大比：按实力排座次，一年内大家认这个排名 */
export function holdTourney(w: World): string | null {
  if (!w.sect.tech.includes('arena')) return '要先有演武场';
  if (w.sect.tourneyYear === year(w.t)) return '今年已经办过了';
  if (w.sect.stones < 60) return '灵石不够（要 60）';
  const r = rngOf(w);
  w.sect.stones -= 60;
  const ranking = members(w).map((p) => [p, Math.sqrt(Math.max(1, powerOf(p))) * r.range(0.85, 1.15)] as const).sort((a, b) => b[1] - a[1]).map(([p]) => p);
  w.sect.tourneyYear = year(w.t);
  w.sect.tourneyRank = ranking.map((p) => p.id);
  ranking.forEach((p, i) => {
    if (i < 3) { p.fame += 6 - i * 2; addLife(w, p, `宗门大比第${i + 1}名`, 'good', true); }
    p.grudge = clamp(p.grudge - 10, 0, 100);
  });
  report(w, { text: `宗门大比：${ranking.slice(0, 3).map((p, i) => `第${i + 1}名${p.name}`).join('，')}。座次排定，大家心服口服。`, tone: 'good', about: ranking.slice(0, 3).map((p) => p.id), big: true });
  r.save();
  return null;
}

/** 宗主替人背书：恩宠加身，花宗主威望 */
export function vouch(w: World, p: Person): string | null {
  if (w.sect.authority < 5) return '宗主威望不够';
  w.sect.authority -= 5;
  p.favor += 10;
  p.grudge = clamp(p.grudge - 10, 0, 100);
  w.acts.push({ kind: 'vouch', who: p.id, text: `当众替${p.name}撑腰` });
  addLife(w, p, '宗主当众替自己撑腰', 'good');
  for (const q of members(w)) if (q.id !== p.id && disp(q, 'envy') > 0) op(q, p.id).aff -= 5;
  return null;
}

export function giftPill(w: World, p: Person): string | null {
  if (w.sect.pills < 3) return '丹药不够（要 3 颗）';
  w.sect.pills -= 3;
  p.exp += 20;
  p.favor += 3;
  p.mood = clamp(p.mood + 8, 0, 100);
  w.acts.push({ kind: 'gift', who: p.id, text: `赏了${p.name}丹药` });
  for (const q of members(w)) if (q.id !== p.id && disp(q, 'envy') > 0 && q.rank === p.rank) op(q, p.id).aff -= 4;
  return null;
}

export function upgradeHall(w: World, h: keyof World['sect']['halls']): string | null {
  const lv = w.sect.halls[h];
  if (lv >= 3) return '已经最高了';
  const cost = [80, 200, 450][lv];
  if (w.sect.stones < cost) return `灵石不够（要 ${cost}）`;
  w.sect.stones -= cost;
  w.sect.halls[h] = lv + 1;
  return null;
}

