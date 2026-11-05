// 一次 AI 请求的「信封」。它作为 Intelligence Activity 的 input 发给 AI 提供方：
// - 大模型提供方读 system（稳定、可缓存）和 prompt（当下）；keep 为真时，把这一问一答记进这个 SessionRef 的对话历史，下次接着聊；
// - think 是想多深（关思考 / 浅想 / 深想），由交情深浅决定；
// - 离线提供方直接把 fallback（规则写好的回答）吐出来。
// 所以无论接的是 DeepSeek、Claude 还是离线，游戏这一侧走的都是同一条 Activity 流程。

import type { Think } from '../game/ai/prompts.ts';
import type { Tier } from '../game/mind/bond.ts';

export type AskKind = 'talk' | 'voice' | 'decide' | 'encounter' | 'greet' | 'overhear' | 'reflect';
export type { Think };

export interface Envelope {
  readonly v: 2;
  readonly soul: string;
  /** 这是哪一类请求：对话、配台词、定打算、找上门时开口、主动开口、旁听、年底回想 */
  readonly ask: AskKind;
  /** 交情深浅（0 陌路 … 3 刻骨），用来记账 */
  readonly tier: Tier;
  /** 稳定的前半段：世界、要求、人设；同一个人反复请求时一字不差，命中缓存 */
  readonly system: string;
  /** 当下：处境、记忆、刚说的话、回复格式 */
  readonly prompt: string;
  /** 记进对话历史的那句短话（比如你说的话）；有它才会续上会话 */
  readonly keep?: string;
  readonly think: Think;
  /** 输出上限（含思考），按想多深给 */
  readonly maxTokens: number;
  /** 离线提供方直接用它；只在离线也要走流程的请求里有 */
  readonly fallback: unknown;
}

/** 想多深给多少输出额度：思考的字也算在里面 */
export const MAX_TOKENS: Record<Think, number> = { off: 500, low: 2500, high: 8000 };

export const encodeEnvelope = (e: Envelope) => JSON.stringify(e);

export function decodeEnvelope(input: string): Envelope | null {
  try {
    const o = JSON.parse(input) as Partial<Envelope> & { v?: number };
    if (!o || typeof o.prompt !== 'string') return null;
    if (o.v === 2) return o as Envelope;
    // 第 2 阶段的信封：没有 system 和思考设置
    if (o.v === 1) return { ...o, v: 2, tier: 1, system: '', think: 'off', maxTokens: MAX_TOKENS.off } as Envelope;
    return null;
  } catch {
    return null;
  }
}

/** 从大模型的输出里取出 JSON 对象：允许前后有多余的字或代码块 */
export function asJson(raw: string): Record<string, unknown> | null {
  const tryParse = (t: string) => {
    try {
      const o = JSON.parse(t);
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw.trim());
  if (direct) return direct;
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  return a >= 0 && b > a ? tryParse(raw.slice(a, b + 1)) : null;
}

/** 从还没写完的 JSON 里取出 reply 已经写出来的部分，用于边生成边显示 */
export function replySoFar(raw: string): string {
  const m = /"reply"\s*:\s*"/.exec(raw);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') break;
    if (ch === '\\') {
      const nx = raw[i + 1];
      if (nx === undefined) break;
      if (nx === 'u') {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
      } else {
        out += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
        i += 1;
      }
      continue;
    }
    out += ch;
  }
  return out;
}
