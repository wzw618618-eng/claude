// 插件：白天干活。每个人按岗位产出，带技能成长、受伤风险、拒绝危险任务。

import { Ctx, Plugin } from '../core/engine';
import { CharState, GameState, TaskId } from '../core/types';
import {
  act, addHealth, addMood, addSkill, addStamina, addTrust, clamp, has, lvl, nm, rel, join,
} from '../core/world';
import { SKILLS, TASKS } from '../data/rules';
import { todayRisk, todayYield } from '../data/situations';

const OUTDOOR: TaskId[] = ['wood', 'hunt', 'scavenge', 'explore'];
const DANGER: TaskId[] = ['scavenge', 'explore', 'guard'];

/** 这个人今天能不能干这个活；不能的话返回原因 */
export function blocked(s: GameState, c: CharState, t: TaskId): string | null {
  if (t === 'rest') return null;
  if (c.restDays > 0) return '得歇着';
  if (c.sick > 0) return '病着';
  if (c.injured > 0 && !['cook', 'comfort', 'care'].includes(t)) return '有伤';
  if (has(c, 'child') && ['explore', 'guard', 'scavenge', 'hunt'].includes(t)) return '孩子';
  if (t === 'build' && !s.project) return '没工程';
  return null;
}

export function efficiency(s: GameState, c: CharState, t: TaskId) {
  let e = 1;
  if (c.stamina < 30) e *= 0.7;
  if (c.health < 40) e *= 0.8;
  if (c.mood < 25) e *= 0.8;
  else if (c.mood >= 75) e *= 1.1;
  if (has(c, 'diligent')) e *= 1.15;
  if (has(c, 'lazy')) e *= 0.85;
  if (has(c, 'child') && ['wood', 'build'].includes(t)) e *= 0.5;
  if (OUTDOOR.includes(t)) e *= s.weather.kind === 'blizzard' ? 0.5 : s.weather.kind === 'snow' ? 0.85 : 1;
  return e * todayYield(s, t);
}

export function injuryRisk(s: GameState, c: CharState, t: TaskId) {
  const base: Partial<Record<TaskId, number>> = { wood: 0.02, hunt: 0.03, scavenge: 0.06, explore: 0.1 };
  let p = base[t] ?? 0;
  if (!p) return 0;
  if (s.weather.kind === 'blizzard') p += 0.08;
  if (c.stamina < 30) p *= 1.5;
  if (c.health < 40) p *= 1.3;
  if (has(c, 'reckless')) p *= 1.6;
  if (has(c, 'timid')) p *= 0.5;
  if (t === 'explore' && s.built.includes('tower')) p *= 0.6;
  return clamp(p * todayRisk(s, t), 0, 0.6);
}

/** 干这个活对心情的直接影响（特质决定） */
export function taskMood(c: CharState, t: TaskId, solo: boolean) {
  let m = 0;
  if (has(c, 'timid') && DANGER.includes(t)) m -= 6;
  if (has(c, 'reckless') && ['explore', 'scavenge'].includes(t)) m += 3;
  if (has(c, 'diligent') && t === 'rest' && !c.injured && !c.sick && !c.restDays) m -= 4;
  if (has(c, 'lazy') && t === 'rest') m += 6;
  if (has(c, 'loner') && solo && t !== 'rest') m += 3;
  return m;
}

export const woodOut = (s: GameState, c: CharState) => (2 + c.skills.str * 0.8) * efficiency(s, c, 'wood');
/** 附近的猎物会越打越少 */
export const gameLeft = (s: GameState) => Math.max(0.55, 1 - (s.day - 1) * 0.027);
export const huntOut = (s: GameState, c: CharState) => (0.6 + c.skills.wild * 0.7) * efficiency(s, c, 'hunt') * gameLeft(s);
export const scavOut = (s: GameState, c: CharState) =>
  (1 + c.skills.wild * 0.5) * efficiency(s, c, 'scavenge') * (has(c, 'reckless') ? 1.3 : 1);
export const buildOut = (s: GameState, c: CharState) => (2 + c.skills.craft) * efficiency(s, c, 'build');
export const cookScore = (s: GameState, c: CharState) => c.skills.craft * efficiency(s, c, 'cook') * (has(c, 'gourmet') ? 1.5 : 1);
export const cookMood = (score: number) => Math.round(1 + score * 0.5);
export const cookSave = (score: number, people: number) => Math.min(Math.floor(score / 2.5), Math.ceil(people / 3));
export const careScore = (s: GameState, c: CharState) =>
  (1 + c.skills.med) * efficiency(s, c, 'care') * (has(c, 'kind') ? 1.3 : 1) * (s.built.includes('clinic') ? 1.5 : 1);
export const comfortOut = (s: GameState, c: CharState) =>
  (1 + c.skills.talk * 0.8) * efficiency(s, c, 'comfort') * (has(c, 'mute') ? 0.3 : 1);
export const guardPower = (c: CharState) => 1 + c.skills.str * 0.3 - (has(c, 'timid') ? 0.4 : 0);

/** 派活面板上显示的预估 */
export function preview(s: GameState, c: CharState, t: TaskId): string {
  const r = (n: number) => Math.max(0, Math.round(n));
  switch (t) {
    case 'wood': return `约 +${r(woodOut(s, c))} 柴火`;
    case 'hunt': return `约 +${r(huntOut(s, c))} 食物，看运气`;
    case 'scavenge': return `约 +${r(scavOut(s, c))} 物资，偶有药品`;
    case 'explore': return '可能遇见人，也可能空手而归';
    case 'build': return s.project ? `+${r(buildOut(s, c))} 进度` : '先去「营建」选一个工程';
    case 'cook': {
      const sc = cookScore(s, c);
      return `大家心情 +${cookMood(sc)}，省 ${cookSave(sc, act(s).length)} 份口粮`;
    }
    case 'care': return `每个伤病员 +${r(4 + careScore(s, c) * 2)} 健康`;
    case 'comfort': return `其他人心情 +${r(comfortOut(s, c))}`;
    case 'guard': return `夜里防狼防偷，守备 ${guardPower(c).toFixed(1)}`;
    case 'rest': return '体力 +35，健康 +6';
  }
}

function explore(ctx: Ctx, c: CharState) {
  const { s, rng } = ctx;
  const f = s.flags;
  const tower = s.built.includes('tower');
  const table: [string, number][] = [];
  if (!f.busFound) table.push(['bus', s.day <= 6 ? 30 : 18]);
  if (!f.manFound && s.day >= 2) table.push(['man', 24]);
  if (!f.gesangFound && s.day >= 3) table.push(['gesang', 20]);
  if (!f.wuFound && s.day >= 5) table.push(['wu', 20]);
  table.push(['deer', 14], ['car', 14], ['hut', 9], ['nothing', 16]);
  table.push(['lost', (s.weather.kind === 'blizzard' ? 22 : 7) * (tower ? 0.5 : 1)]);
  const r = rng.weighted(table)!;
  const n = nm(c.id);
  switch (r) {
    case 'bus': f.busFound = true; ctx.out(`探路：${n}找到了那辆抛锚的客车。`, 'story'); ctx.queue('find_bus', [c.id]); break;
    case 'man': f.manFound = true; ctx.out(`探路：${n}在断桥边发现了什么。`, 'story'); ctx.queue('find_man', [c.id]); break;
    case 'gesang': f.gesangFound = true; ctx.out(`探路：${n}在雪坳里看见了一抹红色。`, 'story'); ctx.queue('find_gesang', [c.id]); break;
    case 'wu': f.wuFound = true; ctx.out(`探路：${n}摸到了山腰的道班。`, 'story'); ctx.queue('find_wu', [c.id]); break;
    case 'deer': { const k = rng.int(5, 8); s.res.food += k; ctx.out(`探路：${n}发现了一头冻僵的鹿，扛回 ${k} 份食物。`, 'good'); break; }
    case 'car': {
      const k = rng.int(3, 5); s.res.mat += k;
      const med = rng.chance(0.4) ? 1 : 0; s.res.med += med;
      ctx.out(`探路：${n}翻了一辆被遗弃的货车，带回 ${k} 件物资${med ? '、1 盒药品' : ''}。`, 'good');
      break;
    }
    case 'hut': s.res.food += 3; s.res.med += 1; ctx.out(`探路：${n}找到一间猎人小屋，带回 3 份食物和 1 盒药。`, 'good'); break;
    case 'nothing': addStamina(c, -10); ctx.out(`探路：${n}走了一整天，什么也没找到。`); break;
    case 'lost':
      addStamina(c, -15); addHealth(c, -18); c.injured = Math.max(c.injured, rng.int(2, 4));
      ctx.out(`探路：${n}在风雪里迷了路，摔伤后才摸回来。`, 'bad');
      break;
  }
}

export const workPlugin: Plugin = {
  id: 'work',
  day(ctx) {
    const { s, rng, tmp } = ctx;
    const A = act(s);
    tmp.eff = {} as Record<string, TaskId>;
    tmp.cared = new Set<string>();
    tmp.buildPts = 0;
    tmp.cook = 0;
    tmp.comfort = [] as [string, number][];

    for (const c of A) {
      let t = c.task;
      if (blocked(s, c, t)) t = 'rest';
      if (DANGER.includes(t) && c.trust < 25 && rng.chance(0.3)) {
        ctx.out(`${nm(c.id)}不肯去${TASKS[t].name}，窝在火边一整天没动。`, 'bad');
        addTrust(c, -1);
        t = 'rest';
      }
      tmp.eff[c.id] = t;
    }
    const byTask = (t: TaskId) => A.filter((c) => tmp.eff[c.id] === t);
    const names = (cs: CharState[]) => cs.map((c) => nm(c.id)).join('、');

    // 砍柴
    const wc = byTask('wood');
    if (wc.length) {
      const k = wc.reduce((n, c) => n + Math.round(woodOut(s, c) * rng.range(0.85, 1.15)), 0);
      s.res.wood += k;
      ctx.out(`砍柴：${names(wc)}带回 ${k} 捆柴火。`);
    }
    // 狩猎
    const hc = byTask('hunt');
    if (hc.length) {
      let k = 0;
      for (const c of hc) {
        let g = Math.round(huntOut(s, c) * rng.range(0.3, 1.7));
        if (g > 0 && s.built.includes('smoke')) g += 1;
        k += g;
      }
      s.res.food += k;
      ctx.out(k ? `狩猎：${names(hc)}带回 ${k} 份食物。` : `狩猎：${names(hc)}守了一天，什么也没逮着。`, k ? 'info' : 'bad');
    }
    // 搜寻
    const sc = byTask('scavenge');
    if (sc.length) {
      let mat = 0, med = 0, food = 0;
      for (const c of sc) {
        mat += Math.round(scavOut(s, c) * rng.range(0.6, 1.4));
        if (rng.chance(0.18 + c.skills.wild * 0.04)) med += 1;
        if (rng.chance(0.25)) food += rng.int(1, 2);
      }
      s.res.mat += mat; s.res.med += med; s.res.food += food;
      const parts = [`${mat} 件物资`];
      if (med) parts.push(`${med} 盒药品`);
      if (food) parts.push(`${food} 份食物`);
      ctx.out(`搜寻：${names(sc)}带回 ${parts.join('、')}。`);
    }
    // 探路
    for (const c of byTask('explore')) explore(ctx, c);
    // 营建
    for (const c of byTask('build')) tmp.buildPts += buildOut(s, c);
    // 掌勺：取最好的那位
    for (const c of byTask('cook')) tmp.cook = Math.max(tmp.cook, cookScore(s, c));
    // 照料
    const carers = byTask('care').map((c) => careScore(s, c)).sort((a, b) => b - a);
    if (carers.length) {
      const score = carers[0] + carers.slice(1).reduce((t, x) => t + x * 0.5, 0);
      const patients = A.filter((c) => c.injured > 0 || c.sick > 0 || c.health < 70);
      for (const p of patients) {
        tmp.cared.add(p.id);
        addHealth(p, Math.round(4 + score * 2));
        if (p.sick > 0) {
          if (s.res.med > 0) {
            s.res.med -= 1; p.sick = 0;
            ctx.out(`照料：用掉 1 盒药，${nm(p.id)}的病好了。`, 'good');
          } else if (rng.chance(0.15 + score * 0.04)) {
            p.sick = 0;
            ctx.out(`照料：没有药，但${nm(p.id)}还是退烧了。`, 'good');
          }
        }
      }
      if (patients.length) ctx.out(`照料：${names(byTask('care'))}照看了${names(patients)}。`);
    }
    // 安抚
    for (const c of byTask('comfort')) tmp.comfort.push([c.id, comfortOut(s, c)]);

    // 体力、技能、受伤、岗位心情
    const counts: Record<string, number> = {};
    for (const c of A) counts[tmp.eff[c.id]] = (counts[tmp.eff[c.id]] ?? 0) + 1;
    for (const c of A) {
      const t: TaskId = tmp.eff[c.id];
      const def = TASKS[t];
      addStamina(c, -def.cost);
      if (t === 'rest') { addHealth(c, 6); addMood(c, 4); }
      addMood(c, taskMood(c, t, counts[t] === 1));
      if (def.skill && t !== 'rest') {
        const mentor = A.some((o) => o !== c && tmp.eff[o.id] === t && o.skills[def.skill!] >= c.skills[def.skill!] + 2 && rel(s, o.id, c.id) > 0);
        if (addSkill(c, def.skill, mentor ? 0.15 : 0.1)) {
          ctx.out(`${nm(c.id)}的${SKILLS[def.skill]}长进了（${lvl(c, def.skill)} 级）。`, 'good');
        }
      }
      const risk = injuryRisk(s, c, t);
      if (risk && rng.chance(risk) && c.injured === 0) {
        c.injured = rng.int(2, 4);
        addHealth(c, -15);
        ctx.out(`${nm(c.id)}在${def.name}时受了伤。`, 'bad');
      }
    }
  },
};

/** 把新人加入营地的统一入口（事件里用） */
export function recruit(s: GameState, id: string, opts: Partial<CharState> = {}) {
  return join(s, id, opts);
}
