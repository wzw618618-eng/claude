// 按 config/game.json 的 model.provider 创建模型客户端。

import type { GameData } from '../data/types';
import { OpenAICompatibleClient, PlatformClient, type AIClient } from './client';
import { TemplateClient } from './templateResponder';

export type ProviderName = 'template' | 'openai_compatible' | 'platform';

export interface ClientEnv {
  /** Node 环境变量；浏览器里不传 */
  env?: Record<string, string | undefined>;
  /** 覆盖配置里的接口地址（例如自建代理） */
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function createClient(data: GameData, provider: ProviderName = data.config.model.provider, opts: ClientEnv = {}): AIClient {
  const m = data.config.model;
  if (provider === 'template') return new TemplateClient();
  if (provider === 'platform') return new PlatformClient();
  const oc = m.providers.openai_compatible;
  return new OpenAICompatibleClient({
    baseUrl: opts.baseUrl ?? opts.env?.ZONGMEN_BASE_URL ?? oc.base_url,
    model: opts.model ?? opts.env?.ZONGMEN_MODEL ?? oc.model,
    apiKey: opts.env?.[oc.api_key_env],
    timeoutMs: m.timeout_ms,
    extraBody: oc.extra_body,
    fetchImpl: opts.fetchImpl,
  });
}
