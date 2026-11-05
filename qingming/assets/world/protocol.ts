// 界面（浏览器主线程）与游戏世界（引擎侧）之间的消息协议，走 GameHost.port。

import type { PlaceId, World } from '../game/core/types.ts';
import type { RootId } from '../game/core/world.ts';
import type { MainAct, SocialKind } from '../game/player.ts';
import type { SoulView } from '../souls/soul-client.ts';

export const CHANNEL = 'qingming/world';

export type Act =
  | { type: 'new'; seed?: number; name?: string; root?: RootId; gender?: 'm' | 'f' }
  | { type: 'move'; place: PlaceId }
  | { type: 'main'; act: MainAct }
  | { type: 'buy'; item: string }
  | { type: 'use'; item: string }
  /** 处理眼前这件找上门的事 */
  | { type: 'choose'; i: number }
  /** 答复对方在谈话里提出的事 */
  | { type: 'offer'; accept: boolean }
  | { type: 'endTurn' }
  | { type: 'retreat'; years: number };

export type ToEngine =
  | { channel: typeof CHANNEL; kind: 'hello'; save?: string }
  | { channel: typeof CHANNEL; kind: 'act'; act: Act }
  /** 选项对话：效果按规则，台词可以由 AI 来说 */
  | { channel: typeof CHANNEL; kind: 'social'; id: string; topic: SocialKind; arg?: string }
  /** 自由对话：你说的话 */
  | { channel: typeof CHANNEL; kind: 'talk'; id: string; text: string }
  /** 正在看谁（他的灵魂进入「聚光」） */
  | { channel: typeof CHANNEL; kind: 'focus'; id: string | null }
  /** 附带一个 MessagePort：Host 侧 AI 运行时的另一端 */
  | { channel: typeof CHANNEL; kind: 'intelligence'; providerId: string; label: string };

export interface AiView {
  /** 正在等谁回话 */
  readonly thinking: string | null;
  /** 上一次 AI 出问题时的说明 */
  readonly note: string | null;
  readonly provider: string;
  /** 接的是大模型（不是离线） */
  readonly online: boolean;
  /** 每个人的 AI 会话 id（多轮对话接着上一轮） */
  readonly sessions: Record<string, string>;
  /** 今年请 AI 定打算的人 */
  readonly decided: readonly string[];
}

export type ToHost =
  | { channel: typeof CHANNEL; kind: 'state'; world: World; souls: SoulView[]; ai: AiView; outcome?: string | null }
  | { channel: typeof CHANNEL; kind: 'stream'; id: string; text: string };
