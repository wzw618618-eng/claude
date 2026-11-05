// 引擎侧根插件（forge.json#roots.engine）：青冥州这个世界。
// - 注册 NpcBrain 组件，装上引擎自带的 npcPlugin，给它接上我们的灵魂客户端；
// - 每帧 poll Intelligence 事件；
// - 通过 GameHost.port 与界面通信。

import type {} from '@forgeax/engine/app';
import { Update } from '@forgeax/engine/ecs';
import { NpcBrain, npcPlugin } from '@forgeax/engine/npc';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { WORLD_PACKAGE } from './ids.ts';
import { createSoulAdapter } from './souls/soul-client.ts';
import { WorldSession } from './world/session.ts';

export const world: Plugin.Object<Record<string, never>> = {
  name: 'qingming/world',
  inject: ['world', 'gameHost'],
  async apply(ctx) {
    const ecs = ctx.world;
    const port = ctx.gameHost?.port;
    if (!port) throw new Error('青冥录需要 GameHost.port 才能和界面通信');
    const session = new WorldSession((m) => port.postMessage(m));
    const receive = (event: MessageEvent) => session.receive(event.data, event.ports?.[0]);

    await ctx.effect(function* () {
      const lease = ecs.components.register(NpcBrain);
      if (lease.ok) yield () => { lease.value.dispose(); };

      ecs.addSystem(Update, {
        name: 'qingming/intelligence-poll',
        queries: [],
        fn: () => session.poll(),
      }).unwrap();
      yield () => { ecs.removeSystem(Update, 'qingming/intelligence-poll'); };

      session.attach(ecs);
      port.addEventListener('message', receive);
      port.start();
      yield () => port.removeEventListener('message', receive);
    }, 'qingming/world');

    // 引擎官方的 NPC 插件：扫描 NpcBrain，签名变化时 sync，每帧 tick
    ctx.plugin(npcPlugin({
      systemName: 'qingming/npc-souls',
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
  packageId: WORLD_PACKAGE,
  build: () => ok({
    'plugin/world': {
      kind: 'plugin',
      module: { specifier: './world.pack.ts', export: 'world' },
      config: {},
    },
  }),
});
