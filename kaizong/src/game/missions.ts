// 宗门任务：任务栏上每季挂着几件差事，宗主挑一到三个弟子组队出去，按天数走一趟回来。
// 成不成看队伍的战力和本事（打打杀杀的看战力，炼丹调解的看本事）；越凶险赏得越多，也越可能有人回不来。

import { power, stepUp } from './cult';
import { SKILL_NAME } from './data/world';
import { boardSize, grant, rewardText } from './goals';
import { insight, makeCandidate } from './recruit';
import type { Rng } from './rng';
import { hallHead } from './sect';
import type { Mission, Person, Reward, Skill, World } from './types';
import { emit } from './fx';
import { addLife, clamp, daysLeft, newId, nowDay, P, report, year } from './world';

interface MissionDef {
  kind: string;
  titles: string[];
  descs: string[];
  skill: Skill;
  skill2?: Skill;
  fight: number;
  seasons: number;
  minDanger?: number;
  maxDanger?: number;
  minYear?: number;
  reward(d: number): Reward;
}

const DEFS: MissionDef[] = [
  { kind: 'beast', titles: ['清剿妖兽', '除掉山下的狼妖', '斩杀作乱的蛟蛇'], descs: ['山下的村子被妖兽祸害，村长求上山来。', '有妖兽夜里下山叼走了牲口，猎户不敢进山了。'], skill: 'combat', fight: 0.85, seasons: 1, reward: (d) => ({ stones: 30 * d, rep: 2 * d }) },
  { kind: 'escort', titles: ['护送商队', '押送一批灵材'], descs: ['商队要过黑风岭，请人护送一程。', '一批灵材要送到坊市，路上不太平。'], skill: 'combat', skill2: 'social', fight: 0.6, seasons: 1, reward: (d) => ({ stones: 45 * d }) },
  { kind: 'herb', titles: ['采集灵药', '进雾谷采药'], descs: ['雾谷里的灵药熟了，去晚了就被别家采光了。', '后山深处长出一片灵芝，有妖兽守着。'], skill: 'herb', fight: 0.3, seasons: 1, reward: (d) => ({ herbs: 22 * d, fpills: d >= 4 ? 1 : 0 }) },
  { kind: 'ruin', titles: ['探索前辈遗府', '下古修士洞府'], descs: ['有人在后山找到一处古修洞府的入口，里面机关重重。', '暴雨冲开了一座前辈遗府，阵法还没散尽。'], skill: 'array', skill2: 'insight', fight: 0.55, seasons: 2, minDanger: 2, reward: (d) => ({ gear: 1, exp: 12 * d, stones: 25 * d }) },
  { kind: 'mediate', titles: ['调解凡人纷争', '平息两村械斗'], descs: ['山下两个世家为争水源闹到要动刀，请宗门出面主持公道。', '两个村子为一块地打了起来，县令管不了。'], skill: 'social', skill2: 'manage', fight: 0.1, seasons: 1, reward: (d) => ({ rep: 5 * d, align: 3 }) },
  { kind: 'demon', titles: ['追剿魔修', '铲除血炼魔窟'], descs: ['一伙魔修在百里外害人炼功，正道各宗都在悬赏。', '有魔修抓了凡人炼血丹，窝点就在西边山里。'], skill: 'combat', skill2: 'insight', fight: 0.9, seasons: 2, minDanger: 3, minYear: 2, reward: (d) => ({ rep: 8 * d, align: 6, stones: 30 * d }) },
  { kind: 'scout', titles: ['寻访良才', '下山访贤'], descs: ['听说有几处地方出了根骨不错的孩子。', '南边镇上有个少年测灵石亮得刺眼，各宗都在打听。'], skill: 'insight', skill2: 'social', fight: 0.15, seasons: 1, maxDanger: 3, reward: (d) => ({ candidate: 1, rep: d }) },
  { kind: 'alchemy', titles: ['代人炼丹', '替城主炼一炉丹'], descs: ['山下城主出重金请人炼一炉固本丹。', '药铺掌柜收了一批好药材，请人开炉。'], skill: 'alchemy', fight: 0, seasons: 1, reward: (d) => ({ stones: 40 * d, pills: 2 * d }) },
  { kind: 'forge', titles: ['代人炼器', '给镖局打一批兵刃'], descs: ['镖局要一批好兵刃，出价不低。', '城里的富户想要一件护身法器。'], skill: 'forge', fight: 0, seasons: 1, reward: (d) => ({ stones: 35 * d, armory: 6 * d }) },
  { kind: 'arena', titles: ['坊市擂台', '赴论剑会'], descs: ['坊市开了擂台，各宗年轻弟子都去露脸。', '有人办论剑会，请各宗派人切磋。'], skill: 'combat', fight: 1, seasons: 1, maxDanger: 4, reward: (d) => ({ rep: 4 * d, stones: 20 * d }) },
];

/** 一趟要走几天：近的一个来月，远的两个多月 */
function missionDays(seasons: number, danger: number, jitter: number) {
  return (seasons >= 2 ? 66 : 30) + danger * 2 + jitter;
}
export const tripDays = (m: Mission) => m.days ?? missionDays(m.seasons, m.danger, 0);

/** 各凶险程度要的总战力、本事 */
export const POWER_NEED = [0, 40, 90, 200, 420, 900];
export const skillNeed = (d: number) => 20 + 12 * d;
export const MAX_TEAM = 3;

/** 这一队去办这件事的把握 */
export function missionChance(m: Mission, team: Person[]): number {
  if (!team.length) return 0;
  const str = team.reduce((t, p) => t + power(p), 0);
  const sk = Math.max(...team.map((p) => p.skills[m.skill] + (m.skill2 ? p.skills[m.skill2] * 0.4 : 0)));
  const pr = Math.min(1.5, str / POWER_NEED[m.danger]);
  const kr = Math.min(1.5, sk / skillNeed(m.danger));
  return clamp(0.08 + 0.55 * (m.fight * pr + (1 - m.fight) * kr) + (team.length - 1) * 0.04, 0.05, 0.95);
}

/** 一个人适不适合这件差事（挑人排序用） */
export function suitability(p: Person, m: Mission): number {
  return (power(p) / POWER_NEED[m.danger]) * m.fight + ((p.skills[m.skill] + (m.skill2 ? p.skills[m.skill2] * 0.4 : 0)) / skillNeed(m.danger)) * (1 - m.fight);
}

/** 这件事要什么样的人（界面提示用） */
export function missionNeeds(m: Mission): string {
  const sk = `${SKILL_NAME[m.skill]}${m.skill2 ? `、${SKILL_NAME[m.skill2]}` : ''}`;
  if (m.fight >= 0.7) return `要能打（全队战力约 ${POWER_NEED[m.danger]}），${sk}好的更稳`;
  if (m.fight >= 0.35) return `要${sk}好，也得能打（战力约 ${POWER_NEED[m.danger]}）`;
  return `看${sk}（约 ${skillNeed(m.danger)}）`;
}

/** 能派出去的人：在山上、没别的差事在身 */
export const canSend = (w: World, p: Person) => p.alive && p.sect === 'me' && p.id !== w.me && p.job !== 'travel' && !p.mission && !p.breaking;

function newMission(w: World, r: Rng, taken: Set<string>): Mission | null {
  const y = year(w.t);
  const pool = DEFS.filter((d) => !taken.has(d.kind) && (d.minYear ?? 0) <= y);
  const def = r.pick(pool);
  if (!def) return null;
  const base = 1 + Math.floor((y - 1) / 2);
  const danger = clamp(base + r.int(-1, 1), def.minDanger ?? 1, Math.min(5, def.maxDanger ?? 5));
  return {
    id: newId(w, 'm'), kind: def.kind, title: r.pick(def.titles), desc: r.pick(def.descs), danger, skill: def.skill, skill2: def.skill2,
    fight: def.fight, seasons: def.seasons, days: missionDays(def.seasons, danger, r.int(-4, 4)), reward: def.reward(danger), expires: w.t + 1,
  };
}

/** 换季时：过期的撤下，空出来的补上 */
export function refreshBoard(w: World, r: Rng) {
  w.missions = w.missions.filter((m) => m.expires >= w.t);
  const taken = new Set(w.missions.map((m) => m.kind));
  while (w.missions.length < boardSize(w)) {
    const m = newMission(w, r, taken);
    if (!m) break;
    taken.add(m.kind);
    w.missions.push(m);
  }
}

/** 派人出去 */
export function dispatch(w: World, missionId: string, ids: string[]): string | null {
  const m = w.missions.find((x) => x.id === missionId);
  if (!m) return '这件差事已经没了';
  const team = [...new Set(ids)].map((id) => P(w, id)).filter((p): p is Person => !!p);
  if (!team.length) return '先挑人';
  if (team.length > MAX_TEAM) return `最多派 ${MAX_TEAM} 个人`;
  const busy = team.find((p) => !canSend(w, p));
  if (busy) return `${busy.name}走不开`;
  const chance = missionChance(m, team);
  for (const p of team) {
    p.mission = { id: m.id, job: p.job, head: p.head };
    p.head = undefined;
    p.job = 'travel';
    if (p.likes.includes('travel')) p.mood = clamp(p.mood + 5, 0, 100);
    if (p.dislikes.includes('travel')) p.grudge = clamp(p.grudge + 4, 0, 100);
  }
  w.missions = w.missions.filter((x) => x.id !== m.id);
  const now = nowDay(w);
  w.expeditions.push({ mission: m, team: team.map((p) => p.id), from: now, back: now + tripDays(m), chance });
  emit({ k: 'banner', text: `${team.map((p) => p.name).join('、')}下山去${m.title}了`, tone: 'info' });
  w.acts.push({ kind: 'mission', who: team[0].id, text: `派${team.map((p) => p.name).join('、')}去${m.title}` });
  return null;
}

/** 回山：回到原来的差事 */
function comeHome(w: World, p: Person) {
  const ms = p.mission;
  p.mission = undefined;
  if (!p.alive || p.sect !== 'me' || !ms) return;
  p.job = ms.job === 'travel' ? 'none' : ms.job;
  if (ms.head && !hallHead(w, ms.head)) { p.head = ms.head; p.job = ms.head; }
}

const names = (ps: Person[]) => ps.map((p) => p.name).join('、');

/** 每天：到日子的队伍回来，算成败。now 不给就是"立刻都回来"（测试用） */
export function settleExpeditions(w: World, r: Rng, now = Infinity) {
  const keep = [];
  for (const e of w.expeditions) {
    if (now < e.back) { keep.push(e); continue; }
    const m = e.mission;
    const team = e.team.map((id) => P(w, id)).filter((p): p is Person => !!p?.alive && p.sect === 'me');
    if (!team.length) { for (const id of e.team) { const p = P(w, id); if (p) p.mission = undefined; } continue; }
    const d = m.danger;
    if (r.chance(e.chance)) {
      const rw: Reward = { ...m.reward };
      grant(w, rw);
      let extra = '';
      if (rw.gear) {
        const best = [...team].sort((a, b) => power(b) - power(a))[0];
        best.gear += rw.gear;
        addLife(w, best, `在${m.title}时得了一件法宝`, 'good', true);
        w.acts.push({ kind: 'gift', who: best.id, text: `派${best.name}去${m.title}，让${best.name}得了法宝` });
        extra += `，${best.name}得了一件法宝`;
      }
      if (rw.exp) for (const p of team) { p.exp += rw.exp; stepUp(p); }
      if (rw.candidate) {
        const c = makeCandidate(w, r, 'genius', insight(w, 1.5));
        c.claim = `被${team[0].name}从山下访来的`;
        c.stay = 2;
        w.candidates.push(c);
        extra += `，还带回一个好苗子${w.people[c.id].name}`;
      }
      for (const p of team) {
        p.merit += 6 * d; p.fame += d; p.favor += 2;
        p.mood = clamp(p.mood + 8, 0, 100);
        p.skills[m.skill] = Math.min(p.caps[m.skill], p.skills[m.skill] + 3);
        addLife(w, p, `${team.length > 1 ? `和${names(team.filter((q) => q !== p))}` : ''}去${m.title}，办成了`, 'good', d >= 3);
      }
      w.stats.missionsDone += 1;
      const shown = rewardText({ ...rw, gear: 0, exp: 0, candidate: 0 });
      report(w, { text: `${names(team)}${m.title}回来了：办成了${shown ? `，得${shown}` : ''}${extra}。`, tone: 'good', about: team.map((p) => p.id), big: d >= 4 });
      emit({ k: 'banner', text: `${m.title}，办成了！${shown ? `得${shown}` : ''}`, tone: 'good' });
      emit({ k: 'float', at: 'gate', text: shown ? `+${shown}` : '凯旋', tone: 'gold' });
    } else {
      // 没办成：带回来一点，人受伤，凶险的差事可能折人
      const part: Reward = { stones: Math.floor((m.reward.stones ?? 0) * 0.3), herbs: Math.floor((m.reward.herbs ?? 0) * 0.3) };
      grant(w, part);
      const hurt: string[] = [];
      for (const p of team) {
        p.hp = clamp(p.hp - (8 + d * 7) * r.range(0.6, 1.3), 5, 100);
        p.mood = clamp(p.mood - 8, 0, 100);
        if (p.hp < 50) hurt.push(p.name);
        addLife(w, p, `去${m.title}，没办成${p.hp < 50 ? '，受了伤' : ''}`, 'bad');
      }
      let lost = '';
      if (d >= 3 && r.chance(0.07 * (d - 2))) {
        const v = [...team].sort((a, b) => power(a) - power(b))[0];
        v.alive = false; v.death = `在${m.title}时陨落`;
        addLife(w, v, v.death, 'bad', true);
        lost = `，${v.name}没能回来`;
      }
      w.stats.missionsFailed += 1;
      report(w, { text: `${names(team)}${m.title}没办成${hurt.length ? `，${hurt.join('、')}受了伤` : ''}${lost}。`, tone: 'bad', about: team.map((p) => p.id), big: !!lost });
      emit({ k: 'banner', text: `${m.title}没办成${lost}`, tone: 'bad' });
    }
    for (const p of team) comeHome(w, p);
  }
  w.expeditions = keep;
  w.members = w.members.filter((id) => P(w, id)?.alive);
}

/** 界面用：某人在外面办什么、什么时候回 */
export function awayText(w: World, p: Person): string | null {
  if (!p.mission) return null;
  const e = w.expeditions.find((x) => x.team.includes(p.id));
  return e ? `外出${e.mission.title}，还有 ${daysLeft(w, e.back)} 日回山` : '外出办事';
}

/** 走到几成了（0–1） */
export function tripProgress(w: World, e: { from?: number; back: number; mission: Mission }) {
  const from = e.from ?? e.back - tripDays(e.mission);
  return Math.max(0, Math.min(1, (nowDay(w) - from) / Math.max(1, e.back - from)));
}
