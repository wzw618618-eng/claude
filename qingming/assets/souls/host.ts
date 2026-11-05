// Host（浏览器主线程）一侧：把 AI 提供方包成引擎的 Intelligence 运行时，开一条 MessageChannel，
// 一端绑在运行时上，另一端交给游戏世界。密钥只留在这一侧。

import { bindIntelligencePort, createIntelligenceRuntime, type IntelligencePortBinding, type IntelligenceProvider } from '@forgeax/engine/intelligence';
import { TALK_LIMITS } from './providers.ts';

export interface HostLink {
  readonly providerId: string;
  /** 交给游戏世界的那一端 */
  readonly port: MessagePort;
  close(): Promise<void>;
}

export function linkProvider(provider: IntelligenceProvider): HostLink {
  const runtime = createIntelligenceRuntime(provider, { limits: TALK_LIMITS });
  const channel = new MessageChannel();
  channel.port1.start();
  const binding: IntelligencePortBinding = bindIntelligencePort(channel.port1, runtime);
  return {
    providerId: runtime.providerId,
    port: channel.port2,
    async close() {
      await binding.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      channel.port1.close();
    },
  };
}
