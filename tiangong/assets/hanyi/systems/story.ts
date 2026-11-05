// 插件：剧情调度。傍晚和清晨各挑一个合适的事件；夜里结算狼群、偷窃和出走。

import { commit, Ctx, makeCtx, Plugin } from '../core/engine';
import { GameState } from '../core/types';
import { act, addHealth, ch, has, nm } from '../core/world';
import { eventMemory, remember } from '../ai/memory';
import { EVENTS, SCHEDULED } from '../data/events';
import { checkDeaths } from './survival';
import { blocked, guardPower } from './work';

function schedule(ctx: Ctx, slot: 'evening' | 'morning') {
  const { s, rng } = ctx;
  if (s.phase === 'ending') return;
  if (s.pending.length >= 2) return;
  const cands = SCHEDULED.filter((e) => {
    if (e.slot !== slot) return false;
    const last = s.fired[e.id];
    if (e.once && last) return false;
    if (e.cooldown && last && s.day - last < e.cooldown) return false;
    return true;
  });
  rng.shuffle(cands);
  cands.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const e of cands) {
    const b = e.bind?.(s, rng);
    if (!b) continue;
    if (e.chance !== undefined && !rng.chance(e.chance)) continue;
    ctx.queue(e.id, b.actors, b.vars ?? {});
    s.fired[e.id] = s.day;
    return;
  }
}

export const storyPlugin: Plugin = {
  id: 'story',
  day(ctx) {
    schedule(ctx, 'evening');
  },
  night(ctx) {
    const { s, rng } = ctx;
    const A = act(s);
    if (!A.length) return;
    const guards = A.filter((c) => c.task === 'guard' && !blocked(s, c, 'guard'));
    ctx.tmp.noGuard = guards.length === 0;
    const power = guards.reduce((t, c) => t + guardPower(c), 0);
    const tower = s.built.includes('tower');

    // 狼群
    const wolfP = s.day >= 4 ? (0.1 + (s.weather.kind === 'blizzard' ? 0.08 : 0)) * (s.flags.fence ? 0.5 : 1) : 0;
    if (rng.chance(wolfP)) {
      let text: string;
      if (power >= (tower ? 1.5 : 2)) {
        text = `半夜，狼群摸到了驿站外面。${guards.map((g) => nm(g.id)).join('、')}点起火把又喊又砸，把它们赶跑了。`;
        const g = rng.pick(guards);
        if (rng.chance(0.15)) { g.injured = 2; addHealth(g, -12); text += `${nm(g.id)}被狼抓伤了胳膊。`; }
        ctx.out('夜里：狼群来过，被守夜的人赶跑了。', 'info');
      } else {
        let lost = rng.int(3, 6);
        if (tower) lost = Math.ceil(lost / 2);
        if (s.flags.fence) lost = Math.ceil(lost / 2);
        if (guards.length) lost = Math.max(1, lost - 2);
        lost = Math.min(lost, s.res.food);
        s.res.food -= lost;
        text = `半夜，狼群扒开了柴房的门，叼走了 ${lost} 份食物。`;
        const victims = guards.length ? guards : A;
        if (rng.chance(guards.length ? 0.4 : 0.25)) {
          const v = rng.pick(victims);
          v.injured = 3; addHealth(v, -18);
          text += `${nm(v.id)}去追，被咬伤了腿。`;
        }
        if (!guards.length) text += '\n\n要是有人守夜，就不会这样了。';
        ctx.out(`夜里：狼群叼走了 ${lost} 份食物。`, 'bad');
      }
      ctx.queue('wolves', [], { text });
    }

    // 偷吃
    if (!s.flags.foodLocked && s.res.food > 0) {
      const thieves = A.filter((c) => c.task !== 'guard' && c.mood < 35 && c.trust < 40 && (c.hungerDays > 0 || s.policy.ration === 'half') && !has(c, 'child'));
      if (thieves.length && rng.chance(0.3)) {
        const x = rng.pick(thieves);
        const g = guards.find((c) => c !== x);
        if (g) {
          ctx.queue('theft', [x.id], { caught: true, guard: g.id });
        } else {
          const n = Math.min(s.res.food, rng.int(2, 3));
          s.res.food -= n;
          ctx.out(`夜里：粮袋里少了 ${n} 份食物。`, 'bad');
          ctx.queue('theft', [x.id], { caught: false, n });
        }
      }
    }

    // 出走
    for (const x of A) {
      if (x.lowMoodDays < 2 || has(x, 'child') || !rng.chance(0.6)) continue;
      const g = guards.find((c) => c !== x);
      if (g) {
        ctx.queue('leave_try', [x.id], { caught: true, guard: g.id });
      } else {
        x.status = 'left';
        x.endDay = s.day;
        x.endNote = 'night';
        s.res.food = Math.max(0, s.res.food - 2);
        ctx.out(`夜里：${nm(x.id)}走了。`, 'bad');
        ctx.queue('leave_try', [x.id], { caught: false });
      }
      break;
    }
    checkDeaths(ctx);
  },
};

export const morningPlugin: Plugin = {
  id: 'morning',
  night(ctx) {
    schedule(ctx, 'morning');
  },
};

/** 当前要处理的事件（标题、正文、选项） */
export function currentEvent(s: GameState) {
  const ev = s.pending[0];
  if (!ev) return null;
  const d = EVENTS[ev.id];
  if (!d) {
    s.pending.shift();
    return currentEvent(s);
  }
  return { ev, title: d.title(s, ev), text: d.text(s, ev), choices: d.choices(s, ev) };
}

/** 玩家做出选择，返回结果文字 */
export function resolveChoice(s: GameState, idx: number): { title: string; text: string } | null {
  const cur = currentEvent(s);
  if (!cur) return null;
  const choice = cur.choices[idx];
  if (!choice || choice.disabled) return null;
  s.pending.shift();
  const ctx = makeCtx(s);
  // 事件里的人会记住你这次替他们做了什么主
  const actors = cur.ev.actors.filter((id) => ch(s, id)?.status === 'active');
  const before = Object.fromEntries(actors.map((id) => [id, ch(s, id)!.trust]));
  const text = choice.run(ctx, cur.ev);
  for (const id of actors) {
    const c = ch(s, id);
    if (!c || c.status === 'dead') continue;
    const d = c.trust - before[id];
    remember(s, id, { kind: 'event', title: cur.title, text: eventMemory(cur.title, choice.label), tone: d > 0 ? 'good' : d < 0 ? 'bad' : '' });
  }
  s.log.push({ day: s.day, text: `【${cur.title}】${choice.label}——${text.replace(/\n+/g, ' ')}`, tone: 'story' });
  checkDeaths(ctx);
  commit(ctx);
  return { title: cur.title, text };
}

/** 有人在事件里离开或死去后，清理不再成立的事件 */
export function prunePending(s: GameState) {
  const always = ['death', 'leave_try', 'wolves', 'blizzard', 'radio_done', 'phone_done', 'stranger'];
  s.pending = s.pending.filter((p) => {
    if (always.includes(p.id) || p.id.startsWith('find_')) return true;
    return p.actors.every((id) => act(s).some((c) => c.id === id));
  });
}
