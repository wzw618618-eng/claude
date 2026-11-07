// 场景 Pack：材质、夜空、所有体素网格，以及摆好一切的场景资产。

import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import {
  ANTIALIAS_FXAA,
  Camera,
  DirectionalLight,
  Materials,
  MeshFilter,
  MeshRenderer,
  perspective,
  PointLight,
  SKYBOX_MODE_CUBEMAP,
  SkyboxBackground,
  Skylight,
  TONEMAP_ACES_FILMIC,
} from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { EquirectAsset, MeshAsset, SceneAsset, SceneEntity } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { GAME_DATA } from '../game/data/bundle.gen';
import type { LocationId } from '../game/data/types';
import { CAMERA_FOV, cameraPosition, ELDER_POS, FACING_YAW, LOCATION_POS, OFFSTAGE, SHOTS, type Vec3 } from './layout';
import { characterModel, ELDER_LOOK, groundModel, lampLights, LOCATION_MODELS, lookOf, propPlacements } from './models';
import { assetGuid, GLOW_MATERIAL, guidText, NIGHT_ENVIRONMENT, PACKAGE_IDS, SCENE_SOURCE_KEY, VOXEL_MATERIAL } from './refs';
import { voxelMesh, type VoxelModel } from './voxel';

const BUILDING_VOXEL = 0.25;
const CHAR_VOXEL = 0.1;

function mesh(model: VoxelModel, scale: number, origin?: [number, number, number]): MeshAsset {
  return voxelMesh(model, { scale, origin, material: VOXEL_MATERIAL, glowMaterial: GLOW_MATERIAL });
}

/** 夜空：近黑的靛蓝，地平线一圈灰蓝，月亮方向略亮 */
function nightSky(): EquirectAsset {
  const W = 128;
  const H = 64;
  const px = new Float32Array(W * H * 4);
  const moon = [0.45, 0.5, -0.74];
  for (let y = 0; y < H; y++) {
    const lat = Math.PI * (0.5 - (y + 0.5) / H);
    for (let x = 0; x < W; x++) {
      const lon = Math.PI * (2 * ((x + 0.5) / W) - 1);
      const dir = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      const up = Math.max(0, dir[1]);
      const horizon = Math.exp(-Math.max(dir[1], 0) * 6);
      const glow = Math.max(0, dir[0] * moon[0] + dir[1] * moon[1] + dir[2] * moon[2]) ** 24;
      const sky = [0.012 + 0.01 * up + 0.05 * horizon + 0.25 * glow, 0.018 + 0.012 * up + 0.06 * horizon + 0.27 * glow, 0.04 + 0.03 * up + 0.08 * horizon + 0.3 * glow];
      const ground = [0.01, 0.014, 0.016];
      const k = dir[1] < 0 ? 0 : 1;
      const o = (y * W + x) * 4;
      px.set([k ? sky[0] : ground[0], k ? sky[1] : ground[1], k ? sky[2] : ground[2], 1], o);
    }
  }
  return { kind: 'equirect', width: W, height: H, format: 'rgba32float', data: new Uint8Array(px.buffer), colorSpace: 'linear' };
}

function yawQuat(yaw: number): [number, number, number, number] {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

function meshEntity(name: string, meshKey: string, pos: Vec3, rot: [number, number, number, number] = [0, 0, 0, 1]): SceneEntity {
  return {
    components: {
      Name: { value: name },
      Transform: { pos, quat: rot },
      MeshFilter: { assetHandle: guidText(assetGuid(PACKAGE_IDS.scene, meshKey)) },
      MeshRenderer: { materials: [] },
    },
  };
}

export const CHARACTER_IDS = [...GAME_DATA.characters.map((c) => c.id), 'elder'];

function buildAll() {
  const out: Record<string, unknown> = {
    'material/voxel': Materials.standard({ baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.92 }),
    'material/glow': Materials.standard({ baseColor: [1, 0.7, 0.35, 1], emissive: [1, 0.5, 0.16], emissiveIntensity: 1.6, metallic: 0, roughness: 0.6 }),
    'environment/night': nightSky(),
  };
  const entities: Record<string, SceneEntity> = {};

  out['mesh/ground'] = mesh(groundModel(), 0.5, [0, 0, 0]);
  entities.ground = meshEntity('地面', 'mesh/ground', [0, 0, 0]);

  for (const loc of Object.keys(LOCATION_MODELS) as LocationId[]) {
    out[`mesh/loc/${loc}`] = mesh(LOCATION_MODELS[loc](), BUILDING_VOXEL);
    entities[`loc/${loc}`] = meshEntity(loc, `mesh/loc/${loc}`, LOCATION_POS[loc]);
  }
  for (const p of propPlacements()) {
    out[`mesh/prop/${p.key}`] = mesh(p.model(), BUILDING_VOXEL);
    entities[`prop/${p.key}`] = meshEntity(p.key, `mesh/prop/${p.key}`, p.pos, yawQuat(p.yaw ?? 0));
  }
  for (const c of GAME_DATA.characters) {
    out[`mesh/char/${c.id}`] = mesh(characterModel(lookOf(c)), CHAR_VOXEL, [4, 0, 3]);
    entities[`char/${c.id}`] = meshEntity(c.name, `mesh/char/${c.id}`, OFFSTAGE, yawQuat(FACING_YAW));
  }
  out['mesh/char/elder'] = mesh(characterModel(ELDER_LOOK), CHAR_VOXEL, [4, 0, 3]);
  entities['char/elder'] = meshEntity('严长老', 'mesh/char/elder', ELDER_POS, yawQuat(FACING_YAW));

  // 光：月光 + 灯笼 + 夜空环境光
  entities.moon = {
    components: {
      Name: { value: '月光' },
      DirectionalLight: {
        direction: [-0.4, -0.8, 0.45],
        color: [0.62, 0.72, 1],
        intensity: 0.9,
        castShadow: true,
        cascadeCount: 2,
        mapSize: 1024,
        depthBias: 0.005,
        normalBias: 0.06,
        shadowDistance: 60,
      },
    },
  };
  lampLights().forEach((l, i) => {
    entities[`lamp/${i}`] = { components: { Name: { value: `灯${i}` }, Transform: { pos: l.pos }, PointLight: { color: l.color, intensity: l.intensity, range: l.range } } };
  });
  entities.skylight = { components: { Name: { value: '夜空光' }, Skylight: { equirect: guidText(NIGHT_ENVIRONMENT), color: [0.8, 0.86, 1], intensity: 2.2 } } };
  entities.sky = { components: { Name: { value: '夜空' }, SkyboxBackground: { equirect: guidText(NIGHT_ENVIRONMENT), mode: SKYBOX_MODE_CUBEMAP } } };

  const shot = SHOTS.overview;
  const eye = cameraPosition(shot);
  const rot = quat.fromLookAt(quat.create(), eye, shot.focus, [0, 1, 0]);
  entities.camera = {
    components: {
      Name: { value: '镜头' },
      Transform: { pos: eye, quat: [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0, rot[3] ?? 1] },
      Camera: {
        ...perspective({ fov: CAMERA_FOV, aspect: 16 / 9, near: 0.1, far: 200 }),
        tonemap: TONEMAP_ACES_FILMIC,
        exposure: 1.15,
        antialias: ANTIALIAS_FXAA,
        clearColor: [0.02, 0.03, 0.06, 1],
      },
    },
  };

  const scene: SceneAsset = { kind: 'scene', entities };
  out[SCENE_SOURCE_KEY] = scene;
  return out;
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.scene,
  name: '宗门内奸 / 场景',
  sceneComponents: [Camera, DirectionalLight, MeshFilter, MeshRenderer, Name, PointLight, SkyboxBackground, Skylight, Transform],
  build: () => ok(buildAll() as never),
});
