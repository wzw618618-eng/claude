// 一次 AI 请求的「信封」。它作为 Intelligence Activity 的 input 发给 AI 提供方：
// - 大模型提供方只读 prompt；
// - 离线提供方直接把 fallback（规则写好的回答）吐出来。
// 所以无论接的是 DeepSeek、Claude 还是离线，游戏这一侧走的都是同一条 Activity 流程。

export type AskKind = 'talk' | 'voice' | 'decide' | 'encounter';

export interface Envelope {
  readonly v: 1;
  readonly soul: string;
  /** 这是哪一类请求：对话、给规则结果配台词、定年度打算、找上门时开口 */
  readonly ask: AskKind;
  readonly prompt: string;
  /** 离线提供方直接用它；只在离线也要走流程的请求里有 */
  readonly fallback: unknown;
}

export const encodeEnvelope = (e: Envelope) => JSON.stringify(e);

export function decodeEnvelope(input: string): Envelope | null {
  try {
    const o = JSON.parse(input) as Partial<Envelope>;
    return o && o.v === 1 && typeof o.prompt === 'string' ? (o as Envelope) : null;
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
