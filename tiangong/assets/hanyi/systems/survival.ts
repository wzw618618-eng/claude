// 插件：口粮、取暖、身体与心情、死亡。

import { Ctx, Plugin } from '../core/engine';
import {
  act, addHealth, addMood, addStamina, addTrust, def, eats, has, heatNeed, nm, rel,
} from '../core/world';
import { cookMood, cookSave } from './work';

export const upkeepPlugin: Plugin = {
  id: 'upkeep',
  day(ctx) {
    const { s, rng, tmp } = ctx;
    const A = act(s);
    if (!A.length) return;
    // 口粮
    let need = A.reduce((n, c) => n + eats(c), 0);
    if (s.policy.ration === 'half') need = Math.ceil(need / 2);
    const save = tmp.cook ? cookSave(tmp.cook, A.length) : 0;
    need = Math.max(1, need - save);
    const eaten = Math.min(s.res.food, need);
    s.res.food -= eaten;
    const fed = eaten / need;
    tmp.fed = fed;
    ctx.out(
      `口粮：吃掉 ${eaten} 份${save ? `（掌勺省下 ${save} 份）` : ''}${fed < 1 ? '，不够分了！' : '。'}`,
      fed < 1 ? 'bad' : 'info',
    );
    for (const c of A) {
      const deficit = 1 - fed;
      if (deficit > 0) { addHealth(c, -Math.round(18 * deficit)); addMood(c, -Math.round(10 * deficit)); }
      if (s.policy.ration === 'half') { addHealth(c, -2); addMood(c, -4); }
      c.hungerDays = deficit > 0.3 ? c.hungerDays + 1 : 0;
      if (c.hungerDays >= 2) addHealth(c, -6);
      if (deficit > 0.3) addTrust(c, -2);
    }
    // 取暖
    const hn = heatNeed(s);
    const burned = Math.min(s.res.wood, hn);
    s.res.wood -= burned;
    let cold = 1 - burned / hn;
    if (s.policy.heat === 'save') cold += 0.2;
    tmp.cold = cold;
    ctx.out(`取暖：烧掉 ${burned} 捆柴${burned < hn ? '，火快灭了，屋里冷得像冰窖！' : '。'}`, burned < hn ? 'bad' : 'info');
    for (const c of A) {
      const m = has(c, 'coldproof') ? 0.5 : has(c, 'coldfear') ? 1.5 : 1;
      if (cold > 0) { addHealth(c, -Math.round(16 * cold * m)); addMood(c, -Math.round(8 * cold)); }
      const sickP = (0.012 + 0.2 * Math.max(0, cold)) * (has(c, 'coldproof') ? 0.5 : 1);
      if (c.sick === 0 && rng.chance(sickP)) {
        c.sick = rng.int(3, 5);
        ctx.out(`${nm(c.id)}发起了高烧。`, 'bad');
      }
    }
  },
};

export const bodyPlugin: Plugin = {
  id: 'body',
  day(ctx) {
    const { s, rng, tmp } = ctx;
    const A = act(s);
    const cookBonus = tmp.cook ? cookMood(tmp.cook) : 0;
    const comfort: [string, number][] = tmp.comfort ?? [];
    const leaderOn = A.filter((c) => has(c, 'leader') && c.mood >= 50 && c.health >= 50).map((c) => c.id);
    const childOn = A.filter((c) => has(c, 'child') && c.mood >= 60).map((c) => c.id);
    const hearth = s.built.includes('hearth');

    for (const c of A) {
      const cared = tmp.cared?.has(c.id);
      if (c.injured > 0) {
        c.injured--;
        if (!cared && tmp.eff?.[c.id] !== 'rest') addHealth(c, -3);
        if (c.injured === 0) ctx.out(`${nm(c.id)}的伤好了。`, 'good');
      }
      if (c.sick > 0) {
        addHealth(c, cared ? -3 : -8);
        c.sick--;
        if (c.sick === 0) ctx.out(`${nm(c.id)}退烧了。`, 'good');
        for (const o of A) {
          if (o !== c && o.sick === 0 && rng.chance(0.04 * (s.built.includes('clinic') ? 0.5 : 1))) {
            o.sick = 3;
            ctx.out(`${nm(o.id)}被传染了。`, 'bad');
          }
        }
      }
      if ((tmp.fed ?? 1) >= 1 && (tmp.cold ?? 0) <= 0.01 && !c.injured && !c.sick) addHealth(c, 3);

      // 心情：困得越久越压抑；好事带来的提振在心情已经不错时会打折扣
      let down = s.day <= 7 ? 2 : 3;
      if (s.weather.kind === 'blizzard') down += 2;
      if (has(c, 'optimist')) down = Math.ceil(down / 2);
      if (has(c, 'pessimist')) down *= 2;
      let up = cookBonus;
      for (const [id, v] of comfort) up += id === c.id ? 2 : Math.round(v);
      if (leaderOn.some((id) => id !== c.id)) up += s.flags.suDeputy ? 3 : 2;
      if (childOn.some((id) => id !== c.id)) up += 1;
      if (hearth) up += 2;
      let friends = 0, foes = 0;
      for (const o of A) {
        if (o === c) continue;
        const r = rel(s, c.id, o.id);
        if (r >= 50) friends++;
        if (r <= -30) foes++;
      }
      up += Math.min(3, friends);
      down += Math.round(foes * 1.5);
      if (c.mood >= 70) up *= 0.4;
      else if (c.mood >= 55) up *= 0.7;
      addMood(c, Math.round(up) - down);
      c.lowMoodDays = c.mood < 10 ? c.lowMoodDays + 1 : 0;
      if (c.restDays > 0) c.restDays--;
    }
    checkDeaths(ctx);
  },
  night(ctx) {
    const { s, tmp } = ctx;
    for (const c of act(s)) {
      const warm = s.res.wood > 0;
      addStamina(c, c.task === 'guard' && !tmp.noGuard ? 5 : warm ? 18 : 10);
      c.talks = 0;
      c.trustTonight = 0;
      c.moodTonight = 0;
    }
    s.chat = {};
    s.ambient = [];
  },
};

export function checkDeaths(ctx: Ctx) {
  const { s } = ctx;
  for (const c of act(s)) {
    if (c.health > 0) continue;
    c.status = 'dead';
    c.endDay = s.day;
    ctx.out(`${def(c.id).name}没能挺过去。`, 'bad');
    ctx.queue('death', [c.id]);
    for (const o of act(s)) addMood(o, -Math.round(12 + Math.max(0, rel(s, o.id, c.id)) / 4));
  }
  if (s.phase !== 'ending' && act(s).length === 0) {
    s.phase = 'ending';
    s.ending = { kind: 'wiped', day: s.day };
  }
}
