// 插件：人际关系、营建、天气、结局。

import { Plugin } from '../core/engine';
import { GameState } from '../core/types';
import {
  act, addMood, addRel, baseTemp, ch, clamp, def, isAct, nm, rel, relKey,
} from '../core/world';
import { PAIR_SCENES } from '../data/characters';
import { BUILDINGS, LAST_DAY } from '../data/rules';
import { coldOf } from '../data/perks';
import { Ctx } from '../core/engine';

export const socialPlugin: Plugin = {
  id: 'social',
  day(ctx) {
    const { s, tmp } = ctx;
    const A = act(s);
    for (let i = 0; i < A.length; i++) {
      for (let j = i + 1; j < A.length; j++) {
        const a = A[i], b = A[j];
        const ta = tmp.eff?.[a.id], tb = tmp.eff?.[b.id];
        if (ta && ta === tb && ta !== 'rest') addRel(s, a.id, b.id, 2);
      }
    }
    todayOutcome(ctx);
  },
};

/** 今日情况里需要看你怎么派活的那几件：吵架的两个人、要发烧的人 */
function todayOutcome(ctx: Ctx) {
  const { s, tmp } = ctx;
  const t = s.today;
  if (!t) return;
  const eff = (id: string) => tmp.eff?.[id];
  if (t.id === 'feud') {
    const [a, b] = t.actors;
    if (!isAct(s, a) || !isAct(s, b)) return;
    if (eff(a) === eff(b) && eff(a) !== 'rest') {
      addRel(s, a, b, -8);
      for (const id of [a, b]) addMood(ch(s, id)!, -5);
      ctx.out(`${nm(a)}和${nm(b)}干着活又吵翻了，差点动手。`, 'bad');
    } else {
      addRel(s, a, b, 3);
      ctx.out(`${nm(a)}和${nm(b)}分开干活，到傍晚气也消了。`, 'good');
    }
  } else if (t.id === 'fever') {
    const c = ch(s, t.actors[0]);
    if (!c || c.status !== 'active' || c.sick) return;
    const cared = act(s).some((o) => eff(o.id) === 'care');
    if (eff(c.id) === 'rest' || cared) ctx.out(`${nm(c.id)}${cared ? '喝了药' : '捂着被子睡了一天'}，烧没起来。`, 'good');
    else { c.sick = 3; ctx.out(`${nm(c.id)}硬撑着干了一天活，晚上烧起来了。`, 'bad'); }
  }
}

const GENERIC_WARM = [
  '{a}和{b}靠着火堆聊到很晚。',
  '{a}把自己的毯子分了一半给{b}。',
  '{a}给{b}烤了半个土豆。',
  '{b}睡着了，{a}往{b}身边的火里添了根柴。',
];
const GENERIC_COLD = [
  '{a}和{b}为了谁该添柴拌了几句嘴。',
  '{a}故意坐得离{b}远远的。',
  '{b}说话的时候，{a}翻了个白眼。',
];
const GENERIC_PLAIN = [
  '{a}给{b}递了一碗热水。',
  '{a}和{b}一起修补漏风的墙缝，谁也没说话。',
  '{a}问{b}老家是哪儿的，聊了几句。',
  '{a}在火边打盹，{b}给{a}披了件衣服。',
];

/** 入夜时生成两三段篝火片段，同时微调关系 */
export function campfireScenes(ctx: Ctx) {
  const { s, rng } = ctx;
  const A = act(s);
  s.ambient = [];
  if (A.length < 2) {
    if (A.length === 1) s.ambient.push(`${nm(A[0].id)}一个人守着火，屋里静得能听见雪落的声音。`);
    return;
  }
  const pairs: [string, string][] = [];
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) pairs.push([A[i].id, A[j].id]);
  rng.shuffle(pairs);
  const n = Math.min(pairs.length, A.length >= 5 ? 2 : 1);
  for (const [a, b] of pairs.slice(0, n)) {
    const r = rel(s, a, b);
    const special = PAIR_SCENES[relKey(a, b)];
    let line: string;
    if (r >= 20) {
      line = special && rng.chance(0.7) ? rng.pick(special.warm) : rng.pick(GENERIC_WARM);
      addRel(s, a, b, 3);
    } else if (r <= -15) {
      line = special && rng.chance(0.7) ? rng.pick(special.cold) : rng.pick(GENERIC_COLD);
      addRel(s, a, b, -2);
    } else {
      line = special && rng.chance(0.5) ? rng.pick(special.warm) : rng.pick(GENERIC_PLAIN);
      addRel(s, a, b, 2);
    }
    const [x, y] = rng.chance(0.5) ? [a, b] : [b, a];
    s.ambient.push(line.replace(/\{a\}/g, nm(x)).replace(/\{b\}/g, nm(y)));
  }
}

export const buildPlugin: Plugin = {
  id: 'build',
  day(ctx) {
    const { s, tmp } = ctx;
    if (!s.project || !tmp.buildPts) return;
    const b = BUILDINGS[s.project.id];
    s.project.progress += tmp.buildPts;
    if (s.project.progress + 1e-6 >= b.pts) {
      s.built.push(s.project.id);
      ctx.out(`营建：「${b.name}」完工了！`, 'good');
      const id = s.project.id;
      s.project = null;
      if (id === 'radio') {
        setRescue(s, s.day + 3, 'radio');
        ctx.queue('radio_done');
      } else if (id === 'phone') {
        setRescue(s, s.day + 3, 'phone');
        ctx.queue('phone_done');
      } else {
        for (const c of act(s)) addMood(c, 3);
      }
    } else {
      ctx.out(`营建：「${b.name}」进度 ${Math.floor(s.project.progress)}/${b.pts}。`);
    }
  },
};

/** 救援最早第 12 天才能上山：路要抢通，暴风雪里直升机也飞不了 */
export const EARLIEST_RESCUE = 12;

export function setRescue(s: GameState, day: number, by: string) {
  day = Math.max(day, EARLIEST_RESCUE);
  if (day < s.rescueDay) {
    s.rescueDay = day;
    s.rescueBy = by;
  }
}

export function startProject(s: GameState, id: string): string | null {
  const b = BUILDINGS[id];
  if (s.built.includes(id)) return '已经建好了';
  if (b.needFlag && !s.flags[b.needFlag]) return '还没解锁';
  if (s.project) return '一次只能干一个工程';
  if ((b.cost.mat ?? 0) > s.res.mat) return '物资不够';
  if ((b.cost.wood ?? 0) > s.res.wood) return '柴火不够';
  s.res.mat -= b.cost.mat ?? 0;
  s.res.wood -= b.cost.wood ?? 0;
  s.project = { id, progress: 0 };
  return null;
}

export function cancelProject(s: GameState) {
  if (!s.project) return;
  const b = BUILDINGS[s.project.id];
  // 退回一半材料
  s.res.mat += Math.floor((b.cost.mat ?? 0) / 2);
  s.res.wood += Math.floor((b.cost.wood ?? 0) / 2);
  s.project = null;
}

export const weatherPlugin: Plugin = {
  id: 'weather',
  night(ctx) {
    const { s, rng } = ctx;
    s.day += 1;
    const w = s.weather;
    const deep = s.day >= 5 && s.day <= 16;
    if (s.flags.stormNext) {
      delete s.flags.stormNext;
      s.flags.firstStorm = true;
      w.kind = 'blizzard'; w.left = 0;
    } else if (w.left > 0) {
      w.left--;
    } else if (!s.flags.firstStorm && s.day >= 7) {
      s.flags.firstStorm = true;
      w.kind = 'blizzard'; w.left = 1;
    } else if (w.kind === 'clear') {
      const r = rng.next();
      if (deep && r < 0.08) { w.kind = 'blizzard'; w.left = rng.int(0, 1); }
      else if (r < 0.38) { w.kind = 'snow'; w.left = rng.int(0, 2); }
    } else if (w.kind === 'snow') {
      const r = rng.next();
      if (r < (deep ? 0.25 : 0.08)) { w.kind = 'blizzard'; w.left = rng.int(0, 1); }
      else if (r < 0.6) { w.kind = 'clear'; w.left = rng.int(0, 2); }
    } else {
      w.kind = rng.chance(0.6) ? 'snow' : 'clear';
      w.left = rng.int(0, 1);
    }
    if (w.kind === 'blizzard') {
      if (s.flags.lastStorm !== s.day - 1) ctx.queue('blizzard');
      s.flags.lastStorm = s.day;
    }
    const off = w.kind === 'blizzard' ? -6 : w.kind === 'snow' ? -2 : 0;
    s.temp = clamp(baseTemp(s.day) + off + rng.int(-1, 1) - coldOf(s.winter), -40, 0);
  },
};

export const endingPlugin: Plugin = {
  id: 'ending',
  night(ctx) {
    const { s } = ctx;
    if (act(s).length === 0) {
      s.phase = 'ending';
      s.ending = { kind: 'wiped', day: s.day };
      return;
    }
    if (s.day >= s.rescueDay || s.day > LAST_DAY) {
      s.phase = 'ending';
      s.ending = { kind: 'rescued', day: s.day };
      s.pending = [];
    }
  },
};

/** 结局里每个人的去向 */
export function fate(s: GameState, id: string): { kind: 'good' | 'ok' | 'dead' | 'left'; text: string } {
  const c = s.chars.find((x) => x.id === id)!;
  const d = def(id);
  if (c.status === 'dead') return { kind: 'dead', text: d.epilogue.dead };
  if (c.status === 'left') {
    if (s.flags[`back_${id}`]) return { kind: 'good', text: d.epilogue.good };
    if (s.flags[`lost_${id}`]) return { kind: 'dead', text: lostText(id) };
    return { kind: 'left', text: d.epilogue.left };
  }
  const arc = !!s.flags[d.arcFlag];
  const okMood = c.mood >= 45;
  return arc || (okMood && c.trust >= 70) ? { kind: 'good', text: d.epilogue.good } : { kind: 'ok', text: d.epilogue.ok };
}

function lostText(id: string) {
  if (id === 'lin') return '开春后，搜救队在半山腰的弯道上找到了林晚。她怀里揣着一张女儿的照片，离镇子只剩十一公里。';
  if (id === 'gesang') return '格桑没能回来。她把最后的干粮留给了同伴。';
  return `${nm(id)}没能走出这座山。`;
}

export function isPresentAtEnd(s: GameState, id: string) {
  return isAct(s, id) || !!s.flags[`back_${id}`];
}
