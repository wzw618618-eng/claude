// 横屏：游戏一律横着摆。手机竖着拿（或者开了方向锁）时，把整个游戏转 90 度，横过手机就是正的。
// 转过之后，手指在屏幕上的滑动方向和页面里的上下对不上，所以转着的时候由这里接管滚动。

let rotated = false;
export const isRotated = () => rotated;

/** 量出游戏实际能用的宽高（转过的话宽高对调），写到 #app 上 */
export function setupOrientation(app: HTMLElement, onResize: () => void) {
  const fit = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    rotated = touch && vh > vw * 1.05;
    const W = rotated ? vh : vw;
    const H = rotated ? vw : vh;
    const root = document.documentElement;
    root.classList.toggle('rot', rotated);
    app.style.width = `${W}px`;
    app.style.height = `${H}px`;
    app.style.transform = rotated ? `translateX(${vw}px) rotate(90deg)` : '';
    root.style.setProperty('--app-w', `${W}px`);
    root.style.setProperty('--app-h', `${H}px`);
    onResize();
  };
  addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 120));
  window.visualViewport?.addEventListener('resize', fit);
  fit();
  rotatedScroll(app);
}

/** 找手指下面能滚的那一层 */
function scroller(el: Element | null, app: HTMLElement): HTMLElement | null {
  for (let e = el as HTMLElement | null; e && e !== app; e = e.parentElement) {
    const cs = getComputedStyle(e);
    const y = /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
    const x = /(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
    if (x || y) return e;
  }
  return null;
}

/**
 * 转过 90 度时：屏幕上往右划 = 游戏里往上划。手指动多少，就把那一层滚多少，松手后带一点惯性。
 * 游戏里的点 (x, y) 在屏幕上是 (屏宽 − y, x)，所以游戏里的 dy = −屏幕 dx，dx = 屏幕 dy。
 */
function rotatedScroll(app: HTMLElement) {
  let el: HTMLElement | null = null;
  let lx = 0, ly = 0, vx = 0, vy = 0, lt = 0, moved = 0;
  let raf = 0;
  app.addEventListener('touchstart', (e) => {
    if (!rotated || e.touches.length !== 1) { el = null; return; }
    cancelAnimationFrame(raf);
    const t = e.touches[0];
    el = scroller(e.target as Element, app);
    lx = t.clientX; ly = t.clientY; vx = vy = 0; lt = performance.now(); moved = 0;
  }, { passive: true });
  app.addEventListener('touchmove', (e) => {
    if (!rotated || !el) return;
    const t = e.touches[0];
    const dx = t.clientX - lx, dy = t.clientY - ly;
    lx = t.clientX; ly = t.clientY;
    const now = performance.now();
    const dt = Math.max(1, now - lt);
    lt = now;
    // 游戏里往上划（dy 为负）= 内容往下滚
    el.scrollTop += dx;
    el.scrollLeft -= dy;
    vy = dx / dt; vx = -dy / dt;
    moved += Math.abs(dx) + Math.abs(dy);
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  app.addEventListener('touchend', () => {
    if (!rotated || !el) return;
    const target = el;
    el = null;
    if (moved < 6) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      target.scrollTop += vy * dt;
      target.scrollLeft += vx * dt;
      vy *= 0.94; vx *= 0.94;
      if (Math.abs(vy) + Math.abs(vx) > 0.02) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }, { passive: true });
}

/** 安卓上点"开始"时顺手进全屏、锁横屏（苹果不支持就算了） */
export async function tryFullscreenLandscape() {
  try {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement && matchMedia('(pointer: coarse)').matches) await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o?.lock?.('landscape');
  } catch { /* 不支持就靠转 90 度 */ }
}
