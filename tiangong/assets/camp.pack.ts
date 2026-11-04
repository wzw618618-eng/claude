// 引擎侧根插件（forge.json#roots.engine）：游戏世界。
// - 注册 NpcBrain 组件，装上引擎自带的 npcPlugin，并给它接上我们的灵魂客户端；
// - 每帧 poll Intelligence 事件；
// - 通过 GameHost.port 与界面通信。

import type {} from '@forgeax/engine/app';
import { Update } from '@forgeax/engine/ecs';
import { NpcBrain, npcPlugin } from '@forgeax/engine/npc';
import { definePack } from '@forgeax/engine/pack/source';
import { CAMP_PACKAGE } from './ids.ts';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { CampSession } from './camp/session.ts';
import { createSoulAdapter } from './souls/soul-client.ts';

export const camp: Plugin.Object<Record<string, never>> = {
  name: 'hanyi/camp',
  inject: ['world', 'gameHost'],
  async apply(ctx) {
    const world = ctx.world;
    const port = ctx.gameHost?.port;
    if (!port) throw new Error('寒驿需要 GameHost.port 才能和界面通信');
    const session = new CampSession((m) => port.postMessage(m));
    const receive = (event: MessageEvent) => session.receive(event.data, event.ports?.[0]);

    await ctx.effect(function* () {
      const lease = world.components.register(NpcBrain);
      if (lease.ok) yield () => { lease.value.dispose(); };

      world.addSystem(Update, {
        name: 'hanyi/intelligence-poll',
        queries: [],
        fn: () => session.poll(),
      }).unwrap();
      yield () => { world.removeSystem(Update, 'hanyi/intelligence-poll'); };

      session.attach(world);
      port.addEventListener('message', receive);
      port.start();
      yield () => port.removeEventListener('message', receive);
    }, 'hanyi/camp');

    // 引擎官方的 NPC 插件：扫描 NpcBrain，签名变化时 sync，每帧 tick
    ctx.plugin(npcPlugin({
      systemName: 'hanyi/npc-souls',
      adapter: createSoulAdapter(session.souls, {
        affordances: (_ref, binding) => session.affordances(binding.soulId),
        sample: (binding) => session.perceive(binding.soulId),
      }),
    }));
    session.publish();
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: CAMP_PACKAGE,
  build: () => ok({
    'plugin/camp': {
      kind: 'plugin',
      module: { specifier: './camp.pack.ts', export: 'camp' },
      config: {},
    },
  }),
});
