// 前端根插件：在 GameHost.uiRoot 里挂上游戏界面，游戏逻辑和模型调用都在这一侧运行。

import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import { PACKAGE_IDS } from '../scene/refs';
import { createGameUi } from './app';

export const ui: Plugin.Object = {
  name: 'zongmen/ui',
  inject: ['gameHost'],
  async apply(ctx) {
    const host = ctx.gameHost;
    if (!host?.uiRoot) throw new Error('宗门内奸的界面需要 GameHost.uiRoot');
    await ctx.effect(async function* () {
      const app = await createGameUi({ uiRoot: host.uiRoot!, port: host.presentationPort ?? host.port });
      yield () => app.dispose();
    }, 'zongmen/ui');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.ui,
  name: '宗门内奸 / 界面',
  build: () => ok({ 'plugin/ui': { kind: 'plugin', module: { specifier: './ui.pack.ts', export: 'ui' } } }),
});
