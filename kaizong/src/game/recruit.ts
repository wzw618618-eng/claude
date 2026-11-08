// 招募：候选人从哪来、你能看出多少、要花什么代价看清他、他肯不肯来。

import { REALM_NAME } from './cult';
import { addDecision } from './decisions';
import { TRAIT } from './data/traits';
import { ORIGIN_TEXT, RANK_NAME, SKILL_NAME, SKILLS } from './data/world';
import { genPerson, setPatron } from './gen';
import type { Rng } from './rng';
import { setRank } from './sect';
import type { Candidate, Person, Rank, Skill, World } from './types';
import { addLife, adjust, clamp, disp, hasTrait, P, report } from './world';

export const WANT_TEXT: Record<Candidate['wants'], string> = {
  technique: '想学上乘功法', status: '想要个像样的名分', safety: '想找个靠得住的地方安身', food: '只求有口饭吃、有处落脚',
  revenge: '想学本事报仇', fame: '想拜入名门，出人头地', wealth: '想过上不愁灵石的日子',
};

/** 看人准不准：迎客堂干得越好越准 */
export function insight(w: World, recruitPower: number) {
  return Math.min(0.95, 0.5 + recruitPower * 0.12 + (w.sect.tech.includes('scouting') ? 0.15 : 0));
}

const SKILL_HINT: Record<Skill, string> = {
  manage: '说话有条理，像是管过事的', alchemy: '身上有淡淡的药香', forge: '手上满是烫伤的旧疤', array: '随手在地上画的符纹颇有章法',
  herb: '认得山门边的每一株草', social: '三言两语就和门房聊熟了', combat: '虎口有厚茧，像是练过剑', teach: '路上一直在教同行的孩子认字',
  insight: '一双眼睛四下打量，什么都看在眼里',
};

const TRAIT_HINT: Record<string, string> = {
  proud: '下巴抬得很高', humble: '见谁都先行礼', fierce: '和排队的人起了口角', gentle: '说话轻声细语', greedy: '盯着山门的灵石灯看了半天',
  lazy: '等着等着就靠墙睡着了', diligent: '等候时也在打坐', timid: '有人大声说话就一哆嗦', reckless: '差点从山道上摔下去', scheming: '问东问西，自己的事却一句不提',
  chatty: '一张嘴就停不下来', loner: '远远站在一边，不和人说话', righteous: '看见有人插队，上前就管', warm: '把干粮分给了旁边的人', cold: '别人搭话也不理',
};

function wantsOf(r: Rng, p: Person): Candidate['wants'] {
  if (p.secret?.kind === 'vendetta') return 'revenge';
  return r.weighted<Candidate['wants']>([
    ['technique', 1 + p.values.power * 2], ['status', 1 + Math.max(0, disp(p, 'ambition')) * 1.5], ['safety', 1 + Math.max(0, -disp(p, 'courage'))],
    ['food', p.origin.includes('孤儿') || p.origin.includes('流民') || p.origin.includes('逃荒') ? 4 : 1], ['fame', 0.5 + Math.max(0, disp(p, 'pride'))], ['wealth', 0.5 + Math.max(0, disp(p, 'greed')) * 1.5],
  ])!;
}

export function makeCandidate(w: World, r: Rng, via: Candidate['via'], acc: number, opts: { patron?: string } = {}): Candidate {
  const gifted = via === 'genius';
  const p = genPerson(w, r, {
    sect: null, gifted,
    realm: 0, stage: r.int(1, gifted ? 5 : 4),
    secret: via === 'spy' ? 'spy' : undefined,
    secretChance: via === 'walkin' ? 0.3 : 0.12,
  });
  if (via === 'spy' && opts.patron) setPatron(p, opts.patron, w.rivals.find((x) => x.id === opts.patron)?.name ?? '');
  if (via === 'walkin' && r.chance(0.15)) { p.realm = 1; p.stage = 0; p.age = r.int(45, 90); }
  w.people[p.id] = p;
  // 印象：真本事里挑两样说，看不准就说错
  const top = [...SKILLS].sort((a, b) => p.caps[b] - p.caps[a]);
  const hints: string[] = [];
  for (const sk of top.slice(0, 2)) hints.push(SKILL_HINT[r.chance(acc) ? sk : r.pick(SKILLS)]);
  const th = p.traits.find((t) => TRAIT_HINT[t]);
  if (th && r.chance(acc)) hints.push(TRAIT_HINT[th]);
  else if (r.chance(0.4)) hints.push(TRAIT_HINT[r.pick(Object.keys(TRAIT_HINT))]);
  if (p.root.apt >= 1.35 && r.chance(acc)) hints.push('周身灵气似乎很足');
  // 自述来历：说谎的人编一个
  const claim = p.honestOrigin ? p.origin : r.pick(ORIGIN_TEXT.filter((o) => o !== p.origin));
  let rumor = '';
  if (p.secret?.kind === 'fugitive' && r.chance(acc * 0.6)) rumor = '山下坊市在传，官府正找一个人，模样和他有几分像';
  else if (p.secret?.kind === 'noble' && r.chance(acc * 0.6)) rumor = '举手投足不像穷人家出来的';
  else if (p.secret?.kind === 'spy' && r.chance(acc * 0.4)) rumor = `有人在${w.rivals.find((x) => x.id === opts.patron)?.name ?? '别宗'}山下见过他`;
  else if (gifted) rumor = '据说在家乡测过灵根，测灵石亮得刺眼';
  const c: Candidate = {
    id: p.id, via, claim, rumor, wants: wantsOf(r, p), patience: r.int(2, 4) + (disp(p, 'temper') < 0 ? 1 : 0),
    known: { root: false, skills: [], traits: false, origin: 'unknown' }, hints, stay: via === 'spy' ? 2 : 1,
  };
  if (gifted) {
    const rv = w.rivals.filter((x) => x.alive && !x.passive);
    if (rv.length && r.chance(0.6)) c.courtedBy = r.pick(rv).id;
  }
  return c;
}

export const candidatePerson = (w: World, c: Candidate) => w.people[c.id];

/** 测灵根 */
export const ROOT_COST = 10;
export function testRoot(w: World, c: Candidate): string | null {
  if (c.known.root) return null;
  if (w.sect.stones < ROOT_COST) return '灵石不够';
  w.sect.stones -= ROOT_COST;
  c.known.root = true;
  return null;
}

/** 考一项才干：花候选人的耐心 */
export function testSkill(w: World, c: Candidate, sk: Skill): string | null {
  if (c.known.skills.includes(sk)) return null;
  if (c.patience <= 0) return '他已经不耐烦了';
  c.patience -= 1;
  c.known.skills.push(sk);
  if (c.patience <= 0) c.annoyed = true;
  return null;
}

export function heartTest(w: World, c: Candidate): string | null {
  if (!w.sect.tech.includes('heart_array')) return '要先建问心阵';
  c.known.traits = true;
  return null;
}

/** 派人去查来历：下一季出结果，他得多等一季 */
export function checkOrigin(w: World, c: Candidate): string | null {
  if (c.known.origin !== 'unknown') return null;
  c.known.origin = 'checking';
  c.checkAt = w.t + 1;
  c.stay = Math.max(c.stay, 2);
  return null;
}

/** 他肯不肯来 */
export function acceptChance(w: World, c: Candidate, rank: Rank): number {
  const p = candidatePerson(w, c);
  if (c.via === 'spy' || p.secret?.kind === 'spy') return 0.97;
  let x = 0.55 + w.sect.rep / 300 + (w.sect.policy === 'recruit' ? 0.15 : 0);
  const rk = { probation: -0.25, outer: -0.05, inner: 0.15, core: 0.3 }[rank as 'outer'] ?? 0;
  x += rk;
  switch (c.wants) {
    case 'technique': x += w.sect.tech.includes('technique_2') ? 0.15 : -0.1; break;
    case 'status': x += rk * 0.8; break;
    case 'safety': x += w.war ? -0.2 : 0.05; break;
    case 'food': x += 0.2; break;
    case 'revenge': x += 0.05; break;
    case 'fame': x += w.sect.rep / 250 - 0.1; break;
    case 'wealth': x += w.sect.stones >= 300 ? 0.1 : -0.1; break;
  }
  if (c.via === 'genius') x -= rank === 'outer' || rank === 'probation' ? 0.35 : 0.1;
  if (c.courtedBy) x -= rank === 'core' ? 0 : 0.15;
  if (c.annoyed) x -= 0.15;
  if (w.sect.align < -30 && disp(p, 'order') > 0) x -= 0.2;
  return clamp(x, 0.05, 0.97);
}

/** 正式招进门 */
export function admit(w: World, r: Rng, c: Candidate, rank: Rank): boolean {
  const p = candidatePerson(w, c);
  w.candidates = w.candidates.filter((x) => x.id !== c.id);
  if (!r.chance(acceptChance(w, c, rank))) {
    report(w, { text: `${p.name}婉拒了，${c.courtedBy ? `转身去了${w.rivals.find((x) => x.id === c.courtedBy)?.name}` : '下山去了'}。`, tone: 'bad', about: [p.id] });
    if (c.courtedBy) { p.sect = c.courtedBy; w.rivals.find((x) => x.id === c.courtedBy)?.named.push(p.id); }
    return false;
  }
  p.sect = 'me';
  w.members.push(p.id);
  if (!w.alumni.includes(p.id)) w.alumni.push(p.id);
  p.rank = 'outer';
  setRank(w, p, rank);
  if (rank === 'probation') p.probation = 0;
  w.acts.push({ kind: 'recruit', who: p.id, text: `收了${p.name}入门` });
  adjust(p, w.me, 20, 15);
  p.loyalty = clamp(p.loyalty + (rank === 'core' ? 15 : rank === 'inner' ? 8 : 0), 0, 100);
  p.life = [];
  addLife(w, p, `以${RANK_NAME[rank]}的身份拜入${w.sect.name}`, 'good', true);
  report(w, { text: `${p.name}拜入山门，成了${RANK_NAME[rank]}。`, tone: 'good', about: [p.id] });
  // 天才被别宗请过，没抢到的那家会记一笔
  if (c.courtedBy) {
    const rv = w.rivals.find((x) => x.id === c.courtedBy);
    if (rv) rv.attitude -= 5;
  }
  return true;
}

export function dismiss(w: World, c: Candidate) {
  w.candidates = w.candidates.filter((x) => x.id !== c.id);
}

/** 每季来人；春天开山收徒 */
export function newCandidates(w: World, r: Rng, recruitPower: number) {
  const acc = insight(w, recruitPower);
  const s = w.sect;
  if (w.t % 4 === 0) {
    let n = 3 + Math.floor(s.rep / 40) + (w.tier >= 2 ? 1 : 0) + (s.tech.includes('scouting') ? 2 : 0) + (s.site === 'market' ? 1 : s.site === 'deep' ? -1 : 0) + Math.floor(recruitPower * 0.6);
    if (s.policy === 'recruit') n = Math.round(n * 1.5);
    if (s.origin === 'demon') n -= 1;
    n = Math.max(1, Math.min(9, n));
    for (let i = 0; i < n; i++) {
      const genius = r.chance(0.07 + s.rep / 1200 + recruitPower * 0.02);
      w.candidates.push(makeCandidate(w, r, genius ? 'genius' : 'open', acc));
    }
    report(w, { text: `开山收徒，来了${n}个人。`, tone: 'info', about: [] });
  }
  if (r.chance(0.45 + (s.site === 'market' ? 0.2 : 0))) {
    w.candidates.push(makeCandidate(w, r, 'walkin', acc));
  }
}

/** 季末：查来历出结果、没被收的人离开 */
export function ageCandidates(w: World) {
  for (const c of w.candidates) {
    if (c.known.origin === 'checking' && c.checkAt !== undefined && w.t >= c.checkAt) {
      const p = candidatePerson(w, c);
      c.known.origin = p.honestOrigin ? 'true' : 'false';
    }
  }
  w.candidates = w.candidates.filter((c) => {
    c.stay -= 1;
    return c.stay > 0;
  });
}

/** 记名弟子试用期满 */
export function probationTick(w: World) {
  for (const id of w.members) {
    const p = P(w, id);
    if (!p?.alive || p.rank !== 'probation') continue;
    p.probation = (p.probation ?? 0) + 1;
    if (p.probation >= 4) addDecision(w, 'probation_end', { who: p.id });
  }
}

/** 候选人身上能看到的东西（界面用） */
export function visibleFacts(w: World, c: Candidate) {
  const p = candidatePerson(w, c);
  return {
    p,
    realm: p.realm === 0 ? `炼气${'一二三四五六七八九'[p.stage - 1]}层` : `${REALM_NAME[p.realm]}`,
    traits: c.known.traits ? p.traits.map((t) => TRAIT[t].name) : null,
    skills: c.known.skills.map((s) => ({ s, name: SKILL_NAME[s], v: Math.round(p.skills[s]), cap: Math.round(p.caps[s]) })),
    likes: c.known.traits ? p.likes : null,
    secretHint: c.known.origin === 'false' ? '查过了：他的来历是假的' : c.known.origin === 'true' ? '查过了：来历属实' : null,
    hasTrait: (t: string) => hasTrait(p, t),
  };
}



