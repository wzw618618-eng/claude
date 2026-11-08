// 每季每个弟子能做的事。代码列出合法的做法，规则按性情打分；重要的人交给 AI 挑。
// 不管谁挑，结果都由 resolve.ts 按规则算。

import { atBottleneck, lvl, power, yearsLeft } from './cult';
import { HALL, HALLS, JOB_NAME, RANK_EXPECT, RANK_NAME, RANK_ORDER, rankLv } from './data/world';
import type { Rng } from './rng';
import { tolerance, type Unconvinced } from './sect';
import type { HallId, Person, Rank, World } from './types';
import { disp, hasTrait, members, nm, op, P } from './world';

export type ActKind =
  | 'work' | 'diligent' | 'slack' | 'cultivate' | 'spar' | 'befriend' | 'woo' | 'confess' | 'mentor' | 'scheme' | 'report'
  | 'request_post' | 'request_rank' | 'challenge' | 'faction' | 'steal' | 'leak' | 'defect' | 'leave' | 'adventure' | 'seclude'
  | 'help' | 'found';

export interface Choice { id: string; kind: ActKind; label: string; target?: string; hall?: HallId; score: number }

export interface Ctx { unc: Unconvinced[] }

const nextRank = (r: Rank): Rank | null => {
  const i = RANK_ORDER.indexOf(r);
  const n = RANK_ORDER[i + 1];
  return n && n !== 'master' && n !== 'chief' ? n : r === 'core' ? 'chief' : null;
};

export function choicesFor(w: World, p: Person, ctx: Ctx): Choice[] {
  const D = (k: Parameters<typeof disp>[1]) => disp(p, k);
  const out: Choice[] = [];
  const add = (c: Omit<Choice, 'id'>) => out.push({ ...c, id: c.target ? `${c.kind}:${c.target}` : c.hall ? `${c.kind}:${c.hall}` : c.kind });
  const wish = p.wish;
  const working = p.job !== 'none' && p.job !== 'seclude' && p.job !== 'travel';
  const others = members(w).filter((q) => q.id !== p.id);

  // 本分
  add({ kind: 'work', label: working ? `在${JOB_NAME[p.job]}安分做事` : '按部就班地修炼、听候差遣', score: 3 + D('order') * 0.5 + D('diligence') * 0.3 - p.grudge / 40 });
  if (working) {
    add({ kind: 'diligent', label: `在${JOB_NAME[p.job]}拼命做事，想做出点名堂`, score: 1 + D('diligence') * 1.2 + D('ambition') * 0.5 + (wish && ['post', 'rank', 'recognition'].includes(wish.kind) ? 1.5 : 0) - p.grudge / 30 });
    if (p.grudge >= 20 || D('diligence') < 0) add({ kind: 'slack', label: '敷衍了事，能偷懒就偷懒', score: p.grudge / 15 - D('order') * 0.5 - D('diligence') * 0.8 + (p.dislikes.includes(p.job) ? 1 : 0) });
    add({ kind: 'cultivate', label: '少干点活，挤时间修炼', score: 1 + p.values.power * 2 + (wish?.kind === 'realm' ? 2 : 0) - D('order') * 0.3 });
  }

  // 冲关
  if (atBottleneck(p)) {
    const left = yearsLeft(p);
    add({ kind: 'seclude', label: `修为圆满，不等宗主发话，自己闭关冲击${['筑基', '结丹', '元婴', '化神'][p.realm]}`, score: 0.5 + D('courage') * 0.5 - D('order') * 0.8 + (left < 15 ? 4 : 0) + (wish?.kind === 'realm' ? 1.5 : 0) });
  }

  // 同门之间
  const peers = others.filter((q) => Math.abs(lvl(q) - lvl(p)) <= 3);
  const sparT = pickBy(peers, (q) => (op(p, q.id).tag === 'rival' ? 3 : 0) + (op(p, q.id).respect < 0 ? 1 : 0));
  if (sparT) add({ kind: 'spar', target: sparT.id, label: `找${sparT.name}切磋（${cmpPower(p, sparT)}）`, score: 0.5 + D('temper') * 0.4 + D('courage') * 0.3 + (w.sect.policy === 'sword' ? 1.5 : 0) + (wish?.kind === 'best' && wish.param === 'combat' ? 1 : 0) });
  const friendT = pickBy(others.filter((q) => { const a = op(p, q.id).aff; return a > -10 && a < 55; }), (q) => (q.job === p.job ? 2 : 0) + op(p, q.id).aff / 30);
  if (friendT) add({ kind: 'befriend', target: friendT.id, label: `和${friendT.name}多走动，交个朋友`, score: 0.6 + D('social') * 0.5 + D('kindness') * 0.3 });
  if (D('romance') > -1) {
    const crush = wish?.kind === 'love' ? P(w, wish.target) : pickBy(others.filter((q) => q.gender !== p.gender && op(p, q.id).aff >= 15 && op(p, q.id).tag !== 'lover'), (q) => op(p, q.id).aff);
    if (crush?.alive && op(p, crush.id).tag !== 'lover' && crush.sect === p.sect) {
      if (op(p, crush.id).aff >= 50) add({ kind: 'confess', target: crush.id, label: `向${crush.name}表明心意`, score: D('romance') + D('courage') * 0.4 + (wish?.kind === 'love' && wish.target === crush.id ? 4 : 0) });
      else add({ kind: 'woo', target: crush.id, label: `对${crush.name}示好`, score: D('romance') * 1 + (wish?.kind === 'love' && wish.target === crush.id ? 3 : 0) });
    }
  }
  if (p.skills.teach >= 25 || p.realm >= 1) {
    const junior = pickBy(others.filter((q) => lvl(q) <= lvl(p) - 3 && op(p, q.id).tag !== 'master'), (q) => q.root.apt + op(p, q.id).aff / 50);
    if (junior) add({ kind: 'mentor', target: junior.id, label: `指点晚辈${junior.name}`, score: p.skills.teach / 40 + D('kindness') * 0.4 + (wish?.kind === 'mentor' ? 2 : 0) });
  }
  const sufferer = pickBy(others.filter((q) => (q.hp < 50 || q.mood < 30) && op(p, q.id).aff > 20), (q) => op(p, q.id).aff);
  if (sufferer) add({ kind: 'help', target: sufferer.id, label: `照顾${sufferer.hp < 50 ? '受了伤' : '心情低落'}的${sufferer.name}`, score: D('kindness') * 0.8 + op(p, sufferer.id).aff / 40 });

  // 往上爬、使绊子
  if (D('cunning') > 0) {
    const foe = pickBy(others.filter((q) => op(p, q.id).aff <= -30 || (D('envy') > 0 && wish?.kind === 'post' && q.head === wish.param)), (q) => -op(p, q.id).aff + (q.head ? 20 : 0));
    if (foe) add({ kind: 'scheme', target: foe.id, label: `在背后给${foe.name}使绊子`, score: D('cunning') * 0.6 + D('envy') * 0.6 + D('grudge') * 0.3 - D('order') * 0.5 - D('kindness') * 0.5 + (wish?.kind === 'post' && foe.head === wish.param ? 2 : 0) + (wish?.kind === 'revenge' && wish.target === foe.id ? 3 : 0) });
  }
  const sinner = w.misdeeds.find((m) => m.who !== p.id && w.t - m.t <= 1 && P(w, m.who)?.job === p.job);
  if (sinner) add({ kind: 'report', target: sinner.who, label: `向宗主告发${nm(w, sinner.who)}${sinner.what}`, score: D('order') * 0.8 + p.values.justice * 1.5 - D('kindness') * 0.3 + (op(p, sinner.who).aff < 0 ? 1 : 0) });
  const want = (wish?.kind === 'post' ? wish.param as HallId : null) ?? (p.dislikes.includes(p.job) ? (p.likes.find((j) => j in HALL) as HallId | undefined) : undefined);
  if (want && want !== p.job) add({ kind: 'request_post', hall: want, label: `求宗主把自己调去${HALL[want].name}`, score: (p.dislikes.includes(p.job) ? 2 : 0) + (wish?.kind === 'post' ? 1.5 : 0) + D('courage') * 0.2 });
  const nr = nextRank(p.rank);
  if (nr && p.rank !== 'probation' && lvl(p) >= RANK_EXPECT[nr]) add({ kind: 'request_rank', label: `觉得自己该当${RANK_NAME[nr]}了，去找宗主说`, score: D('ambition') * 0.8 + p.grudge / 30 + (wish?.kind === 'rank' ? 1.5 : 0) + D('pride') * 0.2 });

  // 不服
  const myUnc = ctx.unc.filter((u) => u.who === p.id);
  for (const u of myUnc) {
    const sup = P(w, u.over);
    if (!sup || p.grudge < 30) continue;
    if (power(p) >= power(sup) * 0.8) add({ kind: 'challenge', target: sup.id, label: `当众挑战${sup.name}，凭什么${sup.gender === 'f' ? '她' : '他'}在我上头`, score: 1 + D('pride') * 0.8 + D('temper') * 0.5 + p.grudge / 25 - D('order') * 0.6 });
  }
  if (p.grudge >= 35 && D('social') > -1.5) {
    const n = others.filter((q) => q.grudge >= 30).length;
    if (n >= 1) add({ kind: 'faction', label: `暗中拉拢几个同样不满的人`, score: p.grudge / 25 + D('cunning') * 0.4 + D('ambition') * 0.4 - D('order') * 0.6 });
  }

  // 走歪路
  if ((D('greed') >= 1 && p.loyalty < 45) || (p.secret?.kind === 'spy' && !p.secret.exposed)) add({ kind: 'steal', label: '趁人不备，顺走些灵石丹药', score: D('greed') * 0.8 - D('order') * 0.8 - p.loyalty / 40 + (p.secret?.kind === 'spy' ? 1 : 0) });
  if (p.secret?.kind === 'spy' && !p.secret.exposed) add({ kind: 'leak', label: `给${w.rivals.find((r) => r.id === p.secret!.patron)?.name ?? '主家'}送信，报这里的底细`, score: 3 + (wish?.kind === 'spy' ? 1 : 0) });
  const lure = w.rivals.find((r) => r.alive && r.id === w.offers[p.id]);
  if ((p.grudge >= 55 && p.loyalty <= 35) || lure) {
    const r = lure ?? w.rivals.filter((x) => x.alive && !x.passive).sort((a, b) => b.rep - a.rep)[0];
    if (r) add({ kind: 'defect', target: r.id, label: `投奔${r.name}${lure ? '（他们开了条件）' : ''}`, score: (p.grudge - 50) / 10 + D('ambition') * 0.4 - p.loyalty / 30 + (lure ? 2 : 0) - tolerance(p) * 2 });
  }
  if (p.loyalty <= 25 || wish?.kind === 'leave') add({ kind: 'leave', label: wish?.kind === 'leave' ? '向宗主请辞，下山回家' : '心灰意冷，想离开宗门', score: (wish?.kind === 'leave' ? 1.5 : 0) + (25 - p.loyalty) / 10 });
  if (wish?.kind === 'found' && p.realm >= 1 && (p.grudge >= 30 || p.loyalty < 45)) add({ kind: 'found', label: '带几个亲近的人下山，自立门户', score: 3 + D('ambition') * 0.5 });
  if (p.job !== 'travel' && (D('courage') > 0 || wish?.kind === 'treasure' || hasTrait(p, 'curious'))) add({ kind: 'adventure', label: '求宗主准自己下山历练', score: D('courage') * 0.5 + (wish?.kind === 'treasure' ? 1.5 : 0) + (hasTrait(p, 'curious') ? 1 : 0) - (working ? 0.5 : 0) });

  return out;
}

function pickBy<T>(arr: T[], score: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bs = -Infinity;
  for (const x of arr) {
    const s = score(x);
    if (s > bs) { bs = s; best = x; }
  }
  return best;
}

function cmpPower(a: Person, b: Person) {
  const r = power(a) / Math.max(1, power(b));
  return r > 1.3 ? `${b.name}比你弱` : r < 0.77 ? `${b.name}比你强` : '旗鼓相当';
}

/** 规则替他挑：分高的更可能被选中，但不是每次都选最高的 */
export function rulePick(r: Rng, cs: Choice[]): Choice {
  const top = [...cs].sort((a, b) => b.score - a.score).slice(0, 4);
  return r.weighted(top.map((c) => [c, Math.max(0.05, c.score) ** 2] as [Choice, number])) ?? cs[0];
}

/** 给 AI 看的选项：分最高的若干个，保证"安分做事"在里面 */
export function aiOptions(cs: Choice[], n = 8): Choice[] {
  const sorted = [...cs].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, n);
  const work = cs.find((c) => c.kind === 'work');
  if (work && !top.includes(work)) top[top.length - 1] = work;
  return top;
}

export const allHalls = HALLS.map((h) => h.id);
export const rankAbove = (a: Rank, b: Rank) => rankLv(a) > rankLv(b);
