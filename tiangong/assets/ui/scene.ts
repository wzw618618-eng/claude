// 驿站场景：把游戏状态画成一幅会动的像素剖面图。
// 左边是林子（砍柴、打猎），中间是驿站里面（灶台、桌子、火塘、草垫、上下铺），右边是门口和下山的路（守夜、搜寻、探路）。
// 白天每个人在自己的活计那里干活；傍晚和夜里大家回到火边坐着，守夜的提着灯站在门外。
// 柴火堆随柴火多少变高变矮，房梁上挂的肉随食物多少变化；营建好的东西会出现在画里；天色、雪和火光跟着时辰和天气变。
// 素材在 scene-atlas.ts（由 scripts/pixel/scene.mjs 生成）；坐标都是场景里的像素，核心区 130×72，屏幕更宽时两边多画些林子。

import type { CharState, GameState, TaskId } from '../hanyi/core/types';
import { act } from '../hanyi/core/world';
import { blocked } from '../hanyi/systems/work';
import { FRAMES } from './scene-atlas';

export const CORE_W = 130;
export const SCENE_H = 72;
const HX = 30;
const HY = 10;
const FLOOR = HY + 44;
const FIRE_X = HX + 28;

type Pose = 'stand' | 'walk' | 'work' | 'sit' | 'lie';
export interface Actor {
  id: string;
  /** 站着的人：脚底中心 x、脚底 y；躺着的人：左上角 */
  x: number;
  y: number;
  pose: Pose;
  tool?: 'axe' | 'hammer' | 'ladle' | 'bow' | 'lantern' | 'bandage' | 'pack';
  mark?: 'dots' | 'z' | 'bang';
  /** 走路：每秒走几格、走多远后回到起点 */
  walk?: [number, number];
  front?: boolean;
}

const SLOT: Record<string, [number, number][]> = {
  wood: [[7, 58], [24, 64], [-3, 63]],
  hunt: [[9, 71], [-3, 68], [21, 71]],
  scavenge: [[112, 64], [123, 67], [104, 69]],
  explore: [[100, 59], [106, 61]],
  guard: [[104, 58], [110, 59]],
  cook: [[39, 54], [34, 54]],
  comfort: [[49, 54], [54, 54]],
  care: [[66, 54], [88, 54]],
  build: [[47, 54], [52, 54]],
  seat: [[49, 54], [67, 54], [42, 54], [74, 54], [35, 54], [81, 54], [88, 54], [45, 57]],
};
const PATIENT: [number, number][] = [[69, 45], [76, 45]];
const BUNK: [number, number][] = [[81, 41], [81, 30]];
const BUILD_AT: Record<string, [number, number]> = {
  door: [47, 54], hearth: [50, 54], clinic: [76, 54], tower: [84, 17], smoke: [108, 58], radio: [49, 54], phone: [49, 54],
};

const effTask = (s: GameState, c: CharState): TaskId => (blocked(s, c, c.task) ? 'rest' : c.task);

/** 每个人在场景里的位置和动作（纯函数：同一个状态总是同一个布局） */
export function layout(s: GameState): Actor[] {
  const A = act(s);
  const out: Actor[] = [];
  const used: Record<string, number> = {};
  const take = (k: string) => {
    const list = SLOT[k];
    const i = used[k] ?? 0;
    used[k] = i + 1;
    return list[i % list.length].slice() as [number, number];
  };
  let patients = 0;
  let bunks = 0;
  const lieDown = (c: CharState, sick: boolean) => {
    if (sick && patients < PATIENT.length) {
      const [x, y] = PATIENT[patients++];
      out.push({ id: c.id, x, y, pose: 'lie', mark: 'z' });
      return true;
    }
    if (bunks < BUNK.length) {
      const [x, y] = BUNK[bunks++];
      out.push({ id: c.id, x, y, pose: 'lie', mark: 'z' });
      return true;
    }
    return false;
  };
  const gather = s.phase !== 'day';
  for (const c of A) {
    const ill = c.sick > 0 || c.injured > 0;
    if (gather) {
      if (c.sick > 0 && lieDown(c, true)) continue;
      if (c.task === 'guard' && !blocked(s, c, 'guard') && s.phase === 'night') {
        const [x, y] = take('guard');
        out.push({ id: c.id, x, y, pose: 'stand', tool: 'lantern' });
        continue;
      }
      const [x, y] = take('seat');
      const want = s.phase === 'night' && s.wants?.[c.id] && !s.wants[c.id].done;
      out.push({ id: c.id, x, y, pose: 'sit', mark: want ? 'dots' : undefined, front: y > FLOOR });
      continue;
    }
    const t = effTask(s, c);
    if (t === 'rest') {
      if (lieDown(c, ill)) continue;
      const [x, y] = take('seat');
      out.push({ id: c.id, x, y, pose: 'sit', mark: 'z' });
      continue;
    }
    if (t === 'build' && s.project) {
      const at = BUILD_AT[s.project.id] ?? SLOT.build[0];
      const n = used.build ?? 0;
      used.build = n + 1;
      out.push({ id: c.id, x: at[0] + n * 6, y: at[1], pose: 'work', tool: 'hammer' });
      continue;
    }
    const [x, y] = take(t);
    const a: Actor = { id: c.id, x, y, pose: 'stand' };
    if (t === 'wood') Object.assign(a, { pose: 'work', tool: 'axe' });
    if (t === 'hunt') Object.assign(a, { pose: 'stand', tool: 'bow' });
    if (t === 'scavenge') Object.assign(a, { pose: 'work', tool: 'pack' });
    if (t === 'explore') Object.assign(a, { pose: 'walk', walk: [6, 26] });
    if (t === 'guard') Object.assign(a, { pose: 'stand', tool: 'lantern' });
    if (t === 'cook') Object.assign(a, { pose: 'work', tool: 'ladle' });
    if (t === 'comfort') Object.assign(a, { pose: 'sit', mark: 'dots' });
    if (t === 'care') Object.assign(a, { pose: 'sit', tool: 'bandage' });
    if (y > FLOOR + 2) a.front = true;
    out.push(a);
  }
  return out;
}

// ───────────────── 画 ─────────────────

interface Flake { x: number; y: number; v: number; w: number; a: number }
interface Puff { x: number; y: number; r: number; a: number }

export interface SceneRuntime {
  flakes: Flake[];
  puffs: Puff[];
  lastPuff: number;
  /** 最近一次画出来的人（点击用），坐标是画布像素 */
  hits: { id: string; x: number; y: number; w: number; h: number }[];
  /** 光照图：傍晚和夜里先画一张「哪里亮」的图，再乘到画面上 */
  light?: HTMLCanvasElement;
}

export const newRuntime = (): SceneRuntime => ({
  flakes: Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), v: 0.15 + Math.random() * 0.25, w: Math.random() * 6.28, a: 0.4 + Math.random() * 0.6 })),
  puffs: [],
  lastPuff: 0,
  hits: [],
});

const SKY: Record<string, [string, string]> = {
  'day.clear': ['#79a3c8', '#cde0ea'],
  'day.snow': ['#8b9cab', '#c6cfd6'],
  'day.blizzard': ['#6c7884', '#9ea8b0'],
  evening: ['#3e3a5e', '#e39a72'],
  night: ['#070d1a', '#1a2840'],
};

/** 地平线：几层正弦叠出来的山（用世界坐标，屏幕宽窄变了山也不跳） */
const ridge = (x: number, k: number) => 0.5 * Math.sin(x * 0.07 + k) + 0.3 * Math.sin(x * 0.19 + k * 2.3) + 0.2 * Math.sin(x * 0.41 + k * 3.7);

function blit(g: CanvasRenderingContext2D, img: CanvasImageSource, name: string, x: number, y: number, flip = false) {
  const f = FRAMES[name];
  if (!f) return;
  const [sx, sy, w, h] = f;
  if (flip) {
    g.save();
    g.translate(Math.round(x) + w, Math.round(y));
    g.scale(-1, 1);
    g.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    g.restore();
  } else g.drawImage(img, sx, sy, w, h, Math.round(x), Math.round(y), w, h);
}

const TOOL_AT: Record<string, Record<string, [number, number]>> = {
  // 工具贴图相对小人左上角的位置：[x, y]
  axe: { work0: [6, 1], work1: [9, 10] },
  hammer: { work0: [7, 3], work1: [9, 11] },
  ladle: { work0: [8, 6], work1: [9, 11] },
  bow: { stand: [8, 7] },
  lantern: { stand: [8, 12] },
  bandage: { sit: [8, 13] },
  pack: { work0: [-3, 9], work1: [-3, 9] },
};

export function drawScene(g: CanvasRenderingContext2D, img: CanvasImageSource, s: GameState, W: number, t: number, rt: SceneRuntime) {
  const ox = Math.floor((W - CORE_W) / 2);
  const night = s.phase === 'night';
  const evening = s.phase === 'evening';
  const wk = s.weather.kind;
  const lit = s.res.wood > 0;
  g.imageSmoothingEnabled = false;
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;

  // 天
  const [top, bot] = night ? SKY.night : evening ? SKY.evening : SKY[`day.${wk}`];
  const sky = g.createLinearGradient(0, 0, 0, 56);
  sky.addColorStop(0, top);
  sky.addColorStop(1, bot);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, SCENE_H);
  if (night && wk !== 'blizzard') {
    for (let i = 0; i < 40; i++) {
      const sx = (i * 53 + 17) % W;
      const sy = (i * 29 + 5) % 34;
      const tw = Math.sin(t * 0.002 + i) > 0.6 ? 1 : 0.55;
      g.fillStyle = `rgba(230,236,255,${wk === 'snow' ? tw * 0.45 : tw})`;
      g.fillRect(sx, sy, 1, 1);
    }
  }
  if (!night && !evening && wk === 'clear') {
    g.fillStyle = '#fff4d8';
    g.fillRect(ox + 106, 7, 6, 6);
    g.fillRect(ox + 105, 8, 8, 4);
    g.fillRect(ox + 107, 6, 4, 8);
  }
  // 远山、近山
  const layers: [number, number, number, string, string][] = night
    ? [[36, 9, 1.3, '#16223a', '#5a6a86'], [46, 5, 4.1, '#0f1a2c', '#3e4c66']]
    : evening
      ? [[36, 9, 1.3, '#7a6a8a', '#e8c8c0'], [46, 5, 4.1, '#5a4e6a', '#c8a8a8']]
      : [[36, 9, 1.3, wk === 'clear' ? '#8fa6bc' : '#9aa6b2', '#eef3f6'], [46, 5, 4.1, wk === 'clear' ? '#6f879e' : '#7f8c98', '#dde6ec']];
  for (const [base, amp, k, col, cap] of layers) {
    for (let x = 0; x < W; x++) {
      const wx = x - ox;
      const h = Math.round(base - amp * (1 + ridge(wx, k)));
      g.fillStyle = col;
      g.fillRect(x, h, 1, 58 - h);
      g.fillStyle = cap;
      g.fillRect(x, h, 1, 2);
    }
  }
  // 远处的一排小松树
  for (let wx = -200; wx < W - ox + 20; wx += 9) {
    const j = Math.abs(Math.sin(wx * 12.9898) * 43758.5453) % 1;
    if (j < 0.35) continue;
    blit(g, img, 'pineS', ox + wx + Math.round(j * 5), 39 + Math.round(j * 3));
  }
  // 雪地
  g.fillStyle = night ? '#9aa8bc' : '#e6edf2';
  g.fillRect(0, 56, W, SCENE_H - 56);
  g.fillStyle = night ? '#8494aa' : '#d2dde5';
  for (let x = 0; x < W; x++) if ((x * 7 + Math.floor(x / 5)) % 11 === 0) g.fillRect(x, 58 + ((x * 3) % 9), 2, 1);
  // 下山的小路
  g.fillStyle = night ? '#8a98ae' : '#cfd9e1';
  for (let x = ox + 100; x < W; x++) g.fillRect(x, 58 + Math.round((x - ox - 100) * 0.12), 1, 2);
  // 近处的大松树
  for (const wx of [-30, -16, -6, 4, 126, 138, 150, 164, 178]) blit(g, img, 'pine', ox + wx, 31);
  for (let wx = -60; wx > -ox - 20; wx -= 13) blit(g, img, 'pine', ox + wx, 31);
  for (let wx = 192; wx < W - ox + 10; wx += 13) blit(g, img, 'pine', ox + wx, 31);
  // 翻车（搜寻的地方）
  blit(g, img, 'car', ox + 112, 49);
  // 柴火堆：柴火越多堆得越高
  const logs = Math.min(12, Math.ceil(s.res.wood / 2));
  for (let i = 0; i < logs; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    blit(g, img, 'log', ox + 17 + col * 4 + (row % 2) * 2, 52 - row * 3);
  }
  blit(g, img, 'block', ox + 13, 53);

  // 驿站
  blit(g, img, 'house', ox + HX, HY);
  // 房梁上挂的肉：食物越多挂得越多
  g.fillStyle = '#4e3624';
  g.fillRect(ox + HX + 4, HY + 17, 22, 1);
  const meat = Math.min(7, Math.ceil(s.res.food / 3));
  for (let i = 0; i < meat; i++) blit(g, img, 'meat', ox + HX + 5 + i * 3, HY + 18);
  // 营建好的
  const built = (id: string) => s.built.includes(id);
  if (built('door')) blit(g, img, 'boards', ox + HX + 12, HY + 19);
  if (built('hearth')) blit(g, img, 'hearth', ox + HX + 21, HY + 37);
  if (built('clinic')) blit(g, img, 'curtain', ox + HX + 38, HY + 25);
  if (built('tower')) blit(g, img, 'tower', ox + HX + 47, HY - 8);
  if (built('radio')) { blit(g, img, 'antenna', ox + HX + 23, HY - 11); blit(g, img, 'radio', ox + HX + 15, HY + 31); }
  if (built('phone')) blit(g, img, 'phone', ox + HX + 19, HY + 31);
  if (built('smoke')) {
    blit(g, img, 'rack', ox + 100, 42);
    for (let i = 0; i < Math.min(4, Math.ceil(s.res.food / 4)); i++) blit(g, img, 'meat', ox + 102 + i * 3, 45);
  }
  if (s.project) {
    const [bx, by] = BUILD_AT[s.project.id] ?? SLOT.build[0];
    blit(g, img, 'scaffold', ox + bx - 15, by - 6);
  }
  // 火塘里的火
  const fx = ox + FIRE_X - 4;
  if (lit) {
    blit(g, img, `fire${Math.floor(t / 140) % 3}`, fx, HY + 33);
    blit(g, img, 'firelogs', fx, HY + 41);
  } else blit(g, img, 'embers', fx, HY + 40);
  // 灶台的锅冒热气（有人掌勺时）

  // 人
  const actors = layout(s);
  const hits: SceneRuntime['hits'] = [];
  const order = actors.slice().sort((a, b) => (a.pose === 'lie' ? 0 : 1) - (b.pose === 'lie' ? 0 : 1) || a.y - b.y);
  const phase = (id: string) => [...id].reduce((h, ch) => h + ch.charCodeAt(0), 0) * 97;
  for (const a of order) {
    const ph = phase(a.id);
    if (a.pose === 'lie') {
      blit(g, img, `${a.id}.lie`, ox + a.x, a.y);
      hits.push({ id: a.id, x: ox + a.x, y: a.y, w: 17, h: 9 });
      if (a.mark === 'z' && Math.floor((t + ph) / 900) % 2 === 0) blit(g, img, 'tool.z', ox + a.x + 5, a.y - 6 - (Math.floor((t + ph) / 300) % 2));
      continue;
    }
    let cx = a.x;
    let frame: string = a.pose;
    if (a.pose === 'walk' && a.walk) {
      // 沿着下山的路一直走到画面边上，再从门口重新出发
      const [speed, minRange] = a.walk;
      const range = Math.max(minRange, W - ox - a.x + 8);
      cx = a.x + (((t + ph) / 1000) * speed) % range;
      frame = Math.floor((t + ph) / 220) % 2 ? 'walk1' : 'walk0';
    } else if (a.pose === 'work') {
      frame = Math.floor((t + ph) / 380) % 2 ? 'work1' : 'work0';
    }
    const sx = ox + Math.round(cx) - 6;
    const sy = a.y - 17;
    if (a.tool === 'pack') blit(g, img, 'tool.pack', sx - 3, sy + 9);
    blit(g, img, `${a.id}.${frame}`, sx, sy);
    hits.push({ id: a.id, x: sx, y: sy, w: 12, h: 18 });
    if (a.tool && a.tool !== 'pack') {
      const at = TOOL_AT[a.tool]?.[frame];
      const name = a.tool === 'axe' || a.tool === 'hammer' || a.tool === 'ladle' ? `tool.${a.tool}${frame === 'work0' ? 0 : 1}` : a.tool === 'lantern' ? `tool.${night || evening ? 'lantern' : 'lanternOff'}` : `tool.${a.tool}`;
      if (at) blit(g, img, name, sx + at[0], sy + at[1] + (a.id === 'man' ? 2 : 0));
    }
    if (a.tool === 'ladle' && Math.floor((t + ph) / 500) % 2) blit(g, img, 'tool.steam', ox + HX + 7, HY + 24);
    if (a.mark === 'dots' && Math.floor((t + ph) / 700) % 3 !== 2) blit(g, img, 'tool.dots', sx + 6, sy - 4);
    if (a.mark === 'z' && Math.floor((t + ph) / 900) % 2 === 0) blit(g, img, 'tool.z', sx + 7, sy - 3);
  }
  rt.hits = hits;

  // 炊烟：有柴烧的时候，从灶台的烟囱冒出来
  const wind = wk === 'blizzard' ? 0.5 : wk === 'snow' ? 0.15 : 0.06;
  if (lit && t - rt.lastPuff > 380) {
    rt.puffs.push({ x: ox + HX + 12, y: HY + 2, r: 1, a: 0.75 });
    rt.lastPuff = t;
  }
  for (const p of rt.puffs) {
    p.y -= 0.12;
    p.x += wind + 0.04;
    p.r = Math.min(4, p.r + 0.03);
    p.a -= 0.006;
  }
  rt.puffs = rt.puffs.filter((p) => p.a > 0 && p.y > -6);
  for (const p of rt.puffs) {
    g.fillStyle = night ? `rgba(120,130,150,${p.a * 0.6})` : `rgba(235,238,242,${p.a})`;
    const r = Math.round(p.r);
    g.fillRect(Math.round(p.x - r / 2), Math.round(p.y - r / 2), r, r);
  }

  // 光：先画一张光照图（底色是夜色或暮色，火塘和灯的位置是暖光），再用正片叠底乘到画面上。
  // 这样离火近的地方保留原本的颜色，远处沉进夜色里，不会像直接叠加亮光那样发灰。
  if (evening || night) {
    if (!rt.light || rt.light.width !== W) {
      rt.light = (g.canvas as HTMLCanvasElement).ownerDocument.createElement('canvas');
      rt.light.width = W;
      rt.light.height = SCENE_H;
    }
    const l = rt.light.getContext('2d')!;
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = night ? '#2c3760' : '#e8b48c';
    l.fillRect(0, 0, W, SCENE_H);
    l.globalCompositeOperation = 'lighter';
    const glow = (x: number, y: number, r: number, col: string) => {
      const gr = l.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = gr;
      l.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const flick = Math.sin(t / 150) * 1.5 + Math.sin(t / 61) * 0.8;
    if (lit) {
      // 屋里整体被火照着，火塘附近最亮；门口漏出去一点
      l.fillStyle = night ? 'rgba(150,90,50,0.55)' : 'rgba(60,40,20,0.4)';
      l.fillRect(ox + HX + 3, HY + 15, 64, 32);
      glow(ox + FIRE_X, HY + 40, 46 + flick, night ? 'rgba(230,170,110,1)' : 'rgba(40,30,20,0.6)');
      glow(ox + HX + 69, HY + 46, 16, night ? 'rgba(120,80,40,0.7)' : 'rgba(0,0,0,0)');
    } else glow(ox + FIRE_X, HY + 42, 14, 'rgba(140,50,30,0.8)');
    if (night) for (const a of actors) if (a.tool === 'lantern') glow(ox + a.x + 4, a.y - 3, 16 + flick, 'rgba(220,170,90,0.9)');
    g.globalCompositeOperation = 'multiply';
    g.drawImage(rt.light, 0, 0);
    g.globalCompositeOperation = 'source-over';
  } else if (!lit) {
    // 白天没柴：屋里冷冰冰的
    g.fillStyle = 'rgba(120,160,220,0.12)';
    g.fillRect(ox + HX + 3, HY + 14, 64, 31);
  }

  // 雪
  const n = wk === 'blizzard' ? 140 : wk === 'snow' ? 60 : 10;
  const drift = wk === 'blizzard' ? 0.9 : wk === 'snow' ? 0.2 : 0.05;
  g.fillStyle = night ? '#c8d2e4' : '#ffffff';
  for (let i = 0; i < n; i++) {
    const f = rt.flakes[i];
    f.y += f.v * (wk === 'blizzard' ? 1.8 : 1) / SCENE_H;
    f.x += (drift + Math.sin(f.w) * 0.15) / W;
    f.w += 0.03;
    if (f.y > 1) { f.y = 0; f.x = Math.random(); }
    if (f.x > 1) f.x -= 1;
    g.globalAlpha = f.a * (night ? 0.7 : 0.9);
    g.fillRect(Math.floor(f.x * W), Math.floor(f.y * SCENE_H), 1, 1);
  }
  g.globalAlpha = 1;
}

/** 点到了谁（画布像素坐标） */
export function hitTest(rt: SceneRuntime, x: number, y: number) {
  for (let i = rt.hits.length - 1; i >= 0; i--) {
    const h = rt.hits[i];
    if (x >= h.x + 1 && x < h.x + h.w - 1 && y >= h.y + 1 && y < h.y + h.h) return h.id;
  }
  return null;
}
