// 界面根插件（forge.json#roots.frontend）：运行在浏览器主线程，挂载到 GameHost.uiRoot。

import type {} from '@forgeax/engine/app';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { UI_PACKAGE } from './ids.ts';
import { mountPlaceholder } from './ui/placeholder.ts';

export const ui: Plugin.Object<Record<string, never>> = {
  name: 'qingming/ui',
  inject: ['gameHost'],
  async apply(ctx) {
    await ctx.effect(function* () {
      const host = ctx.gameHost;
      const root = host?.uiRoot;
      const port = host?.presentationPort ?? host?.port;
      if (!root || !port) throw new Error('青冥录界面需要 GameHost.uiRoot 和 port');
      const mounted = mountPlaceholder({ uiRoot: root, port });
      yield () => mounted.dispose();
    }, 'qingming/ui');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: UI_PACKAGE,
  build: () => ok({
    'plugin/ui': {
      kind: 'plugin',
      module: { specifier: './ui.pack.ts', export: 'ui' },
      config: {},
    },
  }),
});
