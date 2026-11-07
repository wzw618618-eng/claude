// 求解器：假设玩家拿到了全部可获取的事实（含坦白和失言），校验案件可解。
// 推理部分只看事实的结构化参数；真实位置只用来核对事实本身没有写错。

import type { DiscipleId, GameData } from '../data/types';
import { deriveContradictions, placements, type Fact } from './facts';
import type { CaseData } from './generator';

export interface SolveResult {
  ok: boolean;
  errors: string[];
  /** 拥有特征线索的嫌疑人 */
  suspects: DiscipleId[];
  /** 没有被他人证实不在场的嫌疑人 */
  unconfirmed: DiscipleId[];
  /** 打破内奸说法的证据 */
  culpritBreakers: string[];
  /** 每名嫌疑人的不在场证明来源 */
  alibis: Record<DiscipleId, string[]>;
}

/** 某条事实能否作为 X 的“他人证实”不在场证明 */
function confirmsAlibi(f: Fact, x: DiscipleId, facts: readonly Fact[]): boolean {
  const places = placements(f).filter((p) => p.person === x && p.location !== 'library');
  if (places.length === 0) return false;
  // 物证：指向本人的物证
  if (f.source === 'investigation') return true;
  // 别人的证词
  if (f.holder && f.holder !== x && f.source === 'testimony') return true;
  // 本人坦白：必须同时有指向本人、地点一致的物证
  if (f.source === 'confession' && f.holder === x) {
    return facts.some(
      (e) => e.source === 'investigation' && placements(e).some((p) => p.person === x && places.some((q) => q.location === p.location)),
    );
  }
  return false;
}

export function solveCase(c: CaseData, data: GameData): SolveResult {
  const errors: string[] = [];
  const cfg = data.config.generator;
  const present = c.disciples.map((d) => d.id);
  const charById = new Map(data.characters.map((ch) => [ch.id, ch]));
  const truth = new Map(c.disciples.map((d) => [d.id, d.true_location]));

  // 0. 事实本身必须属实、可获取
  for (const f of c.facts) {
    if (f.source === 'investigation' && !f.found_at) errors.push(`${f.id} 是物证却没有地点`);
    if (f.source !== 'investigation' && (!f.holder || !present.includes(f.holder))) errors.push(`${f.id} 没有在场的知情人`);
    if (f.visibility === 'hidden') {
      const holder = c.disciples.find((d) => d.id === f.holder);
      if (!holder || holder.role !== 'secret') errors.push(`${f.id} 被隐瞒，但知情人不会坦白`);
    }
    if (f.visibility === 'slip' && f.holder !== c.culprit) errors.push(`${f.id} 是失言却不属于内奸`);
    for (const p of placements(f)) {
      if (truth.get(p.person) !== p.location) errors.push(`${f.id} 把人放错了地点`);
    }
    if (f.kind === 'exclusive') {
      const really = present.filter((id) => truth.get(id) === f.params.location).sort();
      if (really.join() !== [...f.params.people].sort().join()) errors.push(`${f.id} 的“只有这些人”不属实`);
    }
    if (f.kind === 'empty_room' && truth.get(f.params.person) === 'dorm') errors.push(`${f.id} 说房里没人，其实有人`);
    if (f.kind === 'inaccessible' && present.some((id) => truth.get(id) === f.params.location)) errors.push(`${f.id} 说没人进得去，其实有人`);
    if (f.kind === 'claim') {
      const d = c.disciples.find((x) => x.id === f.params.person)!;
      if (d.role === 'witness' && d.true_location !== f.params.location) errors.push(`${f.id} 老实人说了假话`);
    }
  }
  for (const id of present) {
    if (c.facts.filter((f) => f.kind === 'claim' && f.params.person === id).length !== 1) errors.push(`${id} 的说法不是恰好一条`);
  }

  // 1. 拥有特征线索的嫌疑人 2–3 名
  const traitFacts = c.facts.filter((f) => f.kind === 'trait_clue');
  if (traitFacts.length !== 1) errors.push(`特征线索应恰好 1 条，实际 ${traitFacts.length} 条`);
  const trait = traitFacts[0]?.kind === 'trait_clue' ? traitFacts[0].params.trait : undefined;
  const suspects = present.filter((id) => trait && charById.get(id)!.traits.includes(trait));
  const [minSus, maxSus] = c.tutorial ? [2, 2] : [cfg.suspects_min, cfg.suspects_max];
  if (suspects.length < minSus || suspects.length > maxSus) errors.push(`嫌疑人 ${suspects.length} 名，不在 ${minSus}–${maxSus} 之间`);

  // 2–3. 不在场证明：恰好一名嫌疑人没有被证实，就是内奸
  const alibis: Record<DiscipleId, string[]> = {};
  for (const s of suspects) alibis[s] = c.facts.filter((f) => confirmsAlibi(f, s, c.facts)).map((f) => f.id);
  const unconfirmed = suspects.filter((s) => alibis[s].length === 0);
  if (unconfirmed.length !== 1 || unconfirmed[0] !== c.culprit) {
    errors.push(`没有被证实不在场的嫌疑人是 [${unconfirmed.join(',')}]，应该只有内奸 ${c.culprit}`);
  }

  // 4. 内奸的说法至少被一条证据打破
  const contradictions = deriveContradictions(c.facts);
  const culpritClaim = c.facts.find((f) => f.kind === 'claim' && f.params.person === c.culprit);
  const culpritBreakers = contradictions.filter((x) => x.claim === culpritClaim?.id).map((x) => x.evidence);
  if (culpritBreakers.length === 0) errors.push('内奸的说法没有被任何证据打破');
  if (JSON.stringify(contradictions) !== JSON.stringify(c.contradictions)) errors.push('案件里存的矛盾对与推导结果不一致');

  // 有秘密的人的谎话也必须能被揭穿
  for (const d of c.disciples.filter((x) => x.role === 'secret')) {
    const claim = c.facts.find((f) => f.kind === 'claim' && f.params.person === d.id);
    if (!contradictions.some((x) => x.claim === claim?.id)) errors.push(`${d.id} 的谎话没有任何来源能揭穿`);
  }

  // 5. 没有事实把无辜者放在藏经阁；除内奸自己的说法外，没有事实把内奸放在别处
  for (const f of c.facts) {
    for (const p of placements(f)) {
      if (p.location === 'library' && p.person !== c.culprit) errors.push(`${f.id} 把无辜者放在了藏经阁`);
      if (p.person === c.culprit && p.location !== 'library') errors.push(`${f.id} 把内奸放在了别处`);
    }
  }

  // 6. 事实总数 10–20
  if (c.facts.length < cfg.fact_min || c.facts.length > cfg.fact_max) errors.push(`事实 ${c.facts.length} 条，不在 ${cfg.fact_min}–${cfg.fact_max} 之间`);

  // 定罪证据集至少有 2 条不靠失言就能拿到，S 评级才有可能
  const slipIds = new Set(c.facts.filter((f) => f.kind === 'slip').map((f) => f.id));
  if (c.conviction_set.filter((id) => !slipIds.has(id)).length < 2) errors.push('不靠失言的定罪证据不足 2 条');

  return { ok: errors.length === 0, errors, suspects, unconfirmed, culpritBreakers, alibis };
}
