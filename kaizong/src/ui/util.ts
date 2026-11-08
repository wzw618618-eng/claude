export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const n0 = (x: number) => Math.round(x).toLocaleString('zh-CN');

/** 一条 0–100 的小横条 */
export function bar(v: number, tone: 'good' | 'bad' | 'gold' | 'info' = 'info', label = '') {
  return `<span class="bar ${tone}" title="${esc(label)}${Math.round(v)}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>`;
}

export function word(v: number, words: [number, string][]) {
  for (const [t, w] of words) if (v >= t) return w;
  return words[words.length - 1][1];
}
