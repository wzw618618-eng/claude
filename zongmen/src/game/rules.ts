// 规则：压力、坦白与失言权限、拒答、评级。全部由代码计算，大模型只负责演出。

import type { CaseData, KnowledgeCard } from '../case/generator';
import type { DiscipleId, Emotion, GameConfig, PlayerTone } from '../data/types';

export interface ChatTurn {
  /** 发给模型的本轮用户消息（含状态与事件） */
  user: string;
  /** 校验后的模型输出 JSON */
  assistant: string;
}

export interface DiscipleState {
  disciple: DiscipleId;
  stress: number;
  emotion: Emotion;
  confessed: boolean;
  slipped: boolean;
  refused: boolean;
  /** 已出示过的证据 */
  presented: string[];
  /** 是否已被出示过成立的矛盾（坦白的前提） */
  presentedContradiction: boolean;
  history: ChatTurn[];
}

export function initialDiscipleState(disciple: DiscipleId): DiscipleState {
  return {
    disciple,
    stress: 0,
    emotion: 'calm',
    confessed: false,
    slipped: false,
    refused: false,
    presented: [],
    presentedContradiction: false,
    history: [],
  };
}

export const clampStress = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export type EvidenceVerdict = 'contradiction' | 'irrelevant' | 'repeat' | 'explained';

/** 出示证据的判定：矛盾关系由案件生成器预先算好，不让大模型判断 */
export function judgeEvidence(c: CaseData, st: DiscipleState, factId: string): EvidenceVerdict {
  if (st.presented.includes(factId)) return 'repeat';
  const hit = c.contradictions.some((x) => x.evidence === factId && x.target === st.disciple);
  if (!hit) return 'irrelevant';
  // 已经坦白的人，谎话已经收回，再拿矛盾来问只是旧事重提
  if (st.confessed) return 'explained';
  return 'contradiction';
}

export function evidenceStressDelta(verdict: EvidenceVerdict, cfg: GameConfig): number {
  if (verdict === 'contradiction') return cfg.stress.contradiction;
  if (verdict === 'irrelevant') return cfg.stress.irrelevant_evidence;
  return 0;
}

export function toneStressDelta(tone: PlayerTone, cfg: GameConfig): number {
  return cfg.stress.tone[tone] ?? 0;
}

export interface TurnPermissions {
  canConfess: boolean;
  mustSlip: boolean;
  /** 内奸压力 ≥ 70：慌乱，话变多或变冲 */
  panicking: boolean;
  /** 本轮允许透露的事实 id */
  allowedFactIds: string[];
}

export function permissions(card: KnowledgeCard, st: DiscipleState, cfg: GameConfig): TurnPermissions {
  const canConfess =
    card.role === 'secret' && !st.confessed && st.presentedContradiction && st.stress >= cfg.stress.confess_at;
  const mustSlip = card.role === 'culprit' && !st.slipped && st.stress >= cfg.stress.culprit_slip_at;
  const panicking = card.role === 'culprit' && st.stress >= cfg.stress.culprit_panic_at;
  const allowedFactIds = card.facts
    .filter((f) => {
      if (f.visibility === 'public') return true;
      if (f.visibility === 'hidden') return st.confessed || canConfess;
      return mustSlip; // slip
    })
    .map((f) => f.id);
  return { canConfess, mustSlip, panicking, allowedFactIds };
}

/** 还有没演完的坦白或失言：压力到 100 时先让他说完，再拒答 */
export function hasPendingReveal(card: KnowledgeCard, st: DiscipleState, cfg: GameConfig): boolean {
  const p = permissions(card, st, cfg);
  return p.canConfess || p.mustSlip;
}

export function shouldRefuse(card: KnowledgeCard, st: DiscipleState, cfg: GameConfig): boolean {
  return st.stress >= cfg.stress.refuse_at && !hasPendingReveal(card, st, cfg);
}

export type Grade = 'S' | 'A' | 'B' | 'fail';

export interface Rating {
  grade: Grade;
  correct: boolean;
  validEvidence: string[];
}

/** 指认评级：S 神探 / A 破案 / B 侥幸 / 失败 */
export function rate(c: CaseData, accused: DiscipleId, evidence: string[], remaining: number, cfg: GameConfig): Rating {
  const picked = [...new Set(evidence)];
  const validEvidence = picked.filter((id) => c.conviction_set.includes(id));
  const correct = accused === c.culprit;
  let grade: Grade = 'fail';
  if (correct) {
    if (validEvidence.length >= 2 && remaining >= cfg.rating.s_min_remaining) grade = 'S';
    else if (validEvidence.length >= 1) grade = 'A';
    else grade = 'B';
  }
  return { grade, correct, validEvidence };
}

export const GRADE_NAMES: Record<Grade, string> = { S: 'S 神探', A: 'A 破案', B: 'B 侥幸', fail: '失败' };

/** 按压力给一个默认情绪（模板应答和兜底用） */
export function emotionForStress(stress: number, st: Pick<DiscipleState, 'confessed' | 'refused'>): Emotion {
  if (st.refused) return 'angry';
  if (st.confessed) return 'relieved';
  if (stress >= 85) return 'scared';
  if (stress >= 60) return 'nervous';
  if (stress >= 30) return 'nervous';
  return 'calm';
}
