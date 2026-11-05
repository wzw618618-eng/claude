// 玩家的 AI 设置：由谁来演（离线 / DeepSeek / Claude）、密钥、模型、用量档。
// 只存在本机浏览器的 localStorage 里，不进存档、不进代码，也不会发给游戏世界那一侧。

import type { IntelligenceProvider } from '@forgeax/engine/intelligence';
import { isMode, type Mode } from '../game/mind/bond.ts';
import type { Meter } from './meter.ts';
import { createChatApiProvider, createClaudeProvider, createOfflineProvider, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from './providers.ts';

export type AiKind = 'offline' | 'deepseek' | 'claude';
export interface AiConfig { kind: AiKind; apiKey: string; model: string; mode: Mode }

const STORE = 'qingming.ai';
export const DEFAULT_CONFIG: AiConfig = { kind: 'offline', apiKey: '', model: DEEPSEEK_MODEL, mode: 'normal' };

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

export function loadConfig(storage: Store): AiConfig {
  try {
    const c = JSON.parse(storage?.getItem(STORE) ?? 'null');
    if (!c || typeof c !== 'object') return { ...DEFAULT_CONFIG };
    return {
      kind: c.kind === 'deepseek' || c.kind === 'claude' ? c.kind : 'offline',
      apiKey: typeof c.apiKey === 'string' ? c.apiKey.trim() : '',
      model: typeof c.model === 'string' && c.model.trim() ? c.model.trim() : DEEPSEEK_MODEL,
      mode: isMode(c.mode) ? c.mode : 'normal',
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(storage: Store, cfg: AiConfig) {
  try { storage?.setItem(STORE, JSON.stringify(cfg)); } catch { /* 浏览器不让存就只在这次有效 */ }
}

/** 按设置造提供方；DeepSeek 没填密钥、不在 claude.ai 里却选了 Claude，都退回离线 */
export function providerFor(cfg: AiConfig, opts: { meter?: Meter; sample?: unknown; fetchImpl?: typeof fetch } = {}): { provider: IntelligenceProvider; label: string } {
  if (cfg.kind === 'deepseek' && cfg.apiKey) {
    const provider = createChatApiProvider({
      id: 'deepseek',
      baseUrl: DEEPSEEK_BASE_URL,
      apiKey: cfg.apiKey,
      model: cfg.model || DEEPSEEK_MODEL,
      dialect: 'deepseek',
      onUsage: (r) => opts.meter?.record(r),
    }, opts.fetchImpl);
    return { provider, label: `DeepSeek（${cfg.model || DEEPSEEK_MODEL}）` };
  }
  if (cfg.kind === 'claude' && opts.sample) return { provider: createClaudeProvider(opts.sample), label: 'Claude' };
  const why = cfg.kind === 'deepseek' ? '（还没填 DeepSeek 密钥）' : cfg.kind === 'claude' ? '（不在 claude.ai 里）' : '';
  return { provider: createOfflineProvider(), label: `离线${why}` };
}
