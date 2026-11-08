// 敌宗：宗主由 AI（或规则）按性格拿主意。主线威胁就是他们。

import { power, stepUp } from './cult';
import { addDecision } from './decisions';
import { RIVALS } from './data/world';
import { genPerson } from './gen';
import { insight, makeCandidate } from './recruit';
import type { Rng } from './rng';
import { sectStrength, type Work } from './sect';
import type { Person, Rival, World } from './types';
import { addLife, clamp, disp, members, nm, P, report, year } from './world';

export type RivalMove = 'grow' | 'poach' | 'spy' | 'raid' | 'war' | 'ally' | 'insult' | 'gift';
export interface RivalChoice { id: RivalMove; label: string; score: number; target?: string }

export const MOVE_NAME: Record<RivalMove, string> = {
  grow: '闭门发展', poach: '挖人', spy: '安插奸细', raid: '截杀抢掠', war: '宣战', ally: '提议结盟', insult: '上门挑衅', gift: '送礼示好',
};

export function rivalStrength(w: World, rv: Rival): number {
  const named = [rv.master, ...rv.named].map((id) => P(w, id)).filter((p): p is Person => !!p?.alive && p.sect === rv.id);
  return named.reduce((t, p) => t + Math.sqrt(power(p)) * 10, 0) + rv.crowd.qi * Math.sqrt(30) * 10 + rv.crowd.found * Math.sqrt(160) * 10;
}

export function setupRivals(w: World, r: Rng) {
  for (const def of RIVALS) {
    const m = genPerson(w, r, { sect: def.id, name: def.master.name, gender: def.master.gender, realm: def.master.realm as 2, stage: def.master.stage, traits: def.master.traits, gifted: true });
    m.rank = 'master'; m.voice = def.master.voice; m.origin = def.master.bio;
    m.skills.combat = Math.max(m.skills.combat, 60); m.caps.combat = Math.max(m.caps.combat, 80);
    w.people[m.id] = m;
    const named: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = genPerson(w, r, { sect: def.id, realm: i === 0 ? 1 : 0, stage: i === 0 ? r.int(0, 2) : r.int(5, 8) });
      p.rank = i === 0 ? 'elder' : 'core';
      w.people[p.id] = p;
      named.push(p.id);
    }
    const big = def.passive;
    w.rivals.push({
      id: def.id, name: def.name, color: def.color, master: m.id, named, style: def.style, passive: def.passive,
      crowd: { qi: big ? 60 : r.int(14, 22), found: big ? 8 : r.int(1, 3) }, stones: big ? 3000 : 500, rep: big ? 300 : r.int(60, 90),
      attitude: def.style === 'aggressive' ? -10 : def.style === 'cunning' ? 0 : 10, status: 'neutral', veins: big ? 6 : 2, alive: true,
    });
  }
}

/** 这一季敌宗能做的事，按宗主性格和局势打分 */
export function rivalChoices(w: World, rv: Rival): RivalChoice[] {
  const out: RivalChoice[] = [];
  const m = P(w, rv.master);
  if (!m?.alive) return [{ id: 'grow', label: MOVE_NAME.grow, score: 1 }];
  const ratio = rivalStrength(w, rv) / Math.max(1, sectStrength(w));
  const aggr = rv.style === 'aggressive' ? 1.5 : rv.style === 'cunning' ? 0.5 : 0;
  const cun = rv.style === 'cunning' ? 1.5 : 0;
  const att = rv.attitude;
  const hide = w.sect.policy === 'hide' ? 0.5 : 1;
  out.push({ id: 'grow', label: MOVE_NAME.grow, score: 2 });
  const target = members(w).filter((p) => p.grudge >= 35 || p.loyalty <= 40).sort((a, b) => power(b) - power(a))[0];
  if (target && att < 20) out.push({ id: 'poach', label: `挖${w.sect.name}的${target.name}`, target: target.id, score: (1 + cun + (target.grudge - 35) / 20) * hide });
  if (att < 10 && w.t - (rv.lastSpy ?? -99) >= 8) out.push({ id: 'spy', label: `往${w.sect.name}安插奸细`, score: (0.4 + cun * 0.6) * hide });
  if (att < -10) out.push({ id: 'raid', label: `截杀${w.sect.name}外出的弟子、抢灵脉`, score: (0.5 + aggr + (ratio - 1)) * hide });
  if (att <= -40 && ratio >= 1 && rv.status !== 'truce' && rv.status !== 'war' && rv.status !== 'ally' && year(w.t) >= 2 && !w.war && !w.pendingWar) {
    out.push({ id: 'war', label: `向${w.sect.name}宣战`, score: Math.min(4, 0.5 + aggr + (ratio - 1) * 1.5 + (att + 40) / -30) * hide });
  }
  if (att >= 30 && rv.status !== 'ally') out.push({ id: 'ally', label: `向${w.sect.name}提议结盟`, score: 1 + att / 30 });
  if (att < -20 && ratio > 1) out.push({ id: 'insult', label: `派人上门挑衅`, score: 0.6 + aggr * 0.5 });
  if (att > 10 || ratio < 0.7) out.push({ id: 'gift', label: `给${w.sect.name}送礼示好`, score: 0.5 + (ratio < 0.7 ? 1 : 0) });
  return out;
}

export function ruleRivalPick(r: Rng, cs: RivalChoice[]): RivalChoice {
  return r.weighted(cs.map((c) => [c, Math.max(0.05, c.score) ** 2] as [RivalChoice, number])) ?? cs[0];
}

/** 敌宗出手 */
export function applyRivalMove(w: World, r: Rng, rv: Rival, c: RivalChoice, work: Work) {
  rv.lastMove = MOVE_NAME[c.id];
  rv.hidden = c.id === 'poach' || c.id === 'spy';
  const intel = work.byHall.diplomacy + work.lawPower;
  switch (c.id) {
    case 'grow':
      rv.crowd.qi += r.int(0, 2); rv.stones += 60;
      if (r.chance(0.15)) rv.crowd.found += 1;
      return;
    case 'poach': {
      const p = P(w, c.target);
      if (!p?.alive || p.sect !== 'me') return;
      w.offers[p.id] = rv.id;
      if (r.chance(0.3 + intel * 0.15)) addDecision(w, 'poach_alert', { who: p.id, rival: rv.id });
      return;
    }
    case 'spy': {
      rv.lastSpy = w.t;
      const c2 = makeCandidate(w, r, 'spy', insight(w, work.recruitPower), { patron: rv.id });
      c2.via = 'walkin';
      w.candidates.push(c2);
      return;
    }
    case 'raid': {
      const def = work.guardPower + (w.sect.tech.includes('guard_array') ? 2 : 0);
      const atk = 1.5 + rivalStrength(w, rv) / 400 + r.range(0, 2);
      rv.attitude -= 3;
      if (def >= atk) {
        w.sect.rep += 4;
        for (const p of members(w).filter((q) => q.job === 'guard')) { p.merit += 5; p.fame += 2; }
        report(w, { text: `${rv.name}派人来抢灵脉，被巡山队打了回去。`, tone: 'good', about: [] });
      } else {
        const loss = Math.min(w.sect.stones, r.int(40, 90));
        w.sect.stones -= loss;
        const traveler = members(w).find((p) => p.job === 'travel');
        if (traveler) { traveler.hp = clamp(traveler.hp - 35, 5, 100); addLife(w, traveler, `在外被${rv.name}的人截杀，重伤`, 'bad', true); }
        report(w, { text: `${rv.name}来抢了一回，损失${loss}灵石${traveler ? `，在外的${traveler.name}也被打伤了` : ''}。巡山的人手不够。`, tone: 'bad', about: traveler ? [traveler.id] : [], big: true });
      }
      return;
    }
    case 'war':
      rv.status = 'war';
      w.pendingWar = { enemy: rv.id, byPlayer: false };
      report(w, { text: `${rv.name}宗主${nm(w, rv.master)}向你宣战！下一季开打。`, tone: 'bad', about: [], big: true });
      return;
    case 'ally':
      w.decisions.push({ id: `d${w.nextId++}`, kind: 'ev:rival_ally', title: `${rv.name}提议结盟`, text: `${rv.name}派使者来，想和你结为同盟，互不侵犯、共御外敌。`, options: [{ id: 'yes', label: '结盟' }, { id: 'no', label: '婉拒' }], params: { rival: rv.id }, about: [], fallback: 'no' });
      return;
    case 'insult':
      w.decisions.push({ id: `d${w.nextId++}`, kind: 'ev:rival_insult', title: `${rv.name}上门挑衅`, text: `${rv.name}派了个弟子在山门外叫阵，说${w.sect.name}都是些缩头乌龟。`, options: [{ id: 'fight', label: '派人应战' }, { id: 'ignore', label: '不理', hint: '名望受损，弟子们憋屈' }, { id: 'gift', label: '送点灵石打发走' }], params: { rival: rv.id }, about: [], fallback: 'ignore' });
      return;
    case 'gift':
      w.sect.stones += 50; rv.attitude += 5;
      report(w, { text: `${rv.name}派人送来 50 灵石，示好。`, tone: 'good', about: [] });
      return;
  }
}

/** 敌宗自己的日子：修炼、态度慢慢变 */
export function rivalTick(w: World, r: Rng) {
  for (const rv of w.rivals) {
    if (!rv.alive) continue;
    for (const id of [rv.master, ...rv.named]) {
      const p = P(w, id);
      if (!p?.alive || p.sect !== rv.id) continue;
      p.exp += 10 * p.root.apt * r.range(0.7, 1.2);
      stepUp(p);
    }
    if (rv.passive) continue;
    let d = 0;
    if (rv.style === 'aggressive') d -= w.sect.site === 'vein' ? 2.2 : 1.2;
    if (rv.style === 'proper') d += w.sect.align < -20 ? -3 : 1;
    if (rv.style === 'cunning') d += r.range(-2, 1.5);
    if (w.sect.policy === 'ally') d += 2.5;
    if (w.sect.policy === 'hide') d += 1;
    if (sectStrength(w) > rivalStrength(w, rv) * 1.3) d += 1; // 打不过就客气点
    rv.attitude = clamp(rv.attitude + d, -100, 100);
    if (rv.status === 'truce' && rv.truceUntil !== undefined && w.t >= rv.truceUntil) rv.status = rv.attitude < -30 ? 'hostile' : 'neutral';
    if (rv.status === 'neutral' && rv.attitude <= -30) rv.status = 'hostile';
    if (rv.status === 'hostile' && rv.attitude > -20) rv.status = 'neutral';
  }
}

/** 玩家在"天下"页对敌宗出手 */
export function diplomacy(w: World, rv: Rival, act: 'gift' | 'war' | 'ally' | 'insult'): string | null {
  switch (act) {
    case 'gift':
      if (w.sect.stones < 80) return '灵石不够';
      w.sect.stones -= 80; rv.attitude = clamp(rv.attitude + 10, -100, 100);
      return null;
    case 'ally':
      if (rv.attitude < 40) return `${rv.name}还不够信你（态度要到 40）`;
      rv.status = 'ally';
      w.acts.push({ kind: 'policy', text: `和${rv.name}结盟` });
      return null;
    case 'insult':
      rv.attitude = clamp(rv.attitude - 15, -100, 100); w.sect.authority = clamp(w.sect.authority + 2, 0, 100);
      return null;
    case 'war':
      if (w.war || w.pendingWar) return '正在打仗';
      if (rv.status === 'ally') { w.sect.rep -= 20; for (const p of members(w)) if (disp(p, 'order') > 0) p.loyalty = clamp(p.loyalty - 5, 0, 100); }
      if (w.sect.align > 0 && rv.attitude > -20) w.sect.rep -= 8;
      rv.status = 'war';
      w.pendingWar = { enemy: rv.id, byPlayer: true };
      w.acts.push({ kind: 'declare_war', target: rv.id, text: `向${rv.name}开战` });
      return null;
  }
}

export function resolveRivalEvent(w: World, kind: string, x: Record<string, string | number>, o: string, r: Rng): boolean {
  const rv = w.rivals.find((v) => v.id === x.rival);
  if (!rv) return false;
  if (kind === 'ev:rival_ally') {
    if (o === 'yes') { rv.status = 'ally'; rv.attitude = clamp(rv.attitude + 15, -100, 100); report(w, { text: `和${rv.name}结为同盟。`, tone: 'good', about: [] }); }
    else rv.attitude -= 5;
    return true;
  }
  if (kind === 'ev:rival_insult') {
    if (o === 'fight') {
      const champ = members(w).sort((a, b) => power(b) - power(a))[0];
      const foe = rv.named.map((id) => P(w, id)!).filter((p) => p?.alive && p.sect === rv.id).sort((a, b) => power(a) - power(b))[0];
      if (champ && foe) {
        const win = r.chance(power(champ) ** 2 / (power(champ) ** 2 + power(foe) ** 2));
        (win ? champ : foe).fame += 6;
        if (win) { w.sect.rep += 6; addLife(w, champ, `在山门前打败了来挑衅的${foe.name}`, 'good', true); w.acts.push({ kind: 'war_win', text: `派${champ.name}应战` }); }
        else { w.sect.rep -= 4; champ.hp = clamp(champ.hp - 25, 5, 100); addLife(w, champ, `在山门前输给了${foe.name}`, 'bad', true); champ.ops[foe.id] = { aff: -40, respect: 10, tag: 'rival' }; }
        report(w, { text: win ? `${champ.name}出山门应战，打败了${rv.name}的${foe.name}。` : `${champ.name}应战，输给了${rv.name}的${foe.name}。`, tone: win ? 'good' : 'bad', about: [champ.id], big: true });
      }
      rv.attitude -= 5;
    } else if (o === 'ignore') {
      w.sect.rep -= 5;
      for (const p of members(w)) if (disp(p, 'pride') > 0 || disp(p, 'temper') > 0) p.grudge = clamp(p.grudge + 6, 0, 100);
    } else if (w.sect.stones >= 40) { w.sect.stones -= 40; rv.attitude += 3; }
    return true;
  }
  return false;
}
