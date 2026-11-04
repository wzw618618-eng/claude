// 打印 forge.json#roots 应该使用的插件 GUID（由包 ID 和插件键派生）
import { AssetGuid } from '@forgeax/engine/pack/guid';
import { CAMP_PACKAGE, UI_PACKAGE } from '../assets/ids.ts';

console.log(JSON.stringify({
  engine: AssetGuid.format(AssetGuid.derive(CAMP_PACKAGE, 'plugin/camp')),
  frontend: AssetGuid.format(AssetGuid.derive(UI_PACKAGE, 'plugin/ui')),
}));
