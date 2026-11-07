// 快捷问题和“问某人的事”（中文输入不可用时的降级方案）。

import type { DiscipleId } from '../data/types';
import type { GameSession } from './state';

export function quickQuestions(game: Pick<GameSession, 'case'>): [string, string, string] {
  const t = game.case.time_slot;
  return [`${t}你在哪里？`, '那时你见到了谁？', '你怎么看这件事？'];
}

export function askAboutQuestion(game: Pick<GameSession, 'case' | 'name'>, other: DiscipleId): string {
  return `你${game.case.time_slot}见过${game.name(other)}吗？`;
}
