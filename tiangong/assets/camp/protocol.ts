// 界面（浏览器主线程）与游戏世界（引擎侧）之间的消息协议，走 GameHost.port。

import type { GameState, TaskId } from '../hanyi/core/types.ts';
import type { Topic } from '../hanyi/ai/dialogue.ts';
import type { SoulView } from '../souls/soul-client.ts';

export const CHANNEL = 'hanyi/camp';

export type Act =
  | { type: 'new'; winter?: number; perk?: string }
  | { type: 'endDay' }
  | { type: 'toNight' }
  | { type: 'endNight' }
  | { type: 'choose'; i: number }
  | { type: 'setTask'; id: string; task: TaskId }
  | { type: 'policy'; k: 'ration' | 'heat'; v: string }
  | { type: 'build'; id: string }
  | { type: 'cancel' }
  /** 照他说的办；不带 id 时，所有人都照自己说的办 */
  | { type: 'adopt'; id?: string };

export type ToEngine =
  | { channel: typeof CHANNEL; kind: 'hello'; save?: string }
  | { channel: typeof CHANNEL; kind: 'act'; act: Act }
  | { channel: typeof CHANNEL; kind: 'talk'; id: string; topic?: Topic; text?: string }
  | { channel: typeof CHANNEL; kind: 'focus'; id: string | null }
  /** 附带一个 MessagePort：Host 侧 AI 运行时的另一端 */
  | { channel: typeof CHANNEL; kind: 'intelligence'; providerId: string; label: string };

export interface TalkView {
  readonly thinking: string | null;
  readonly note: string | null;
  readonly provider: string;
  readonly sessions: Record<string, string>;
}

export type ToHost =
  | {
      channel: typeof CHANNEL;
      kind: 'state';
      state: GameState;
      souls: SoulView[];
      talk: TalkView;
      outcome?: { title: string; text: string } | null;
    }
  | { channel: typeof CHANNEL; kind: 'stream'; id: string; text: string };
