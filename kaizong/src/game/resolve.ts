// 弟子挑好的事，按规则算结果。AI 只决定"做什么"，成不成、后果多大都在这里。

import type { Choice } from './choices';
import { attemptBreak, addDecision, drift, duel, leaveSect } from './decisions';
import type { Rng } from './rng';
import type { Work } from './sect';
import type { Person, Skill, World } from './types';
import { addLife, adjust, clamp, disp, members, op, P, pronoun, report } from './world';

export function applyChoice(w: World, r: Rng, p: Person, c: Choice, work: Work) {
  p.lastAct = c.kind;
  const t = P(w, c.target);
  const law = work.lawPower;
  switch (c.kind) {
    case 'work': case 'diligent': case 'cultivate': return;
    case 'slack':
      if (r.chance(0.5)) w.misdeeds.push({ who: p.id, what: '常常偷懒', t: w.t });
      return;
    case 'seclude':
      addLife(w, p, '没等宗主发话，自己闭关冲关', 'story');
      attemptBreak(w, r, p, false);
      return;
    case 'spar': {
      if (!t) return;
      const win = duel(r, p, t);
      const lose = win === p ? t : p;
      win.fame += 2;
      p.skills.combat = Math.min(p.caps.combat, p.skills.combat + 2);
      t.skills.combat = Math.min(t.caps.combat, t.skills.combat + 1);
      adjust(lose, win.id, disp(lose, 'pride') > 1 ? -6 : 3, 6);
      adjust(win, lose.id, 3, 0);
      if (r.chance(0.08)) { lose.hp = clamp(lose.hp - 20, 5, 100); addLife(w, lose, `和${win.name}切磋时受了伤`, 'bad'); }
      if (op(p, t.id).tag === 'rival' || p.starred || t.starred) addLife(w, p, `和${t.name}切磋，${win === p ? '赢了' : '输了'}`, win === p ? 'good' : 'info');
      return;
    }
    case 'befriend': {
      if (!t) return;
      const gain = 6 + disp(t, 'social') * 2 + (t.values.bond > 0.6 ? 2 : 0) - (disp(t, 'trust') < -1 ? 4 : 0);
      adjust(t, p.id, gain); adjust(p, t.id, 5);
      tagFriends(w, p, t);
      return;
    }
    case 'woo': {
      if (!t) return;
      const gain = 5 + disp(t, 'romance') * 2 + (op(t, p.id).aff > 20 ? 3 : 0) - (op(t, p.id).tag === 'lover' ? 0 : 0);
      adjust(t, p.id, gain); adjust(p, t.id, 6);
      if (p.starred || t.starred) addLife(w, p, `常去找${t.name}`, 'story');
      return;
    }
    case 'confess': {
      if (!t) return;
      const taken = Object.values(t.ops).some((o) => o.tag === 'lover');
      const yes = !taken && op(t, p.id).aff >= 40 && disp(t, 'romance') > -1.5 && r.chance(0.5 + op(t, p.id).aff / 200);
      if (yes) {
        op(p, t.id).tag = 'lover'; op(t, p.id).tag = 'lover';
        adjust(p, t.id, 20); adjust(t, p.id, 20);
        p.mood = clamp(p.mood + 25, 0, 100); t.mood = clamp(t.mood + 20, 0, 100);
        addLife(w, p, `向${t.name}表明心意，${pronoun(t)}答应了`, 'good', true);
        addLife(w, t, `${p.name}向${pronoun(t)}表明心意，${pronoun(t)}答应了`, 'good', true);
        report(w, { text: `${p.name}和${t.name}结为道侣。`, tone: 'good', about: [p.id, t.id], big: true });
        // 心里也有对方的第三人，会难过甚至记恨
        for (const q of members(w)) {
          if (q.id === p.id || q.id === t.id) continue;
          if (q.wish?.kind === 'love' && (q.wish.target === p.id || q.wish.target === t.id)) {
            const rival = q.wish.target === p.id ? t : p;
            adjust(q, rival.id, -30); q.mood = clamp(q.mood - 25, 0, 100);
            addLife(w, q, `心上人和${rival.name}在一起了`, 'bad', true);
            drift(w, r, q, 'heartbreak', 0.4);
            q.wish = null;
          }
        }
      } else {
        p.mood = clamp(p.mood - 20, 0, 100);
        adjust(t, p.id, -3);
        addLife(w, p, `向${t.name}表明心意，被婉拒了`, 'bad', true);
        if (p.starred || t.starred) report(w, { text: `${p.name}向${t.name}表白，被婉拒了。`, tone: 'story', about: [p.id, t.id] });
        drift(w, r, p, 'heartbreak', 0.25);
        if (p.wish?.kind === 'love') p.wish = null;
      }
      return;
    }
    case 'mentor': {
      if (!t) return;
      const sk = (['combat', 'alchemy', 'herb', 'forge', 'array', 'manage'] as const).reduce<Skill>((b, s) => (p.skills[s] > p.skills[b] ? s : b), 'combat');
      t.skills[sk] = Math.min(t.caps[sk], t.skills[sk] + 3);
      t.exp += 4;
      p.skills.teach = Math.min(p.caps.teach, p.skills.teach + 1);
      p.merit += 2;
      adjust(t, p.id, 8, 6); adjust(p, t.id, 5);
      if (op(t, p.id).aff >= 45 && !op(t, p.id).tag) {
        op(t, p.id).tag = 'master'; op(p, t.id).tag = 'pupil';
        addLife(w, t, `拜${p.name}为师`, 'good', true);
        addLife(w, p, `收${t.name}为徒`, 'good', true);
        report(w, { text: `${t.name}拜了${p.name}为师。`, tone: 'good', about: [p.id, t.id] });
      }
      return;
    }
    case 'help': {
      if (!t) return;
      if (t.hp < 50) t.hp = clamp(t.hp + 15, 0, 100); else t.mood = clamp(t.mood + 15, 0, 100);
      adjust(t, p.id, 10); adjust(p, t.id, 3);
      tagFriends(w, p, t);
      return;
    }
    case 'scheme': {
      if (!t) return;
      const caught = r.chance(0.15 + law * 0.08 - disp(p, 'cunning') * 0.05);
      if (caught) {
        addDecision(w, 'scheme_caught', { who: p.id, target: t.id });
        adjust(t, p.id, -30);
      } else if (r.chance(0.55 + disp(p, 'cunning') * 0.08)) {
        t.favor = Math.max(0, t.favor - 5); t.merit = Math.max(0, t.merit - 10); t.mood = clamp(t.mood - 10, 0, 100);
        addLife(w, t, '最近总有人在背后说坏话，日子不好过', 'bad');
      }
      return;
    }
    case 'report': {
      const m = w.misdeeds.find((x) => x.who === c.target);
      if (t && m) addDecision(w, 'report', { who: p.id, target: t.id, what: m.what });
      return;
    }
    case 'request_post':
      if (c.hall) addDecision(w, 'transfer', { who: p.id, hall: c.hall });
      return;
    case 'request_rank': {
      const order = ['probation', 'outer', 'inner', 'core', 'chief', 'elder'];
      const next = p.rank === 'core' ? 'chief' : order[order.indexOf(p.rank) + 1];
      if (next) addDecision(w, 'promotion', { who: p.id, rank: next });
      return;
    }
    case 'challenge':
      if (t) addDecision(w, 'challenge', { who: p.id, target: t.id });
      return;
    case 'faction': {
      const pals = members(w).filter((q) => q.id !== p.id && q.grudge >= 30).slice(0, 3);
      for (const q of pals) { adjust(q, p.id, 10); q.grudge = clamp(q.grudge + 4, 0, 100); }
      p.factionSize = (p.factionSize ?? 0) + pals.length;
      if (r.chance(0.2 + law * 0.1) || p.factionSize >= 3) addDecision(w, 'faction_alert', { who: p.id, n: pals.length });
      return;
    }
    case 'steal': {
      const amount = Math.min(w.sect.stones, Math.round(r.range(15, 40)));
      w.sect.stones -= amount;
      w.misdeeds.push({ who: p.id, what: '偷了宗门的灵石', t: w.t });
      if (r.chance(0.2 + law * 0.12)) addDecision(w, 'theft', { who: p.id, what: `${amount}灵石`, amount });
      // 没抓到人：只知道库房少了东西，不知道是谁
      else if (amount > 0) report(w, { text: `库房对账，少了${amount}灵石，不知是谁拿的。执法堂得力，才抓得到人。`, tone: 'bad', about: [] });
      return;
    }
    case 'leak': {
      const rv = w.rivals.find((x) => x.id === p.secret?.patron);
      if (rv) rv.intel = (rv.intel ?? 0) + 1;
      if (r.chance(0.12 + law * 0.1 + w.sect.halls.law * 0.02)) addDecision(w, 'spy_caught', { who: p.id, patron: p.secret!.patron ?? '' });
      return;
    }
    case 'defect': {
      const rv = w.rivals.find((x) => x.id === c.target);
      if (!rv) return;
      const loot = Math.min(w.sect.stones, Math.round(w.sect.stones * 0.1));
      w.sect.stones -= loot;
      leaveSect(w, p, `叛出师门，投奔了${rv.name}${loot ? `，还卷走了${loot}灵石` : ''}`, 'bad', rv.id);
      rv.named.push(p.id);
      p.rank = 'inner';
      for (const q of members(w)) { adjust(q, p.id, -30); if (op(q, p.id).tag === 'friend') drift(w, r, q, 'betrayed', 0.4); }
      w.sect.authority = clamp(w.sect.authority - 5, 0, 100);
      return;
    }
    case 'leave':
      addDecision(w, 'leave_request', { who: p.id });
      return;
    case 'found': {
      const followers = members(w).filter((q) => q.id !== p.id && op(q, p.id).aff >= 40 && q.grudge >= 20).slice(0, 3);
      addDecision(w, 'found_leave', { who: p.id, followers: followers.map((f) => f.id).join(','), names: followers.length ? followers.map((f) => f.name).join('、') : '自己一个人' });
      return;
    }
    case 'adventure':
      addDecision(w, 'travel_request', { who: p.id });
      return;
  }
}

function tagFriends(w: World, a: Person, b: Person) {
  const x = op(a, b.id), y = op(b, a.id);
  if (x.aff >= 55 && y.aff >= 55 && !x.tag && !y.tag) {
    x.tag = 'friend'; y.tag = 'friend';
    addLife(w, a, `和${b.name}成了至交`, 'good');
    addLife(w, b, `和${a.name}成了至交`, 'good');
  }
}

/** 同门之间自己处出来的交情：同一处干活的人走得近，性子不合的越处越僵 */
export function socialize(w: World, r: Rng) {
  const ps = members(w);
  for (const p of ps) {
    const mates = ps.filter((q) => q.id !== p.id && q.job === p.job && p.job !== 'none');
    const pool = mates.length ? mates : ps.filter((q) => q.id !== p.id);
    for (const q of r.shuffle([...pool]).slice(0, 2)) {
      let d = r.range(-2, 3);
      const sim = 1 - (['power', 'wealth', 'bond', 'loyalty', 'justice'] as const).reduce((t, v) => t + Math.abs(p.values[v] - q.values[v]), 0) / 2.5;
      d += sim * 3;
      if (disp(p, 'temper') > 1 && disp(q, 'temper') > 1) d -= 3;
      d += disp(q, 'kindness') * 0.8 + disp(q, 'social') * 0.5;
      if (disp(p, 'envy') > 0 && q.fame + q.merit > p.fame + p.merit + 20) d -= 2 * disp(p, 'envy');
      if (disp(q, 'temper') > 1 && disp(q, 'kindness') < 0) d -= 1.5;
      adjust(p, q.id, d);
      const o = op(p, q.id);
      if (o.aff <= -50 && !o.tag) { o.tag = 'rival'; addLife(w, p, `和${q.name}越处越不对付`, 'bad'); }
      // 积怨爆发：同处干活的死对头打起来
      if (o.aff <= -60 && op(q, p.id).aff <= -40 && mates.includes(q) && r.chance(0.25)) {
        const win = duel(r, p, q);
        const lose = win === p ? q : p;
        lose.hp = clamp(lose.hp - 20, 5, 100);
        addDecision(w, 'fight', { a: p.id, b: q.id, loser: lose.id });
      }
    }
  }
}



