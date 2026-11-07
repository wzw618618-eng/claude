// 脚本化的玩家：只用游戏里能拿到的信息（线索簿 + 角色档案上的特征）推理。
// 用于整局回放测试：模板应答模式下无头跑完一局。

import { deriveContradictions, placements, type Fact } from '../../assets/game/case/facts';
import type { DiscipleId, LocationId } from '../../assets/game/data/types';
import type { GameSession } from '../../assets/game/game/state';
import { quickQuestions } from '../../assets/game/game/quick';

const LOCATIONS: LocationId[] = ['library', 'dorm', 'alchemy', 'kitchen', 'training', 'bamboo', 'gate'];

export function knownFacts(game: GameSession): Fact[] {
  return game.state.clues.map((c) => game.fact(c.factId));
}

/** 只看线索簿推理出的内奸；推不出唯一一人时返回 undefined */
export function deduce(game: GameSession): { culprit?: DiscipleId; suspects: DiscipleId[]; breakers: string[] } {
  const facts = knownFacts(game);
  const trait = facts.find((f) => f.kind === 'trait_clue');
  if (!trait || trait.kind !== 'trait_clue') return { suspects: [], breakers: [] };
  const suspects = game.case.disciples
    .map((d) => d.id)
    .filter((id) => game.data.characters.find((c) => c.id === id)!.traits.includes(trait.params.trait));
  const confirmed = (x: DiscipleId) =>
    facts.some((f) => placements(f).some((p) => p.person === x && p.location !== 'library') && (f.source === 'investigation' || (f.holder && f.holder !== x)));
  const left = suspects.filter((s) => !confirmed(s));
  const culprit = left.length === 1 ? left[0] : undefined;
  const contradictions = deriveContradictions(facts);
  const breakers = culprit ? contradictions.filter((c) => c.target === culprit).map((c) => c.evidence) : [];
  return { culprit, suspects, breakers };
}

export interface BotResult {
  deduced?: DiscipleId;
  accused: DiscipleId;
  grade: string;
  questionsLeft: number;
}

/**
 * 正常推理：勘察全部地点 → 每人问“在哪”“见到谁” → 推理 → 对内奸出示矛盾 → 指认。
 * wrong=true 时故意指认一个无辜者，用来覆盖失败结局。
 */
export async function playBot(game: GameSession, opts: { wrong?: boolean; pressCulprit?: boolean } = {}): Promise<BotResult> {
  game.start();
  game.finishIntro();
  for (const l of LOCATIONS) game.investigate(l);
  const [where, saw] = quickQuestions(game);
  for (const d of game.case.disciples) {
    await game.ask(d.id, where);
    await game.ask(d.id, saw);
  }
  const { culprit, breakers } = deduce(game);
  if (culprit && opts.pressCulprit) {
    for (const b of breakers) await game.present(culprit, b);
    // 继续逼问，直到失言
    for (let i = 0; i < 8 && !game.state.disciples[culprit].slipped && game.state.questionsLeft > 0; i++) {
      await game.ask(culprit, '你还敢狡辩？老实交代！');
    }
  }
  const target = opts.wrong ? game.case.disciples.find((d) => d.id !== game.case.culprit)!.id : culprit ?? game.case.disciples[0].id;
  const evidence = [...breakers, game.state.clues.find((c) => game.fact(c.factId).kind === 'trait_clue')!.factId];
  const fill = game.state.clues.map((c) => c.factId).filter((id) => !evidence.includes(id));
  const picked = [...new Set([...evidence, ...fill])].slice(0, 2);
  const r = game.accuse(target, picked);
  if (!r.ok) throw new Error(r.error);
  await game.epilogue();
  return { deduced: culprit, accused: target, grade: r.rating.grade, questionsLeft: game.state.questionsLeft };
}
