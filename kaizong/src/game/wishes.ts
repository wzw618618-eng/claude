// 心愿：每个人现在最想要的东西。入门时和人生大事之后定（AI 写，或规则按性格挑）。
// 每季检查有没有被成全、有没有被断掉；如果是宗主的决定促成的——哪怕宗主根本不知道他有这个心愿——他会记在宗主头上。

import { REALM_NAME } from './cult';
import { HALL, HALLS, RANK_NAME, rankLv, SKILL_NAME, SKILLS } from './data/world';
import type { Rng } from './rng';
import type { HallId, Person, PlayerAct, Rank, Skill, Wish, WishKind, World } from './types';
import { addLife, clamp, disp, hasTrait, members, nm, op, P, report } from './world';

export const WISH_NAME: Record<WishKind, string> = {
  realm: '突破境界', post: '当上主事', rank: '往上爬', revenge: '报仇', love: '求道侣', best: '技艺第一', found: '自立门户',
  recognition: '得宗主看重', leave: '回家', glory: '宗门扬名', mentor: '收个好徒弟', treasure: '得一件好法宝', spy: '完成密令',
};

/** 心愿的一个选项（给规则挑，也列给 AI 看） */
export interface WishOption { kind: WishKind; target?: string; param?: string; text: string; weight: number }

export function wishOptions(w: World, p: Person): WishOption[] {
  const out: WishOption[] = [];
  const amb = disp(p, 'ambition');
  const nextRealm = p.realm + 1;
  if (nextRealm <= 3) out.push({ kind: 'realm', param: String(nextRealm), text: `此生定要踏入${REALM_NAME[nextRealm]}`, weight: 2 + p.values.power * 3 + (p.root.apt > 1.3 ? 2 : 0) });
  const favHall = (p.likes.find((j) => (HALL as Record<string, unknown>)[j]) as HallId | undefined) ?? HALLS[0].id;
  out.push({ kind: 'post', param: favHall, text: `想当${HALL[favHall].name}主事`, weight: 1 + Math.max(0, amb) * 1.5 });
  const nextRank: Rank = p.rank === 'outer' || p.rank === 'probation' ? 'inner' : p.rank === 'inner' ? 'core' : p.rank === 'core' ? 'chief' : 'elder';
  out.push({ kind: 'rank', param: nextRank, text: `想当上${RANK_NAME[nextRank]}`, weight: 1 + Math.max(0, amb) * 2 + (hasTrait(p, 'vain') ? 1 : 0) });
  const bestSkill = SKILLS.reduce<Skill>((b, s) => (p.caps[s] > p.caps[b] ? s : b), 'combat');
  out.push({ kind: 'best', param: bestSkill, text: `${SKILL_NAME[bestSkill]}一道，要做到宗门第一`, weight: 1 + p.values.power * 2 + (hasTrait(p, 'swordnut') || hasTrait(p, 'pillnut') || hasTrait(p, 'craftnut') ? 3 : 0) });
  out.push({ kind: 'recognition', text: '想让宗主正眼看我一回', weight: 0.8 + (p.favor < 5 ? 1 : 0) + Math.max(0, disp(p, 'pride')) * 0.5 });
  out.push({ kind: 'glory', text: '想看着宗门名震一州', weight: 0.5 + p.values.loyalty * 2 });
  if (p.realm >= 1 || p.skills.teach >= 40) out.push({ kind: 'mentor', text: '想收一个能传衣钵的好徒弟', weight: 0.5 + disp(p, 'kindness') * 0.5 + p.skills.teach / 50 });
  out.push({ kind: 'treasure', text: '想得一件趁手的好法宝', weight: 0.5 + p.values.wealth * 2 + Math.max(0, disp(p, 'greed')) });
  if (hasTrait(p, 'filial') || p.values.bond > 0.7) out.push({ kind: 'leave', text: '想攒够本事，回家看看爹娘', weight: 0.6 + (hasTrait(p, 'filial') ? 2 : 0) });
  if (amb > 1.5 && p.realm >= 1) out.push({ kind: 'found', text: '总有一天，我要自己开宗立派', weight: amb + Math.max(0, disp(p, 'pride')) });
  // 求道侣：心里有人
  if (disp(p, 'romance') > -0.5) {
    const crush = members(w).filter((q) => q.id !== p.id && q.gender !== p.gender && (p.ops[q.id]?.aff ?? 0) >= 25)
      .sort((a, b) => (p.ops[b.id]?.aff ?? 0) - (p.ops[a.id]?.aff ?? 0))[0];
    if (crush) out.push({ kind: 'love', target: crush.id, text: `想和${crush.name}结为道侣`, weight: 1 + disp(p, 'romance') * 1.5 + (p.ops[crush.id].aff - 25) / 20 });
  }
  // 报仇：血仇在敌宗
  if (p.secret?.kind === 'vendetta') {
    const foe = enemyTarget(w, p);
    if (foe) out.push({ kind: 'revenge', target: foe, text: `查到了，害我家破人亡的是${nm(w, foe)}，此仇必报`, weight: 8 });
  }
  const enemies = Object.entries(p.ops).filter(([id, o]) => o.aff <= -60 && P(w, id)?.alive);
  if (enemies.length && disp(p, 'grudge') > 0) {
    const [id] = enemies.sort((a, b) => a[1].aff - b[1].aff)[0];
    out.push({ kind: 'revenge', target: id, text: `${nm(w, id)}欠我的，我迟早讨回来`, weight: 1 + disp(p, 'grudge') * 1.5 });
  }
  if (p.secret?.kind === 'spy' && !p.secret.exposed) out.push({ kind: 'spy', target: p.secret.patron, text: '摸清这里的底细，偷到功法，回去复命', weight: 10 });
  return out;
}

/** 血仇算在敌宗某个有名有姓的人头上（报仇的线索，也是"阴差阳错"的来源） */
function enemyTarget(w: World, p: Person): string | undefined {
  const pool = w.rivals.filter((r) => r.alive).flatMap((r) => r.named.concat(r.master)).filter((id) => P(w, id)?.alive);
  if (!pool.length) return undefined;
  // 用名字算一个固定的下标，同一个人每次挑出来的仇人一样
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

export function ruleWish(w: World, r: Rng, p: Person): Wish | null {
  const opts = wishOptions(w, p);
  const pick = r.weighted(opts.map((o) => [o, o.weight] as [WishOption, number]));
  if (!pick) return null;
  return { kind: pick.kind, text: pick.text, target: pick.target, param: pick.param, since: w.t, by: 'rule' };
}

/** 心愿成了没有 */
export function wishDone(w: World, p: Person): boolean {
  const x = p.wish;
  if (!x) return false;
  switch (x.kind) {
    case 'realm': return p.realm >= Number(x.param);
    case 'post': return p.head === x.param;
    case 'rank': return rankLv(p.rank) >= rankLv(x.param as Rank);
    case 'revenge': { const t = P(w, x.target); return !!t && !t.alive; }
    case 'love': return op(p, x.target!).tag === 'lover';
    case 'best': {
      const sk = x.param as Skill;
      return p.skills[sk] >= 55 && members(w).every((q) => q.id === p.id || q.skills[sk] < p.skills[sk]);
    }
    case 'recognition': return p.favor >= 20 || rankLv(p.rank) >= rankLv('core');
    case 'glory': return w.sect.rep >= 150;
    case 'mentor': return Object.entries(p.ops).some(([id, o]) => o.tag === 'pupil' && (P(w, id)?.root.apt ?? 0) >= 1.3);
    case 'treasure': return p.gear >= 3;
    default: return false;
  }
}

/** 是宗主的哪个决定促成的（找不到就返回 null） */
export function creditAct(w: World, p: Person): PlayerAct | null {
  const x = p.wish;
  if (!x) return null;
  const acts = w.acts;
  const by = (f: (a: PlayerAct) => boolean) => acts.find(f) ?? null;
  switch (x.kind) {
    case 'realm': return by((a) => (a.kind === 'break_pill' || a.kind === 'break_ok') && a.who === p.id);
    case 'post': return by((a) => a.kind === 'head' && a.who === p.id);
    case 'rank': return by((a) => a.kind === 'promote' && a.who === p.id);
    case 'recognition': return by((a) => (a.kind === 'promote' || a.kind === 'vouch' || a.kind === 'gift') && a.who === p.id);
    case 'revenge': return by((a) => a.kind === 'war_kill' && a.target === x.target) ?? by((a) => a.kind === 'punish' && a.who === x.target);
    case 'love': {
      const t = P(w, x.target);
      return by((a) => (a.kind === 'job' || a.kind === 'head') && (a.who === p.id || a.who === t?.id) && !!t && t.job === p.job) ?? recentPairing(w, p, t);
    }
    case 'best': return by((a) => (a.kind === 'job' || a.kind === 'head') && a.who === p.id && !!a.hall && (HALL as Record<string, { skill: string }>)[a.hall]?.skill === x.param);
    case 'glory': return by((a) => a.kind === 'war_win' || a.kind === 'policy');
    case 'mentor': return by((a) => a.kind === 'recruit');
    case 'treasure': return by((a) => a.kind === 'gift' && a.who === p.id);
    default: return null;
  }
}

/** 道侣成了，往前找宗主近一年里把两人放到一处的安排 */
function recentPairing(w: World, p: Person, t: Person | undefined): PlayerAct | null {
  if (!t || p.job !== t.job || p.job === 'none') return null;
  const mark = w.pairings[[p.id, t.id].sort().join('|')];
  return mark !== undefined && w.t - mark <= 4 ? { kind: 'job', who: p.id, text: `把${p.name}和${t.name}安排在一处` } : null;
}

export interface WishNews { p: Person; credit: PlayerAct | null; wish: Wish }

/** 季末：成全了的心愿结算，宗主促成的记功；没有心愿的人生一个新的 */
export function settleWishes(w: World, r: Rng): WishNews[] {
  const news: WishNews[] = [];
  for (const p of members(w)) {
    if (!p.wish) continue;
    if (!wishDone(w, p)) continue;
    const wish = p.wish;
    const credit = creditAct(w, p);
    p.mood = clamp(p.mood + 20, 0, 100);
    p.grudge = clamp(p.grudge - 20, 0, 100);
    if (credit) {
      p.loyalty = clamp(p.loyalty + 25, 0, 100);
      const me = w.people[w.me];
      const o = op(p, me.id); o.aff = clamp(o.aff + 30, -100, 100); o.respect = clamp(o.respect + 20, -100, 100);
      addLife(w, p, `心愿得偿：${wish.text}。${credit.kind === 'war_kill' ? '宗主' : '是宗主'}${actWhy(credit)}，成全了${p.gender === 'f' ? '她' : '他'}`, 'good', true);
    } else {
      addLife(w, p, `心愿得偿：${wish.text}`, 'good', true);
    }
    report(w, {
      text: credit ? `${p.name}多年的心愿「${wish.text}」成了——起因是你${actWhy(credit)}。${p.gender === 'f' ? '她' : '他'}把这份情记在了你头上。` : `${p.name}多年的心愿「${wish.text}」成了。`,
      tone: 'good', about: [p.id], big: !!credit,
    });
    news.push({ p, credit, wish });
    p.wish = null;
  }
  return news;
}

function actWhy(a: PlayerAct) {
  return a.text.replace(/^你/, '');
}

/** 宗主的决定断了谁的念想：想当主事的人看着位子给了别人 */
export function thwarted(w: World): { p: Person; text: string }[] {
  const out: { p: Person; text: string }[] = [];
  for (const a of w.acts) {
    if (a.kind === 'head' && a.hall) {
      for (const p of members(w)) {
        if (p.id === a.who || p.wish?.kind !== 'post' || p.wish.param !== a.hall) continue;
        p.grudge = clamp(p.grudge + 15, 0, 100);
        const o = op(p, a.who!); o.aff = clamp(o.aff - 15, -100, 100);
        addLife(w, p, `一心想当${HALL[a.hall as HallId].name}主事，宗主却给了${nm(w, a.who)}`, 'bad');
        out.push({ p, text: `${p.name}一直盼着当${HALL[a.hall as HallId].name}主事，你却给了${nm(w, a.who)}，${p.gender === 'f' ? '她' : '他'}心里很不是滋味。` });
      }
    }
    if (a.kind === 'promote' && a.who) {
      const t = P(w, a.who);
      if (t?.rank === 'chief') {
        for (const p of members(w)) {
          if (p.id === t.id || p.wish?.kind !== 'rank' || p.wish.param !== 'chief') continue;
          p.grudge = clamp(p.grudge + 15, 0, 100);
          op(p, t.id).aff -= 15;
          out.push({ p, text: `${p.name}一直想当首席弟子，你却选了${t.name}。` });
        }
      }
    }
  }
  return out;
}
