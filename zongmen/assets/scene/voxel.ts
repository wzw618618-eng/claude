// 体素模型：用方块拼出场景和角色，再转成带顶点颜色的网格。
// 纯函数，不依赖引擎运行时；Pack 构建时和测试里都能直接用。

import { createMeshBuilder } from '@forgeax/engine/geometry';
import type { AssetGuid, MeshAsset } from '@forgeax/engine/types';

/** sRGB 十六进制颜色，如 '#3a5f8a' */
export type Hex = string;

/** 每个体素：颜色 + 是否发光（发光体素走第二个材质槽） */
export interface Voxel {
  color: Hex;
  glow?: boolean;
}

export class VoxelModel {
  readonly cells = new Map<string, Voxel>();

  set(x: number, y: number, z: number, color: Hex, glow = false): this {
    this.cells.set(`${x},${y},${z}`, { color, glow });
    return this;
  }

  remove(x: number, y: number, z: number): this {
    this.cells.delete(`${x},${y},${z}`);
    return this;
  }

  get(x: number, y: number, z: number): Voxel | undefined {
    return this.cells.get(`${x},${y},${z}`);
  }

  /** 填一个长方体（两角都包含） */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: Hex | ((x: number, y: number, z: number) => Hex | undefined), glow = false): this {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
    for (let x = ax; x <= bx; x++)
      for (let y = ay; y <= by; y++)
        for (let z = az; z <= bz; z++) {
          const c = typeof color === 'function' ? color(x, y, z) : color;
          if (c) this.set(x, y, z, c, glow);
        }
    return this;
  }

  /** 把另一个模型平移后并进来 */
  merge(other: VoxelModel, dx = 0, dy = 0, dz = 0): this {
    for (const [k, v] of other.cells) {
      const [x, y, z] = k.split(',').map(Number);
      this.cells.set(`${x + dx},${y + dy},${z + dz}`, v);
    }
    return this;
  }

  get size(): number {
    return this.cells.size;
  }

  bounds(): { min: [number, number, number]; max: [number, number, number] } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const k of this.cells.keys()) {
      const p = k.split(',').map(Number);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    }
    return { min, max };
  }
}

/** sRGB → 线性（顶点颜色要求线性 RGBA） */
export function hexToLinear(hex: Hex): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return [c[0], c[1], c[2]];
}

const FACES: Array<{ n: [number, number, number]; corners: Array<[number, number, number]>; shade: number }> = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.9 },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.9 },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.7 },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.95 },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.85 },
];

export interface VoxelMeshOptions {
  /** 一格体素的边长（米） */
  scale: number;
  /** 模型原点（体素坐标），会被移到网格局部坐标 (0,0,0)；默认底面中心 */
  origin?: [number, number, number];
  material: AssetGuid;
  glowMaterial?: AssetGuid;
}

/** 只生成朝外的面（相邻有体素的面剔除），普通体素和发光体素分成两个子网格 */
export function voxelMesh(model: VoxelModel, opts: VoxelMeshOptions): MeshAsset {
  const { min, max } = model.bounds();
  const origin = opts.origin ?? [(min[0] + max[0] + 1) / 2, min[1], (min[2] + max[2] + 1) / 2];
  const s = opts.scale;
  const groups: Array<{ pos: number[]; nor: number[]; col: number[]; idx: number[] }> = [
    { pos: [], nor: [], col: [], idx: [] },
    { pos: [], nor: [], col: [], idx: [] },
  ];
  for (const [k, v] of model.cells) {
    const [x, y, z] = k.split(',').map(Number);
    const g = groups[v.glow && opts.glowMaterial ? 1 : 0];
    const lin = hexToLinear(v.color);
    for (const f of FACES) {
      const nb = model.get(x + f.n[0], y + f.n[1], z + f.n[2]);
      if (nb && !!nb.glow === !!v.glow) continue;
      const base = g.pos.length / 3;
      for (const c of f.corners) {
        g.pos.push((x + c[0] - origin[0]) * s, (y + c[1] - origin[1]) * s, (z + c[2] - origin[2]) * s);
        g.nor.push(...f.n);
        // 烘一点面朝向的明暗，夜里光少时体块也分得清
        g.col.push(lin[0] * f.shade, lin[1] * f.shade, lin[2] * f.shade, 1);
      }
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const used = groups.map((g, i) => ({ g, i })).filter(({ g }) => g.idx.length > 0);
  if (used.length === 0) throw new Error('体素模型是空的');
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const indices: number[] = [];
  const submeshes: Array<{ topology: 'triangle-list'; indexOffset: number; indexCount: number; materialSlot: number }> = [];
  const slots: Array<{ slotName: string; sourceKey: string; defaultMaterial: AssetGuid }> = [];
  for (const { g, i } of used) {
    const vbase = position.length / 3;
    const ibase = indices.length;
    position.push(...g.pos);
    normal.push(...g.nor);
    color.push(...g.col);
    for (const id of g.idx) indices.push(id + vbase);
    submeshes.push({ topology: 'triangle-list', indexOffset: ibase, indexCount: g.idx.length, materialSlot: slots.length });
    slots.push(
      i === 0
        ? { slotName: 'surface', sourceKey: 'zongmen:voxel', defaultMaterial: opts.material }
        : { slotName: 'glow', sourceKey: 'zongmen:glow', defaultMaterial: opts.glowMaterial! },
    );
  }
  const vcount = position.length / 3;
  const builder = createMeshBuilder({
    attributes: {
      position: new Float32Array(position),
      normal: new Float32Array(normal),
      uv: new Float32Array(vcount * 2),
      color: new Float32Array(color),
    },
    indices: new Uint32Array(indices),
    submeshes,
    materialSlots: slots,
  });
  const built = builder.build();
  if (!built.ok) throw built.error;
  return built.value;
}
