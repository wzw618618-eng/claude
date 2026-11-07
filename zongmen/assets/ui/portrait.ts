// 头像：取角色体素模型的正面投影（头和肩），画成像素小图，和场景里的模型一模一样。

import { GAME_DATA } from '../game/data/bundle.gen';
import { characterModel, ELDER_LOOK, lookOf } from '../scene/models';

export interface PixelGrid {
  width: number;
  height: number;
  /** 行优先，从上到下；undefined 表示透明 */
  pixels: Array<string | undefined>;
}

/** 正面投影：同一 (x,y) 取最靠前（z 最大）的体素 */
export function portraitGrid(id: string, rows = 11): PixelGrid {
  const look = id === 'elder' ? ELDER_LOOK : lookOf(GAME_DATA.characters.find((c) => c.id === id)!);
  const model = characterModel(look);
  const front = new Map<string, { z: number; color: string }>();
  let maxY = -Infinity;
  for (const [k, v] of model.cells) {
    const [x, y, z] = k.split(',').map(Number);
    maxY = Math.max(maxY, y);
    const key = `${x},${y}`;
    const cur = front.get(key);
    if (!cur || z > cur.z) front.set(key, { z, color: v.color });
  }
  const x0 = -1;
  const width = 10;
  const pixels: Array<string | undefined> = [];
  for (let row = 0; row < rows; row++) {
    const y = maxY - row;
    for (let x = x0; x < x0 + width; x++) pixels.push(front.get(`${x},${y}`)?.color);
  }
  return { width, height: rows, pixels };
}

const cache = new Map<string, string>();

/** 生成头像的 data URL（浏览器里调用） */
export function portraitUrl(doc: Document, id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const grid = portraitGrid(id);
  const scale = 6;
  const canvas = doc.createElement('canvas');
  canvas.width = grid.width * scale;
  canvas.height = grid.height * scale;
  const g = canvas.getContext('2d');
  if (!g) return '';
  grid.pixels.forEach((c, i) => {
    if (!c) return;
    g.fillStyle = c;
    g.fillRect((i % grid.width) * scale, Math.floor(i / grid.width) * scale, scale, scale);
  });
  const url = canvas.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
