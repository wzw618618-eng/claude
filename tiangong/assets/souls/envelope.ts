// 一次夜谈请求的「信封」。它作为 Intelligence Activity 的 input 发给 AI 提供方：
// - 大模型提供方只读 prompt；
// - 离线提供方直接用 fallback（按心情、信任挑好的手写台词）。
// 这样无论接的是 DeepSeek、Claude 还是离线台词，游戏这一侧走的都是同一条 Activity 流程。

import type { TalkResult } from '../hanyi/ai/dialogue.ts';
import { parseAI } from '../hanyi/ai/dialogue.ts';

export interface TalkEnvelope {
  readonly v: 1;
  readonly soul: string;
  readonly prompt: string;
  /** 离线提供方直接用它；自荐、开场白、篝火对话不走离线提供方，为 null */
  readonly fallback: TalkResult | null;
}

export const encodeEnvelope = (e: TalkEnvelope) => JSON.stringify(e);

export function decodeEnvelope(input: string): TalkEnvelope | null {
  try {
    const o = JSON.parse(input) as Partial<TalkEnvelope>;
    return o && o.v === 1 && typeof o.prompt === 'string' ? (o as TalkEnvelope) : null;
  } catch {
    return null;
  }
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

/** 校验大模型的最终回复：只接受合规的 JSON，数值被夹在规定范围内 */
export function acceptReply(output: string): TalkResult | null {
  const tryParse = (t: string) => {
    try { return parseAI(JSON.parse(t)); } catch { return null; }
  };
  const direct = tryParse(output.trim());
  if (direct) return direct;
  const a = output.indexOf('{'), b = output.lastIndexOf('}');
  return a >= 0 && b > a ? tryParse(output.slice(a, b + 1)) : null;
}
