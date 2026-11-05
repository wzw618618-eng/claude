// 记账：每次 AI 请求用了多少 token、约多少钱、花在谁身上。
// 价格按 DeepSeek V4.1 Flash 的高峰价算（闲时是一半），所以显示的是「最多大概这么多」。
// 只在 Host（浏览器主线程）这一侧，和密钥待在一起；总账存在本机浏览器里。

import type { Usage, UsageReport } from './providers.ts';

/** 每百万 token 多少美元：输入未命中缓存、命中缓存、输出（思考也算输出） */
export interface Price { readonly miss: number; readonly hit: number; readonly out: number }
export const PRICES: Record<string, Price> = {
  // DeepSeek V4.1 Flash 高峰价（2026-09 起；闲时减半）
  'deepseek-flash': { miss: 0.30, hit: 0.006, out: 1.20 },
};
/** 换成人民币大概乘多少 */
export const USD_CNY = 7.1;

export const costOf = (model: string, u: Usage): number | null => {
  const p = PRICES[model];
  return p ? (u.inputMiss * p.miss + u.inputHit * p.hit + u.output * p.out) / 1e6 : null;
};

export interface Totals { calls: number; inputHit: number; inputMiss: number; output: number; reasoning: number; usd: number; ms: number; priced: boolean }
const zero = (): Totals => ({ calls: 0, inputHit: 0, inputMiss: 0, output: 0, reasoning: 0, usd: 0, ms: 0, priced: true });

function add(t: Totals, r: UsageReport) {
  t.calls++;
  t.inputHit += r.usage.inputHit;
  t.inputMiss += r.usage.inputMiss;
  t.output += r.usage.output;
  t.reasoning += r.usage.reasoning;
  t.ms += r.ms;
  const c = costOf(r.model, r.usage);
  if (c === null) t.priced = false;
  else t.usd += c;
}

export interface Meter {
  record(r: UsageReport): void;
  /** 这一局（开新局时清零） */
  readonly game: Readonly<Totals>;
  /** 这台设备上一共 */
  readonly all: Readonly<Totals>;
  /** 这一局按灵魂、按交情、按请求类型分开的账 */
  bySoul(): [string, Totals][];
  byTier(): Record<number, Totals>;
  byAsk(): Record<string, Totals>;
  resetGame(): void;
  onChange(fn: () => void): () => void;
}

const STORE = 'qingming.ai.meter';

export function createMeter(storage: Pick<Storage, 'getItem' | 'setItem'> | null = null): Meter {
  let game = zero();
  let all = zero();
  try {
    const saved = storage?.getItem(STORE);
    if (saved) all = { ...zero(), ...JSON.parse(saved) };
  } catch { /* 读不到就从零记 */ }
  let soul = new Map<string, Totals>();
  let tier = new Map<number, Totals>();
  let ask = new Map<string, Totals>();
  const subs = new Set<() => void>();
  const bucket = <K>(m: Map<K, Totals>, k: K) => { let t = m.get(k); if (!t) m.set(k, (t = zero())); return t; };
  return {
    record(r) {
      add(game, r);
      add(all, r);
      add(bucket(soul, r.soul), r);
      add(bucket(tier, r.tier), r);
      add(bucket(ask, r.ask), r);
      try { storage?.setItem(STORE, JSON.stringify(all)); } catch { /* 存不下就算了 */ }
      for (const f of subs) f();
    },
    get game() { return game; },
    get all() { return all; },
    bySoul: () => [...soul].sort((a, b) => b[1].usd - a[1].usd || b[1].calls - a[1].calls),
    byTier: () => Object.fromEntries(tier),
    byAsk: () => Object.fromEntries(ask),
    resetGame() {
      game = zero();
      soul = new Map();
      tier = new Map();
      ask = new Map();
      for (const f of subs) f();
    },
    onChange(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** 一行账：12 次 · 输入 34.5k（缓存命中 62%）· 输出 3.2k（思考 1.1k）· 约 ¥0.03 */
export function totalsText(t: Totals) {
  if (!t.calls) return '还没用过';
  const input = t.inputHit + t.inputMiss;
  const hit = input ? Math.round((t.inputHit / input) * 100) : 0;
  const money = t.priced ? ` · 约 ¥${(t.usd * USD_CNY).toFixed(t.usd * USD_CNY < 1 ? 3 : 2)}` : '';
  return `${t.calls} 次 · 输入 ${k(input)}（缓存命中 ${hit}%）· 输出 ${k(t.output)}（思考 ${k(t.reasoning)}）${money}`;
}
