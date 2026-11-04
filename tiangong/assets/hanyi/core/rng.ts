// 可存档的随机数：状态只有一个整数，存档读档后结果完全一致，便于复现和平衡测试。

export interface Rng {
  next(): number;
  chance(p: number): boolean;
  int(lo: number, hi: number): number;
  range(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  weighted<T>(items: [T, number][]): T | null;
  shuffle<T>(arr: T[]): T[];
  state(): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (items) => {
      const total = items.reduce((t, [, w]) => t + Math.max(0, w), 0);
      if (total <= 0) return null;
      let r = next() * total;
      for (const [v, w] of items) {
        r -= Math.max(0, w);
        if (r < 0) return v;
      }
      return items[items.length - 1][0];
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    state: () => a >>> 0,
  };
  return rng;
}
