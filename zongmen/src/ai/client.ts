// 统一的模型调用接口。三种实现共用：平台模型服务、经代理的自带 API、模板应答。
// 游戏代码只依赖这个接口，在 config/game.json 的 model.provider 里切换。

import type { CaseData } from '../case/generator';
import type { DiscipleState, EvidenceVerdict, TurnPermissions } from '../game/rules';
import type { DiscipleId, GameData } from '../data/types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type TurnEvent =
  | { type: 'text'; text: string }
  | { type: 'evidence'; factId: string; verdict: Exclude<EvidenceVerdict, 'repeat'> };

/** 模板应答需要的结构化上下文。真实模型忽略它，只看提示词。 */
export type TemplateContext =
  | {
      type: 'turn';
      data: GameData;
      case: CaseData;
      disciple: DiscipleId;
      state: DiscipleState;
      perms: TurnPermissions;
      event: TurnEvent;
      /** 本局第几次问话，用来让模板台词有变化 */
      turnIndex: number;
    }
  | {
      type: 'epilogue';
      data: GameData;
      case: CaseData;
      accused: DiscipleId;
      success: boolean;
    };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  json: boolean;
  context?: TemplateContext;
}

export interface ChatResponse {
  text: string;
  usage?: { input: number; output: number };
}

export interface AIClient {
  /** 是否是真实大模型（计入调用预算） */
  readonly kind: 'template' | 'llm';
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class AIClientError extends Error {
  constructor(
    message: string,
    readonly reason: 'timeout' | 'http' | 'network' | 'empty' | 'unconfigured',
  ) {
    super(message);
  }
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  model: string;
  /** 只在 Node（本机开发、评测）里传。浏览器里必须指向不需要密钥的自建代理。 */
  apiKey?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** OpenAI 兼容的 chat/completions 接口（DeepSeek、自建代理等） */
export class OpenAICompatibleClient implements AIClient {
  readonly kind = 'llm' as const;
  constructor(private readonly opts: OpenAICompatibleOptions) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const f = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream: false,
    };
    if (req.json) body.response_format = { type: 'json_object' };
    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new AIClientError(ctrl.signal.aborted ? '模型调用超时' : `网络错误：${String(e)}`, ctrl.signal.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new AIClientError(`模型服务返回 ${res.status}`, 'http');
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) throw new AIClientError('模型返回了空内容', 'empty');
    return {
      text,
      usage: json.usage ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 } : undefined,
    };
  }
}

/** 平台模型服务：第 0 阶段还没找到公开接口，接入前一律报“未配置”，由会话切到模板应答。 */
export class PlatformClient implements AIClient {
  readonly kind = 'llm' as const;
  async chat(): Promise<ChatResponse> {
    throw new AIClientError('造化工坊平台模型服务尚未接入', 'unconfigured');
  }
}
