// AI 提供方（IntelligenceProvider）。它们只在浏览器主线程（Host）这一侧运行，
// 密钥也只留在这里；游戏世界那一侧只通过引擎的 Intelligence 端口收发结构化消息。

import type { ActivityId, ActivitySink, ActivitySubmission, IntelligenceProvider } from '@forgeax/engine/intelligence';
import { ok } from '@forgeax/engine/types';
import { decodeEnvelope } from './envelope.ts';

const promptOf = (s: ActivitySubmission) => decodeEnvelope(s.input)?.prompt ?? s.input;

/** 离线台词：按心情和信任挑好的手写台词，像打字一样一点点吐出来 */
export function createOfflineProvider(opts: { chunk?: number; delayMs?: number } = {}): IntelligenceProvider {
  const chunk = opts.chunk ?? 2;
  const delay = opts.delayMs ?? 35;
  const live = new Map<ActivityId, { timer?: ReturnType<typeof setTimeout>; sink: ActivitySink }>();
  return {
    id: 'hanyi-offline',
    start(sub, sink) {
      const env = decodeEnvelope(sub.input);
      const text = JSON.stringify(env?.fallback ?? { reply: '……', trust: 0, mood: 0, revealed: false });
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

export interface ChatApiConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/** OpenAI 兼容的 /chat/completions 流式接口，DeepSeek 就是这一种 */
export function createChatApiProvider(cfg: ChatApiConfig, fetchImpl: typeof fetch = fetch): IntelligenceProvider {
  const live = new Map<ActivityId, AbortController>();
  return {
    id: cfg.id,
    start(sub, sink) {
      const ctl = new AbortController();
      live.set(sub.id, ctl);
      void (async () => {
        let full = '';
        try {
          const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
              model: cfg.model,
              stream: true,
              temperature: 0.9,
              max_tokens: 400,
              response_format: { type: 'json_object' },
              messages: [{ role: 'user', content: promptOf(sub) }],
            }),
            signal: ctl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`AI 接口返回 HTTP ${res.status}`);
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
              const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                full += delta;
                sink.text(delta);
              }
            }
          }
          sink.complete(full);
        } catch (cause) {
          if (ctl.signal.aborted) sink.cancelled();
          else sink.fail(cause);
        } finally {
          live.delete(sub.id);
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

/** Host 与游戏世界两侧共用的 Activity 上限：提示词带着角色设定和最近的事，比默认值长 */
export const TALK_LIMITS = { maxInputChars: 32000, maxOutputChars: 4000, maxConcurrentActivities: 16 } as const;
