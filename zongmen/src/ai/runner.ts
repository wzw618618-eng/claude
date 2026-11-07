// 一轮审问的完整管线：拼提示词 → 调模型 → 校验 → 失败重生成 1 次 → 仍失败用兜底。
// 模型报错或超时时切到模板应答；单局调用超出上限后也一律用模板应答。

import type { CaseData } from '../case/generator';
import type { DiscipleState, TurnPermissions } from '../game/rules';
import type { DiscipleId, GameData, PlayerTone } from '../data/types';
import { AIClientError, type AIClient, type ChatMessage, type TemplateContext, type TurnEvent } from './client';
import { buildEpiloguePrompt, buildMessages, buildSystemPrompt, buildTurnMessage, estimateTokens } from './prompt';
import { classifyTone, TemplateClient } from './templateResponder';
import { correctionNote, fallbackOutput, validateEpilogue, validateOutput, type DiscipleOutput, type Stage } from './validate';

export interface CallBudget {
  /** 本局已用的大模型调用次数（含重新生成） */
  used: number;
  max: number;
}

export interface AttemptLog {
  raw?: string;
  error?: string;
  stage?: Stage;
  errors?: string[];
  latencyMs: number;
  usage?: { input: number; output: number };
}

export type TurnSource = 'llm' | 'template' | 'fallback';

export interface TurnOutcome {
  output: DiscipleOutput;
  source: TurnSource;
  /** 本轮发给模型的用户消息（存进对话历史） */
  userMessage: string;
  attempts: AttemptLog[];
  /** 模型服务出错，会话应切到模板应答 */
  clientFailed: boolean;
  notes: string[];
  estimatedInputTokens: number;
}

export interface RunnerDeps {
  data: GameData;
  client: AIClient;
  budget: CallBudget;
  now?: () => number;
}

export interface TurnRequest {
  case: CaseData;
  disciple: DiscipleId;
  state: DiscipleState;
  perms: TurnPermissions;
  event: TurnEvent;
  turnIndex: number;
}

const templateClient = new TemplateClient();

export async function runDiscipleTurn(req: TurnRequest, deps: RunnerDeps): Promise<TurnOutcome> {
  const { data, budget } = deps;
  const now = deps.now ?? (() => Date.now());
  const cfg = data.config;
  const system = buildSystemPrompt(data, req.case, req.disciple);
  const userMessage = buildTurnMessage(data, req.case, req.state, req.perms, req.event);
  const messages = buildMessages(req.state, userMessage, cfg.history_turns);
  const context: TemplateContext = {
    type: 'turn',
    data,
    case: req.case,
    disciple: req.disciple,
    state: req.state,
    perms: req.perms,
    event: req.event,
    turnIndex: req.turnIndex,
  };
  const estimatedInputTokens = estimateTokens(system + messages.map((m) => m.content).join(''));
  const vctx = { data, case: req.case, disciple: req.disciple, perms: req.perms };
  const playerTone: PlayerTone = req.event.type === 'text' ? classifyTone(data, req.event.text) : 'neutral';
  const attempts: AttemptLog[] = [];

  let client = deps.client;
  let clientFailed = false;
  // 单局调用用完：一律用模板应答
  if (client.kind === 'llm' && budget.used >= budget.max) client = templateClient;

  const maxAttempts = client.kind === 'llm' ? 1 + cfg.model.retries : 1;
  let convo: ChatMessage[] = messages;
  let lastErrors: string[] = [];
  for (let i = 0; i < maxAttempts; i++) {
    if (client.kind === 'llm' && budget.used >= budget.max) break;
    const t0 = now();
    let raw: string;
    try {
      if (client.kind === 'llm') budget.used++;
      const res = await client.chat({
        system,
        messages: convo,
        maxTokens: cfg.model.dialogue.max_tokens,
        temperature: cfg.model.dialogue.temperature,
        json: cfg.model.json_mode,
        context,
      });
      raw = res.text;
      attempts.push({ raw, latencyMs: now() - t0, usage: res.usage });
    } catch (e) {
      attempts.push({ error: e instanceof Error ? e.message : String(e), latencyMs: now() - t0 });
      if (e instanceof AIClientError) {
        clientFailed = true;
        continue;
      }
      throw e;
    }
    clientFailed = false;
    const v = validateOutput(raw, vctx);
    if (v.ok) {
      return { output: v.output, source: client.kind === 'llm' ? 'llm' : 'template', userMessage, attempts, clientFailed: false, notes: v.notes, estimatedInputTokens };
    }
    attempts[attempts.length - 1].stage = v.stage;
    attempts[attempts.length - 1].errors = v.errors;
    lastErrors = v.errors;
    convo = [...messages, { role: 'assistant', content: raw }, { role: 'user', content: correctionNote(v.errors) }];
  }

  // 模型服务出错（或预算用尽）：这一轮改由模板应答
  if (clientFailed || (client.kind === 'llm' && attempts.length === 0)) {
    const v = validateOutput((await templateClient.chat({ system, messages, maxTokens: 0, temperature: 0, json: true, context })).text, vctx);
    if (v.ok) return { output: v.output, source: 'template', userMessage, attempts, clientFailed, notes: v.notes, estimatedInputTokens };
  }

  return {
    output: fallbackOutput(data, req.case, req.disciple, req.perms, playerTone, req.turnIndex),
    source: 'fallback',
    userMessage,
    attempts,
    clientFailed,
    notes: lastErrors.length ? [`校验未通过，已用兜底：${lastErrors.join('；')}`] : ['已用兜底'],
    estimatedInputTokens,
  };
}

export interface EpilogueOutcome {
  text: string;
  source: TurnSource;
  attempts: AttemptLog[];
}

export async function runEpilogue(
  c: CaseData,
  accused: DiscipleId,
  success: boolean,
  grade: string,
  deps: RunnerDeps,
): Promise<EpilogueOutcome> {
  const { data, budget } = deps;
  const now = deps.now ?? (() => Date.now());
  const context: TemplateContext = { type: 'epilogue', data, case: c, accused, success };
  const attempts: AttemptLog[] = [];
  const client = deps.client;
  if (client.kind === 'llm' && budget.used < budget.max) {
    const prompt = buildEpiloguePrompt(data, c, accused, success, grade);
    const t0 = now();
    try {
      budget.used++;
      const res = await client.chat({
        system: prompt,
        messages: [{ role: 'user', content: '请写尾声。' }],
        maxTokens: data.config.model.epilogue.max_tokens,
        temperature: data.config.model.epilogue.temperature,
        json: false,
      });
      attempts.push({ raw: res.text, latencyMs: now() - t0, usage: res.usage });
      const v = validateEpilogue(res.text, data);
      if (v.ok) return { text: v.text, source: 'llm', attempts };
      attempts[attempts.length - 1].errors = [v.error];
    } catch (e) {
      attempts.push({ error: e instanceof Error ? e.message : String(e), latencyMs: now() - t0 });
    }
  }
  const text = (await templateClient.chat({ system: '', messages: [], maxTokens: 0, temperature: 0, json: false, context })).text;
  return { text, source: client.kind === 'llm' ? 'fallback' : 'template', attempts };
}
