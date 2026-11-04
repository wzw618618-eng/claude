// 极简的插件宿主：一切玩法都是插件（干活、口粮取暖、身心状态、人际、营建、天气、剧情、结局）。
// 每个插件可以挂在「白天结算」和「夜里结算」两个时刻，按注册顺序执行。
// 这和天工引擎「Harness 模式，一切皆插件」的思路一致，迁移时每个插件可以原样变成一个引擎插件。

import { makeRng, Rng } from './rng';
import { GameState, PendingEvent, Tone, Vars } from './types';

export interface Ctx {
  s: GameState;
  rng: Rng;
  /** 写进今天的报告和驿站日志 */
  out(text: string, tone?: Tone): void;
  /** 排队一个需要玩家抉择的事件 */
  queue(id: string, actors?: string[], vars?: Vars): void;
  /** 本次结算的临时数据，插件之间传递用 */
  tmp: Record<string, any>;
}

export interface Plugin {
  id: string;
  day?(ctx: Ctx): void;
  night?(ctx: Ctx): void;
}

export function makeCtx(s: GameState): Ctx {
  const rng = makeRng(s.rng);
  return {
    s,
    rng,
    tmp: {},
    out(text, tone = 'info') {
      const line = { day: s.day, text, tone };
      s.report.push(line);
      s.log.push(line);
    },
    queue(id, actors = [], vars = {}) {
      if (s.pending.some((p) => p.id === id && p.actors.join() === actors.join())) return;
      const ev: PendingEvent = { id, actors, vars };
      s.pending.push(ev);
    },
  };
}

export function commit(ctx: Ctx) {
  ctx.s.rng = ctx.rng.state();
  if (ctx.s.log.length > 400) ctx.s.log.splice(0, ctx.s.log.length - 400);
}

export class Engine {
  private plugins: Plugin[] = [];
  use(p: Plugin) {
    this.plugins.push(p);
    return this;
  }
  /** 白天结束：结算干活、吃饭、取暖、身心、营建，然后排队傍晚事件 */
  endDay(s: GameState) {
    s.report = [];
    const ctx = makeCtx(s);
    for (const p of this.plugins) p.day?.(ctx);
    commit(ctx);
  }
  /** 夜里结束：守夜、天气、人心变化，进入新的一天 */
  endNight(s: GameState) {
    s.report = [];
    const ctx = makeCtx(s);
    for (const p of this.plugins) p.night?.(ctx);
    commit(ctx);
  }
}
