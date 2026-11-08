// 宗主亲为：宗主自己做一件事，每件要花些日子（闭关、亲传一季，游历、拜山两个月，开炉一个半月）。
// 做完一轮出结果，接着再做同一件；中途换别的事，这一轮就白做了。坐镇、游历在做的时候天天起作用。

import { atBottleneck, breakChance, breakthrough, need, REALM_NAME, realmText, stepUp } from './cult';
import { SKILL_NAME } from './data/world';
import { insight, makeCandidate } from './recruit';
import type { Rng } from './rng';
import type { Work } from './sect';
import type { MasterAct, Person, Skill, World } from './types';
import { emit } from './fx';
import { addLife, adjust, clamp, daysLeft, disp, me, members, nm, nowDay, P, pronoun, report } from './world';

export const MASTER_ACT: Record<MasterAct, { name: string; desc: string; target?: 'disciple' | 'rival' }> = {
  seclude: { name: '闭关', desc: '自己修炼，修为圆满后冲击元婴。到了元婴，宗门的底气就不一样了' },
  teach: { name: '亲传', desc: '亲自教一个弟子：修为大进、学到你的拿手本事，更认你这个师父；同辈里善妒的会眼红', target: 'disciple' },
  preside: { name: '坐镇', desc: '坐镇山门：全宗怨气消得快，执法堂、巡山队更得力，宗主威望 +2' },
  roam: { name: '游历', desc: '下山走一趟：可能带回好苗子、灵药、灵石，或者听到些风声；山上没人镇着，怨气涨一些' },
  craft: { name: '开炉', desc: '亲自炼丹：用掉灵草，换来丹药，可能炼出筑基丹。宗主炼丹本事越高越好' },
  visit: { name: '拜山', desc: '登门拜访一个宗门：对方态度大涨，名望也涨一点', target: 'rival' },
};
export const MASTER_ACTS = Object.keys(MASTER_ACT) as MasterAct[];

/** 每件事做一轮要几天 */
export const MASTER_DAYS: Record<MasterAct, number> = { seclude: 90, teach: 90, preside: 90, roam: 60, craft: 45, visit: 60 };

/** 宗主最拿手的本事（亲传时教这个） */
export function masterSkill(m: Person): Skill {
  return (['combat', 'alchemy', 'forge', 'array', 'herb', 'manage'] as Skill[]).reduce((b, s) => (m.skills[s] > m.skills[b] ? s : b), 'combat');
}

/** 宗主冲关的成算：比弟子高一些，失败多了越来越难 */
export const masterBreakChance = (w: World) => Math.min(0.85, breakChance(me(w), false) + 0.2);

/** 这件事现在能不能做；不能就说为什么 */
export function masterBlock(w: World, act: MasterAct, target?: string): string | null {
  switch (act) {
    case 'teach': {
      const p = P(w, target);
      if (!p) return '挑一个弟子';
      if (!p.alive || p.sect !== 'me' || p.id === w.me) return `${p.name}不是本门弟子`;
      if (p.job === 'travel') return `${p.name}不在山上`;
      return null;
    }
    case 'visit': {
      const rv = w.rivals.find((x) => x.id === target);
      if (!rv) return '挑一个宗门';
      if (!rv.alive) return `${rv.name}已经没了`;
      if (rv.status === 'war' || w.war?.enemy === rv.id) return `正和${rv.name}打仗`;
      return null;
    }
    case 'craft': return w.sect.herbs < 15 ? '灵草不够（要 15）' : null;
    default: return null;
  }
}

export function setMasterPlan(w: World, act: MasterAct, target?: string): string | null {
  const no = masterBlock(w, act, target);
  if (no) return no;
  const tg = MASTER_ACT[act].target ? target : undefined;
  const cur = w.masterPlan;
  if (cur.act === act && cur.target === tg && cur.until !== undefined) return null;
  const now = nowDay(w);
  w.masterPlan = { act, target: tg, from: now, until: now + MASTER_DAYS[act] };
  return null;
}

/** 这一轮做到几成（0–1） */
export function masterProgress(w: World): number {
  const { from, until } = w.masterPlan;
  if (from === undefined || until === undefined) return 0;
  return Math.max(0, Math.min(1, (nowDay(w) - from) / Math.max(1, until - from)));
}
export const masterLeft = (w: World) => daysLeft(w, w.masterPlan.until ?? nowDay(w));

/** 坐镇、游历在做的时候天天起作用；f 是这一天占一季的几分之几 */
export function masterDaily(w: World, work: Work, f: number) {
  const act = w.masterPlan.act;
  if (act === 'preside') {
    work.lawPower += 2;
    work.guardPower += 3;
    for (const p of members(w)) p.grudge = clamp(p.grudge - 2 * f, 0, 100);
  } else if (act === 'roam') {
    work.lawPower = Math.max(0, work.lawPower - 1);
    for (const p of members(w)) p.grudge = clamp(p.grudge + 1 * f, 0, 100);
  }
}

/** 每天：这一轮做完了就出结果，再接着做同一件 */
export function masterTick(w: World, r: Rng) {
  const now = nowDay(w);
  const plan = w.masterPlan;
  if (plan.until === undefined) { plan.from = now; plan.until = now + MASTER_DAYS[plan.act]; return; }
  // 这一天过完算一天：第 until 天的早上就算做满了
  if (now + 1 < plan.until) return;
  masterSeason(w, r);
  const next = w.masterPlan;
  next.from = now + 1;
  next.until = now + 1 + MASTER_DAYS[next.act];
}

export function planText(w: World): string {
  const { act, target } = w.masterPlan;
  if (act === 'teach') return `亲传${nm(w, target)}`;
  if (act === 'visit') return `拜山${w.rivals.find((x) => x.id === target)?.name ?? ''}`;
  if (act === 'seclude' && atBottleneck(me(w))) return `闭关冲击${REALM_NAME[me(w).realm + 1]}`;
  return MASTER_ACT[act].name;
}

/** 宗主做完一轮，出结果（坐镇、游历天天起的作用在 masterDaily 里） */
export function masterSeason(w: World, r: Rng, _work?: Work) {
  const m = me(w);
  let { act, target } = w.masterPlan;
  if (masterBlock(w, act, target)) { act = 'seclude'; target = undefined; w.masterPlan = { act }; }
  const s = w.sect;
  switch (act) {
    case 'seclude': {
      if (m.realm >= 4) return;
      if (atBottleneck(m)) {
        const to = REALM_NAME[m.realm + 1];
        if (r.chance(masterBreakChance(w))) {
          breakthrough(m);
          s.rep += 40; s.authority = clamp(s.authority + 20, 0, 100);
          for (const rv of w.rivals) if (rv.alive) rv.attitude = clamp(rv.attitude + 10, -100, 100);
          for (const p of members(w)) { adjust(p, m.id, 5, 15); p.loyalty = clamp(p.loyalty + 5, 0, 100); }
          addLife(w, m, `闭关冲关，踏入${to}`, 'good', true);
          report(w, { text: `宗主闭关冲关，踏入${to}！天降异象，一州皆知。各宗对你客气了许多。`, tone: 'good', about: [], big: true });
          emit({ k: 'break', who: m.id, ok: true });
          emit({ k: 'banner', text: `宗主破关，踏入${to}！`, tone: 'gold' });
        } else {
          m.fails += 1; m.exp = Math.round(m.exp * 0.5); m.hp = clamp(m.hp - 35, 5, 100);
          addLife(w, m, `冲击${to}失败，受了内伤`, 'bad', true);
          report(w, { text: `宗主冲击${to}失败，受了内伤，修为跌了一截。`, tone: 'bad', about: [], big: true });
          emit({ k: 'break', who: m.id, ok: false });
        }
        return;
      }
      const tech = (s.tech.includes('technique_2') ? 1.1 : 1) * (s.tech.includes('technique_3') ? 1.1 : 1) * (s.tech.includes('blood_art') ? 1.15 : 1);
      const before = m.stage;
      m.exp += need(m) * 0.12 * (0.85 + 0.15 * m.root.apt) * tech * (0.6 + m.hp / 250);
      stepUp(m);
      if (m.stage !== before) {
        s.authority = clamp(s.authority + 3, 0, 100);
        addLife(w, m, `闭关有成，修为到了${realmText(m)}`, 'good');
        report(w, { text: `宗主闭关有成，修为到了${realmText(m)}。`, tone: 'good', about: [] });
      }
      if (atBottleneck(m)) report(w, { text: `宗主修为圆满，下一季闭关就能冲击${REALM_NAME[m.realm + 1]}（成算 ${Math.round(masterBreakChance(w) * 100)}%）。`, tone: 'info', about: [] });
      return;
    }
    case 'teach': {
      const p = P(w, target)!;
      const sk = masterSkill(m);
      p.skills[sk] = Math.min(p.caps[sk], p.skills[sk] + 6);
      if (atBottleneck(p)) {
        p.fails = Math.max(0, p.fails - 1);
        p.mood = clamp(p.mood + 10, 0, 100);
      } else {
        // 炼气弟子当场长一层；筑基以上一阶太长，教一季顶小半阶
        p.exp += p.realm === 0 ? need(p) : need(p) * 0.5;
        stepUp(p);
      }
      adjust(p, m.id, 12, 8);
      p.loyalty = clamp(p.loyalty + 8, 0, 100);
      p.favor += 5;
      for (const q of members(w)) if (q.id !== p.id && q.rank === p.rank && disp(q, 'envy') > 0) adjust(q, p.id, -4);
      w.acts.push({ kind: 'teach', who: p.id, text: `亲自传了${p.name}功法` });
      addLife(w, p, `宗主亲自传功，教了${pronoun(p)}${SKILL_NAME[sk]}${atBottleneck(p) ? '，心境通透了不少' : '，修为大进'}`, 'good', true);
      report(w, { text: `你亲自给${p.name}传功：修为到了${realmText(p)}，${SKILL_NAME[sk]}也长进了。`, tone: 'good', about: [p.id] });
      return;
    }
    case 'preside': {
      s.authority = clamp(s.authority + 2, 0, 100);
      emit({ k: 'float', at: 'main', text: '宗主威望 +2', tone: 'gold' });
      return;
    }
    case 'roam': {
      const spy = members(w).find((p) => p.secret?.kind === 'spy' && !p.secret.exposed);
      const pick = r.weighted<'kid' | 'herbs' | 'stones' | 'rep' | 'rumor'>([['kid', 4], ['herbs', 3], ['stones', 2], ['rep', 2], ['rumor', spy ? 3 : 0]])!;
      if (pick === 'kid') {
        const c = makeCandidate(w, r, r.chance(0.35) ? 'genius' : 'walkin', insight(w, 2));
        c.claim = '宗主游历时在山下遇见，带回来的';
        c.stay = 2;
        w.candidates.push(c);
        report(w, { text: `你下山游历，遇见一个叫${w.people[c.id].name}的${w.people[c.id].age < 20 ? '少年' : '年轻人'}，带回了山门，在迎客堂等你见。`, tone: 'good', about: [] });
      } else if (pick === 'herbs') {
        const n = r.int(30, 70); s.herbs += n;
        report(w, { text: `你下山游历，在深山里采了 ${n} 株灵草回来。`, tone: 'good', about: [] });
      } else if (pick === 'stones') {
        const n = r.int(60, 140); s.stones += n;
        report(w, { text: `你下山游历，顺手替人解了个难处，得了 ${n} 灵石。`, tone: 'good', about: [] });
      } else if (pick === 'rep') {
        s.rep += 6;
        report(w, { text: '你下山游历，一路行侠仗义，宗门名声传开了一些。', tone: 'good', about: [] });
      } else if (spy) {
        const rv = w.rivals.find((x) => x.id === spy.secret!.patron);
        w.misdeeds.push({ who: spy.id, what: `常往${rv?.name ?? '别家'}山下跑`, t: w.t });
        report(w, { text: `你下山游历，在茶楼听人闲聊：${spy.name}常往${rv?.name ?? '别家'}山下跑。`, tone: 'story', about: [spy.id] });
      }
      return;
    }
    case 'craft': {
      // 一炉一个半月，半季的量
      const used = Math.min(s.herbs, 20);
      s.herbs -= used;
      const pills = Math.round(used * (0.3 + m.skills.alchemy / 200));
      s.pills += pills;
      let fp = '';
      if (used >= 15 && r.chance((0.15 + m.skills.alchemy / 200 + (s.tech.includes('foundation_recipe') ? 0.2 : 0)) / 2)) { s.fpills += 1; fp = '，还成了一颗筑基丹'; }
      emit({ k: 'float', at: 'main', text: `+${pills}丹药${fp ? ' +1筑基丹' : ''}`, tone: 'good' });
      report(w, { text: `你亲自开炉，用 ${used} 株灵草炼出 ${pills} 颗丹药${fp}。`, tone: 'good', about: [] });
      return;
    }
    case 'visit': {
      const rv = w.rivals.find((x) => x.id === target)!;
      const rm = P(w, rv.master);
      const up = rv.passive ? 6 : 7 + (rm && m.realm >= rm.realm ? 3 : 0);
      rv.attitude = clamp(rv.attitude + up, -100, 100);
      s.rep += rv.passive ? 6 : 2;
      report(w, { text: `你登门拜访${rv.name}，和${rm?.name ?? '宗主'}${rv.passive ? '论了一夜的道' : '喝了一顿酒'}。${rv.name}对你客气了不少。`, tone: 'good', about: [] });
      return;
    }
  }
}
