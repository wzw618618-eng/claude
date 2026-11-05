// AI 定年度打算：年初，在主角身边的几个人由 AI 来想今年做什么。
// - 选项全部来自规则：平常能做的事，加上为目标奔走的几种合法做法（比如争宗主时散布丑闻、静等、还是动手）；
// - AI 只能从这些选项里挑一件，再用自己的口吻说一句理由；
// - 不合规就退回规则定的打算。不在主角身边的人照旧只走规则，不花 AI 额度。

import type { Npc, Plan, SectId, World } from '../core/types';
import { aff, being, ME, nm, npcs, placeName, power } from '../core/world';
import { asJson } from '../../souls/envelope';
import { bestPlace, GOALS, goalWant, targetName } from '../mind/goals';
import { canBreak } from '../systems/body';
import { follow, needOptions } from '../systems/year';
import { goalBlock, memoryBlock, personaBlock, secretBlock, situationBlock, tiesBlock, WORLD_BLOCK } from './prompts';

type Want = Omit<Plan, 'by' | 'asking'>;
export interface YearChoice { id: string; want: Want; label: string; forGoal: boolean }

/** 每年最多替几个人用 AI 定打算（省额度） */
export const AI_DECISIONS_PER_YEAR = 3;

const SCHEME: Record<string, string> = {
  ambush: '埋伏，亲自动手', scandal: '散布宗主的丑闻', wait: '按兵不动，等对方自己倒下', buy: '花钱买', steal: '暗中偷',
  rob: '硬抢', share: '把好处分给帮手', betray: '独吞，甩掉帮手', delve: '闯洞府深处', ally: '找帮手', woo: '拉拢同门',
  claim: '接位', near: '多接近', gift: '送礼', confess: '表白',
};

/** 为目标奔走的几种做法：规则挑一种，AI 可以换成别的合法做法 */
function goalVariants(w: World, n: Npc): Want[] {
  const g = n.mind.goal;
  const base = g ? goalWant(w, n) : null;
  if (!g || !base) return [];
  const out: Want[] = [base];
  const add = (x: Want) => { if (!out.some((o) => o.act === x.act && o.place === x.place && o.scheme === x.scheme)) out.push(x); };
  if (g.kind === 'throne' && g.step === 2) {
    const sect = g.target as SectId;
    const m = w.sects[sect].master;
    const master = m ? w.people[m] : undefined;
    if (master?.alive && master.id !== n.id) {
      add({ act: 'goal', place: sect, why: '让同门看清宗主的真面目', scheme: 'scandal', target: m });
      add({ act: 'goal', place: sect, why: '等那老东西自己坐化', scheme: 'wait', target: m });
      // 打不过还硬上就是送死，不给这个选项
      if (power(n) >= power(master) * 0.6) add({ act: 'goal', place: sect, why: '是时候动手了', scheme: 'ambush', target: m });
    }
  }
  if (g.kind === 'treasure' && g.step === 2) {
    const h = w.treasure[g.target!];
    const holder = h && h !== 'cave' && h !== 'gone' && h !== ME ? being(w, h) : undefined;
    if (holder?.alive) {
      const tn = targetName(w, g), hn = nm(w, h);
      if (n.stones >= 300) add({ act: 'goal', place: holder.place, why: `拿三百灵石跟${hn}买${tn}`, scheme: 'buy', target: h });
      add({ act: 'goal', place: holder.place, why: `趁${hn}不备，把${tn}偷过来`, scheme: 'steal', target: h });
      add({ act: 'goal', place: holder.place, why: `从${hn}手里把${tn}抢过来`, scheme: 'rob', target: h });
    }
  }
  if (g.kind === 'treasure' && g.step === 3 && g.ally) {
    add({ act: 'goal', place: n.place, why: '说好的那一份，分给帮手', scheme: 'share', target: g.ally });
    add({ act: 'goal', place: n.place, why: '东西只能有一个主人', scheme: 'betray', target: g.ally });
  }
  if (g.kind === 'longevity' && g.step === 1) {
    if (n.stones >= 200) add({ act: 'goal', place: 'market', why: '去坊市买延寿丹', scheme: 'buy' });
    add({ act: 'goal', place: 'cave', why: '去洞府找延寿的灵药', scheme: 'delve' });
  }
  return out;
}

export function wantId(x: Want) {
  if (x.act === 'goal') return x.scheme ? `goal:${x.scheme}` : 'goal';
  if (x.act === 'adventure') return `adventure:${x.place}`;
  if (x.act === 'visit') return `visit:${x.target}`;
  return x.act;
}

/** 今年能做的事：先是为目标奔走的几种做法，再是平常的事；同一个代号只留第一个 */
export function yearChoices(w: World, n: Npc): YearChoice[] {
  const out: YearChoice[] = [];
  const g = n.mind.goal;
  const push = (want: Want, forGoal: boolean) => {
    const id = wantId(want);
    if (out.some((c) => c.id === id)) return;
    const how = want.scheme ? `，${SCHEME[want.scheme] ?? want.scheme}` : '';
    const label = `${forGoal && g ? `为了${GOALS[g.kind].name}：` : ''}${want.why}（${placeName(want.place)}${how}）`;
    out.push({ id, want, label, forGoal });
  };
  for (const x of goalVariants(w, n)) push(x, true);
  const home = bestPlace(n);
  if (canBreak(n)) push({ act: 'seclude', place: home, why: '修为圆满，闭关冲关' }, false);
  if (n.hp < 80) push({ act: 'heal', place: home, why: '先把伤养好' }, false);
  for (const [x] of needOptions(w, n)) push(x, false);
  return out;
}

/** 陪别人出手的帮手已经答应了人家，不再另做打算 */
export const committed = (n: Npc) => n.plan.act === 'help' && !!n.plan.target;

/** 今年请 AI 替谁想：在主角身边、有得选的人；正和主角说话的、有目标的、和主角恩怨深的排前面 */
export function whoDecides(w: World, focus: string | null, limit = AI_DECISIONS_PER_YEAR): Npc[] {
  return npcs(w)
    .filter((n) => n.place === w.me.place && !committed(n) && yearChoices(w, n).length >= 2)
    .map((n) => [n, (n.id === focus ? 100 : 0) + (n.mind.goal ? 2 : 0) + Math.abs(aff(n, ME)) / 30 + (n.mind.op[ME] ? 1 : 0)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([n]) => n);
}

export function buildDecidePrompt(w: World, n: Npc) {
  const options = yearChoices(w, n).map((c) => `- ${c.id}：${c.label}`).join('\n');
  return `你在为一款叫《青冥录》的中文修仙游戏扮演一个修士。新的一年开始了，你要决定今年做什么。

${WORLD_BLOCK}

${personaBlock(w, n)}

${situationBlock(w, n, false)}

${goalBlock(w, n, false)}

${secretBlock(w, n, false)}

${tiesBlock(w, n)}

${memoryBlock(w, n, 8, false)}

【今年能做的事】（只能从这里选一件）
${options}

【要求】
- 按你的性格、看重的东西、处境、长远目标和你记得的事，选一件你今年真会去做的事。不一定选最稳妥的，要像这个人会做的选择：谨慎的人会等时机，莽撞的人会冒险，阴狠的人会下狠手，重情的人会先顾着在意的人。
- 用你自己的口吻写一句心里话当理由，不超过30个字。不要提到AI、游戏、数值和代号。
- 只回复一个JSON对象：{"choice":"上面的代号","why":"你的心里话"}`;
}

/** 校验 AI 的打算：代号必须在选项里，理由不能空 */
export function acceptDecision(w: World, n: Npc, raw: string): Plan | null {
  const o = asJson(raw);
  if (!o || typeof o.choice !== 'string' || typeof o.why !== 'string') return null;
  const c = yearChoices(w, n).find((x) => x.id === o.choice);
  const why = o.why.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!c || !why) return null;
  return { ...c.want, why, by: 'ai' };
}

/** 采用 AI 的打算：人跟着去那个地方；要出手的话，帮手也跟着去 */
export function applyDecision(w: World, n: Npc, plan: Plan) {
  n.plan = plan;
  n.place = plan.place;
  follow(w, n);
}
