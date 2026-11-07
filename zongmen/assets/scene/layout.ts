// 场景布局与镜头：引擎（摆放、镜头移动）和界面（标签、情绪图标的屏幕位置）共用。
// 坐标：右手系，+Y 向上，单位米。镜头固定斜 45° 俯视。

import type { LocationId } from '../game/data/types';

export type Vec3 = [number, number, number];

/** 每个可勘察地点的中心（标签和镜头对准这里） */
export const LOCATION_POS: Record<LocationId, Vec3> = {
  library: [-6, 0, -13],
  dorm: [-12.5, 0, -3],
  alchemy: [12.5, 0, -3.5],
  kitchen: [11.5, 0, 7.5],
  training: [-11, 0, 7.5],
  bamboo: [7, 0, -14],
  gate: [0, 0, 13],
};

/** 地点标签离地高度 */
export const LOCATION_LABEL_HEIGHT: Record<LocationId, number> = {
  library: 7.2,
  dorm: 4.2,
  alchemy: 4.6,
  kitchen: 4.4,
  training: 2.4,
  bamboo: 6.4,
  gate: 5.6,
};

/** 大殿（不可勘察，只是背景） */
export const HALL_POS: Vec3 = [0, 0, -6.5];

/** 广场上 5 名弟子的站位（从左到右），严长老站在后面 */
export const PLAZA_SLOTS: Vec3[] = [
  [-3.2, 0, 2.6],
  [-1.6, 0, 3.1],
  [0, 0, 3.3],
  [1.6, 0, 3.1],
  [3.2, 0, 2.6],
];
export const ELDER_POS: Vec3 = [2.6, 0, -2.4];
/** 不在场的角色藏到这里 */
export const OFFSTAGE: Vec3 = [0, -60, 0];

/** 角色面朝镜头的偏航角 */
export const FACING_YAW = (20 * Math.PI) / 180;

export interface CameraShot {
  focus: Vec3;
  distance: number;
  /** 俯角（弧度） */
  pitch: number;
  /** 偏航角（弧度），0 表示从 +Z 往 -Z 看 */
  yaw: number;
}

export const CAMERA_FOV = Math.PI / 4;
const DEG = Math.PI / 180;

export const SHOTS = {
  overview: { focus: [0, 0, -1], distance: 40, pitch: 50 * DEG, yaw: 20 * DEG } as CameraShot,
  plaza: { focus: [0, 0.8, 1.6], distance: 15.5, pitch: 45 * DEG, yaw: 20 * DEG } as CameraShot,
  gateIntro: { focus: [0, 1.5, 12], distance: 14, pitch: 30 * DEG, yaw: 0 } as CameraShot,
  libraryIntro: { focus: [-6, 3, -13], distance: 15, pitch: 32 * DEG, yaw: 35 * DEG } as CameraShot,
};

/**
 * 地图机位：按屏幕宽高比拉远镜头，直到 7 个地点的标签都落在画面里
 * （横向留 6% 边，上面留 12%，下面留出底部面板的 30%）。
 */
export function fitOverviewShot(width: number, height: number): CameraShot {
  const base = SHOTS.overview;
  const pts = (Object.keys(LOCATION_POS) as LocationId[]).map((l) => [LOCATION_POS[l][0], LOCATION_LABEL_HEIGHT[l], LOCATION_POS[l][2]] as Vec3);
  for (let d = 24; d <= 90; d += 1) {
    const shot = { ...base, distance: d };
    // 标签本身约 90 像素宽，边距至少留半个标签
    const mx = Math.max(width * 0.06, 52);
    const ok = pts.every((p) => {
      const s = projectToScreen(p, shot, width, height);
      return !!s && s.x > mx && s.x < width - mx && s.y > height * 0.12 && s.y < height * 0.7;
    });
    if (ok) return shot;
  }
  return { ...base, distance: 90 };
}

/** 广场机位：5 名弟子连同头顶的情绪图标都在画面里，且在底部头像栏之上 */
export function fitPlazaShot(width: number, height: number): CameraShot {
  const base = SHOTS.plaza;
  const pts: Vec3[] = PLAZA_SLOTS.flatMap((p) => [[p[0], 0, p[2]] as Vec3, [p[0], 2.3, p[2]] as Vec3]);
  for (let d = base.distance; d <= 40; d += 0.5) {
    const shot = { ...base, distance: d };
    const ok = pts.every((p) => {
      const s = projectToScreen(p, shot, width, height);
      return !!s && s.x > width * 0.08 && s.x < width * 0.92 && s.y > height * 0.1 && s.y < height * 0.7;
    });
    if (ok) return shot;
  }
  return { ...base, distance: 40 };
}

export function locationShot(loc: LocationId): CameraShot {
  // 焦点往镜头这边推，建筑落在画面上半部分，下面留给地点面板
  const p = LOCATION_POS[loc];
  const yaw = 20 * DEG;
  return { focus: [p[0] + 5 * Math.sin(yaw), 0, p[2] + 5 * Math.cos(yaw)], distance: 26, pitch: 40 * DEG, yaw };
}

/** 审问时的特写：人在画面上方三分之一，下面留给对话框 */
export function closeupShot(pos: Vec3): CameraShot {
  return { focus: [pos[0], pos[1] - 0.9, pos[2]], distance: 9, pitch: 12 * DEG, yaw: 20 * DEG };
}

export function cameraPosition(shot: CameraShot): Vec3 {
  const { focus, distance: d, pitch, yaw } = shot;
  return [
    focus[0] + d * Math.sin(yaw) * Math.cos(pitch),
    focus[1] + d * Math.sin(pitch),
    focus[2] + d * Math.cos(yaw) * Math.cos(pitch),
  ];
}

/** 镜头平滑过渡（引擎和界面用同一个公式，标签才跟得上画面） */
export function blendShot(from: CameraShot, to: CameraShot, t: number): CameraShot {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    focus: [lerp(from.focus[0], to.focus[0]), lerp(from.focus[1], to.focus[1]), lerp(from.focus[2], to.focus[2])],
    distance: lerp(from.distance, to.distance),
    pitch: lerp(from.pitch, to.pitch),
    yaw: lerp(from.yaw, to.yaw),
  };
}

/** 两个机位是否已经足够接近（用来在过渡末尾直接吸附，避免画面和标签无限微动） */
export function shotsClose(a: CameraShot, b: CameraShot, eps = 1e-3): boolean {
  return (
    Math.abs(a.focus[0] - b.focus[0]) < eps &&
    Math.abs(a.focus[1] - b.focus[1]) < eps &&
    Math.abs(a.focus[2] - b.focus[2]) < eps &&
    Math.abs(a.distance - b.distance) < eps &&
    Math.abs(a.pitch - b.pitch) < eps * 0.1 &&
    Math.abs(a.yaw - b.yaw) < eps * 0.1
  );
}

/** 往目标机位走一步；足够近时直接吸附 */
export function stepShot(current: CameraShot, target: CameraShot, dt: number): CameraShot {
  const next = blendShot(current, target, 1 - Math.exp(-CAMERA_FOLLOW * dt));
  return shotsClose(next, target) ? target : next;
}

/** 每秒逼近目标的速度（指数平滑） */
export const CAMERA_FOLLOW = 3.2;

/** 世界坐标投影到屏幕（CSS 像素）；在镜头背后时返回 undefined */
export function projectToScreen(p: Vec3, shot: CameraShot, width: number, height: number): { x: number; y: number; depth: number } | undefined {
  const eye = cameraPosition(shot);
  // 相机基向量：forward 指向 focus
  const f = norm(sub(shot.focus, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const v = sub(p, eye);
  const z = dot(v, f);
  if (z <= 0.05) return undefined;
  const tan = Math.tan(CAMERA_FOV / 2);
  const aspect = width / height;
  const ndcX = dot(v, r) / (z * tan * aspect);
  const ndcY = dot(v, u) / (z * tan);
  return { x: (ndcX * 0.5 + 0.5) * width, y: (0.5 - ndcY * 0.5) * height, depth: z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** 角色的高度（米），用来把情绪图标放在头顶 */
export const CHAR_VOXEL = 0.1;
