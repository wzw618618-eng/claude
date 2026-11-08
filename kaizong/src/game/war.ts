// 宗门战：靠决策，不靠手速。战前定人、定打法；打三轮，每轮之间做一个决定。
// 弟子在战场上怎么表现看性格：有人死战，有人临阵脱逃，奸细会倒戈。

import { power } from './cult';
import { drift } from './decisions';
import type { Rng } from './rng';
import { rivalStrength } from './rivals';
import type { Person, Rival, Stance, World } from './types';
import { addLife, adjust, clamp, disp, me, members, P, report } from './world';

export const STANCE_NAME: Record<Stance, string> = { hold: '据守', sally: '主动出击', ambush: '设伏' };

export function startWar(w: World, enemy: string, byPlayer: boolean) {
  const rv = w.rivals.find((r) => r.id === enemy)!;
  rv.status = 'war';
  const team = members(w).filter((p) => p.job !== 'travel').sort((a, b) => power(b) - power(a)).slice(0, 6).map((p) => p.id);
  w.war = {
    enemy, byPlayer, stake: byPlayer ? 'vein' : 'mountain', round: 0, wins: 0, losses: 0, team, stance: byPlayer ? 'sally' : 'hold',
    masterUsed: false, log: [], phase: 'prep', enemyTeam: [rv.master, ...rv.named].filter((id) => P(w, id)?.alive && P(w, id)?.sect === enemy), startedAt: w.t,
  };
  w.pendingWar = undefined;
}

/** 这个人在战场上会怎样 */
function conduct(w: World, r: Rng, p: Person, rv: Rival): { f: number; tag: 'brave' | 'flee' | 'betray' | 'normal' } {
  if (p.secret?.kind === 'spy' && !p.secret.exposed && p.secret.patron === rv.id) return { f: -0.5, tag: 'betray' };
  const revenge = p.wish?.kind === 'revenge' && P(w, p.wish.target)?.sect === rv.id;
  if (revenge || disp(p, 'courage') >= 1.5 || (p.loyalty >= 80 && r.chance(0.5))) return { f: 1.3, tag: 'brave' };
  if ((disp(p, 'courage') <= -1.5 && r.chance(0.45)) || (p.loyalty < 30 && r.chance(0.35)) || (p.grudge > 70 && r.chance(0.3))) return { f: 0, tag: 'flee' };
  return { f: 1, tag: 'normal' };
}

export interface RoundResult { win: boolean; ours: number; theirs: number; lines: string[] }

export function fightRound(w: World, r: Rng, useMaster: boolean): RoundResult {
  const war = w.war!;
  const rv = w.rivals.find((x) => x.id === war.enemy)!;
  const s = w.sect;
  war.round += 1;
  const lines: string[] = [];
  const team = war.team.map((id) => P(w, id)).filter((p): p is Person => !!p?.alive && p.sect === 'me');
  let ours = 0;
  for (const p of team) {
    const c = conduct(w, r, p, rv);
    ours += power(p) * c.f;
    if (c.tag === 'betray') {
      p.secret!.exposed = true;
      lines.push(`${p.name}临阵倒戈——原来是${rv.name}的奸细！`);
      addLife(w, p, '在宗门战中倒戈，投向了主家', 'bad', true);
      p.sect = rv.id; rv.named.push(p.id);
      w.members = w.members.filter((id) => id !== p.id);
      for (const q of members(w)) { adjust(q, p.id, -60); drift(w, r, q, 'betrayed', 0.15); }
    } else if (c.tag === 'flee') {
      lines.push(`${p.name}临阵脱逃。`);
      p.fame = Math.max(0, p.fame - 8);
      addLife(w, p, '宗门战中临阵脱逃', 'bad', true);
      for (const q of members(w)) if (q.id !== p.id) adjust(q, p.id, -10, -15);
    } else if (c.tag === 'brave' && r.chance(0.5)) {
      lines.push(`${p.name}${p.wish?.kind === 'revenge' ? '红着眼' : ''}冲在最前面。`);
    }
  }
  const has = (t: string) => s.tech.includes(t);
  let mult = 1 + Math.min(0.4, s.armory / Math.max(1, team.length * 25));
  if (has('sword_array')) mult *= 1.15;
  if (s.policy === 'sword') mult *= 1.1;
  if (war.stance === 'hold') mult *= war.stake === 'mountain' ? (has('guard_array') ? 1.6 : 1.3) : 1.05;
  if (war.stance === 'sally') mult *= 1.12;
  const intelOurs = (s.foresight && s.foresight >= war.startedAt ? 1 : 0) + members(w).filter((p) => p.secret?.kind === 'spy' && p.secret.exposed && p.secret.patron === rv.id).length;
  if (war.stance === 'ambush') mult *= intelOurs > 0 ? 1.45 : 0.85;
  // 盟友派人助阵
  const allies = w.rivals.filter((x) => x.alive && x.status === 'ally' && x.id !== rv.id);
  if (allies.length) { ours += allies.reduce((t, a) => t + rivalStrength(w, a) * 0.08, 0); if (war.round === 1) lines.push(`${allies.map((a) => a.name).join('、')}派人来助阵。`); }
  ours *= mult * r.range(0.8, 1.2);
  // 对面
  const enemies = war.enemyTeam.map((id) => P(w, id)).filter((p): p is Person => !!p?.alive && p.sect === rv.id);
  const master = P(w, rv.master);
  const fighters = enemies.filter((p) => p.id !== rv.master);
  // 敌宗不会倾巢而出：有名有姓的上阵，无名弟子只来一部分
  let theirs = fighters.reduce((t, p) => t + power(p), 0) + rv.crowd.qi * 0.25 * 22 + rv.crowd.found * 0.35 * 130;
  theirs *= (1 + (rv.intel ?? 0) * 0.05) * (war.stake === 'mountain' && war.byPlayer ? 1.2 : 1) * r.range(0.8, 1.2);
  // 宗主出手：两边宗主对上
  const masterIn = master?.alive && master.sect === rv.id && (war.round >= 3 || (war.round === 2 && war.wins >= 1 && rv.style !== 'proper'));
  if (useMaster) {
    war.masterUsed = true;
    const m = me(w);
    ours += power(m) * 0.6;
    if (!masterIn) m.hp = clamp(m.hp - r.int(0, 10), 5, 100);
    lines.push(`你亲自出手了。`);
    if (masterIn) {
      theirs += power(master!) * 0.38;
      const mine = power(m), his = power(master!);
      const win = r.chance(mine ** 2 / (mine ** 2 + his ** 2));
      const loser = win ? master! : m;
      loser.hp = clamp(loser.hp - r.int(20, 45), 5, 100);
      lines.push(win ? `你和${master!.name}交手，占了上风。` : `你和${master!.name}交手，吃了亏。`);
      if (win) ours *= 1.2; else theirs *= 1.2;
    }
  } else if (masterIn) {
    theirs += power(master!) * 0.38;
    lines.push(`${master!.name}亲自下场了。`);
  }
  const win = ours > theirs;
  if (win) war.wins += 1; else war.losses += 1;
  // 伤亡
  const ratio = win ? theirs / Math.max(1, ours) : ours / Math.max(1, theirs);
  const losers = win ? fighters : team.filter((p) => p.sect === 'me');
  const hurtMul = war.stance === 'sally' ? 1.3 : 1;
  for (const p of losers) {
    const dmg = r.range(10, 40) * (1.2 - ratio * 0.5) * (win ? 1 : hurtMul);
    p.hp -= dmg;
    if (p.hp <= 0) {
      p.alive = false; p.hp = 0;
      p.death = win ? `死于和${w.sect.name}的宗门战` : `在宗门战中战死`;
      addLife(w, p, p.death, 'bad', true);
      lines.push(win ? `${rv.name}的${p.name}战死。` : `${p.name}战死了。`);
      if (win) w.acts.push({ kind: 'war_kill', target: p.id, text: `${war.byPlayer ? '为抢灵脉' : '守山'}和${rv.name}开战` });
    } else if (dmg > 25) lines.push(`${p.name}受了重伤。`);
  }
  if (win) rv.crowd.qi = Math.max(0, rv.crowd.qi - r.int(2, 5));
  // 赢的一方小伤
  const winners = win ? team : fighters;
  for (const p of winners) if (p.alive) p.hp = clamp(p.hp - r.range(0, 12), 1, 100);
  for (const p of team) if (p.alive && p.sect === 'me') { p.merit += 8; if (win) p.fame += 2; }
  w.members = w.members.filter((id) => P(w, id)?.alive);
  war.log.push({ text: `第${war.round}轮：${win ? '我方占优' : '敌方占优'}（${Math.round(ours)} 对 ${Math.round(theirs)}）。${lines.join('')}`, tone: win ? 'good' : 'bad' });
  return { win, ours, theirs, lines };
}

/** 两轮之间：用丹药疗伤 */
export function healTeam(w: World) {
  const war = w.war!;
  const n = Math.min(Math.floor(w.sect.pills), 10);
  w.sect.pills -= n;
  for (const id of war.team) { const p = P(w, id); if (p?.alive) p.hp = clamp(p.hp + n * 3, 0, 100); }
  war.log.push({ text: `用了${n}颗丹药给出战的弟子疗伤。`, tone: 'info' });
}

/** 打完了（三轮或撤退）：结算 */
export function endWar(w: World, r: Rng, retreat = false): { win: boolean; text: string; wiped: boolean } {
  const war = w.war!;
  const rv = w.rivals.find((x) => x.id === war.enemy)!;
  const s = w.sect;
  const win = !retreat && war.wins >= 2;
  let text = '';
  let wiped = false;
  if (win) {
    s.rep += 20; s.authority = clamp(s.authority + 10, 0, 100);
    const loot = Math.min(rv.stones, 150 + r.int(0, 100));
    rv.stones -= loot; s.stones += loot;
    if (rv.veins > 0) { rv.veins -= 1; s.veins += 1; }
    rv.attitude = clamp(rv.attitude + 15, -100, 100);
    w.acts.push({ kind: 'war_win', text: `打赢了${rv.name}` });
    text = `打赢了${rv.name}！夺得一条灵脉、${loot}灵石，名望大涨。`;
    for (const p of members(w)) { p.mood = clamp(p.mood + 15, 0, 100); p.loyalty = clamp(p.loyalty + 5, 0, 100); }
    // 敌宗宗主死了、人也打光了，就散了
    const m = P(w, rv.master);
    if (!m?.alive && rv.crowd.qi < 8) {
      rv.alive = false;
      text += `${rv.name}宗主身死，宗门就此散了。`;
    }
  } else {
    // 守山战输了：灵脉已经丢光、或者人都快没了，山门就守不住了
    if (war.stake === 'mountain' && (s.veins <= 0 || members(w).length < 3)) {
      wiped = true;
      text = `山门被${rv.name}攻破了。`;
    } else {
      const loss = Math.round(s.stones * (retreat ? 0.25 : 0.4));
      s.stones -= loss;
      const lostVein = s.veins > 0 && (war.stake === 'mountain' || s.veins > 1);
      if (lostVein) { s.veins -= 1; rv.veins += 1; }
      let razed = '';
      if (war.stake === 'mountain' && !retreat) {
        const built = (Object.keys(s.halls) as (keyof typeof s.halls)[]).filter((h) => s.halls[h] > 0);
        if (built.length) { const h = r.pick(built); s.halls[h] -= 1; razed = '，一座殿堂被毁'; }
      }
      s.rep = Math.max(0, s.rep - (retreat ? 8 : 15));
      s.authority = clamp(s.authority - (retreat ? 5 : 10), 0, 100);
      text = `${retreat ? '撤兵求和' : '打输了'}：赔了${loss}灵石${lostVein ? '，丢了一条灵脉' : ''}${razed}，名望受损。${s.veins <= 0 ? '灵脉已经丢光了，再输一场，山门就保不住了。' : ''}`;
      for (const p of members(w)) { p.mood = clamp(p.mood - 15, 0, 100); if (disp(p, 'courage') < 0) p.loyalty = clamp(p.loyalty - 5, 0, 100); }
    }
  }
  if (win) w.stats.warsWon += 1; else w.stats.warsLost += 1;
  rv.status = 'truce';
  rv.truceUntil = w.t + 12;
  rv.attitude = clamp(rv.attitude + 20, -100, 100);
  war.phase = 'done';
  report(w, { text: `宗门战结束：${text}`, tone: win ? 'good' : 'bad', about: war.team, big: true });
  return { win, text, wiped };
}

export function enemyPower(w: World): number {
  const war = w.war;
  if (!war) return 0;
  const rv = w.rivals.find((x) => x.id === war.enemy)!;
  return Math.round(rivalStrength(w, rv));
}
