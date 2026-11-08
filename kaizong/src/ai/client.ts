// 调大模型：DeepSeek（OpenAI 兼容的 /chat/completions，流式）。
// 密钥只存在玩家自己的浏览器里，由浏览器直接发请求，不经过任何服务器。

export interface Usage { inputHit: number; inputMiss: number; output: number }
export interface ChatReq {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** 边生成边回调（聊天时显示打字效果） */
  onText?: (soFar: string) => void;
  signal?: AbortSignal;
  /** 多轮对话的历史（聊天用） */
  history?: { role: 'user' | 'assistant'; content: string }[];
}
export interface ChatRes { text: string; usage: Usage; ms: number }

export interface AiClient {
  readonly kind: 'deepseek' | 'offline';
  chat(req: ChatReq): Promise<ChatRes>;
}

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
/** DeepSeek V4.1 Flash */
export const DEEPSEEK_MODEL = 'deepseek-flash';

export function readUsage(u: any): Usage {
  const prompt = Number(u?.prompt_tokens) || 0;
  const hit = Number(u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens) || 0;
  const miss = u?.prompt_cache_miss_tokens !== undefined ? Number(u.prompt_cache_miss_tokens) || 0 : Math.max(0, prompt - hit);
  return { inputHit: hit, inputMiss: miss, output: Number(u?.completion_tokens) || 0 };
}

export class AiError extends Error {
  constructor(msg: string, readonly status?: number) { super(msg); }
}

export function createDeepSeek(cfg: { apiKey: string; model?: string; baseUrl?: string; onUsage?: (u: Usage, ms: number) => void }, fetchImpl: typeof fetch = (...a) => fetch(...a)): AiClient {
  const url = `${(cfg.baseUrl ?? DEEPSEEK_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
  return {
    kind: 'deepseek',
    async chat(req) {
      const t0 = Date.now();
      const body = {
        model: cfg.model ?? DEEPSEEK_MODEL,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: req.maxTokens ?? 300,
        temperature: req.temperature ?? 0.9,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        messages: [{ role: 'system', content: req.system }, ...(req.history ?? []), { role: 'user', content: req.prompt }],
      };
      let res: Response | null = null;
      for (let attempt = 0; ; attempt++) {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
          signal: req.signal,
        });
        if (res.ok || attempt >= 1 || !(res.status === 429 || res.status >= 500)) break;
        await new Promise((ok) => setTimeout(ok, 1200));
      }
      if (!res || !res.ok || !res.body) {
        const st = res?.status;
        throw new AiError(`AI 接口出错（HTTP ${st}${st === 401 ? '，密钥不对' : st === 402 ? '，余额不足' : ''}）`, st);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let full = '';
      let usage: Usage = { inputHit: 0, inputMiss: 0, output: 0 };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          let chunk: any;
          try { chunk = JSON.parse(data); } catch { continue; }
          if (chunk?.usage) usage = readUsage(chunk.usage);
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            full += delta;
            req.onText?.(full);
          }
        }
      }
      const ms = Date.now() - t0;
      cfg.onUsage?.(usage, ms);
      return { text: full, usage, ms };
    },
  };
}

/** 从模型输出里取 JSON：允许前后有多余的字或代码块 */
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

/** 从还没写完的 JSON 里取出 reply 已经写出来的部分 */
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
      out += nx === 'n' ? '\n' : nx;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}
