// 浏览器里选模型：本地开发时可连本机代理（密钥只在代理进程里），否则用模板应答。
// 正式发布接平台模型服务或自建代理前，发布版一律走模板应答。

import { OpenAICompatibleClient, type AIClient } from '../game/ai/client';
import { TemplateClient } from '../game/ai/templateResponder';
import type { GameData } from '../game/data/types';

export type ProviderSetting = 'auto' | 'template' | 'proxy';

export const DEV_PROXY_URL = 'http://127.0.0.1:8787';

export interface PickedClient {
  client: AIClient;
  label: string;
}

/** 本机页面且地址里带 ?proxy=1 时，“自动”才去连本机代理（连不上会在控制台报错，所以不默认探测） */
function wantsLocalProxy(): boolean {
  try {
    const h = globalThis.location?.hostname ?? '';
    const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    return local && new URLSearchParams(globalThis.location?.search ?? '').has('proxy');
  } catch {
    return false;
  }
}

export async function pickClient(data: GameData, setting: ProviderSetting, proxyUrl = DEV_PROXY_URL): Promise<PickedClient> {
  const template = { client: new TemplateClient(), label: '模板应答（离线）' };
  if (setting === 'template') return template;
  if (setting === 'auto' && !wantsLocalProxy()) return template;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${proxyUrl}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return template;
    const info = (await res.json()) as { model?: string };
    const model = info.model ?? data.config.model.providers.openai_compatible.model;
    return {
      client: new OpenAICompatibleClient({ baseUrl: proxyUrl, model, timeoutMs: data.config.model.timeout_ms }),
      label: `${model}（本地代理）`,
    };
  } catch {
    return template;
  }
}
