// 引擎根插件：加载场景，听界面的舞台指令，每帧移动镜头、摆放和驱动角色。

import { Time, Update } from '@forgeax/engine/ecs';
import type { EntityHandle } from '@forgeax/engine/ecs';
import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, sceneEntity, Transform, worldDespawnScene, worldResolveSceneEntity } from '@forgeax/engine/scene';
import type { SceneAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '@forgeax/engine/app';
import { blendShot, CAMERA_FOLLOW, cameraPosition, ELDER_POS, FACING_YAW, OFFSTAGE, PLAZA_SLOTS, SHOTS, type CameraShot, type Vec3 } from './layout';
import { assetGuid, guidText, PACKAGE_IDS, SCENE_SOURCE_KEY } from './refs';
import { isStageMessage, type Pose } from './stage-protocol';

const CHARACTER_KEYS = ['lin_qingzhu', 'shen_mo', 'liu_hanshuang', 'su_xiaoyu', 'bai_zhi', 'ye_wuchen', 'zhao_tiezhu', 'qian_duoduo', 'elder'];

function mul(a: number[], b: number[]): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** 角色这一帧的位移和姿态 */
export function poseOffset(pose: Pose, t: number, phase: number): { dx: number; dy: number; tilt: number; roll: number } {
  switch (pose) {
    case 'talk':
      return { dx: 0, dy: Math.abs(Math.sin(t * 9 + phase)) * 0.05, tilt: Math.sin(t * 4.5 + phase) * 0.04, roll: 0 };
    case 'nervous':
      return { dx: Math.sin(t * 28 + phase) * 0.025, dy: 0, tilt: 0, roll: Math.sin(t * 14 + phase) * 0.05 };
    case 'down':
      return { dx: 0, dy: -0.04, tilt: 0.32, roll: 0 };
    default:
      return { dx: 0, dy: Math.sin(t * 1.8 + phase) * 0.015, tilt: 0, roll: 0 };
  }
}

export const stage: Plugin.Object<{ readonly scene: string }> = {
  name: 'zongmen/stage',
  inject: ['world', 'assets', 'gameHost'],
  async apply(ctx, config) {
    const assets = ctx.assets;
    if (!assets) throw new Error('舞台需要资产服务');
    const loaded = await assets.loadByGuid<SceneAsset>(assets.parseGuid(config.scene));
    if (!loaded.ok) throw loaded.error;
    const world = ctx.world;
    const host = ctx.gameHost;
    await ctx.effect(async function* () {
      const handle = world.allocSharedRef('SceneAsset', loaded.value);
      yield () => {
        world.sharedRefs.release(handle).unwrap();
      };
      const root = assets.instantiate<SceneAsset>(handle, world).unwrap();
      yield () => worldDespawnScene(world, root).unwrap();
      const resolve = (key: string): EntityHandle => {
        const r = worldResolveSceneEntity(world, root, sceneEntity(SCENE_SOURCE_KEY, key));
        if (!r.ok) throw r.error;
        return r.value;
      };
      const camera = resolve('camera');
      const chars = new Map(CHARACTER_KEYS.map((k) => [k, resolve(`char/${k}`)]));

      // 舞台状态
      let target: CameraShot = SHOTS.overview;
      let current: CameraShot = SHOTS.overview;
      const place = new Map<string, Vec3>([['elder', ELDER_POS]]);
      const poses = new Map<string, Pose>();
      let time = 0;

      const receive = (event: MessageEvent) => {
        const msg = event.data;
        if (!isStageMessage(msg)) return;
        switch (msg.kind) {
          case 'shot':
            target = msg.shot;
            if (msg.instant) current = msg.shot;
            break;
          case 'cast':
            for (const k of CHARACTER_KEYS) if (k !== 'elder') place.delete(k);
            msg.ids.slice(0, PLAZA_SLOTS.length).forEach((id, i) => place.set(id, PLAZA_SLOTS[i]));
            break;
          case 'pose':
            poses.set(msg.id, msg.pose);
            break;
          case 'elder':
            if (msg.visible) place.set('elder', ELDER_POS);
            else place.delete('elder');
            break;
        }
      };
      host?.port?.addEventListener('message', receive);
      host?.port?.start();
      yield () => host?.port?.removeEventListener('message', receive);

      world
        .addSystem(Update, {
          name: 'zongmen-stage',
          before: [PROPAGATE_TRANSFORMS_SYSTEM],
          queries: [],
          fn: () => {
            const dt = Math.min(0.1, world.getResource(Time).delta);
            time += dt;
            current = blendShot(current, target, 1 - Math.exp(-CAMERA_FOLLOW * dt));
            const eye = cameraPosition(current);
            const rot = quat.fromLookAt(quat.create(), eye, current.focus, [0, 1, 0]);
            world.set(camera, Transform, { pos: eye, quat: [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0, rot[3] ?? 1] }).unwrap();
            let i = 0;
            for (const [key, entity] of chars) {
              i++;
              const base = place.get(key);
              if (!base) {
                world.set(entity, Transform, { pos: OFFSTAGE }).unwrap();
                continue;
              }
              const o = poseOffset(poses.get(key) ?? 'idle', time, i * 1.7);
              const yaw = [0, Math.sin(FACING_YAW / 2), 0, Math.cos(FACING_YAW / 2)];
              const tilt = [Math.sin(o.tilt / 2), 0, 0, Math.cos(o.tilt / 2)];
              const roll = [0, 0, Math.sin(o.roll / 2), Math.cos(o.roll / 2)];
              world.set(entity, Transform, { pos: [base[0] + o.dx, base[1] + o.dy, base[2]], quat: mul(mul(yaw, tilt), roll) }).unwrap();
            }
          },
        })
        .unwrap();
      yield () => world.removeSystem(Update, 'zongmen-stage').unwrap();
    }, 'zongmen/stage');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.stage,
  name: '宗门内奸 / 舞台',
  build: () =>
    ok({
      'plugin/stage': {
        kind: 'plugin',
        module: { specifier: './stage.pack.ts', export: 'stage' },
        config: { scene: { $asset: guidText(assetGuid(PACKAGE_IDS.scene, SCENE_SOURCE_KEY)) } },
      },
    }),
});
