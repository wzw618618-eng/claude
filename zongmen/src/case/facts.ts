// 事实的结构与矛盾推导。矛盾对和求解只看结构化参数，不看文字。

import type { DiscipleId, LocationId, TraitId } from '../data/types';

export type FactKind = 'presence' | 'exclusive' | 'empty_room' | 'inaccessible' | 'claim' | 'trait_clue' | 'slip';

/** 获取方式：勘察物证、审问证词、坦白、失言 */
export type FactSource = 'investigation' | 'testimony' | 'confession' | 'slip';

/** 公开：被问到就说；隐瞒：坦白前不说；失言：只在必须失言那一轮说 */
export type Visibility = 'public' | 'hidden' | 'slip';

/** 线索簿分类 */
export type ClueCategory = 'physical' | 'testimony' | 'confession';

interface FactBase {
  id: string;
  /** 线索簿里显示的标准文本 */
  text: string;
  /** 证词类事实：持有人用第一人称说出口的话 */
  quote?: string;
  /** 知情人（证词、坦白、失言）。物证没有知情人 */
  holder?: DiscipleId;
  /** 物证所在地点（勘察可得） */
  found_at?: LocationId;
  visibility: Visibility;
  source: FactSource;
}

export type Fact = FactBase &
  (
    | { kind: 'presence'; params: { person: DiscipleId; location: LocationId } }
    | { kind: 'exclusive'; params: { location: LocationId; people: DiscipleId[] } }
    | { kind: 'empty_room'; params: { person: DiscipleId } }
    | { kind: 'inaccessible'; params: { location: LocationId } }
    | { kind: 'claim'; params: { person: DiscipleId; location: LocationId } }
    | { kind: 'trait_clue'; params: { trait: TraitId } }
    | { kind: 'slip'; params: { detail: string } }
  );

export type ClaimFact = Extract<Fact, { kind: 'claim' }>;

export interface Contradiction {
  /** 证据事实 id */
  evidence: string;
  /** 被打破的说法事实 id */
  claim: string;
  /** 说法的主人 */
  target: DiscipleId;
}

export function categoryOf(fact: Fact): ClueCategory {
  if (fact.source === 'investigation') return 'physical';
  if (fact.source === 'confession' || fact.source === 'slip') return 'confession';
  return 'testimony';
}

/**
 * 证据 E 与说法 claim(X, Y) 构成矛盾，当且仅当：
 * - E 是 presence(X, Z)，且 Z ≠ Y；
 * - E 是 exclusive(Y, S)，且 X 不在 S 中；
 * - E 是 empty_room(X)，且 Y 是弟子居所；
 * - E 是 inaccessible(Y)。
 */
export function contradicts(evidence: Fact, claim: ClaimFact): boolean {
  const { person: x, location: y } = claim.params;
  switch (evidence.kind) {
    case 'presence':
      return evidence.params.person === x && evidence.params.location !== y;
    case 'exclusive':
      return evidence.params.location === y && !evidence.params.people.includes(x);
    case 'empty_room':
      return evidence.params.person === x && y === 'dorm';
    case 'inaccessible':
      return evidence.params.location === y;
    default:
      return false;
  }
}

/** 从事实表自动推导全部矛盾对 */
export function deriveContradictions(facts: readonly Fact[]): Contradiction[] {
  const claims = facts.filter((f): f is ClaimFact => f.kind === 'claim');
  const out: Contradiction[] = [];
  for (const e of facts) {
    if (e.kind === 'claim') continue;
    for (const c of claims) {
      if (contradicts(e, c)) out.push({ evidence: e.id, claim: c.id, target: c.params.person });
    }
  }
  return out;
}

/** 这条事实是否表明某人案发时在某地（用于不在场证明和“把人放在某处”的检查） */
export function placements(fact: Fact): Array<{ person: DiscipleId; location: LocationId }> {
  switch (fact.kind) {
    case 'presence':
      return [{ person: fact.params.person, location: fact.params.location }];
    case 'exclusive':
      return fact.params.people.map((person) => ({ person, location: fact.params.location }));
    default:
      return [];
  }
}
