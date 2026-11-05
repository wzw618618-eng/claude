// 像素画布：按图层把 ASCII 字符画画上去，自动描边，最后导出 RGBA。
// 每个像素记录颜色和「材质」（face / hair / cloth …），方便之后按材质补阴影。

export const W = 48;
export const H = 48;

export class Canvas {
  constructor(w = W, h = H) {
    this.w = w;
    this.h = h;
    this.col = new Array(w * h).fill(null);
    this.mat = new Array(w * h).fill(null);
  }
  in(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    return this.in(x, y) ? this.col[y * this.w + x] : undefined;
  }
  m(x, y) {
    return this.in(x, y) ? this.mat[y * this.w + x] : undefined;
  }
  put(x, y, c, mat) {
    if (!this.in(x, y) || c == null) return;
    this.col[y * this.w + x] = c;
    this.mat[y * this.w + x] = mat;
  }
  erase(x, y) {
    if (!this.in(x, y)) return;
    this.col[y * this.w + x] = null;
    this.mat[y * this.w + x] = null;
  }
  rgba() {
    const out = new Uint8Array(this.w * this.h * 4);
    this.col.forEach((c, i) => {
      if (!c) return;
      const n = parseInt(c.slice(1), 16);
      out[i * 4] = (n >> 16) & 255;
      out[i * 4 + 1] = (n >> 8) & 255;
      out[i * 4 + 2] = n & 255;
      out[i * 4 + 3] = 255;
    });
    return out;
  }
}

/** 左半边 → 左右对称的整行 */
export const mirror = (rows) => rows.map((r) => r + [...r].reverse().join(''));

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 把一层 ASCII 画到画布上。'.' 和空格是透明。
 * outline：这一层边界上的像素换成描边色（画布外不算边界，身子可以一直延伸到底）。
 * keep：这些字符即使在边界上也不描边。
 * only：只画在这些材质上面（比如眉毛只画在脸上）。
 */
export function draw(cv, rows, y0, pal, { mat = 'x', outline = null, keep = '', x0 = 0, only = null } = {}) {
  const pts = new Map();
  rows.forEach((r, j) => {
    [...r].forEach((ch, i) => {
      if (ch !== '.' && ch !== ' ') pts.set((y0 + j) * 1000 + (x0 + i), ch);
    });
  });
  for (const [k, ch] of pts) {
    const x = k % 1000;
    const y = Math.floor(k / 1000);
    if (only && !only.includes(cv.m(x, y))) continue;
    let c = pal[ch];
    if (c === undefined) throw new Error(`调色板里没有「${ch}」（${mat}）`);
    let m = mat;
    if (outline && !keep.includes(ch)) {
      const edge = N4.some(([dx, dy]) => cv.in(x + dx, y + dy) && !pts.has((y + dy) * 1000 + (x + dx)));
      if (edge) {
        c = outline;
        m = mat + '!';
      }
    }
    cv.put(x, y, c, m);
  }
}

/** 用每行的左边界生成一个左右对称的实心形状（右边界 = 47 - 左边界） */
export function shapeRows(left, ch = 's') {
  return left.map((l) => (l == null ? '' : '.'.repeat(l) + ch.repeat(W - 2 * l) + '.'.repeat(l)));
}

/** 放大 n 倍（预览用） */
export function scale(cv, n, bg = null) {
  const out = new Canvas(cv.w * n, cv.h * n);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const c = cv.get(Math.floor(x / n), Math.floor(y / n)) ?? bg;
      if (c) out.put(x, y, c, 'x');
    }
  }
  return out;
}

/** 把多张小图拼到一张大图上 */
export function sheet(cells, cols, cellW, cellH, bg) {
  const rows = Math.ceil(cells.length / cols);
  const out = new Canvas(cols * cellW, rows * cellH);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.put(x, y, bg, 'x');
  cells.forEach((cv, i) => {
    const ox = (i % cols) * cellW;
    const oy = Math.floor(i / cols) * cellH;
    for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
      const c = cv.get(x, y);
      if (c) out.put(ox + x, oy + y, c, 'x');
    }
  });
  return out;
}

/** 实心多边形（按像素中心判断） */
export function poly(cv, pts, color, mat, { only = null } = {}) {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = 0; x < cv.w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside && (!only || only.includes(cv.m(x, y)))) cv.put(x, y, color, mat);
    }
  }
}

/** 像素直线 */
export function line(cv, x0, y0, x1, y1, color, mat, { only = null } = {}) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!only || only.includes(cv.m(x0, y0))) cv.put(x0, y0, color, mat);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
