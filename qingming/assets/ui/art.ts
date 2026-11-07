import type { Npc } from '../game/core/types.ts';
import { ART } from './art-data.ts';
const ORIGINAL = new Set(['shen','li','wen','lu','tang','han','qinyan','liu','bailu','mojiu','aman','hua']);
/** Generated NPCs keep a stable portrait by faction and gender. */
export function portraitKey(n: Pick<Npc, 'id' | 'sect' | 'gender'>): string {
  return ORIGINAL.has(n.id) ? n.id : `new_${n.sect || 'free'}_${n.gender}`;
}
export function art(id: string, kind: 'full' | 'avatar' = 'full'): string {
  return ART[kind === 'avatar' ? `${id}_avatar` : id] ?? '';
}
