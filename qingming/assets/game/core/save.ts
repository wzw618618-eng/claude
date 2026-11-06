// 读旧存档：按修订号补上新加的字段，顺手修掉旧版本留下的坏数据。

import type { World } from './types';
import { ME, SAVE_REV, sweepDead } from './world';
import { strikeReady } from '../mind/goals';

export function upgrade(w: World): World {
  // 第 1 阶段的存档没有谈话记录；第 2 阶段的没有旁听
  w.chat ??= {};
  w.turn.talk ??= {};
  w.offer ??= null;
  w.heard ??= [];
  if ((w.rev ?? 1) < 2) {
    w.fame ??= 0;
    w.root ??= w.me.talent >= 1.45 ? 'heaven' : w.me.talent >= 1.1 ? 'dual' : 'mixed';
    w.origin ??= 'wild';
    w.flags.lifeStock ??= 1;
    // 旧版本里死了的人还挂着道侣、师父，宝物留在死人身上
    sweepDead(w);
    // 旧版本里盟友会年年约你去空洞府
    for (const n of Object.values(w.people)) {
      const g = n.mind.goal;
      const striking = g && ((g.kind === 'revenge' && g.step === 3) || (g.kind === 'treasure' && g.step === 2));
      if (g?.ally === ME && striking && !strikeReady(w, n)) g.ally = undefined;
    }
    w.rev = 2;
  }
  w.rev = Math.max(w.rev ?? 1, SAVE_REV);
  return w;
}
