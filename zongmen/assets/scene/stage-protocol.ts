// 界面 → 引擎的舞台指令。界面决定演什么，引擎负责画出来。

import type { CameraShot } from './layout';

export type Pose = 'idle' | 'talk' | 'nervous' | 'down';

export type StageCommand =
  /** 镜头移到某个机位；instant 为真时直接切过去 */
  | { kind: 'shot'; shot: CameraShot; instant?: boolean }
  /** 本局在场的 5 名弟子，按广场站位从左到右 */
  | { kind: 'cast'; ids: string[] }
  /** 某个角色的动作 */
  | { kind: 'pose'; id: string; pose: Pose }
  /** 严长老是否在场 */
  | { kind: 'elder'; visible: boolean };

export type StageMessage = StageCommand & { channel: 'zongmen/stage' };

export function isStageMessage(value: unknown): value is StageMessage {
  return !!value && typeof value === 'object' && (value as { channel?: unknown }).channel === 'zongmen/stage';
}
