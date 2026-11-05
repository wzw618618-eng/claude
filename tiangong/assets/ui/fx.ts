// 画面反馈：每次重画之后，对比上一次的状态，补上动起来的东西。
// - 像素雪：页面里所有 canvas[data-snow] 都会下雪，雪花位置跨重画保留，不会一点就跳；
// - 过场：傍晚 / 入夜 / 新的一天，屏幕中间闪过一张大字卡；
// - 跳数字：资源有增减时，从日头上的数字旁边飘出 +3 / −2；聊天涨了信任，从人像旁飘出来；
// - 人物反应：派了活、心情变了，人像跳一下；
// - 教学：给提示指着的那个东西加高亮，并滚到能看见的地方；
// - 对应的声音。

import type { GameState } from '../hanyi/core/types';
import type { Sound } from './audio';
import { dayCard, type UI } from './view';

interface Snap {
  screen: string;
  seed: number;
  day: number;
  phase: string;
  res: Record<string, number>;
  chars: Record<string, { task: string; tier: number; trust: number; status: string }>;
  pending: string;
  outcome: boolean;
  heard: number;
  them: number;
  tip: string;
}

interface Flake { x: number; y: number; v: number; w: number; s: number; a: number }

const tierOf = (m: number) => (m >= 60 ? 0 : m >= 30 ? 1 : 2);

function take(s: GameState | null, ui: UI, tip: string): Snap {
  const chars: Snap['chars'] = {};
  for (const c of s?.chars ?? []) chars[c.id] = { task: c.task, tier: tierOf(c.mood), trust: c.trust, status: c.status };
  return {
    screen: ui.screen === 'title' || !s ? 'title' : 'game',
    seed: s?.seed ?? 0,
    day: s?.day ?? 0,
    phase: s?.phase ?? 'title',
    res: { ...(s?.res ?? {}) },
    chars,
    pending: s?.pending[0] ? `${s.pending[0].id}:${s.pending.length}` : '',
    outcome: !!ui.outcome,
    heard: s ? Object.keys(s.flags).filter((k) => k.startsWith('heard_') && s.flags[k]).length : 0,
    them: s ? Object.values(s.chat).reduce((n, log) => n + log.filter((m) => m.from === 'them').length, 0) : 0,
    tip,
  };
}

export interface Fx {
  after(s: GameState | null, ui: UI): void;
  dispose(): void;
}

export function createFx(app: HTMLElement, layer: HTMLElement, win: Window | null, sound: Sound): Fx {
  const doc = app.ownerDocument;
  let prev: Snap | null = null;
  let raf = 0;
  const flakes = new Map<string, Flake[]>();
  const timers = new Set<number>();
  const still = !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const later = (ms: number, fn: () => void) => {
    if (!win) return fn();
    const id = win.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };
  const spawn = (cls: string, html: string, ms: number) => {
    const el = doc.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    layer.append(el);
    later(ms, () => el.remove());
    return el;
  };

  // ───── 过场大字卡 ─────
  function card(to: string, title: string, sub: string) {
    layer.querySelectorAll('.phase-card').forEach((el) => el.remove());
    spawn(`phase-card to-${to}`, `<div><b>${title}</b><span>${sub}</span></div>`, still ? 900 : 1900);
  }

  // ───── 飘字 ─────
  function float(target: Element | null, text: string, cls: string, delay = 0) {
    if (!target) return;
    later(delay, () => {
      const r = target.getBoundingClientRect();
      if (!r.width) return;
      const el = spawn(`float ${cls}`, text, 1500);
      el.style.left = `${r.left + r.width / 2}px`;
      el.style.top = `${r.top + r.height * 0.3}px`;
    });
  }
  const bump = (el: Element | null, cls: string) => {
    if (!el) return;
    el.classList.remove(cls);
    void (el as HTMLElement).offsetWidth;
    el.classList.add(cls);
  };

  function compare(a: Snap, b: Snap, s: GameState) {
    let moved = false;
    if (b.phase !== a.phase || b.day !== a.day) {
      moved = true;
      if (b.phase === 'evening') { card('evening', '傍晚', '收工了'); sound.play('dusk'); }
      else if (b.phase === 'night') { card('night', '入夜', '围炉夜话'); sound.play('night'); }
      else if (b.phase === 'day') { const d = dayCard(s); card('day', d.title, d.sub); sound.play('dawn'); }
    }
    // 资源
    let i = 0;
    for (const k of Object.keys(b.res)) {
      const d = (b.res[k] ?? 0) - (a.res[k] ?? 0);
      if (!d) continue;
      const cap = app.querySelector(`[data-res="${k}"]`);
      float(cap, `${d > 0 ? '+' : '−'}${Math.abs(d)}`, d > 0 ? 'pos' : 'neg', (moved ? 450 : 0) + i++ * 90);
      bump(cap, 'bump');
    }
    // 人
    for (const [id, c] of Object.entries(b.chars)) {
      const o = a.chars[id];
      if (!o || c.status !== 'active') continue;
      const face = app.querySelector(`.card[data-id="${id}"] .pt`);
      if (c.task !== o.task || c.tier !== o.tier) bump(face, 'hop');
      const dt = c.trust - o.trust;
      if (dt) {
        const fig = app.querySelector(`.chat-vn .vn-stage figure`) ?? app.querySelector(`.card[data-id="${id}"] .card-face`);
        float(fig, `${dt > 0 ? '♥ 信任 +' : '信任 −'}${Math.abs(dt)}`, dt > 0 ? 'trust' : 'neg', 250);
      }
    }
    // 声音
    const delay = moved ? 650 : 0;
    if (b.pending && b.pending !== a.pending) later(delay, () => sound.play('event'));
    else if (b.outcome && !a.outcome) sound.play('good');
    if (b.heard > a.heard) later(300, () => sound.play('secret'));
    else if (b.them > a.them) sound.play('talk');
  }

  // ───── 教学高亮 ─────
  function coach(tip: string, changed: boolean) {
    const box = app.querySelector<HTMLElement>('.coach[data-target]');
    if (!box) return;
    const target = app.querySelector<HTMLElement>(box.dataset.target!);
    if (!target) return;
    target.classList.add('coach-target');
    if (!changed || !win) return;
    const r = target.getBoundingClientRect();
    const boxTop = box.getBoundingClientRect().top;
    if (r.top < 70 || r.bottom > boxTop - 8) target.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    void tip;
  }

  // ───── 像素雪 ─────
  const makeFlakes = (n: number): Flake[] =>
    Array.from({ length: n }, () => ({
      x: Math.random(), y: Math.random(), v: 0.0012 + Math.random() * 0.003, w: Math.random() * 6.28,
      s: Math.random() < 0.25 ? 2 : 1, a: 0.35 + Math.random() * 0.6,
    }));

  function drawSnow(cv: HTMLCanvasElement) {
    const key = cv.dataset.snow ?? 'x';
    const n = Number(cv.dataset.n ?? 40);
    const wind = Number(cv.dataset.wind ?? 0);
    let fl = flakes.get(key);
    if (!fl || fl.length !== n) {
      fl = makeFlakes(n);
      flakes.set(key, fl);
    }
    const w = Math.max(1, Math.round(cv.clientWidth / 3));
    const h = Math.max(1, Math.round(cv.clientHeight / 3));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = cv.dataset.color ?? '#eef2f5';
    for (const f of fl) {
      if (!still) {
        f.y += f.v * (1 + wind * 0.6);
        f.w += 0.03;
        f.x += wind * 0.0025 + Math.sin(f.w) * 0.0006;
        if (f.y > 1.03) { f.y = -0.03; f.x = Math.random(); }
        if (f.x > 1.03) f.x -= 1.06;
        if (f.x < -0.03) f.x += 1.06;
      }
      g.globalAlpha = f.a;
      g.fillRect(Math.floor(f.x * w), Math.floor(f.y * h), f.s, f.s);
    }
    g.globalAlpha = 1;
  }

  function loop() {
    raf = 0;
    const cvs = app.querySelectorAll<HTMLCanvasElement>('canvas[data-snow]');
    if (!cvs.length) return;
    cvs.forEach(drawSnow);
    if (!still && win) raf = win.requestAnimationFrame(loop);
  }

  return {
    after(s, ui) {
      const box = app.querySelector<HTMLElement>('.coach');
      const snap = take(s, ui, box?.dataset.tip ?? '');
      sound.scene({ phase: snap.screen === 'title' ? 'title' : (snap.phase as 'day'), weather: s?.weather.kind ?? 'snow' });
      if (s && prev && snap.screen === 'game') {
        if (prev.screen === 'title' || prev.seed !== snap.seed) {
          if (s.phase === 'day') { const d = dayCard(s); card('day', d.title, d.sub); }
          sound.play('dawn');
        } else compare(prev, snap, s);
      }
      coach(snap.tip, snap.tip !== prev?.tip);
      prev = snap;
      if (!raf) loop();
    },
    dispose() {
      if (raf && win) win.cancelAnimationFrame(raf);
      for (const id of timers) win?.clearTimeout(id);
      layer.replaceChildren();
    },
  };
}
