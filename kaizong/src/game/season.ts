// 时间：一季九十天，按天往前走（dayTick）。季初排日程（谁哪天拿主意），季末结算一季攒下的事。
// planSeason 在季初列出重要的人能做的事；界面拿去问 AI，答案回来前到日子的人按规则自己拿主意。

import { aiOptions, choicesFor, rulePick, SECRET_ACTS, type Choice } from './choices';
import { atBottleneck, lifespan, lvl, power as powerOf, realmText } from './cult';
import { addDecision, DECISION_DAYS, drift, finishBreaks, refreshDecision, resolveDecision } from './decisions';
import { HALL, POLICY, SKILLS, TECH } from './data/world';
import { rollEvents, travelTick } from './events';
import { emit } from './fx';
import { ageCandidates, newCandidates, probationTick } from './recruit';
import { templateWhy } from './lines';
import { applyChoice, socialize } from './resolve';
import { applyRivalMove, ruleRivalPick, rivalChoices, rivalTick, type RivalChoice } from './rivals';
import type { Rng } from './rng';
import { cultivate, distributePills, doWork, payUpkeep, underqualified, unconvinced, upkeepCost, type Unconvinced, type Work } from './sect';
import type { HallId, Person, World } from './types';
import { startWar } from './war';
import { checkGoal, checkTier, tierIncome, turnYear } from './goals';
import { masterDaily, masterTick } from './master';
import { refreshBoard, settleExpeditions } from './missions';
import { finishWorks } from './build';
import { ruleWish, settleWishes, thwarted, type WishNews } from './wishes';
import { addLife, clamp, disp, everyone, members, MONTH_DAYS, nm, nowDay, op, P, report, rngOf, SEASON_DAYS, year } from './world';

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

/** 顶栏显示的家底 */
export const RES_KEYS = ['stones', 'herbs', 'pills', 'fpills', 'armory', 'rep', 'authority', 'veins'] as const;

/** 宣战以后过几天打上门 */
export const WAR_DAYS = 20;

/** AI 替人拿的主意：弟子 id → 选项；敌宗 id → 选项 */
export interface AiPicks { picks?: Record<string, Pick>; rivalPicks?: Record<string, Pick> }

/** 排这一季的日程：每个人哪天拿主意、敌宗哪天出手、哪天出事；顺便分丹药、记下季初家底 */
export function scheduleSeason(w: World, r: Rng) {
  const acts: Record<string, number> = {};
  for (const p of members(w)) acts[p.id] = r.int(3, SEASON_DAYS - 4);
  const rivals: Record<string, number> = {};
  for (const rv of w.rivals) rivals[rv.id] = r.int(8, SEASON_DAYS - 8);
  w.sched = { acts, rivals, events: r.int(12, 70), walkin: r.int(6, 80), social: r.int(30, 60), routineLeft: 3 };
  w.pillTo = [...distributePills(w, r)];
  w.before = Object.fromEntries(RES_KEYS.map((k) => [k, w.sect[k]]));
  flowMark = {};
}

/** 新的一季开头：上一季的纪事收进往事，排日程 */
export function startSeason(w: World, r: Rng) {
  // 往事按"哪一季发生的"记：t = -1 是开山那一季
  if (w.report.length) w.history.unshift({ t: w.t - 1, items: w.report });
  w.history = w.history.slice(0, 8);
  w.report = [];
  w.sect.ledger = {};
  w.misdeeds = w.misdeeds.filter((m) => w.t - m.t <= 1);
  w.day = 0;
  scheduleSeason(w, r);
}

/** 上次飘字时各项产出累计到多少（每半个月飘一次这半个月的产出） */
let flowMark: Record<string, number> = {};
const FLOW: [string, string, string][] = [['herbs', 'herb', '灵草'], ['pills', 'alchemy', '丹药'], ['trade', 'diplomacy', '灵石'], ['income', 'main', '灵石']];

function emptyWork(): Work { return { cultBonus: 1, lawPower: 1, recruitPower: 0, guardPower: 0, byHall: {} as Record<HallId, number> }; }

/** 某个弟子到了拿主意的那天：挑一件事做（AI 先想好了就用 AI 的） */
function decideOne(w: World, r: Rng, p: Person, unc: Unconvinced[], pk: Pick | undefined) {
  if (p.job === 'travel') { p.lastAct = 'travel'; return; }
  if (p.breaking) { p.lastAct = 'seclude'; return; }
  const cs = choicesFor(w, p, { unc });
  const c = (pk && cs.find((x) => x.id === pk.id)) || rulePick(r, cs);
  p.lastWhy = pk?.why && pk.id === c.id ? pk.why : undefined;
  if (!p.lastWhy && c.kind !== 'work' && r.chance(0.6)) p.lastWhy = templateWhy(w, r, p, c);
  applyChoice(w, r, p, c, emptyWork());
  // 见不得光的事不进纪事、不进经历，心里话也不让宗主看见；叛逃在 leaveSect 里已经报过
  if (SECRET_ACTS.includes(c.kind)) { p.lastWhy = undefined; return; }
  if (c.kind === 'defect' || !p.alive || p.sect !== 'me') return;
  if (p.lastWhy) emit({ k: 'say', who: p.id, text: p.lastWhy });
  const routine = ['work', 'diligent', 'cultivate', 'slack'].includes(c.kind);
  const byAi = pk?.by === 'ai' && pk.id === c.id;
  const sched = w.sched!;
  // 大事都报；日常的事（偷懒、拼命、挤时间修炼）标记的人和 AI 说了话的照报，其余一季最多三条
  const show = !routine || p.starred || byAi || (!!p.lastWhy && sched.routineLeft-- > 0);
  if (show && !(c.kind === 'work' && !p.lastWhy)) {
    report(w, { text: `${p.name}：${c.label}。`, tone: 'story', about: [p.id], quote: p.lastWhy ? { who: p.id, text: p.lastWhy } : undefined });
  }
  // 经历只记有分量的事；日常的事只在 AI 替他说了话时记
  const fresh = p.lastWhy && !p.life.slice(-6).some((l) => l.text.includes(p.lastWhy!));
  if (!routine || (fresh && byAi)) addLife(w, p, p.lastWhy ? `${c.label}——"${p.lastWhy}"` : c.label, 'story');
}

/** 每天：心情慢慢回到中间，讨厌的活、不服的人一点点积怨。f 是一天占一季的几分之几 */
function moodTick(w: World, unc: Unconvinced[], work: Work, f: number) {
  const s = w.sect;
  const pillTo = new Set(w.pillTo ?? []);
  const lawCalm = 3 + work.lawPower * 1.5 + (s.tech.includes('rules') ? 2 : 0) + (s.heritage === 'mind' ? 1 : 0);
  for (const p of members(w)) {
    let g = -lawCalm;
    if (p.dislikes.includes(p.job)) g += 4;
    if (p.likes.includes(p.job)) g -= 2;
    for (const u of unc.filter((x) => x.who === p.id)) {
      g += (4 + u.gap * 0.08) * (1 + Math.max(0, disp(p, 'pride')) * 0.3);
      op(p, u.over).respect = clamp(op(p, u.over).respect - 3 * f, -100, 100);
    }
    if (!pillTo.has(p.id) && disp(p, 'envy') > 0 && members(w).some((q) => pillTo.has(q.id) && q.rank === p.rank)) g += 2 * disp(p, 'envy');
    p.grudge = clamp(p.grudge + g * f, 0, 100);
    let m = (55 - p.mood) * 0.15 + (p.likes.includes(p.job) ? 3 : 0) - (p.dislikes.includes(p.job) ? 3 : 0) - (p.hp < 50 ? 4 : 0);
    if (Object.values(p.ops).some((o) => o.tag === 'lover')) m += 2;
    if (s.policy === 'sword' && disp(p, 'temper') > 0) m += 1;
    p.mood = clamp(p.mood + m * f, 0, 100);
    if (p.grudge >= 60) p.loyalty = clamp(p.loyalty - 2 * f, 0, 100);
    if (p.grudge <= 10 && p.mood >= 60) p.loyalty = clamp(p.loyalty + 1 * f, 0, 100);
    p.hp = clamp(p.hp + 10 * f, 0, 100);
  }
  // 德不配位的人，下面的人看不起
  for (const p of members(w)) {
    if (!underqualified(p)) continue;
    for (const q of members(w)) if (q.id !== p.id && (q.job === p.head || q.job === p.job)) op(q, p.id).respect = clamp(op(q, p.id).respect - 4 * f, -100, 100);
  }
}

/**
 * 过一天。山上的事按天推进：干活、修炼、收入天天有；月初发月例；
 * 每个弟子一季里挑一天拿主意；工程、出门的队伍、闭关、宗主的事到日子就出结果；待裁决的事过期按默认办。
 * 季末那天结算一季（心愿、寿元、品阶、开春），返回这一季的小结；平常返回 null。
 */
export function dayTick(w: World, ai: AiPicks = {}): Summary | null {
  const r = rngOf(w);
  const s = w.sect;
  if (!w.sched) scheduleSeason(w, r);
  const sched = w.sched!;
  const d = w.day ?? 0;
  const now = nowDay(w);
  const f = 1 / SEASON_DAYS;

  // 一、待裁决：新冒出来的记上期限；过期的按默认办
  for (const x of w.decisions) {
    if (x.due === undefined) { x.at = now; x.due = now + DECISION_DAYS; emit({ k: 'decision', id: x.id }); }
  }
  for (const x of [...w.decisions]) {
    if (x.due! > now) continue;
    const label = x.options.find((o) => o.id === x.fallback)?.label ?? '不管';
    resolveDecision(w, r, x.id, x.fallback);
    report(w, { text: `「${x.title}」一直没等到你拍板，按"${label}"办了。`, tone: 'info', about: x.about });
  }

  // 二、月初发月例
  if (d % MONTH_DAYS === 0) {
    const cost = upkeepCost(w) / 3;
    if (payUpkeep(w, 1 / 3)) { if (cost >= 1) emit({ k: 'float', at: 'main', text: `月例 −${Math.round(cost)}灵石`, tone: 'bad' }); }
    else {
      report(w, { text: '灵石不够发月例了！弟子们怨声载道。', tone: 'bad', about: [], big: true, chronicle: false });
      emit({ k: 'banner', text: '灵石不够发月例了！', tone: 'bad' });
    }
  }

  // 三、干活、修炼
  const unc = unconvinced(w);
  const work = doWork(w, r, unc, f);
  masterDaily(w, work, f);
  w.work = work;
  const cul = cultivate(w, r, work, f, new Set(w.pillTo ?? []));
  for (const p of cul.leveled) {
    if (p.realm >= 1 || p.starred) addLife(w, p, `修为精进到${realmText(p)}`, 'good');
    emit({ k: 'level', who: p.id, text: realmText(p) });
  }
  // 刚修到圆满的人来求冲关
  for (const p of cul.bottleneck) {
    if (p.id === w.me || !p.alive || p.sect !== 'me' || p.breaking) continue;
    addDecision(w, 'breakthrough', { who: p.id });
  }
  moodTick(w, unc, work, f);

  // 四、山门收入
  const base = { vein: 60, deep: 25, market: 35 }[s.site] + (s.veins - 2) * 30 + (s.tech.includes('market_shop') ? 40 : 0) + (s.site === 'market' ? 25 : 0);
  const income = (Math.round(base * (s.veinDebuff && s.veinDebuff > w.t ? 0.8 : 1)) + tierIncome(w)) * f;
  s.stones += income;
  s.ledger.income = (s.ledger.income ?? 0) + income;
  // 每半个月飘一次这半个月的产出
  if (d % 15 === 14) {
    for (const [key, at, name] of FLOW) {
      const v = (s.ledger[key] ?? 0) - (flowMark[key] ?? 0);
      if (v >= 1) emit({ k: 'float', at, text: `+${Math.round(v)}${name}`, tone: 'good' });
      flowMark[key] = s.ledger[key] ?? 0;
    }
  }

  // 五、今天轮到拿主意的弟子
  for (const p of members(w)) {
    let day = sched.acts[p.id];
    if (day === undefined) day = sched.acts[p.id] = d < SEASON_DAYS - 2 ? r.int(d + 1, SEASON_DAYS - 1) : -1;
    if (day === d && p.alive && p.sect === 'me') decideOne(w, r, p, unc, ai.picks?.[p.id]);
  }

  // 六、敌宗出手
  for (const rv of w.rivals) {
    if (sched.rivals[rv.id] !== d || !rv.alive || rv.passive || rv.status === 'war') continue;
    const cs = rivalChoices(w, rv);
    const pk = ai.rivalPicks?.[rv.id];
    const c = (pk && cs.find((x) => x.id === pk.id)) || ruleRivalPick(r, cs);
    rv.lastWhy = pk?.why && pk.id === c.id ? pk.why : undefined;
    applyRivalMove(w, r, rv, c, work);
    // 明面上的动作才报；挖人、派奸细是暗地里的
    if (rv.lastMove && rv.lastWhy && !rv.hidden) report(w, { text: `${rv.name}宗主${nm(w, rv.master)}：${rv.lastMove}。`, tone: 'info', about: [], quote: { who: rv.master, text: rv.lastWhy } });
  }

  // 七、事件奇遇、上门投奔、人和人之间
  if (d === sched.events) rollEvents(w, r);
  if (d === sched.walkin) newCandidates(w, r, work.recruitPower, 'walkin');
  if (d === sched.social) socialize(w, r);

  // 八、到日子的：工程落成、队伍回山、出关、宗主做完一轮、打上门
  finishWorks(w);
  settleExpeditions(w, r, now);
  finishBreaks(w, r);
  masterTick(w, r);
  ageCandidates(w);
  if (w.pendingWar && !w.war) {
    const pw = w.pendingWar;
    const rv = w.rivals.find((x) => x.id === pw.enemy);
    if (pw.at === undefined) {
      pw.at = now + WAR_DAYS;
      emit({ k: 'banner', text: pw.byPlayer ? `大军开拔，${WAR_DAYS} 日后与${rv?.name ?? '敌宗'}开战` : `${rv?.name ?? '敌宗'}大军压境，${WAR_DAYS} 日后攻山！`, tone: 'bad' });
    } else if (now >= pw.at) {
      startWar(w, pw.enemy, pw.byPlayer);
      emit({ k: 'banner', text: pw.byPlayer ? `与${rv?.name ?? '敌宗'}开战了` : `${rv?.name ?? '敌宗'}打上山门了！`, tone: 'bad' });
    }
  }
  for (const [pid, rid] of Object.entries(w.offers)) {
    const p = P(w, pid);
    const rv = w.rivals.find((x) => x.id === rid);
    if (!p?.alive || p.sect !== 'me' || !rv?.alive) delete w.offers[pid];
  }
  w.members = w.members.filter((id) => P(w, id)?.alive && P(w, id)?.sect === 'me');
  if (members(w).length === 0) w.over = { win: false, text: '弟子走的走、死的死，山上只剩你一个人。宗门散了。' };

  // 九、往前走一天；到季末结算
  w.day = d + 1;
  let sum: Summary | null = null;
  if (w.day >= SEASON_DAYS) {
    sum = endSeason(w, r);
    startSeason(w, r);
  }
  r.save();
  return sum;
}

/** 季末：一季里慢慢攒下的事一起结算 */
function endSeason(w: World, r: Rng): Summary {
  const s = w.sect;
  const work = w.work ?? emptyWork();
  // 被"压一压"的人，每年开春再来求一次
  if (w.t % 4 === 3) for (const p of members(w)) if (atBottleneck(p) && !p.breaking) addDecision(w, 'breakthrough', { who: p.id });
  // 德不配位的人，偶尔闹出事
  for (const p of members(w)) {
    const why = underqualified(p);
    if (why && r.chance(0.12)) { report(w, { text: `${p.name}${why}，手下的人阳奉阴违。`, tone: 'bad', about: [p.id] }); p.mood = clamp(p.mood - 5, 0, 100); }
  }
  if (s.policy === 'hide') s.rep = Math.max(0, s.rep - 1.5);

  // 历练、敌宗一季的变化
  travelTick(w, r);
  rivalTick(w, r);

  // 试用期、心愿
  probationTick(w);
  const wishNews = settleWishes(w, r);
  w.stats.credited += wishNews.filter((x) => x.credit).length;
  for (const x of thwarted(w)) report(w, { text: x.text, tone: 'bad', about: [x.p.id] });
  const newWishes: string[] = [];
  for (const p of members(w)) {
    if (p.wish) continue;
    // 心愿成了或者断了以后，过一阵才生新的
    if (r.chance(0.5)) { p.wish = ruleWish(w, r, p); if (p.wish) { p.wishPending = true; newWishes.push(p.id); } }
  }

  // 才干退步、性情随岗位变、资历
  for (const p of members(w)) {
    const used = p.job in HALL ? [HALL[p.job as keyof typeof HALL].skill, HALL[p.job as keyof typeof HALL].skill2] : [];
    for (const sk of SKILLS) if (!used.includes(sk) && p.skills[sk] > p.caps[sk] * 0.4) p.skills[sk] = Math.max(0, p.skills[sk] - 0.3);
    p.tenure += 1;
    p.served[p.job] = (p.served[p.job] ?? 0) + 1;
    p.seniority += 1;
    if ((p.served[p.job] ?? 0) >= 8 && r.chance(0.05)) drift(w, r, p, p.job as 'law', 1);
    if (p.grudge >= 70 && r.chance(0.05)) drift(w, r, p, 'oppressed', 1);
  }

  // 寿元
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

  // 品阶、大计；来人走人，时间往前
  checkTier(w);
  checkGoal(w);
  if (w.t % 4 === 3) turnYear(w, r);
  w.acts = [];
  w.t += 1;
  w.day = 0;
  if (w.t % 4 === 0) {
    w.needPolicy = true;
    w.needTech = true;
    s.policy = null;
  }
  newCandidates(w, r, work.recruitPower, 'open');
  refreshBoard(w, r);
  for (const d of w.decisions) refreshDecision(w, d);
  if (year(w.t) > w.endYear && !w.war) w.over = endText(w);
  if (members(w).length === 0) w.over = { win: false, text: '弟子走的走、死的死，山上只剩你一个人。宗门散了。' };
  if (!w.people[w.me].alive) w.over = { win: false, text: '你寿元耗尽，坐化了。' };
  const before = w.before ?? {};
  w.delta = Object.fromEntries(RES_KEYS.map((k) => [k, Math.round((s[k] - (before[k] ?? s[k])) * 10) / 10]));
  return { t: w.t, wishNews, newWishes, deaths };
}

/** 一口气过完这一季剩下的日子（测试、平衡模拟用）。中途打起仗来就停下，等打完再接着过 */
export function advanceSeason(w: World, _plan: Plan | null, picks: Record<string, Pick> = {}, rivalPicks: Record<string, Pick> = {}): Summary {
  const t0 = w.t;
  let sum: Summary | null = null;
  for (let i = 0; i < SEASON_DAYS + 1 && w.t === t0 && !w.over; i++) {
    sum = dayTick(w, { picks, rivalPicks }) ?? sum;
    if (w.war && w.war.phase === 'prep' && w.t === t0) break;
  }
  return sum ?? { t: w.t, wishNews: [], newWishes: [], deaths: [] };
}

/** 一局到年头了（打完仗、收兵时也要查一下） */
export function checkEnd(w: World) {
  if (!w.over && !w.war && year(w.t) > w.endYear) w.over = endText(w);
}

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


