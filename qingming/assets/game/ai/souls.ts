// 交情深的人自己会做的三件事（都只在接了大模型时发生，离线不触发）：
// 1. 主动开口（greet）：你到了地方，相熟以上的人先跟你说两句——接着他和你的那段谈话往下说；
// 2. 旁听（overhear）：同一处的两个人说话，你在旁边听见了；两人彼此的好感按他们说的话小幅变化；
// 3. 年底回想（reflect）：和你有过交集的相熟、刻骨之人，把这一年凝成一句「心里的你」，以后一直记着。
// 回复都要过校验，不合规就当没发生。

import type { Heard, Npc, World } from '../core/types';
import { adjust, aff, clamp, nm, npcs, op, placeName } from '../core/world';
import { asJson } from '../../souls/envelope';
import { bondScore, metThisYear, type Tier } from '../mind/bond';
import { describe } from '../mind/memory';
import { faceContext, faceSystem } from './talk';
import {
  type Ask, chatBlock, heartBlock, INTRO, join, memoryBlock, opinionBlock, personaBlock, RULES_BLOCK, soulSystem, WORLD_BLOCK,
} from './prompts';

/** 到了一个地方，最多几个人主动开口 */
export const GREETS_PER_ARRIVAL = 2;
const HEARD_CAP = 20;
/** 旁听的一段话最多让彼此好感变多少 */
export const HEARD_AFF = 3;
export const HEART_CHARS = 40;

// ───────────── 主动开口 ─────────────

/** 谁会主动开口：在你身边、相熟以上、没有正找你办事的人；交情深的先说 */
export function greetWho(w: World, tier: (n: Npc) => Tier, busy: readonly string[], limit = GREETS_PER_ARRIVAL): Npc[] {
  return npcs(w)
    .filter((n) => n.place === w.me.place && !busy.includes(n.id) && tier(n) >= 2)
    .sort((a, b) => bondScore(w, b) - bondScore(w, a))
    .slice(0, limit);
}

/** 主动开口和自由对话用同一个 system（命中同一份缓存），也接着同一段会话 */
export function buildGreetPrompt(w: World, n: Npc, tier: Tier): Ask {
  return {
    system: faceSystem(w, n),
    prompt: join(
      faceContext(w, n, tier),
      chatBlock(w, n, 6),
      `【这一刻】${w.me.name}今年来到了${placeName(w.me.place)}。你看见了对方，决定先开口——可以是招呼、关心、试探、挖苦、警告，看你们的交情、你记得的事和你自己的心思。`,
      `【这次怎么说】
- 1到2句，不超过60个字。不要替对方说话。
- 只回复一个JSON对象：{"reply":"你说的话"}`,
    ),
  };
}

/** 这句开口放进会话历史时，代表「对方来了」的那句 */
export const greetTurn = (w: World) => `（${w.me.name}来到了${placeName(w.me.place)}）`;

// ───────────── 旁听 ─────────────

/** 两人之间共同记得的事，和彼此的看法，打个分：恩怨越深越有话说 */
function pairScore(w: World, a: Npc, b: Npc) {
  const shared = a.mind.mem.filter((m) => m.a === b.id || m.b === b.id).length + b.mind.mem.filter((m) => m.a === a.id || m.b === a.id).length;
  return Math.abs(aff(a, b.id)) + Math.abs(aff(b, a.id)) + shared * 5 + (a.master === b.id || b.master === a.id || a.partner === b.id ? 40 : 0);
}

/** 谁和谁说话被你听见：至少一个是相熟以上的人，挑最有话说的一对 */
export function overhearPair(w: World, tier: (n: Npc) => Tier, busy: readonly string[]): [Npc, Npc] | null {
  const here = npcs(w).filter((n) => n.place === w.me.place && !busy.includes(n.id));
  let best: [Npc, Npc] | null = null;
  let score = -1;
  for (let i = 0; i < here.length; i++) {
    for (let j = i + 1; j < here.length; j++) {
      const [a, b] = [here[i], here[j]];
      if (Math.max(tier(a), tier(b)) < 2) continue;
      const s = pairScore(w, a, b) + (tier(a) + tier(b)) * 5;
      if (s > score) { score = s; best = tier(a) >= tier(b) ? [a, b] : [b, a]; }
    }
  }
  return best;
}

function viewOf(w: World, x: Npc, y: Npc) {
  const o = op(x, y.id);
  const mems = x.mind.mem.filter((m) => m.a === y.id || m.b === y.id).slice(-4).map((m) => `第${m.y}年，${describe(w, m, x.id, '')}`);
  const cover = x.mind.goal ? (x.mind.goal.secret ? x.mind.goal.cover ?? '没什么打算' : '') : '';
  return `【${x.name}眼里的${y.name}】好感${o.aff}（-100到100），信任${o.trust}。${mems.length ? `\n${x.name}记得：${mems.join('；')}` : ''}${cover ? `\n${x.name}对外只说自己「${cover}」，不会说出真实打算。` : ''}`;
}

export function buildOverhearPrompt(w: World, a: Npc, b: Npc): Ask {
  const persona = (n: Npc) => personaBlock(w, n).replace('【你是谁】', `【${n.name}】`);
  return {
    // 两个人的人设放在一起：同一对人再说话时命中缓存
    system: join(
      `${INTRO.replace('一个修士', '两个修士')}你要写他们之间的一小段对话。`,
      WORLD_BLOCK,
      RULES_BLOCK.replace('你就是这个人，用这个人的口吻', '两个人各用自己的口吻'),
      persona(a),
      persona(b),
    ),
    prompt: join(
      `【此刻】第${w.year}年，${a.name}和${b.name}都在${placeName(a.place)}。${w.me.name}就在不远处，听得见他们说话，所以两人都不会说出心底的秘密和真实打算。`,
      viewOf(w, a, b),
      viewOf(w, b, a),
      `【这次怎么写】
- 写${a.name}和${b.name}之间自然的2到5句对话，每句不超过50个字，可以带一个括号里的简短动作。按他们的性格、交情和记得的事来写：投缘就聊得热络，有仇就夹枪带棒。
- a：这段话之后${a.name}对${b.name}的好感怎么变，整数-3到3；b：${b.name}对${a.name}的好感怎么变，整数-3到3。
- 只回复一个JSON对象：{"lines":[{"who":"${a.name}","text":"……"},{"who":"${b.name}","text":"……"}],"a":0,"b":0}`,
    ),
  };
}

export interface HeardReply { lines: { who: string; text: string }[]; a: number; b: number }

export function acceptOverhear(raw: string, a: Npc, b: Npc): HeardReply | null {
  const o = asJson(raw);
  if (!o || !Array.isArray(o.lines)) return null;
  const idOf: Record<string, string> = { [a.name]: a.id, [b.name]: b.id, [a.id]: a.id, [b.id]: b.id };
  const lines = o.lines
    .map((l: unknown) => {
      const x = l as { who?: unknown; text?: unknown };
      const who = typeof x?.who === 'string' ? idOf[x.who.trim()] : undefined;
      const text = typeof x?.text === 'string' ? x.text.trim().slice(0, 80) : '';
      return who && text ? { who, text } : null;
    })
    .filter((x): x is { who: string; text: string } => !!x)
    .slice(0, 6);
  if (lines.length < 2) return null;
  const num = (v: unknown) => clamp(Math.round(Number(v) || 0), -HEARD_AFF, HEARD_AFF);
  return { lines, a: num(o.a), b: num(o.b) };
}

/** 落到世界上：记下听到的话，两人彼此的好感按说的话小幅变化 */
export function applyOverhear(w: World, a: Npc, b: Npc, r: HeardReply) {
  const h: Heard = { y: w.year, at: a.place, a: a.id, b: b.id, lines: r.lines };
  (w.heard ??= []).push(h);
  if (w.heard.length > HEARD_CAP) w.heard.splice(0, w.heard.length - HEARD_CAP);
  adjust(a, b.id, { aff: r.a });
  adjust(b, a.id, { aff: r.b });
  return h;
}

export const heardText = (w: World, h: Heard) => h.lines.map((l) => `${nm(w, l.who)}：${l.text}`).join('\n');

// ───────────── 年底回想 ─────────────

/** 年底谁会回想你：今年和你有过交集的刻骨之人；相熟的人要今年和你说过话 */
export function reflectWho(w: World, tier: (n: Npc) => Tier): Npc[] {
  return npcs(w).filter((n) => {
    const t = tier(n);
    return t >= 3 ? metThisYear(w, n) : t === 2 && !!w.turn.talk[n.id];
  });
}

/** 回想用的是不带目标、秘密的 system（和配台词共用缓存），也让他别把秘密写进「心里的你」 */
export function buildReflectPrompt(w: World, n: Npc): Ask {
  const thisYear = (w.chat[n.id] ?? []).filter((l) => l.y === w.year);
  return {
    system: soulSystem(w, n),
    prompt: join(
      `第${w.year}年快过去了，你在回想这一年和${w.me.name}的来往。下面的「对方」就是${w.me.name}。`,
      heartBlock(w, n),
      memoryBlock(w, n, 12),
      thisYear.length ? chatBlock({ ...w, chat: { [n.id]: thisYear } }, n, 30) : '',
      opinionBlock(w, n),
      `【这次怎么写】
- 用一句心里话写下你现在怎么看对方：可以是感激、牵挂、提防、怨恨、敬畏……要有这一年发生的具体的事，也要接得上你以前的看法。
- 称对方为「你」，用你自己的口吻，不超过${HEART_CHARS}个字。不要写你自己的秘密和真实打算，不要提数值。
- 只回复一个JSON对象：{"heart":"……"}`,
    ),
  };
}

export function acceptReflect(raw: string): string | null {
  const o = asJson(raw);
  const h = typeof o?.heart === 'string' ? o.heart.trim().replace(/\s+/g, ' ') : '';
  return h ? h.slice(0, HEART_CHARS + 20) : null;
}

/** 写进心里 */
export function applyReflect(n: Npc, heart: string, y: number) {
  n.mind.heart = heart;
  n.mind.heartY = y;
}

