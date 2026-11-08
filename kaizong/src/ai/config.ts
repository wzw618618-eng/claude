// AI 设置：用不用 DeepSeek、密钥、档位。只存在本机浏览器里。
// 记账：每次请求用了多少 token、大约多少钱。

import type { AiMode } from '../game/season';
import type { Usage } from './client';

export interface AiConfig { kind: 'offline' | 'deepseek'; apiKey: string; mode: AiMode }
const KEY = 'kaizong.ai';
const METER = 'kaizong.ai.meter';

export function loadConfig(): AiConfig {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (o && (o.kind === 'offline' || o.kind === 'deepseek')) return { kind: o.kind, apiKey: String(o.apiKey ?? ''), mode: ['save', 'normal', 'rich'].includes(o.mode) ? o.mode : 'normal' };
  } catch { /* 读不到就用默认 */ }
  return { kind: 'offline', apiKey: '', mode: 'normal' };
}

export function saveConfig(c: AiConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* 存不下就算了 */ }
}

/** DeepSeek V4.1 Flash 每百万 token 多少美元 */
const PRICE = { miss: 0.3, hit: 0.006, out: 1.2 };
const USD_CNY = 7.1;

export interface Totals { calls: number; yuan: number; ms: number; fails: number }
const zero = (): Totals => ({ calls: 0, yuan: 0, ms: 0, fails: 0 });

export interface Meter { game: Totals; all: Totals; record(u: Usage, ms: number): void; fail(): void; resetGame(): void }

export function createMeter(): Meter {
  let all = zero();
  try { all = { ...zero(), ...JSON.parse(localStorage.getItem(METER) ?? '{}') }; } catch { /* 从零记 */ }
  const m: Meter = {
    game: zero(),
    all,
    record(u, ms) {
      const yuan = ((u.inputMiss * PRICE.miss + u.inputHit * PRICE.hit + u.output * PRICE.out) / 1e6) * USD_CNY;
      for (const t of [m.game, m.all]) { t.calls++; t.yuan += yuan; t.ms += ms; }
      try { localStorage.setItem(METER, JSON.stringify(m.all)); } catch { /* 存不下就算了 */ }
    },
    fail() { m.game.fails++; },
    resetGame() { m.game = zero(); },
  };
  return m;
}

export const money = (y: number) => (y < 0.01 ? '不到 1 分钱' : y < 1 ? `约 ${(y * 100).toFixed(0)} 分钱` : `约 ${y.toFixed(2)} 元`);
