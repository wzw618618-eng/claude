import { GAME_DATA } from './bundle.gen';
import type { GameData } from './types';

export * from './types';

/** 默认数据包。测试或换皮时可以传入自己的 GameData。 */
export function defaultData(): GameData {
  return GAME_DATA;
}
