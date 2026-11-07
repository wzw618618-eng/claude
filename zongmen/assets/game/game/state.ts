// 一局的状态机：标题 → 开场 → 调查与审问 → 指认 → 结局。
// 状态是纯 JSON（案件按种子重新生成），界面层只负责显示和转发操作。

import { categoryOf, type ClueCategory, type Fact } from '../case/facts';
import { factById, fill, generateCase, type CaseData, type GenerateOptions } from '../case/generator';
import type { DiscipleId, GameData, LocationId } from '../data/types';
import type { AIClient } from '../ai/client';
import { runDiscipleTurn, runEpilogue, type CallBudget, type TurnSource } from '../ai/runner';
import { TemplateClient } from '../ai/templateResponder';
import {
  clampStress,
  evidenceStressDelta,
  GRADE_NAMES,
  initialDiscipleState,
  judgeEvidence,
  permissions,
  rate,
  shouldRefuse,
  toneStressDelta,
  type DiscipleState,
  type Rating,
} from './rules';

export type Phase = 'title' | 'intro' | 'investigate' | 'accuse' | 'ending';

const VERDICT_LINES = {
  contradiction: '【矛盾成立】这条证据和他的说法对不上！',
  irrelevant: '【不构成矛盾】这条证据和他的说法并不冲突。',
  explained: '【已坦白过】他已经交代过这件事了。',
} as const;

export interface ClueEntry {
  factId: string;
  order: number;
  category: ClueCategory;
  /** 证词的来源弟子 / 物证的地点 */
  via: string;
}

export interface TranscriptLine {
  from: 'player' | 'disciple' | 'system';
  text: string;
  emotion?: string;
  source?: TurnSource;
}

export interface Notice {
  from: 'elder' | 'system';
  text: string;
}

export interface CallStats {
  calls: number;
  inputTokens: number;
  /** 其中命中前缀缓存的输入 token */
  cachedInputTokens: number;
  outputTokens: number;
  totalLatencyMs: number;
  turns: number;
  fallbackTurns: number;
  templateTurns: number;
}

export interface SessionState {
  seed: number;
  tutorial: boolean;
  phase: Phase;
  questionsLeft: number;
  clues: ClueEntry[];
  visited: LocationId[];
  disciples: Record<DiscipleId, DiscipleState>;
  transcripts: Record<DiscipleId, TranscriptLine[]>;
  notices: Notice[];
  budget: CallBudget;
  stats: CallStats;
  /** 模型服务出过错，本局后面都用模板应答 */
  templateMode: boolean;
  turnIndex: number;
  /** 掌门直觉：每局 1 次，高亮一对已收集但尚未出示的矛盾 */
  intuition?: { evidence: string; claim: string; target: DiscipleId };
  /** 玩家自己标记为“矛盾”的线索对（只是笔记，不影响判定） */
  marks: Array<[string, string]>;
  ending?: { accused: DiscipleId; evidence: string[]; rating: Rating; epilogue?: string; epilogueSource?: TurnSource };
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface TurnView {
  reply: string;
  emotion: string;
  newClues: string[];
  source: TurnSource;
  refusedNow: boolean;
  verdict?: string;
}

export class GameSession {
  readonly case: CaseData;
  state: SessionState;
  private busy = false;
  private readonly templateClient = new TemplateClient();

  constructor(
    readonly data: GameData,
    private client: AIClient,
    init: { seed: number; options?: GenerateOptions } | { restore: SessionState },
  ) {
    if ('restore' in init) {
      this.case = generateCase(init.restore.seed, data, { tutorial: init.restore.tutorial });
      // 旧存档没有后来加的字段
      this.state = { ...init.restore, marks: init.restore.marks ?? [] };
    } else {
      this.case = generateCase(init.seed, data, init.options);
      this.state = GameSession.freshState(data, this.case);
    }
  }

  static freshState(data: GameData, c: CaseData): SessionState {
    const cfg = data.config;
    return {
      seed: c.seed,
      tutorial: c.tutorial,
      phase: 'title',
      questionsLeft: cfg.questions,
      clues: [],
      visited: [],
      disciples: Object.fromEntries(c.disciples.map((d) => [d.id, initialDiscipleState(d.id)])),
      transcripts: Object.fromEntries(c.disciples.map((d) => [d.id, []])),
      notices: [],
      budget: { used: 0, max: cfg.budget.max_calls_per_case },
      stats: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalLatencyMs: 0, turns: 0, fallbackTurns: 0, templateTurns: 0 },
      templateMode: false,
      turnIndex: 0,
      marks: [],
    };
  }

  get isBusy() {
    return this.busy;
  }

  private get activeClient(): AIClient {
    return this.state.templateMode ? this.templateClient : this.client;
  }

  setClient(client: AIClient) {
    this.client = client;
    this.state.templateMode = false;
  }

  name(id: DiscipleId): string {
    return this.data.characters.find((c) => c.id === id)!.name;
  }

  fact(id: string): Fact {
    return factById(this.case, id);
  }

  hasClue(id: string) {
    return this.state.clues.some((c) => c.factId === id);
  }

  private addClue(id: string, via: string): boolean {
    if (this.hasClue(id)) return false;
    const f = this.fact(id);
    this.state.clues.push({ factId: id, order: this.state.clues.length + 1, category: categoryOf(f), via });
    return true;
  }

  // ---------- 流程 ----------

  /** 严长老的开场白（脚本驱动，不调用大模型） */
  introLines(): string[] {
    const names = this.case.disciples.map((d) => `${this.name(d.id)}（${this.data.characters.find((c) => c.id === d.id)!.identity}）`).join('、');
    return this.data.templates.elder.intro.map((l) => fill(l, { time: this.case.time_slot, item: this.case.stolen_item.name, names }));
  }

  start(): void {
    if (this.state.phase === 'title') this.state.phase = 'intro';
  }

  finishIntro(): void {
    if (this.state.phase === 'intro' || this.state.phase === 'title') {
      this.state.phase = 'investigate';
      this.state.notices.push({ from: 'elder', text: this.introLines()[3] });
    }
  }

  /** 勘察地点：自动记下该处物证，不消耗问话 */
  investigate(loc: LocationId): ActionResult<{ found: string[]; text: string }> {
    if (this.state.phase !== 'investigate') return { ok: false, error: '现在不能勘察' };
    const locData = this.data.locations.find((l) => l.id === loc);
    if (!locData) return { ok: false, error: '没有这个地点' };
    if (!this.state.visited.includes(loc)) this.state.visited.push(loc);
    const ids = this.case.investigation[loc] ?? [];
    const found = ids.filter((id) => this.addClue(id, locData.name));
    return { ok: true, found, text: ids.length ? locData.desc : `${locData.desc}${locData.empty_text}` };
  }

  canInterrogate(id: DiscipleId): ActionResult {
    if (this.state.phase !== 'investigate') return { ok: false, error: '现在不能审问' };
    if (!this.state.disciples[id]) return { ok: false, error: '没有这名弟子' };
    if (this.state.disciples[id].refused) return { ok: false, error: fill(this.data.templates.elder.refused, { name: this.name(id) }) };
    if (this.state.questionsLeft <= 0) return { ok: false, error: '问话次数已经用完了' };
    if (this.busy) return { ok: false, error: '弟子还在思索，请稍候' };
    return { ok: true };
  }

  /** 清理玩家输入：限长，去掉控制字符和尖括号，防止伪造标签 */
  sanitize(text: string): string {
    const cleaned = text.replace(/[\u0000-\u001f\u007f<>＜＞〈〉《》]/g, '').trim();
    return [...cleaned].slice(0, this.data.config.input_max_chars).join('');
  }

  isBlocked(text: string): boolean {
    const lower = text.toLowerCase();
    return this.data.blocklist.words.some((w) => lower.includes(w.toLowerCase()));
  }

  async ask(id: DiscipleId, rawText: string): Promise<ActionResult<TurnView>> {
    const can = this.canInterrogate(id);
    if (!can.ok) return can;
    const text = this.sanitize(rawText);
    if (!text) return { ok: false, error: '请先输入要问的话' };
    const st = this.state.disciples[id];
    this.consumeQuestion();
    this.state.transcripts[id].push({ from: 'player', text });
    if (this.isBlocked(text)) {
      const lines = this.data.fallback.blocked;
      const reply = lines[this.state.turnIndex % lines.length];
      this.state.turnIndex++;
      this.state.transcripts[id].push({ from: 'disciple', text: reply, emotion: st.emotion, source: 'fallback' });
      this.afterQuestion();
      return { ok: true, reply, emotion: st.emotion, newClues: [], source: 'fallback', refusedNow: false };
    }
    return this.runTurn(id, { type: 'text', text });
  }

  async present(id: DiscipleId, factId: string): Promise<ActionResult<TurnView>> {
    const can = this.canInterrogate(id);
    if (!can.ok) return can;
    if (!this.hasClue(factId)) return { ok: false, error: '线索簿里没有这条证据' };
    const st = this.state.disciples[id];
    const verdict = judgeEvidence(this.case, st, factId);
    if (verdict === 'repeat') return { ok: false, error: '已经出示过了' };
    this.consumeQuestion();
    st.presented.push(factId);
    st.stress = clampStress(st.stress + evidenceStressDelta(verdict, this.data.config));
    if (verdict === 'contradiction') st.presentedContradiction = true;
    this.state.transcripts[id].push({ from: 'player', text: `（出示证据）${this.fact(factId).text}` });
    this.state.transcripts[id].push({ from: 'system', text: VERDICT_LINES[verdict] });

    const card = this.case.knowledge[id];
    if (shouldRefuse(card, st, this.data.config)) {
      // 压力到 100：拒绝再回答，不调用大模型
      st.refused = true;
      st.emotion = 'angry';
      const reply = this.data.fallback.refuse[id];
      this.state.turnIndex++;
      this.state.transcripts[id].push({ from: 'disciple', text: reply, emotion: 'angry', source: 'fallback' });
      this.afterQuestion();
      return { ok: true, reply, emotion: 'angry', newClues: [], source: 'fallback', refusedNow: true, verdict };
    }
    const view = await this.runTurn(id, { type: 'evidence', factId, verdict });
    return view.ok ? { ...view, verdict } : view;
  }

  private consumeQuestion() {
    this.state.questionsLeft = Math.max(0, this.state.questionsLeft - 1);
  }

  private afterQuestion() {
    const left = this.state.questionsLeft;
    const elder = this.data.templates.elder;
    if (left === this.data.config.dawn_warning_at) this.state.notices.push({ from: 'elder', text: fill(elder.dawn_warning, { left }) });
    if (left === 0 && this.state.phase === 'investigate') {
      this.state.phase = 'accuse';
      this.state.notices.push({ from: 'elder', text: elder.dawn });
    }
  }

  private async runTurn(id: DiscipleId, event: Parameters<typeof runDiscipleTurn>[0]['event']): Promise<ActionResult<TurnView>> {
    const st = this.state.disciples[id];
    const card = this.case.knowledge[id];
    const cfg = this.data.config;
    const perms = permissions(card, st, cfg);
    const usedBefore = this.state.budget.used;
    this.busy = true;
    let outcome;
    try {
      outcome = await runDiscipleTurn(
        { case: this.case, disciple: id, state: st, perms, event, turnIndex: this.state.turnIndex },
        { data: this.data, client: this.activeClient, budget: this.state.budget },
      );
    } finally {
      this.busy = false;
    }
    this.state.turnIndex++;
    const out = outcome.output;

    // 统计
    const s = this.state.stats;
    s.turns++;
    if (outcome.source === 'fallback') s.fallbackTurns++;
    if (outcome.source === 'template') s.templateTurns++;
    this.recordCalls(this.state.budget.used - usedBefore, outcome.attempts);
    if (outcome.clientFailed && !this.state.templateMode) {
      this.state.templateMode = true;
      this.state.notices.push({ from: 'system', text: this.data.templateLines.sleepy_notice });
    }

    // 记入线索簿：用案件事实表的标准文本，不用模型原话
    const newClues: string[] = [];
    for (const fid of out.revealed_fact_ids) {
      if (this.addClue(fid, this.name(id))) newClues.push(fid);
      if (!st.revealed.includes(fid)) st.revealed.push(fid);
    }

    if (out.confessed) {
      st.confessed = true;
      st.stress = cfg.stress.after_confess;
    } else if (event.type === 'text') {
      st.stress = clampStress(st.stress + toneStressDelta(out.player_tone, cfg));
    }
    if (out.slipped) st.slipped = true;
    st.emotion = out.emotion;
    st.history.push({ user: outcome.historyMessage, assistant: JSON.stringify(out) });

    this.state.transcripts[id].push({ from: 'disciple', text: out.reply, emotion: out.emotion, source: outcome.source });
    let refusedNow = false;
    if (shouldRefuse(card, st, cfg)) {
      st.refused = true;
      st.emotion = 'angry';
      refusedNow = true;
      this.state.transcripts[id].push({ from: 'system', text: this.data.fallback.refuse[id] });
    }
    this.afterQuestion();
    return { ok: true, reply: out.reply, emotion: st.emotion, newClues, source: outcome.source, refusedNow };
  }

  /** 掌门直觉：找一对已在线索簿里、但还没对那个人出示过的矛盾 */
  useIntuition(): ActionResult<{ evidence: string; claim: string; target: DiscipleId }> {
    if (this.state.intuition) return { ok: false, error: '掌门直觉每局只能用一次' };
    const hit = this.case.contradictions.find(
      (x) => this.hasClue(x.evidence) && this.hasClue(x.claim) && !this.state.disciples[x.target].presented.includes(x.evidence),
    );
    if (!hit) return { ok: false, error: '线索簿里还看不出哪两条对不上，先多查多问' };
    this.state.intuition = hit;
    return { ok: true, ...hit };
  }

  /** 把两条线索标记为矛盾（再标一次取消） */
  toggleMark(a: string, b: string): ActionResult<{ marked: boolean }> {
    if (a === b || !this.hasClue(a) || !this.hasClue(b)) return { ok: false, error: '要选线索簿里的两条不同线索' };
    const key = [a, b].sort() as [string, string];
    const i = this.state.marks.findIndex((m) => m[0] === key[0] && m[1] === key[1]);
    if (i >= 0) {
      this.state.marks.splice(i, 1);
      return { ok: true, marked: false };
    }
    this.state.marks.push(key);
    return { ok: true, marked: true };
  }

  /** 玩家主动进入指认 */
  beginAccusation(): ActionResult {
    if (this.state.phase !== 'investigate' && this.state.phase !== 'accuse') return { ok: false, error: '现在不能指认' };
    this.state.phase = 'accuse';
    return { ok: true };
  }

  /** 回到调查（只有问话没用完时可以） */
  cancelAccusation(): ActionResult {
    if (this.state.phase !== 'accuse' || this.state.questionsLeft <= 0) return { ok: false, error: '天已经亮了，必须指认' };
    this.state.phase = 'investigate';
    return { ok: true };
  }

  accuse(id: DiscipleId, evidence: string[]): ActionResult<{ rating: Rating }> {
    if (this.state.phase !== 'accuse' && this.state.phase !== 'investigate') return { ok: false, error: '现在不能指认' };
    if (!this.state.disciples[id]) return { ok: false, error: '没有这名弟子' };
    const picked = [...new Set(evidence)];
    if (picked.length !== 2) return { ok: false, error: '请从线索簿里选 2 条证据' };
    if (!picked.every((e) => this.hasClue(e))) return { ok: false, error: '证据必须来自线索簿' };
    const rating = rate(this.case, id, picked, this.state.questionsLeft, this.data.config);
    this.state.phase = 'ending';
    this.state.ending = { accused: id, evidence: picked, rating };
    return { ok: true, rating };
  }

  async epilogue(): Promise<string> {
    const e = this.state.ending;
    if (!e) throw new Error('还没有指认');
    if (e.epilogue) return e.epilogue;
    const usedBefore = this.state.budget.used;
    const out = await runEpilogue(this.case, e.accused, e.rating.correct, GRADE_NAMES[e.rating.grade], {
      data: this.data,
      client: this.activeClient,
      budget: this.state.budget,
    });
    this.recordCalls(this.state.budget.used - usedBefore, out.attempts);
    e.epilogue = out.text;
    e.epilogueSource = out.source;
    return out.text;
  }

  /** 真相复盘：由代码根据案件数据生成，不调用大模型 */
  truthTable(): Array<{ id: DiscipleId; name: string; role: string; truth: string; claim: string; secret?: string; flaws: string[] }> {
    const locName = (l: string) => this.data.locations.find((x) => x.id === l)!.name;
    return this.case.disciples.map((d) => {
      const card = this.case.knowledge[d.id];
      const flaws =
        d.role === 'culprit'
          ? this.case.conviction_set.map((fid) => this.fact(fid).text)
          : this.case.contradictions.filter((x) => x.target === d.id).map((x) => this.fact(x.evidence).text);
      return {
        id: d.id,
        name: this.name(d.id),
        role: d.role === 'culprit' ? '内奸' : d.role === 'secret' ? '有秘密的无辜者' : '老实的目击者',
        truth: locName(d.true_location),
        claim: locName(d.claim_location),
        secret: card.secret ? this.data.secrets.find((x) => x.id === card.secret!.id)!.review : undefined,
        flaws,
      };
    });
  }

  private recordCalls(llmCalls: number, attempts: Array<{ latencyMs: number; usage?: { input: number; output: number; cachedInput?: number } }>) {
    const s = this.state.stats;
    s.calls += llmCalls;
    if (llmCalls === 0) return;
    for (const a of attempts) {
      s.totalLatencyMs += a.latencyMs;
      s.inputTokens += a.usage?.input ?? 0;
      s.cachedInputTokens += a.usage?.cachedInput ?? 0;
      s.outputTokens += a.usage?.output ?? 0;
    }
  }

  averageLatencyMs(): number {
    const s = this.state.stats;
    return s.calls ? Math.round(s.totalLatencyMs / s.calls) : 0;
  }

  toJSON(): SessionState {
    return this.state;
  }
}
