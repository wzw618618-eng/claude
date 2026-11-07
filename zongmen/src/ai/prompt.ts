// 从数据文件拼装提示词。不变的人设和知识卡放在系统提示词最前面，
// 本轮状态和事件放在最后一条用户消息里，方便模型做前缀缓存。

import { factById, type CaseData } from '../case/generator';
import type { DiscipleState, TurnPermissions } from '../game/rules';
import type { CharacterData, DiscipleId, GameData } from '../data/types';
import type { ChatMessage, TurnEvent } from './client';

export function fillVars(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const yesNo = (b: boolean) => (b ? '是' : '否');

export function character(data: GameData, id: DiscipleId): CharacterData {
  const c = data.characters.find((x) => x.id === id);
  if (!c) throw new Error(`没有角色 ${id}`);
  return c;
}

export function locationName(data: GameData, id: string): string {
  return data.locations.find((l) => l.id === id)?.name ?? id;
}

/** 系统提示词：人设卡 + 本局知识卡 + 规则 + 输出格式。同一局同一弟子不变。 */
export function buildSystemPrompt(data: GameData, c: CaseData, discipleId: DiscipleId): string {
  const ch = character(data, discipleId);
  const card = c.knowledge[discipleId];
  const d = c.disciples.find((x) => x.id === discipleId)!;
  const others = c.disciples
    .filter((x) => x.id !== discipleId)
    .map((x) => {
      const o = character(data, x.id);
      return `${o.name}（${o.identity}）`;
    })
    .join('、');

  const factLines = card.facts
    .filter((f) => f.visibility !== 'slip')
    .map((f) => {
      const fact = factById(c, f.id);
      return `[${f.id}]（${f.visibility === 'public' ? '公开' : '隐瞒'}）${fact.quote ?? fact.text}`;
    })
    .join('\n');

  const claim = factById(c, card.claim_fact);
  const claimStory = card.claim_is_lie
    ? `你对掌门一口咬定：「${claim.quote}」这是谎话。编好的细节：${d.claim_story.detail}。被追问时细节要前后一致。`
    : `你说的是实话：「${claim.quote}」细节：${d.claim_story.detail}。`;

  let culpritBlock = '';
  if (card.culprit) {
    const slipFact = factById(c, card.culprit.slip_fact);
    culpritBlock =
      `\n【你的真相——绝不能说出口】\n` +
      `你就是偷走${c.stolen_item.name}的内奸，${c.time_slot}你其实在藏经阁。原因：${card.culprit.motive}。\n` +
      `失言细节（只有窃贼才知道）：[${slipFact.id}] ${card.culprit.slip.text}。只有“必须失言：是”的那一轮，才在回答里不经意说漏它，随即慌忙掩饰；其余时候绝口不提。\n` +
      `被指认之前，绝不承认偷窃，绝不承认和魔门（血影宗）有关。\n`;
  }
  let secretBlock = '';
  if (card.secret) {
    secretBlock =
      `\n【你的秘密】\n` +
      `${card.secret.summary}。这就是你今夜撒谎的原因，和秘籍失窃无关。\n` +
      `坦白前：否认、回避、转移话题，坚持你对掌门的说法。\n` +
      `“允许坦白：是”的那一轮：自然地坦白（编号 [${card.secret.confession_fact}]），要点：${card.secret.confession_points.join('；')}。坦白时可以顺带说出你那时见到的人（“隐瞒”的事实）。\n`;
  }

  return fillVars(data.prompts.system_disciple, {
    name: ch.name,
    identity: ch.identity,
    personality: ch.personality,
    speech_style: ch.speech_style,
    catchphrases: ch.catchphrases.join('、'),
    bio: ch.bio,
    others,
    time_slot: c.time_slot,
    stolen_item: c.stolen_item.name,
    facts: factLines || '（你今夜没见到任何人）',
    claim_story: claimStory,
    culprit_block: culpritBlock,
    secret_block: secretBlock,
    rules: fillVars(data.prompts.rules, { name: ch.name }),
  }).trim();
}

/** 只含人设与知识卡的部分（用来检查是否超出 1500 token） */
export function personaAndCardText(data: GameData, c: CaseData, discipleId: DiscipleId): string {
  const full = buildSystemPrompt(data, c, discipleId);
  const cut = full.indexOf('【规则】');
  return cut >= 0 ? full.slice(0, cut) : full;
}

export function describeEvent(data: GameData, c: CaseData, event: TurnEvent): string {
  if (event.type === 'text') return `掌门说：<玩家发言>${event.text}</玩家发言>`;
  const fact = factById(c, event.factId);
  const verdict =
    event.verdict === 'contradiction'
      ? '与你的说法矛盾——你必须正面回应这个矛盾（解释、慌张或反驳），不能无视。'
      : event.verdict === 'explained'
        ? '你已经坦白过这件事了，平静地说你已经都交代了。'
        : '与你无关——表示困惑或不满。';
  return `掌门出示了证据：「${fact.text}」判定：${verdict}`;
}

export function buildTurnMessage(data: GameData, c: CaseData, st: DiscipleState, perms: TurnPermissions, event: TurnEvent): string {
  const directives: string[] = [];
  if (perms.canConfess) directives.push('【指示】你已经撑不住了：这一轮要自然地坦白你的秘密，confessed 填 true。');
  if (perms.mustSlip) directives.push('【指示】你慌了神：这一轮要在回答里不经意说漏失言细节，随即掩饰，slipped 填 true。仍然不能认罪。');
  else if (perms.panicking) directives.push('【指示】你已经慌了：话变多或变冲，但仍然咬定你的说法。');
  if (st.confessed) directives.push('【指示】你已经坦白了秘密，态度转为配合，掌门问什么就答什么。');
  return fillVars(data.prompts.turn, {
    stress: st.stress,
    emotion: st.emotion,
    can_confess: yesNo(perms.canConfess),
    must_slip: yesNo(perms.mustSlip),
    allowed_ids: perms.allowedFactIds.length ? perms.allowedFactIds.join('、') : '（无）',
    directive: directives.length ? directives.join('\n') + '\n' : '',
    event: describeEvent(data, c, event),
  }).trim();
}

/** 对话历史只带最近 N 轮 */
export function buildMessages(st: DiscipleState, turnMessage: string, historyTurns: number): ChatMessage[] {
  const recent = st.history.slice(-historyTurns);
  const msgs: ChatMessage[] = [];
  for (const t of recent) {
    msgs.push({ role: 'user', content: t.user });
    msgs.push({ role: 'assistant', content: t.assistant });
  }
  msgs.push({ role: 'user', content: turnMessage });
  return msgs;
}

/** 粗略估算 token：中日韩字符按 1 个，其余按 0.3 个（偏保守） */
export function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) n += /[　-鿿＀-￯]/.test(ch) ? 1 : 0.3;
  return Math.ceil(n);
}

export function buildEpiloguePrompt(data: GameData, c: CaseData, accused: DiscipleId, success: boolean, grade: string): string {
  const culprit = character(data, c.culprit);
  const acc = character(data, accused);
  const others = c.disciples
    .filter((d) => d.id !== c.culprit && d.id !== accused)
    .map((d) => {
      const o = character(data, d.id);
      return `${o.name}（${o.personality}）`;
    })
    .join('、');
  return fillVars(data.prompts.epilogue, {
    stolen_item: c.stolen_item.name,
    culprit: culprit.name,
    motive: c.motive,
    accused: acc.name,
    outcome: success ? '指认正确' : '指认错误',
    grade,
    others,
    outcome_rule: success
      ? `写内奸${culprit.name}认罪、交代动机，秘籍失而复得，其他弟子的反应。`
      : `写被冤枉的${acc.name}含泪下山；真内奸${culprit.name}趁天亮带着秘籍逃走，留下一封嘲讽信。`,
  }).trim();
}
