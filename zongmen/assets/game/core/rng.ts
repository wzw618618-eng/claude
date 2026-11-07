// 带种子的随机数。同一种子永远得到同一串数，用于案件生成和模板应答。
// 算法：splitmix32 打散种子，sfc32 出数。都是纯整数运算，Node 和浏览器结果一致。

export interface Rng {
  /** [0, 1) 之间的小数 */
  next(): number;
  /** [0, n) 之间的整数 */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  chance(p: number): boolean;
}

/** 把若干字符串或数字混成一个 32 位种子（FNV-1a） */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part) + '\u0000';
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const mix = splitmix32(seed);
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();
  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  // 先空转几轮，避免相邻种子开头相关
  for (let i = 0; i < 12; i++) nextU32();

  const rng: Rng = {
    next: () => nextU32() / 4294967296,
    int: (n: number) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`rng.int 需要正整数，收到 ${n}`);
      return Math.floor(rng.next() * n);
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('rng.pick 不能从空数组里取');
      return items[rng.int(items.length)];
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance: (p: number) => rng.next() < p,
  };
  return rng;
}
