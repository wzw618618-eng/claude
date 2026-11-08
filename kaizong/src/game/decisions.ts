// 待裁决的事：弟子们闹出来的、要宗主拍板的事。
// 存档里只存种类和参数，文字和后果都在这里按种类算。

import { atBottleneck, BREAK_PILL, breakChance, breakthrough, power, REALM_NAME, yearsLeft } from './cult';
import { DRIFT } from './data/traits';
import { HALL, RANK_NAME } from './data/world';
import type { Rng } from './rng';
import { assignJob, setHead, setRank } from './sect';
import type { Decision, DecisionOption, HallId, Person, Rank, World } from './types';
import { emit } from './fx';
import { addLife, adjust, clamp, disp, hasTrait, lacks, members, newId, nm, nowDay, op, P, pay, pronoun, report } from './world';

type Params = Record<string, string | number>;

interface Kind {
  title(w: World, x: Params): string;
  text(w: World, x: Params): string;
  options(w: World, x: Params): DecisionOption[];
  fallback: string;
  about(x: Params): string[];
  apply(w: World, r: Rng, x: Params, o: string): void;
}

const who = (w: World, x: Params, k = 'who') => P(w, String(x[k]))!;

export function drift(w: World, r: Rng, p: Person, cause: keyof typeof DRIFT, chance = 0.5) {
  const opts = DRIFT[cause];
  if (!opts || !r.chance(chance)) return;
  const d = r.pick(opts);
  if (p.traits.includes(d.to)) return;
  p.traits.push(d.to);
  if (p.traits.length > 5) p.traits.shift();
  addLife(w, p, `性情变了：${d.why}`, 'story');
}

/** 两人比斗：按战力算胜负，强的不一定赢 */
export function duel(r: Rng, a: Person, b: Person): Person {
  const pa = power(a) ** 2, pb = power(b) ** 2;
  return r.chance(pa / (pa + pb)) ? a : b;
}

/** 闭关冲关要几天 */
export const BREAK_DAYS = 15;
/** 待裁决的事最多等几天，过了按默认办 */
export const DECISION_DAYS = 45;

/** 进洞闭关：过 BREAK_DAYS 天出结果 */
export function startBreak(w: World, p: Person, pill: boolean) {
  const now = nowDay(w);
  p.breaking = { from: now, until: now + BREAK_DAYS, pill };
  emit({ k: 'banner', text: `${p.name}进洞闭关，冲击${REALM_NAME[p.realm + 1]}`, tone: 'gold' });
}

/** 每天：闭关到日子的人出关 */
export function finishBreaks(w: World, r: Rng) {
  const now = nowDay(w);
  for (const id of w.members) {
    const p = w.people[id];
    if (!p?.breaking || now < p.breaking.until) continue;
    const pill = p.breaking.pill;
    p.breaking = undefined;
    if (!p.alive || p.sect !== 'me' || !atBottleneck(p)) continue;
    attemptBreak(w, r, p, pill);
  }
}

export function attemptBreak(w: World, r: Rng, p: Person, pill: boolean): boolean {
  const ok = r.chance(breakChance(p, pill));
  const target = REALM_NAME[p.realm + 1];
  emit({ k: 'break', who: p.id, ok });
  emit({ k: 'banner', text: ok ? `${p.name}破关而出，踏入${target}！` : `${p.name}冲击${target}失败，受了内伤`, tone: ok ? 'gold' : 'bad' });
  if (ok) {
    breakthrough(p);
    if (p.sect === 'me') w.stats.breaks += 1;
    p.mood = clamp(p.mood + 25, 0, 100);
    p.fame += 10;
    addLife(w, p, `闭关冲关，成功踏入${target}`, 'good', true);
    report(w, { text: `${p.name}闭关冲关，成功踏入${target}！`, tone: 'good', about: [p.id], big: true });
    for (const q of members(w)) if (q.id !== p.id) adjust(q, p.id, disp(q, 'envy') > 0 ? -4 : 3, 10);
  } else {
    p.fails += 1;
    p.hp = clamp(p.hp - 40, 5, 100);
    p.exp = Math.round(p.exp * 0.5);
    p.age += 2;
    p.mood = clamp(p.mood - 20, 0, 100);
    addLife(w, p, `冲击${target}失败，经脉受损，折了两年寿元`, 'bad', true);
    report(w, { text: `${p.name}冲击${target}失败，受了内伤。`, tone: 'bad', about: [p.id] });
    if (r.chance(0.25)) {
      const t = r.pick(['extreme', 'gloomy']);
      if (!p.traits.includes(t)) { p.traits.push(t); addLife(w, p, '冲关失败后生了心魔，性子变得' + (t === 'extreme' ? '偏激' : '阴郁'), 'bad'); }
    }
  }
  return ok;
}

const KINDS: Record<string, Kind> = {
  breakthrough: {
    title: (w, x) => `${who(w, x).name}想冲关`,
    text: (w, x) => {
      const p = who(w, x);
      const left = yearsLeft(p);
      return `${p.name}修为圆满，想闭关冲击${REALM_NAME[p.realm + 1]}。不用丹药约有${pct(breakChance(p, false))}的把握，用了${BREAK_PILL[p.realm]}约${pct(breakChance(p, true))}。失败会受伤、折寿。${left < 20 ? `${pronoun(p)}只剩约${left}年寿元了。` : ''}`;
    },
    options: (w, x) => [
      ...breakOptions(w, who(w, x)),
      { id: 'wait', label: '再压一压', hint: `修为不会丢，但${pronoun(who(w, x))}会着急；明年开春再来求你` },
    ],
    fallback: 'wait',
    about: (x) => [String(x.who)],
    apply(w, r, x, o) {
      const p = who(w, x);
      if (!p.alive || !atBottleneck(p)) return;
      if (o === 'wait') {
        p.grudge = clamp(p.grudge + (yearsLeft(p) < 20 ? 15 : 5), 0, 100);
        return;
      }
      breakNow(w, r, p, o as BreakWay);
    },
  },
  transfer: {
    title: (w, x) => `${who(w, x).name}求调岗`,
    text: (w, x) => { const p = who(w, x); return `${p.name}想从${p.head ? HALL[p.head].name + '主事' : jobName(p)}调去${HALL[x.hall as HallId].name}。${p.dislikes.includes(p.job) ? `${pronoun(p)}一直不喜欢现在的活。` : ''}${p.likes.includes(x.hall as HallId) ? `那是${pronoun(p)}喜欢的活。` : ''}`; },
    options: () => [{ id: 'yes', label: '准了' }, { id: 'no', label: '不准' }],
    fallback: 'no',
    about: (x) => [String(x.who)],
    apply(w, _r, x, o) {
      const p = who(w, x);
      if (o === 'yes' && w.sect.halls[x.hall as HallId] > 0) { assignJob(w, p, x.hall as HallId); p.mood = clamp(p.mood + 10, 0, 100); adjust(p, w.me, 5); }
      else { p.grudge = clamp(p.grudge + 8, 0, 100); adjust(p, w.me, -4); }
    },
  },
  promotion: {
    title: (w, x) => `${who(w, x).name}求晋升`,
    text: (w, x) => `${who(w, x).name}觉得自己该当${RANK_NAME[x.rank as Rank]}了。`,
    options: () => [{ id: 'yes', label: '准了' }, { id: 'no', label: '还不到时候' }],
    fallback: 'no',
    about: (x) => [String(x.who)],
    apply(w, _r, x, o) {
      const p = who(w, x);
      if (o === 'yes') setRank(w, p, x.rank as Rank);
      else { p.grudge = clamp(p.grudge + 6 + Math.max(0, disp(p, 'pride')) * 4, 0, 100); adjust(p, w.me, -5); }
    },
  },
  challenge: {
    title: (w, x) => `${who(w, x).name}要挑战${nm(w, String(x.target))}`,
    text: (w, x) => {
      const p = who(w, x), q = who(w, x, 'target');
      return `${p.name}不服${q.name}压在自己头上，当众提出比斗。${p.name}战力约${power(p)}，${q.name}约${power(q)}。`;
    },
    options: (w, x) => [
      { id: 'swap', label: '准许，赢了就让位', hint: '最服众，但输家会记仇' },
      { id: 'duel', label: '准许比斗，只论胜负不换位' },
      { id: 'no', label: '不许', hint: `${who(w, x).name}会更不服` },
    ],
    fallback: 'no',
    about: (x) => [String(x.who), String(x.target)],
    apply(w, r, x, o) {
      const p = who(w, x), q = who(w, x, 'target');
      if (!p.alive || !q.alive) return;
      if (o === 'no') { p.grudge = clamp(p.grudge + 10, 0, 100); adjust(p, w.me, -6, -6); return; }
      const win = duel(r, p, q);
      const lose = win === p ? q : p;
      win.fame += 8; lose.fame = Math.max(0, lose.fame - 4);
      lose.hp = clamp(lose.hp - 25, 5, 100);
      for (const m of members(w)) if (m.id !== win.id) adjust(m, win.id, 0, 8);
      adjust(lose, win.id, -20, 5);
      addLife(w, win, `当众比斗，赢了${lose.name}`, 'good', true);
      addLife(w, lose, `当众比斗，输给了${win.name}`, 'bad', true);
      if (hasTrait(lose, 'proud') || hasTrait(lose, 'vain')) drift(w, r, lose, 'humiliated', 0.6);
      if (win === p) drift(w, r, win, 'triumph', 0.3);
      let swapText = '';
      if (o === 'swap' && win === p) {
        const [rp, rq, hp, hq] = [p.rank, q.rank, p.head, q.head];
        if (hq) setHead(w, hq, p);
        if (rq !== rp) { setRank(w, p, rq); setRank(w, q, rp); }
        if (hp && !hq) setHead(w, hp, q);
        swapText = `，两人换了位置`;
        p.grudge = 0;
      } else if (win === p) p.grudge = clamp(p.grudge - 15, 0, 100);
      else p.grudge = clamp(p.grudge - 25, 0, 100);
      report(w, { text: `${p.name}当众挑战${q.name}，${win.name}赢了${swapText}。`, tone: 'story', about: [p.id, q.id], big: true });
    },
  },
  report: {
    title: (w, x) => `${who(w, x).name}告发${nm(w, String(x.target))}`,
    text: (w, x) => `${who(w, x).name}来告发：${nm(w, String(x.target))}${x.what}。`,
    options: () => [{ id: 'punish', label: '查实就罚' }, { id: 'ignore', label: '不予理会' }],
    fallback: 'ignore',
    about: (x) => [String(x.who), String(x.target)],
    apply(w, _r, x, o) {
      const p = who(w, x), q = who(w, x, 'target');
      if (o === 'punish') {
        q.merit = Math.max(0, q.merit - 20); q.mood = clamp(q.mood - 15, 0, 100); q.grudge = clamp(q.grudge + 10, 0, 100);
        adjust(q, p.id, -25); adjust(p, w.me, 5, 5); p.favor += 2;
        w.acts.push({ kind: 'punish', who: q.id, text: `罚了${q.name}` });
        addLife(w, q, `被${p.name}告发${x.what}，受了罚`, 'bad');
      } else { p.mood = clamp(p.mood - 5, 0, 100); adjust(p, w.me, -3, -3); }
    },
  },
  scheme_caught: {
    title: (w, x) => `${who(w, x).name}暗算同门被抓`,
    text: (w, x) => `执法堂查到${who(w, x).name}在背后给${nm(w, String(x.target))}使绊子。`,
    options: () => [{ id: 'punish', label: '重罚' }, { id: 'expel', label: '逐出山门' }, { id: 'pardon', label: '念其初犯，饶过' }],
    fallback: 'punish',
    about: (x) => [String(x.who), String(x.target)],
    apply(w, r, x, o) {
      const p = who(w, x), q = who(w, x, 'target');
      if (o === 'expel') expel(w, r, p, '暗算同门');
      else if (o === 'punish') {
        p.merit = Math.max(0, p.merit - 30); p.favor = Math.max(0, p.favor - 10); p.grudge = clamp(p.grudge + 15, 0, 100);
        adjust(q, w.me, 8, 5); w.acts.push({ kind: 'punish', who: p.id, text: `罚了${p.name}` });
      } else { adjust(q, w.me, -10, -8); q.grudge = clamp(q.grudge + 10, 0, 100); }
    },
  },
  theft: {
    title: (w, x) => `${who(w, x).name}偷东西被抓`,
    text: (w, x) => `${who(w, x).name}偷了宗门${x.what}，被执法堂抓了个正着。`,
    options: () => [{ id: 'punish', label: '重罚，追回赃物' }, { id: 'expel', label: '逐出山门' }, { id: 'pardon', label: '饶过这一回' }],
    fallback: 'punish',
    about: (x) => [String(x.who)],
    apply(w, r, x, o) {
      const p = who(w, x);
      if (o === 'expel') expel(w, r, p, '偷盗');
      else if (o === 'punish') { w.sect.stones += Number(x.amount) || 0; p.merit = Math.max(0, p.merit - 20); p.grudge = clamp(p.grudge + 10, 0, 100); w.acts.push({ kind: 'punish', who: p.id, text: `罚了${p.name}` }); }
      else { p.loyalty = clamp(p.loyalty + (disp(p, 'kindness') > 0 ? 10 : 0), 0, 100); for (const m of members(w)) if (disp(m, 'order') > 1) adjust(m, w.me, -3, -4); }
    },
  },
  spy_caught: {
    title: (w, x) => `揪出了奸细${who(w, x).name}`,
    text: (w, x) => `执法堂查明：${who(w, x).name}是${rivalName(w, String(x.patron))}派来的奸细。`,
    options: () => [{ id: 'expel', label: '废去修为，逐出山门' }, { id: 'turn', label: '策反，让他反过来替我们传话', hint: '成不成看他忠心几分' }, { id: 'return', label: '放回去，敲打一下对方' }],
    fallback: 'expel',
    about: (x) => [String(x.who)],
    apply(w, r, x, o) {
      const p = who(w, x);
      p.secret!.exposed = true;
      const rv = w.rivals.find((v) => v.id === x.patron);
      if (o === 'turn' && r.chance(0.3 + p.loyalty / 150)) {
        p.secret!.kind = 'spy'; p.loyalty = clamp(p.loyalty + 25, 0, 100);
        addLife(w, p, '身份败露后被宗主策反，从此替宗门传假消息', 'story', true);
        report(w, { text: `${p.name}被策反了，从此替你往${rv?.name}送假消息。`, tone: 'good', about: [p.id] });
        p.wish = null;
        return;
      }
      if (o === 'return' && rv) rv.attitude -= 5;
      if (rv) rv.attitude -= 10;
      p.realm = 0; p.stage = Math.min(p.stage, 1);
      expel(w, r, p, '奸细');
      w.sect.authority = clamp(w.sect.authority + 5, 0, 100);
    },
  },
  leave_request: {
    title: (w, x) => `${who(w, x).name}想下山`,
    text: (w, x) => { const p = who(w, x); return `${p.name}向你请辞：${p.wish?.kind === 'leave' ? p.wish.text : '心灰意冷，想离开宗门'}。`; },
    options: () => [{ id: 'allow', label: '准了，好聚好散' }, { id: 'keep', label: '好言挽留', hint: '多半能留住，但不一定' }, { id: 'refuse', label: '不准走' }],
    fallback: 'allow',
    about: (x) => [String(x.who)],
    apply(w, r, x, o) {
      const p = who(w, x);
      if (o === 'allow') {
        w.sect.rep += 2;
        leaveSect(w, p, '辞别宗门下山去了', 'info');
        w.acts.push({ kind: 'let_go', who: p.id, text: `准${p.name}下山` });
      } else if (o === 'keep' && r.chance(0.4 + p.loyalty / 200 + disp(p, 'kindness') * 0.05)) {
        p.favor += 6; p.loyalty = clamp(p.loyalty + 15, 0, 100); p.mood = clamp(p.mood + 10, 0, 100);
        if (p.wish?.kind === 'leave') p.wish = null;
        addLife(w, p, '宗主亲自挽留，留了下来', 'good');
      } else if (o === 'keep') {
        leaveSect(w, p, '宗主挽留不住，还是下山了', 'info');
      } else { p.grudge = clamp(p.grudge + 20, 0, 100); p.loyalty = clamp(p.loyalty - 10, 0, 100); }
    },
  },
  travel_request: {
    title: (w, x) => `${who(w, x).name}想下山历练`,
    text: (w, x) => { const p = who(w, x); return `${p.name}想下山历练一年。可能得奇遇，也可能受伤、甚至回不来。${p.head ? `${pronoun(p)}走了，${HALL[p.head].name}就没人主事了。` : ''}`; },
    options: () => [{ id: 'yes', label: '准了' }, { id: 'no', label: '不准' }],
    fallback: 'no',
    about: (x) => [String(x.who)],
    apply(w, _r, x, o) {
      const p = who(w, x);
      if (o === 'yes') { assignJob(w, p, 'travel'); p.travelUntil = w.t + 4; p.mood = clamp(p.mood + 10, 0, 100); }
      else p.mood = clamp(p.mood - 5, 0, 100);
    },
  },
  probation_end: {
    title: (w, x) => `${who(w, x).name}试用期满`,
    text: (w, x) => { const p = who(w, x); return `记名弟子${p.name}在山上待满一年了。这一年${pronoun(p)}${p.merit >= 25 ? '干活很卖力' : p.merit >= 10 ? '干活还算本分' : '没干出什么名堂'}，修为到了${realmLabel(p)}${p.grudge >= 40 ? '，心里似乎有些怨气' : ''}。留不留？`; },
    options: () => [{ id: 'keep', label: '转为外门弟子' }, { id: 'inner', label: '直接升内门' }, { id: 'expel', label: '请他下山' }],
    fallback: 'keep',
    about: (x) => [String(x.who)],
    apply(w, r, x, o) {
      const p = who(w, x);
      p.probation = undefined;
      if (o === 'expel') { leaveSect(w, p, '试用期满，被请下了山', 'bad'); return; }
      setRank(w, p, o === 'inner' ? 'inner' : 'outer');
      void r;
    },
  },
  fight: {
    title: (w, x) => `${who(w, x, 'a').name}和${who(w, x, 'b').name}打起来了`,
    text: (w, x) => { const a = who(w, x, 'a'), b = who(w, x, 'b'); return `${a.name}和${b.name}积怨已深，今天在${jobName(a)}大打出手，${x.loser === a.id ? a.name : b.name}受了伤。`; },
    options: (w, x) => [
      { id: 'a', label: `罚${who(w, x, 'a').name}` },
      { id: 'b', label: `罚${who(w, x, 'b').name}` },
      { id: 'both', label: '各打五十大板' },
      { id: 'mediate', label: '亲自调解', hint: '花宗主威望，两人关系缓和' },
    ],
    fallback: 'both',
    about: (x) => [String(x.a), String(x.b)],
    apply(w, _r, x, o) {
      const a = who(w, x, 'a'), b = who(w, x, 'b');
      if (o === 'mediate') {
        w.sect.authority = clamp(w.sect.authority - 4, 0, 100);
        adjust(a, b.id, 25); adjust(b, a.id, 25); adjust(a, w.me, 5, 5); adjust(b, w.me, 5, 5);
        return;
      }
      const hit = o === 'a' ? [a] : o === 'b' ? [b] : [a, b];
      for (const p of hit) { p.merit = Math.max(0, p.merit - 15); p.grudge = clamp(p.grudge + 8, 0, 100); adjust(p, w.me, -5); }
      if (o === 'a') adjust(b, w.me, 8, 4);
      if (o === 'b') adjust(a, w.me, 8, 4);
    },
  },
  poach_alert: {
    title: (w, x) => `${rivalName(w, String(x.rival))}在挖${who(w, x).name}`,
    text: (w, x) => { const p = who(w, x); return `外事堂打听到：${rivalName(w, String(x.rival))}私下找过${p.name}，许了好处。${p.grudge >= 40 ? `${pronoun(p)}最近本就不太痛快。` : ''}`; },
    options: () => [{ id: 'raise', label: '加恩挽留', hint: '花 40 灵石，他会念你的好', cost: { stones: 40 } }, { id: 'warn', label: '警告对方，别伸手' }, { id: 'ignore', label: '由他去' }],
    fallback: 'ignore',
    about: (x) => [String(x.who)],
    apply(w, _r, x, o) {
      const p = who(w, x);
      const rv = w.rivals.find((v) => v.id === x.rival);
      if (o === 'raise') { p.favor += 8; p.loyalty = clamp(p.loyalty + 15, 0, 100); p.grudge = clamp(p.grudge - 15, 0, 100); delete w.offers[p.id]; w.acts.push({ kind: 'gift', who: p.id, text: `加恩挽留${p.name}` }); }
      if (o === 'warn' && rv) { rv.attitude -= 8; delete w.offers[p.id]; w.sect.authority = clamp(w.sect.authority + 2, 0, 100); }
    },
  },
  faction_alert: {
    title: (w, x) => `${who(w, x).name}在拉帮结派`,
    text: (w, x) => `执法堂报：${who(w, x).name}暗中拉拢了${x.n}个心怀不满的人，常在一处议论宗门的不是。`,
    options: () => [{ id: 'break', label: '把这几个人拆开，分到各处' }, { id: 'coopt', label: '招安：给领头的一个位置' }, { id: 'ignore', label: '不管' }],
    fallback: 'ignore',
    about: (x) => [String(x.who)],
    apply(w, _r, x, o) {
      const p = who(w, x);
      if (o === 'break') { p.grudge = clamp(p.grudge + 10, 0, 100); for (const m of members(w)) if (m.grudge >= 30) m.grudge = clamp(m.grudge - 10, 0, 100); }
      if (o === 'coopt') { p.favor += 10; p.grudge = clamp(p.grudge - 30, 0, 100); p.loyalty = clamp(p.loyalty + 10, 0, 100); if (p.rank === 'outer') setRank(w, p, 'inner'); w.acts.push({ kind: 'promote', who: p.id, text: `招安了${p.name}` }); }
    },
  },
  found_leave: {
    title: (w, x) => `${who(w, x).name}要自立门户`,
    text: (w, x) => `${who(w, x).name}要带着${x.names}下山，自立门户。`,
    options: () => [{ id: 'allow', label: '好聚好散' }, { id: 'stop', label: '拦下来', hint: '要动手，可能有人受伤' }],
    fallback: 'allow',
    about: (x) => [String(x.who)],
    apply(w, r, x, o) {
      const p = who(w, x);
      const followers = String(x.followers).split(',').filter(Boolean).map((id) => P(w, id)!).filter((q) => q?.alive && q.sect === p.sect);
      if (o === 'stop') {
        const strongest = members(w).filter((q) => q.id !== p.id && !followers.includes(q)).sort((a, b) => power(b) - power(a))[0];
        if (strongest && duel(r, strongest, p) === strongest) {
          p.hp = clamp(p.hp - 40, 5, 100); p.grudge = clamp(p.grudge + 20, 0, 100);
          for (const f of followers) { f.grudge = clamp(f.grudge + 10, 0, 100); f.loyalty = clamp(f.loyalty - 10, 0, 100); }
          report(w, { text: `${strongest.name}出手拦下了${p.name}，自立门户的事就此作罢。`, tone: 'story', about: [p.id, strongest.id], big: true });
          return;
        }
      }
      w.sect.rep = Math.max(0, w.sect.rep - (o === 'stop' ? 8 : 3));
      for (const f of followers) leaveSect(w, f, `跟着${p.name}下山另立门户`, 'bad');
      leaveSect(w, p, '下山自立门户', 'story');
    },
  },
};

function pct(x: number) { return `${Math.round(x * 100)}%`; }
function realmLabel(p: Person) { return p.realm === 0 ? `炼气${'一二三四五六七八九'[Math.max(0, p.stage - 1)]}层` : REALM_NAME[p.realm]; }

/** 冲关的几种办法：不给丹、赐筑基丹、倾宗门之力 */
export type BreakWay = 'go' | 'pill' | 'treasure';

export function breakOptions(w: World, p: Person): DecisionOption[] {
  const o: DecisionOption[] = [];
  if (p.realm === 0) o.push({ id: 'pill', label: '赐一颗筑基丹，准闭关', hint: `成算 ${pct(breakChance(p, true))} · 库里有 ${w.sect.fpills} 颗`, cost: { fpills: 1 } });
  else o.push({ id: 'treasure', label: `倾宗门之力助${pronoun(p)}冲关`, hint: `成算 ${pct(breakChance(p, true))} · 花 ${p.realm * 250} 灵石`, cost: { stones: p.realm * 250 } });
  o.push({ id: 'go', label: '准闭关，不给丹', hint: `成算 ${pct(breakChance(p, false))}` });
  return o;
}

/** 宗主准某人冲关（季报里的待裁决，或人物卡上直接下令） */
export function breakNow(w: World, r: Rng, p: Person, way: BreakWay): string | null {
  if (!p.alive || !atBottleneck(p)) return `${p.name}还没到冲关的时候`;
  if (p.breaking) return `${p.name}已经在闭关了`;
  const opt = breakOptions(w, p).find((o) => o.id === way);
  if (!opt) return '不能这样冲关';
  const no = lacks(w, opt.cost);
  if (no) return no;
  pay(w, opt.cost);
  const pill = way !== 'go';
  // 当面准了，季报里那件"想冲关"的事就不用再管了
  w.decisions = w.decisions.filter((d) => !(d.kind === 'breakthrough' && d.params.who === p.id));
  w.acts.push({ kind: pill ? 'break_pill' : 'break_ok', who: p.id, text: pill ? `赐丹助${p.name}冲关` : `准${p.name}闭关冲关` });
  adjust(p, w.me, pill ? 10 : 4, 5);
  void r;
  startBreak(w, p, pill);
  return null;
}
function jobName(p: Person) { return p.job in HALL ? HALL[p.job as HallId].name : '山上'; }
function rivalName(w: World, id: string) { return w.rivals.find((r) => r.id === id)?.name ?? '某宗'; }

/** 离开宗门（下山、叛逃、自立门户都走这里） */
export function leaveSect(w: World, p: Person, why: string, tone: 'good' | 'bad' | 'info' | 'story', to: string | null = null) {
  p.sect = to;
  p.head = undefined;
  p.job = 'none';
  if (!to) p.rank = 'outer';
  w.members = w.members.filter((id) => id !== p.id);
  addLife(w, p, why, tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : 'story', true);
  report(w, { text: `${p.name}${why}。`, tone: tone === 'good' ? 'good' : tone === 'info' ? 'info' : 'bad', about: [p.id], big: true });
  for (const q of members(w)) {
    const o = op(q, p.id);
    if (o.aff >= 40) { q.mood = clamp(q.mood - 10, 0, 100); addLife(w, q, `${p.name}走了，${pronoun(q)}很难过`, 'bad'); }
  }
  delete w.offers[p.id];
}

export function expel(w: World, _r: Rng, p: Person, why: string) {
  w.acts.push({ kind: 'expel', who: p.id, text: `把${p.name}逐出山门` });
  leaveSect(w, p, `因${why}被逐出山门`, 'bad');
  w.sect.authority = clamp(w.sect.authority + 2, 0, 100);
}

export function addDecision(w: World, kind: string, params: Params): Decision | null {
  const k = KINDS[kind];
  if (!k) return null;
  // 同一件事不重复报
  if (w.decisions.some((d) => d.kind === kind && JSON.stringify(d.params) === JSON.stringify(params))) return null;
  if (kind === 'breakthrough' && w.decisions.some((d) => d.kind === kind && d.params.who === params.who)) return null;
  const now = nowDay(w);
  const d: Decision = {
    id: newId(w, 'd'), kind, params,
    title: k.title(w, params), text: k.text(w, params), options: k.options(w, params),
    about: k.about(params), fallback: k.fallback, at: now, due: now + DECISION_DAYS,
  };
  w.decisions.push(d);
  emit({ k: 'decision', id: d.id });
  return d;
}

/** 刷新文字（比如库里的丹药数变了） */
export function refreshDecision(w: World, d: Decision) {
  const k = KINDS[d.kind];
  if (!k) return;
  d.text = k.text(w, d.params);
  d.options = k.options(w, d.params);
}

/** 宗主拍板。选了花不起的选项就不办，返回原因 */
export function resolveDecision(w: World, r: Rng, id: string, option: string): string | null {
  const i = w.decisions.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const d = w.decisions[i];
  const opt = d.options.find((o) => o.id === option);
  const no = lacks(w, opt?.cost);
  if (no) return no;
  w.decisions.splice(i, 1);
  // 冲关的花费在 breakNow 里扣（还要再核一遍成算）；其余选项在这里统一扣
  if (d.kind !== 'breakthrough') pay(w, opt?.cost);
  // 事件类的裁决由 events.ts 处理
  if (d.kind.startsWith('ev:')) { resolveEventDecision(w, r, d, option); return null; }
  const k = KINDS[d.kind];
  const alive = d.about.every((a) => P(w, a)?.alive !== false);
  if (k && alive) k.apply(w, r, d.params, option);
  return null;
}

export function isDecisionKind(k: string) { return k in KINDS; }

// 事件裁决的处理由 events.ts 注册进来，避免循环引用
let resolveEventDecision: (w: World, r: Rng, d: Decision, option: string) => void = () => {};
export function setEventResolver(f: typeof resolveEventDecision) { resolveEventDecision = f; }
