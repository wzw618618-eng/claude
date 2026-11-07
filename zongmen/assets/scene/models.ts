// 体素美术：8 名弟子、严长老、各处建筑和摆设、地面。全部程序生成。
// 弟子的外袍颜色、身高、草鞋和随身物与 data/characters.json 的特征一致：玩家看外观就能推理。

import { createRng } from '../game/core/rng';
import type { CharacterData, LocationId } from '../game/data/types';
import { VoxelModel, type Hex } from './voxel';
import { HALL_POS, LOCATION_POS } from './layout';

// ---------- 调色板（夜色里偏饱和，靠灯笼和月光照亮） ----------
export const PAL = {
  skin: '#f0c8a0',
  skinShade: '#e0b088',
  eye: '#1b1b22',
  mouth: '#b4544c',
  blush: '#f2a0a0',
  hair: '#1e1a1c',
  white: '#f4f1e8',
  robe: { robe_qing: '#3c8a80', robe_bai: '#e9e5da', robe_hui: '#868a90' } as Record<string, Hex>,
  robeTrim: { robe_qing: '#2a645d', robe_bai: '#c9c2b1', robe_hui: '#62666c' } as Record<string, Hex>,
  inner: '#efe6d2',
  boots: '#2a2420',
  straw: '#cfa860',
  strawDark: '#9c7a3e',
  jade: '#6fd39a',
  gold: '#e2b23a',
  bell: '#d9a72a',
  sachet: '#ef8fb4',
  bamboo: '#a9c95c',
  bambooDark: '#7f9c3c',
  wood: '#7a4a2a',
  woodDark: '#4e2e1c',
  pillar: '#8e2f25',
  plaster: '#c9b896',
  paper: '#e6d6a8',
  roof: '#2c3a4c',
  roofRidge: '#45566c',
  stone: '#8a8c90',
  stoneDark: '#6c6e74',
  bronze: '#9a7440',
  bronzeDark: '#6b4e2a',
  fire: '#ff8c32',
  lantern: '#ffbe55',
  lanternRed: '#ff6a3d',
  grass: '#33503f',
  grass2: '#2d4838',
  grass3: '#3a5a44',
  mud: '#5a4838',
  puddle: '#3c4c5e',
  leaf: '#4f8a3e',
  leafDark: '#3e7032',
  pine: '#2f5e3e',
  trunk: '#5a3a24',
  rock: '#77797f',
} as const;

// ---------- 角色 ----------

interface CharacterLook {
  robe: Hex;
  trim: Hex;
  height: 'tall' | 'normal' | 'short';
  sandals: boolean;
  item?: 'jade' | 'bell' | 'bamboo_sword' | 'sachet';
  hair: string;
  accent: Hex;
  beard?: boolean;
}

export function lookOf(c: CharacterData): CharacterLook {
  const robeTrait = c.traits.find((t) => t.startsWith('robe_'))!;
  const item = c.traits.find((t) => ['jade', 'bell', 'bamboo_sword', 'sachet'].includes(t)) as CharacterLook['item'];
  return {
    robe: PAL.robe[robeTrait],
    trim: PAL.robeTrim[robeTrait],
    height: c.traits.includes('tall') ? 'tall' : c.look.height === 'short' ? 'short' : 'normal',
    sandals: c.traits.includes('straw'),
    item,
    hair: c.look.hair,
    accent: c.look.accent,
  };
}

export const ELDER_LOOK: CharacterLook = {
  robe: '#5b4a3a',
  trim: '#3f3226',
  height: 'normal',
  sandals: false,
  hair: '白发道髻',
  accent: '#c9a03a',
  beard: true,
};

/** 角色模型：宽 8（x 0..7）、深 6（z 0..5，+z 朝前）、Q 版大头 */
export function characterModel(look: CharacterLook): VoxelModel {
  const m = new VoxelModel();
  const leg = look.height === 'tall' ? 5 : look.height === 'short' ? 3 : 4;
  const body = look.height === 'tall' ? 5 : 4;
  // 鞋
  const shoe = look.sandals ? PAL.straw : PAL.boots;
  for (const x0 of [1, 5]) {
    m.box(x0, 0, 1, x0 + 1, 0, 4, shoe);
    if (look.sandals) m.box(x0, 0, 3, x0 + 1, 0, 3, PAL.strawDark); // 草鞋的绑带
  }
  // 下摆
  m.box(1, 1, 1, 6, leg, 4, look.robe);
  m.box(1, 1, 1, 6, 1, 4, look.trim);
  // 腰带
  const belt = leg + 1;
  m.box(1, belt, 1, 6, belt, 4, look.accent);
  // 上身
  const top = belt + body;
  m.box(1, belt + 1, 1, 6, top, 4, look.robe);
  m.box(3, top - 1, 4, 4, top, 4, PAL.inner); // 交领
  m.box(2, top, 4, 2, top, 4, look.trim);
  m.box(5, top, 4, 5, top, 4, look.trim);
  // 袖子和手
  for (const x of [0, 7]) {
    m.box(x, belt, 1, x, top, 4, look.robe);
    m.box(x, belt, 2, x, belt, 3, PAL.skin);
    m.box(x, top, 1, x, top, 4, look.trim);
  }
  // 头
  const h0 = top + 1;
  m.box(1, h0, 0, 6, h0 + 5, 4, PAL.skin);
  m.box(1, h0, 0, 6, h0, 4, PAL.skinShade);
  // 眼睛、嘴、腮红（脸在 z=4 那一面）
  m.set(2, h0 + 2, 4, PAL.eye).set(5, h0 + 2, 4, PAL.eye);
  m.set(2, h0 + 3, 4, PAL.eye).set(5, h0 + 3, 4, PAL.eye);
  m.set(3, h0 + 1, 4, PAL.mouth).set(4, h0 + 1, 4, PAL.mouth);
  m.set(1, h0 + 1, 4, PAL.blush).set(6, h0 + 1, 4, PAL.blush);
  // 头发：顶上和后脑
  const hairColor = look.beard ? PAL.white : PAL.hair;
  m.box(1, h0 + 5, 0, 6, h0 + 5, 4, hairColor);
  m.box(1, h0 + 1, 0, 6, h0 + 5, 0, hairColor);
  m.box(1, h0 + 4, 1, 1, h0 + 5, 3, hairColor);
  m.box(6, h0 + 4, 1, 6, h0 + 5, 3, hairColor);
  m.box(2, h0 + 5, 4, 5, h0 + 5, 4, hairColor); // 刘海
  hairStyle(m, look, h0, hairColor);
  if (look.beard) {
    m.box(2, h0 - 2, 5, 5, h0 + 1, 5, PAL.white);
    m.box(3, h0 - 3, 5, 4, h0 - 3, 5, PAL.white);
    m.remove(3, h0 + 1, 4).remove(4, h0 + 1, 4);
    m.box(2, h0 + 4, 5, 5, h0 + 4, 5, PAL.white); // 白眉
  }
  // 随身物（挂在腰前或背后）
  if (look.item === 'jade') {
    m.set(2, belt - 1, 5, PAL.jade).set(2, belt - 2, 5, PAL.jade).set(2, belt, 5, look.accent);
  } else if (look.item === 'bell') {
    m.set(5, belt - 1, 5, PAL.bell).set(5, belt - 2, 5, PAL.bell).set(5, belt, 5, look.accent);
  } else if (look.item === 'sachet') {
    m.set(5, belt - 1, 5, PAL.sachet).set(5, belt - 2, 5, PAL.sachet).set(4, belt - 1, 5, PAL.sachet).set(5, belt, 5, look.accent);
  } else if (look.item === 'bamboo_sword') {
    // 斜背在身后
    for (let i = 0; i < 9; i++) m.set(1 + Math.floor(i * 0.7), belt - 1 + i, -1, i < 2 ? PAL.woodDark : i % 3 === 0 ? PAL.bambooDark : PAL.bamboo);
  }
  return m;
}

function hairStyle(m: VoxelModel, look: CharacterLook, h0: number, c: Hex): void {
  const top = h0 + 6;
  switch (look.hair) {
    case '束发高冠':
      m.box(3, top, 1, 4, top + 1, 2, c);
      m.box(3, top + 2, 1, 4, top + 2, 2, PAL.gold);
      break;
    case '散发半束':
      m.box(2, h0 - 2, -1, 5, h0 + 4, -1, c);
      m.box(3, top, 1, 4, top, 2, c);
      break;
    case '高马尾':
      m.box(3, top, 1, 4, top, 1, c);
      m.box(3, h0 + 1, -1, 4, top, -1, c);
      m.box(3, h0 - 1, -2, 4, h0 + 1, -2, c);
      m.set(3, top, 2, look.accent);
      break;
    case '双髻':
      m.box(1, top, 1, 2, top + 1, 2, c);
      m.box(5, top, 1, 6, top + 1, 2, c);
      m.set(1, top, 3, look.accent).set(6, top, 3, look.accent);
      break;
    case '低髻插木簪':
      m.box(2, h0 + 2, -1, 5, h0 + 4, -1, c);
      m.box(1, h0 + 3, -2, 6, h0 + 3, -2, PAL.wood);
      break;
    case '玉冠束发':
      m.box(3, top, 1, 4, top + 1, 2, c);
      m.box(2, top + 1, 1, 5, top + 1, 2, PAL.jade);
      break;
    case '短发包头巾':
      m.box(1, h0 + 5, 0, 6, h0 + 5, 4, look.accent);
      m.box(1, h0 + 4, 4, 6, h0 + 4, 4, look.accent);
      m.box(3, top, 0, 4, top, 1, look.accent);
      break;
    case '圆髻戴珠花':
      m.box(2, top, 1, 5, top + 1, 3, c);
      m.set(5, top + 1, 3, PAL.sachet).set(2, top + 1, 3, PAL.gold);
      break;
    case '白发道髻':
      m.box(3, top, 1, 4, top + 1, 2, c);
      m.set(3, top + 1, 3, PAL.wood).set(4, top + 1, 3, PAL.wood);
      break;
    default:
      m.box(3, top, 1, 4, top, 2, c);
  }
}

/** 角色总高（体素格数），用来放头顶的情绪图标 */
export function characterHeight(look: CharacterLook): number {
  const { max } = characterModel(look).bounds();
  return max[1] + 1;
}

// ---------- 建筑与摆设（体素 0.25 米） ----------

interface PavilionOpts {
  w: number;
  d: number;
  wall: number;
  roofLayers: number;
  doors?: number;
  litWindows?: number[];
  wallColor?: Hex;
}

/** 通用的中式屋子：台基、柱子、墙、门窗、层叠屋顶和起翘的檐角 */
export function pavilion(o: PavilionOpts): VoxelModel {
  const m = new VoxelModel();
  const { w, d, wall } = o;
  // 台基
  m.box(-1, 0, -1, w, 0, d, (x, _y, z) => ((x + z) % 2 ? PAL.stone : PAL.stoneDark));
  // 墙
  m.box(0, 1, 0, w - 1, wall, d - 1, o.wallColor ?? PAL.plaster);
  // 柱子
  for (let x = 0; x < w; x += 4) {
    m.box(x, 1, d - 1, x, wall, d - 1, PAL.pillar);
    m.box(x, 1, 0, x, wall, 0, PAL.pillar);
  }
  m.box(w - 1, 1, d - 1, w - 1, wall, d - 1, PAL.pillar);
  m.box(w - 1, 1, 0, w - 1, wall, 0, PAL.pillar);
  // 门窗（正面 z=d-1）
  const doors = o.doors ?? 1;
  const span = w / doors;
  for (let i = 0; i < doors; i++) {
    const cx = Math.floor(span * i + span / 2);
    m.box(cx - 1, 1, d - 1, cx, Math.min(wall - 1, 5), d - 1, PAL.woodDark);
    const lit = o.litWindows?.includes(i);
    const wx = cx + 2 < w - 1 ? cx + 2 : cx - 3;
    m.box(wx, 3, d - 1, wx, 4, d - 1, lit ? PAL.lantern : PAL.paper, !!lit);
  }
  // 屋檐横梁
  m.box(-1, wall + 1, -1, w, wall + 1, d, PAL.woodDark);
  // 层叠屋顶
  for (let i = 0; i < o.roofLayers; i++) {
    const y = wall + 2 + i;
    const inset = i;
    m.box(-2 + inset, y, -2 + inset, w + 1 - inset, y, d + 1 - inset, i === o.roofLayers - 1 ? PAL.roofRidge : PAL.roof);
  }
  // 檐角起翘
  for (const [x, z] of [[-2, -2], [w + 1, -2], [-2, d + 1], [w + 1, d + 1]]) m.set(x, wall + 3, z, PAL.roofRidge);
  // 屋脊两端
  const ry = wall + 1 + o.roofLayers;
  m.set(-1 + o.roofLayers, ry + 1, Math.floor(d / 2), PAL.roofRidge).set(w - o.roofLayers, ry + 1, Math.floor(d / 2), PAL.roofRidge);
  return m;
}

export function libraryModel(): VoxelModel {
  const m = pavilion({ w: 18, d: 14, wall: 9, roofLayers: 3, doors: 1 });
  // 第二层
  const upper = pavilion({ w: 12, d: 9, wall: 7, roofLayers: 4, doors: 1 });
  m.merge(upper, 3, 12, 2);
  // 宝顶
  m.box(8, 12 + 7 + 5, 6, 9, 12 + 7 + 7, 6, PAL.gold);
  // 匾额
  m.box(7, 7, 14, 10, 8, 14, PAL.gold);
  return m;
}

export function hallModel(): VoxelModel {
  const m = pavilion({ w: 30, d: 14, wall: 11, roofLayers: 5, doors: 3, litWindows: [0, 1, 2] });
  m.box(12, 9, 14, 17, 10, 14, PAL.gold); // 匾额
  // 台阶
  m.box(10, 0, 14, 19, 0, 15, PAL.stone);
  return m;
}

export function dormModel(): VoxelModel {
  return pavilion({ w: 10, d: 30, wall: 7, roofLayers: 3, doors: 1 }).merge(sideRooms(), 0, 0, 0);
}

/** 居所：长条单间，门窗开在朝广场的一侧（+x） */
function sideRooms(): VoxelModel {
  const m = new VoxelModel();
  for (let i = 0; i < 5; i++) {
    const z = 2 + i * 6;
    m.box(9, 1, z, 9, 5, z + 1, PAL.woodDark);
    m.box(9, 3, z + 3, 9, 4, z + 3, i === 2 ? PAL.lantern : PAL.paper, i === 2);
  }
  return m;
}

export function alchemyModel(): VoxelModel {
  const m = pavilion({ w: 14, d: 12, wall: 8, roofLayers: 3, doors: 1, litWindows: [0] });
  // 丹炉：三足、圆鼓、炉口有火
  const fx = -6;
  const fz = 5;
  for (const [dx, dz] of [[0, 0], [4, 0], [2, 4]]) m.box(fx + dx, 1, fz + dz, fx + dx, 2, fz + dz, PAL.bronzeDark);
  m.box(fx - 1, 3, fz - 1, fx + 5, 7, fz + 5, PAL.bronze);
  m.box(fx, 8, fz, fx + 4, 8, fz + 4, PAL.bronzeDark);
  m.box(fx + 1, 9, fz + 1, fx + 3, 9, fz + 3, PAL.fire, true);
  m.box(fx + 1, 5, fz + 5, fx + 3, 5, fz + 5, PAL.fire, true);
  // 药柜一角
  m.box(15, 1, 2, 16, 5, 6, PAL.wood);
  return m;
}

export function kitchenModel(): VoxelModel {
  const m = pavilion({ w: 14, d: 11, wall: 8, roofLayers: 3, doors: 1, litWindows: [0] });
  // 烟囱
  m.box(10, 9, 2, 11, 16, 3, PAL.stoneDark);
  // 柴堆
  for (let i = 0; i < 4; i++) m.box(-5, 1 + i, 1, -2, 1 + i, 8, i % 2 ? PAL.wood : PAL.woodDark);
  // 水缸
  m.box(15, 1, 6, 17, 3, 8, PAL.stoneDark);
  m.box(16, 3, 7, 16, 3, 7, PAL.puddle);
  return m;
}

export function trainingModel(): VoxelModel {
  const m = new VoxelModel();
  // 兵器架
  m.box(-8, 1, -6, -8, 6, -6, PAL.wood).box(-1, 1, -6, -1, 6, -6, PAL.wood).box(-8, 6, -6, -1, 6, -6, PAL.wood);
  for (let x = -7; x <= -2; x += 2) m.box(x, 2, -5, x, 7, -5, x % 4 ? PAL.stone : PAL.bamboo);
  // 木人桩
  for (const [x, z] of [[4, -2], [6, 3]]) {
    m.box(x, 1, z, x + 1, 7, z + 1, PAL.wood);
    m.box(x - 1, 5, z, x - 1, 5, z + 1, PAL.woodDark).box(x + 2, 4, z, x + 2, 4, z + 1, PAL.woodDark);
  }
  // 石锁
  m.box(-6, 1, 4, -5, 2, 5, PAL.rock);
  return m;
}

export function bambooModel(): VoxelModel {
  const m = new VoxelModel();
  const rng = createRng(42);
  for (let i = 0; i < 34; i++) {
    const x = rng.int(28) - 14;
    const z = rng.int(20) - 10;
    const h = 16 + rng.int(14);
    for (let y = 1; y <= h; y++) m.set(x, y, z, y % 5 === 0 ? PAL.bambooDark : PAL.leaf);
    m.box(x - 1, h - 2, z - 1, x + 1, h + 1, z + 1, (xx, yy) => ((xx + yy) % 2 ? PAL.leaf : PAL.leafDark));
  }
  // 禁地木牌
  m.box(-16, 1, 11, -16, 5, 11, PAL.wood).box(-18, 5, 11, -14, 7, 11, PAL.pillar);
  return m;
}

export function gateModel(): VoxelModel {
  const m = new VoxelModel();
  // 牌坊：两根柱子、横梁、小屋顶
  for (const x of [-9, 8]) m.box(x, 0, 0, x + 1, 17, 1, PAL.pillar);
  m.box(-10, 15, -1, 10, 16, 2, PAL.woodDark);
  m.box(-11, 18, -2, 11, 18, 3, PAL.roof).box(-10, 19, -1, 10, 19, 2, PAL.roofRidge);
  m.set(-12, 19, -2, PAL.roofRidge).set(12, 19, -2, PAL.roofRidge).set(-12, 19, 3, PAL.roofRidge).set(12, 19, 3, PAL.roofRidge);
  m.box(-3, 13, 2, 2, 14, 2, PAL.gold); // 匾额
  // 灯笼
  for (const x of [-7, 6]) {
    m.box(x, 13, 2, x, 14, 2, PAL.woodDark);
    m.box(x - 1, 10, 1, x + 1, 12, 3, PAL.lanternRed, true);
  }
  // 往山下的台阶
  for (let i = 0; i < 6; i++) m.box(-6, -i, 3 + i * 2, 5, -i, 4 + i * 2, i % 2 ? PAL.stone : PAL.stoneDark);
  return m;
}

export function lanternPost(): VoxelModel {
  return new VoxelModel()
    .box(0, 0, 0, 1, 7, 1, PAL.stoneDark)
    .box(-1, 8, -1, 2, 8, 2, PAL.stone)
    .box(-1, 9, -1, 2, 10, 2, PAL.lantern, true)
    .box(-1, 11, -1, 2, 11, 2, PAL.roof);
}

export function incenseBurner(): VoxelModel {
  const m = new VoxelModel();
  for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) m.box(x, 0, z, x, 1, z, PAL.bronzeDark);
  m.box(-1, 2, -1, 5, 5, 5, PAL.bronze);
  m.box(0, 6, 0, 4, 6, 4, PAL.bronzeDark);
  m.box(1, 6, 1, 3, 6, 3, PAL.fire, true);
  for (const x of [1, 2, 3]) m.box(x, 7, 2, x, 10, 2, '#c9a77a');
  return m;
}

export function pineTree(seed: number): VoxelModel {
  const m = new VoxelModel();
  const rng = createRng(seed);
  const h = 8 + rng.int(4);
  m.box(0, 0, 0, 0, h, 0, PAL.trunk);
  for (let i = 0; i < 4; i++) {
    const r = 4 - i;
    const y = 4 + i * 3;
    m.box(-r, y, -r, r, y + 1, r, (x, yy, z) => (Math.abs(x) + Math.abs(z) <= r + 1 ? ((x + z + yy) % 3 ? PAL.pine : PAL.leafDark) : undefined));
  }
  return m;
}

// ---------- 地面（体素 0.5 米，顶面在 y=0） ----------

export const GROUND_HALF = 22;

export function groundModel(): VoxelModel {
  const m = new VoxelModel();
  const rng = createRng(7);
  const inRect = (x: number, z: number, cx: number, cz: number, hw: number, hd: number) => Math.abs(x - cx) <= hw && Math.abs(z - cz) <= hd;
  const path = (x: number, z: number) => {
    const ax = x * 0.5;
    const az = z * 0.5;
    // 广场
    if (inRect(ax, az, 0, 1.2, 5.5, 5)) return 'plaza';
    // 中轴路：广场到山门、广场到大殿
    if (Math.abs(ax) <= 1.5 && az > 5 && az < 12.5) return 'path';
    // 通往各处的小路
    for (const loc of Object.keys(LOCATION_POS) as LocationId[]) {
      const [lx, , lz] = LOCATION_POS[loc];
      // 从广场边缘拉一条 L 形小路
      if (Math.abs(az - lz) <= 0.75 && ((ax >= Math.min(0, lx) && ax <= Math.max(0, lx)) || false) && loc !== 'gate' && loc !== 'library' && loc !== 'bamboo') return 'path';
      if (loc === 'library' || loc === 'bamboo') {
        if (Math.abs(ax - lx) <= 0.75 && az <= -3 && az >= lz) return 'path';
        if (Math.abs(az + 9.5) <= 0.75 && ax >= Math.min(lx, 0) && ax <= Math.max(lx, 0)) return 'path';
      }
    }
    if (inRect(ax, az, LOCATION_POS.training[0], LOCATION_POS.training[2], 4, 3.5)) return 'mud';
    if (inRect(ax, az, LOCATION_POS.bamboo[0], LOCATION_POS.bamboo[2], 4.5, 3.5)) return 'bamboo';
    return 'grass';
  };
  for (let x = -GROUND_HALF * 2; x < GROUND_HALF * 2; x++) {
    for (let z = -GROUND_HALF * 2; z < GROUND_HALF * 2; z++) {
      const kind = path(x + 0.5, z + 0.5);
      let c: Hex;
      if (kind === 'plaza') c = (x + z) % 2 === 0 ? PAL.stone : '#7f8186';
      else if (kind === 'path') c = rng.chance(0.3) ? PAL.stoneDark : '#77797e';
      else if (kind === 'mud') c = rng.chance(0.18) ? PAL.puddle : rng.chance(0.4) ? '#4e3e30' : PAL.mud;
      else if (kind === 'bamboo') c = rng.chance(0.5) ? PAL.grass2 : '#2a4232';
      else c = rng.chance(0.15) ? PAL.grass3 : rng.chance(0.4) ? PAL.grass2 : PAL.grass;
      m.set(x, -1, z, c);
    }
  }
  return m;
}

/** 场景里的静态摆设：[模型名, 位置] */
export function propPlacements(): Array<{ key: string; model: () => VoxelModel; pos: [number, number, number]; yaw?: number }> {
  const lanterns: Array<[number, number]> = [[-5.6, -3.4], [5.6, -3.4], [-5.6, 6], [5.6, 6], [-1.9, 10], [1.9, 10]];
  const trees: Array<[number, number]> = [[-16, -10], [-17, 2], [16, -10], [17, 1], [-15, 13], [15, 13], [-3, -18], [12, -18], [-19, -16], [19, 16]];
  return [
    { key: 'hall', model: hallModel, pos: HALL_POS },
    { key: 'incense', model: incenseBurner, pos: [0, 0, 0.6] },
    ...lanterns.map(([x, z], i) => ({ key: `lantern-${i}`, model: lanternPost, pos: [x, 0, z] as [number, number, number] })),
    ...trees.map(([x, z], i) => ({ key: `tree-${i}`, model: () => pineTree(100 + i), pos: [x, 0, z] as [number, number, number] })),
  ];
}

export const LOCATION_MODELS: Record<LocationId, () => VoxelModel> = {
  library: libraryModel,
  dorm: dormModel,
  alchemy: alchemyModel,
  kitchen: kitchenModel,
  training: trainingModel,
  bamboo: bambooModel,
  gate: gateModel,
};

/** 灯笼的点光源位置（世界坐标） */
export function lampLights(): Array<{ pos: [number, number, number]; color: [number, number, number]; intensity: number; range: number }> {
  const out: Array<{ pos: [number, number, number]; color: [number, number, number]; intensity: number; range: number }> = [];
  for (const p of propPlacements().filter((x) => x.key.startsWith('lantern'))) out.push({ pos: [p.pos[0] + 0.12, 2.5, p.pos[2] + 0.12], color: [1, 0.62, 0.28], intensity: 14, range: 9 });
  out.push({ pos: [0, 1.8, 0.8], color: [1, 0.5, 0.18], intensity: 10, range: 7 }); // 香炉
  out.push({ pos: [LOCATION_POS.gate[0] - 1.7, 2.8, LOCATION_POS.gate[2] + 0.5], color: [1, 0.42, 0.25], intensity: 10, range: 8 });
  out.push({ pos: [LOCATION_POS.gate[0] + 1.6, 2.8, LOCATION_POS.gate[2] + 0.5], color: [1, 0.42, 0.25], intensity: 10, range: 8 });
  out.push({ pos: [LOCATION_POS.alchemy[0] - 1.0, 2.6, LOCATION_POS.alchemy[2] + 1.2], color: [1, 0.55, 0.2], intensity: 14, range: 8 }); // 丹炉
  out.push({ pos: [HALL_POS[0], 3, HALL_POS[2] + 2.4], color: [1, 0.7, 0.4], intensity: 10, range: 9 });
  return out;
}
