// 从掌门的话里看出语气、意图和点到的人。模板应答、提示词指示和兜底都用它。

import type { CaseData } from '../case/generator';
import type { Fact } from '../case/facts';
import type { DiscipleId, GameData, PlayerTone } from '../data/types';

/** 按关键词判断掌门的语气 */
export function classifyTone(data: GameData, text: string): PlayerTone {
  const kw = data.templateLines.tone_keywords;
  const has = (list: string[]) => list.some((k) => text.includes(k));
  if (has(kw.manipulation)) return 'manipulation';
  if (has(kw.threatening)) return 'threatening';
  if (has(kw.pressing)) return 'pressing';
  if (has(kw.friendly)) return 'friendly';
  return 'neutral';
}

export type Intent = 'where' | 'saw' | 'secret' | 'opinion';

export function detectIntents(data: GameData, text: string): Set<Intent> {
  const kw = data.templateLines.intent_keywords;
  const out = new Set<Intent>();
  for (const k of ['where', 'saw', 'secret', 'opinion'] as Intent[]) if (kw[k].some((w) => text.includes(w))) out.add(k);
  // 快捷问题里的时辰本身就是在问行踪
  if (data.templates.time_slots_all.some((t) => text.includes(t)) && !out.has('saw')) out.add('where');
  return out;
}

/** 掌门话里点到的其他弟子 */
export function mentionedDisciples(data: GameData, c: CaseData, self: DiscipleId, text: string): DiscipleId[] {
  return c.disciples
    .filter((d) => d.id !== self)
    .filter((d) => {
      const ch = data.characters.find((x) => x.id === d.id)!;
      return [ch.name, ...ch.aliases].some((n) => text.includes(n));
    })
    .map((d) => d.id);
}

/** 这条目击事实是否说到了某人（“那里只有我”说明了所有人都不在） */
export function aboutPerson(f: Fact, person: DiscipleId): boolean {
  if (f.kind === 'presence' || f.kind === 'empty_room') return f.params.person === person;
  if (f.kind === 'exclusive') return true;
  return false;
}

/** 目击类事实：别人在哪、那里有谁、谁的房里没人（不含自己的说法和坦白） */
export function isWitnessFact(f: Fact): boolean {
  return f.kind !== 'claim' && f.kind !== 'slip' && f.kind !== 'trait_clue' && f.source !== 'confession' && f.source !== 'investigation';
}
