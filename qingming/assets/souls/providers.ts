// AI 提供方（IntelligenceProvider）。它们只在浏览器主线程（Host）这一侧运行，
// 密钥也只留在这里；游戏世界那一侧只通过引擎的 Intelligence 端口收发结构化消息。

import type { ActivityId, ActivitySink, ActivitySubmission, IntelligenceProvider } from '@forgeax/engine/intelligence';
import { ok } from '@forgeax/engine/types';
import { asJson, decodeEnvelope } from './envelope.ts';

/** 不分 system 的提供方（Claude）：把两段拼起来 */
const promptOf = (s: ActivitySubmission) => {
  const env = decodeEnvelope(s.input);
  return env ? [env.system, env.prompt].filter(Boolean).join('\n\n') : s.input;
};

export const OFFLINE_PROVIDER = 'qingming-offline';

/** 离线：把信封里规则写好的回答（fallback），像打字一样一点点吐出来 */
export function createOfflineProvider(opts: { chunk?: number; delayMs?: number } = {}): IntelligenceProvider {
  const chunk = opts.chunk ?? 2;
  const delay = opts.delayMs ?? 35;
  const live = new Map<ActivityId, { timer?: ReturnType<typeof setTimeout>; sink: ActivitySink }>();
  return {
    id: OFFLINE_PROVIDER,
    start(sub, sink) {
      const env = decodeEnvelope(sub.input);
      const text = JSON.stringify(env?.fallback ?? { reply: '……' });
      const rec: { timer?: ReturnType<typeof setTimeout>; sink: ActivitySink } = { sink };
      live.set(sub.id, rec);
      let i = 0;
      const step = () => {
        if (!live.has(sub.id)) return;
        if (i >= text.length) {
          live.delete(sub.id);
          sink.complete(text);
          return;
        }
        sink.text(text.slice(i, i + chunk));
        i += chunk;
        rec.timer = setTimeout(step, delay);
      };
      rec.timer = setTimeout(step, delay);
      return ok(undefined);
    },
    cancel(id) {
      const rec = live.get(id);
      if (rec) {
        clearTimeout(rec.timer);
        live.delete(id);
        rec.sink.cancelled();
      }
      return ok(undefined);
    },
    async close() {
      for (const rec of live.values()) clearTimeout(rec.timer);
      live.clear();
    },
  };
}

/** 一次请求用了多少 token（DeepSeek 会分开报缓存命中和未命中、思考用的 token） */
export interface Usage {
  readonly inputHit: number;
  readonly inputMiss: number;
  readonly output: number;
  readonly reasoning: number;
}

/** 记账用：哪个灵魂、哪类请求、交情几档、用了多少 */
export interface UsageReport {
  readonly soul: string;
  readonly ask: string;
  readonly tier: number;
  readonly model: string;
  readonly usage: Usage;
  readonly ms: number;
}

export interface ChatApiConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** 'deepseek'：用 DeepSeek 的思考开关（thinking / reasoning_effort）；'none'：不发这些参数 */
  readonly dialect?: 'deepseek' | 'none';
  /** 每个会话最多记几轮问答 */
  readonly historyTurns?: number;
  /** 限流、服务端出错后等多久再试（毫秒） */
  readonly retryMs?: number;
  /** 每次请求结束时报一次用量 */
  readonly onUsage?: (r: UsageReport) => void;
}

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
/** DeepSeek V4.1 Flash */
export const DEEPSEEK_MODEL = 'deepseek-flash';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

/** 把接口报的用量统一成一种样子（DeepSeek 和 OpenAI 的字段名不一样） */
export function readUsage(u: any): Usage {
  const prompt = Number(u?.prompt_tokens) || 0;
  const hit = Number(u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens) || 0;
  const miss = u?.prompt_cache_miss_tokens !== undefined ? Number(u.prompt_cache_miss_tokens) || 0 : Math.max(0, prompt - hit);
  return { inputHit: hit, inputMiss: miss, output: Number(u?.completion_tokens) || 0, reasoning: Number(u?.completion_tokens_details?.reasoning_tokens) || 0 };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((done, fail) => {
  const t = setTimeout(done, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); fail(new Error('aborted')); }, { once: true });
});

/**
 * OpenAI 兼容的 /chat/completions 流式接口，DeepSeek 就是这一种。
 * - messages = system（稳定，命中缓存）+ 这个 SessionRef 之前的问答 + 当下的 prompt；
 * - 信封里的 keep 有值时，把这一问一答记进会话，下次同一个 SessionRef 接着聊（引擎负责发同一个 SessionRef）；
 * - think：off 关思考，low / high 是思考深度；思考的内容不交给游戏，只记 token；
 * - 限流或服务端出错时，还没吐字就等一下再试一次。
 */
export function createChatApiProvider(cfg: ChatApiConfig, fetchImpl: typeof fetch = fetch): IntelligenceProvider {
  const live = new Map<ActivityId, AbortController>();
  const history = new Map<string, Msg[]>();
  const turns = cfg.historyTurns ?? 12;
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    id: cfg.id,
    start(sub, sink) {
      const ctl = new AbortController();
      live.set(sub.id, ctl);
      const env = decodeEnvelope(sub.input);
      const keep = env?.keep;
      const past = keep ? history.get(sub.session.id) ?? [] : [];
      const messages: Msg[] = [
        ...(env?.system ? [{ role: 'system' as const, content: env.system }] : []),
        ...past,
        { role: 'user', content: env?.prompt ?? sub.input },
      ];
      const think = env?.think ?? 'off';
      const body: Record<string, unknown> = {
        model: cfg.model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: env?.maxTokens ?? 600,
        response_format: { type: 'json_object' },
        messages,
      };
      if (cfg.dialect !== 'none') {
        if (think === 'off') body.thinking = { type: 'disabled' };
        else body.reasoning_effort = think;
      }
      if (think === 'off') body.temperature = 0.9;
      void (async () => {
        const t0 = Date.now();
        let full = '';
        let usage: Usage | null = null;
        try {
          let res: Response | null = null;
          for (let attempt = 0; ; attempt++) {
            res = await fetchImpl(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
              body: JSON.stringify(body),
              signal: ctl.signal,
            });
            if (res.ok || attempt >= 1 || !(res.status === 429 || res.status >= 500)) break;
            await sleep(cfg.retryMs ?? 1200, ctl.signal);
          }
          if (!res || !res.ok || !res.body) throw new Error(`AI 接口返回 HTTP ${res?.status}${res?.status === 401 ? '（密钥不对）' : res?.status === 402 ? '（余额不足）' : ''}`);
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
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
              const chunk = JSON.parse(data);
              if (chunk?.usage) usage = readUsage(chunk.usage);
              // 只把正文交给游戏；reasoning_content（思考）不外漏
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                full += delta;
                sink.text(delta);
              }
            }
          }
          // 回得像样才记进会话，免得一句坏话带坏后面的对话
          if (keep && asJson(full)) {
            const h = [...past, { role: 'user' as const, content: keep }, { role: 'assistant' as const, content: full }];
            history.set(sub.session.id, h.slice(-turns * 2));
          }
          sink.complete(full);
        } catch (cause) {
          if (ctl.signal.aborted) sink.cancelled();
          else sink.fail(cause);
        } finally {
          live.delete(sub.id);
          if (usage && env) cfg.onUsage?.({ soul: env.soul, ask: env.ask, tier: env.tier, model: cfg.model, usage, ms: Date.now() - t0 });
        }
      })();
      return ok(undefined);
    },
    cancel(id) {
      live.get(id)?.abort();
      return ok(undefined);
    },
    async close() {
      for (const c of live.values()) c.abort();
      live.clear();
      history.clear();
    },
  };
}

/** 在 claude.ai 里打开时，用页面的 sample 能力让 Claude 扮演角色 */
export function createClaudeProvider(sample: any): IntelligenceProvider {
  const live = new Map<ActivityId, AbortController>();
  return {
    id: 'claude',
    start(sub, sink) {
      const ctl = new AbortController();
      live.set(sub.id, ctl);
      sample(promptOf(sub), {
        modelTier: 'quick',
        cache: false,
        signal: ctl.signal,
        onText: ({ delta }: { delta: string }) => sink.text(delta),
      }).then(
        (r: { text: string }) => sink.complete(r.text),
        (e: { code?: string }) => (e?.code === 'cancelled' ? sink.cancelled() : sink.fail(e)),
      ).finally(() => live.delete(sub.id));
      return ok(undefined);
    },
    cancel(id) {
      live.get(id)?.abort();
      return ok(undefined);
    },
    async close() {
      for (const c of live.values()) c.abort();
      live.clear();
    },
  };
}

/** Host 与游戏世界两侧共用的 Activity 上限：刻骨之人的提示词带着全部记忆、谈话和江湖传闻，比默认值长得多 */
export const TALK_LIMITS = { maxInputChars: 64000, maxOutputChars: 4000, maxConcurrentActivities: 16 } as const;
