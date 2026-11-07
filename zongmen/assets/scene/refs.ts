// Pack 的 packageId 和由它推导的资产 GUID。引擎和界面两边都从这里取。

import { AssetGuid } from '@forgeax/engine/pack/guid';
import { definePackageId, type PackageId } from '@forgeax/engine/pack/source';
import type { AssetGuid as AssetGuidType } from '@forgeax/engine/types';

export const PACKAGE_IDS = Object.freeze({
  scene: definePackageId('019fd5a0-0100-7000-8000-00000000000a'),
  stage: definePackageId('019fd5a0-0200-7000-8000-00000000000b'),
  ui: definePackageId('019fd5a0-0300-7000-8000-00000000000c'),
});

export function assetGuid(packageId: PackageId, sourceKey: string): AssetGuidType {
  return AssetGuid.derive(packageId, sourceKey);
}

export function guidText(value: AssetGuidType): string {
  return AssetGuid.format(value);
}

export const SCENE_SOURCE_KEY = 'scene/main';
export const VOXEL_MATERIAL = assetGuid(PACKAGE_IDS.scene, 'material/voxel');
export const GLOW_MATERIAL = assetGuid(PACKAGE_IDS.scene, 'material/glow');
export const NIGHT_ENVIRONMENT = assetGuid(PACKAGE_IDS.scene, 'environment/night');

/** 界面 ↔ 引擎的消息频道 */
export const STAGE_CHANNEL = 'zongmen/stage';
