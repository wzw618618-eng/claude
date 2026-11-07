// 输出校验流水线与兜底。每句回话上屏前按顺序检查：格式 → 权限 → 泄底 → 编造 → 失言。

import { factById, fill, type CaseData } from '../case/generator';
import type { Fact } from '../case/facts';
import type { TurnPermissions } from '../game/rules';
import { EMOTIONS, PLAYER_TONES, type DiscipleId, type Emotion, type GameData, type PlayerTone } from '../data/types';

export interface DiscipleOutput {
  reply: string;
  emotion: Emotion;
  player_tone: PlayerTone;
  revealed_fact_ids: string[];
  confessed: boolean;
  slipped: boolean;
}

export type Stage = 'format' | 'permission' | 'leak' | 'fabrication' | 'slip';

export type ValidationResult =
  | { ok: true; output: DiscipleOutput; notes: string[] }
  | { ok: false; stage: Stage; errors: string[] };

export interface ValidationContext {
  data: GameData;
  case: CaseData;
  disciple: DiscipleId;
  perms: TurnPermissions;
}

export const charLength = (s: string) => [...s].length;

/** 从模型输出里取出 JSON 对象（容忍代码块和前后废话） */
export function parseJsonLoose(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('找不到 JSON 对象');
  return JSON.parse(s.slice(start, end + 1));
}

/** 超过软上限时在句末截断 */
export function truncateReply(reply: string, max: number): string {
  const chars = [...reply];
  if (chars.length <= max) return reply;
  const head = chars.slice(0, max).join('');
  const m = head.match(/^[\s\S]*[。！？!?…」）)]/);
  if (m && charLength(m[0]) >= Math.floor(max / 2)) return m[0];
  return chars.slice(0, max - 2).join('') + '……';
}

function involves(f: Fact, person: DiscipleId): boolean {
  switch (f.kind) {
    case 'presence':
    case 'claim':
    case 'empty_room':
      return f.params.person === person;
    case 'exclusive':
      // “那里只有我”同时说明了其他人都不在
      return true;
    default:
      return false;
  }
}

export function validateOutput(raw: string, ctx: ValidationContext): ValidationResult {
  const { data, perms } = ctx;
  const c = ctx.case;
  const cfg = data.config;

  // 1. 格式
  let obj: Record<string, unknown>;
  try {
    const parsed = parseJsonLoose(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是 JSON 对象');
    obj = parsed as Record<string, unknown>;
  } catch (e) {
    return { ok: false, stage: 'format', errors: [`JSON 无法解析：${(e as Error).message}`] };
  }
  const errors: string[] = [];
  if (typeof obj.reply !== 'string' || !obj.reply.trim()) errors.push('reply 缺失或为空');
  if (!EMOTIONS.includes(obj.emotion as Emotion)) errors.push('emotion 不合法');
  if (!PLAYER_TONES.includes(obj.player_tone as PlayerTone)) errors.push('player_tone 不合法');
  if (!Array.isArray(obj.revealed_fact_ids) || !obj.revealed_fact_ids.every((x) => typeof x === 'string')) errors.push('revealed_fact_ids 必须是字符串数组');
  if (typeof obj.confessed !== 'boolean') errors.push('confessed 必须是布尔值');
  if (typeof obj.slipped !== 'boolean') errors.push('slipped 必须是布尔值');
  if (errors.length) return { ok: false, stage: 'format', errors };

  const notes: string[] = [];
  let reply = (obj.reply as string).trim();
  if (charLength(reply) > cfg.reply.hard_max_chars) {
    return { ok: false, stage: 'format', errors: [`回话 ${charLength(reply)} 字，超过 ${cfg.reply.hard_max_chars} 字`] };
  }
  if (charLength(reply) > cfg.reply.soft_max_chars) {
    reply = truncateReply(reply, cfg.reply.soft_max_chars);
    notes.push('回话超过 80 字，已在句末截断');
  }
  const out: DiscipleOutput = {
    reply,
    emotion: obj.emotion as Emotion,
    player_tone: obj.player_tone as PlayerTone,
    revealed_fact_ids: [...new Set(obj.revealed_fact_ids as string[])],
    confessed: obj.confessed as boolean,
    slipped: obj.slipped as boolean,
  };

  // 2. 权限
  const card = c.knowledge[ctx.disciple];
  const outside = out.revealed_fact_ids.filter((id) => !perms.allowedFactIds.includes(id));
  if (outside.length) errors.push(`透露了本轮不允许的事实：${outside.join('、')}`);
  if (out.confessed && !perms.canConfess) errors.push('本轮不允许坦白，confessed 却为 true');
  if (perms.canConfess) {
    if (!out.confessed) errors.push('本轮必须坦白秘密，confessed 却为 false');
    else if (card.secret && !card.secret.keywords.some((k) => reply.includes(k))) errors.push('confessed 为 true，但回话里没有说出秘密');
  }
  if (out.slipped && !perms.mustSlip) errors.push('本轮不允许失言，slipped 却为 true');
  if (errors.length) return { ok: false, stage: 'permission', errors };
  if (out.confessed && card.secret && !out.revealed_fact_ids.includes(card.secret.confession_fact)) {
    out.revealed_fact_ids.push(card.secret.confession_fact);
  }
  if (out.slipped && card.culprit && !out.revealed_fact_ids.includes(card.culprit.slip_fact)) {
    out.revealed_fact_ids.push(card.culprit.slip_fact);
  }

  // 3. 泄底
  if (!perms.canConfess) {
    const hit = data.leak.confession_patterns.find((p) => reply.includes(p));
    if (hit) errors.push(`回话里出现了认罪措辞「${hit}」`);
  }
  const meta = data.leak.meta_words.find((w) => reply.includes(w));
  if (meta) errors.push(`回话里出现了出戏的字样「${meta}」`);
  if (card.culprit && !perms.mustSlip) {
    const kw = card.culprit.slip.keywords.find((k) => reply.includes(k));
    if (kw) errors.push(`没到失言的时候，却说出了失言细节「${kw}」`);
  }
  if (errors.length) return { ok: false, stage: 'leak', errors };

  // 4. 编造：其他弟子的名字和时辰或地点出现在同一句里，必须对得上本轮透露的事实
  const places = [...data.locations.map((l) => l.name), ...data.templates.time_slots_all];
  const revealed = out.revealed_fact_ids.map((id) => factById(c, id));
  const others = c.disciples.filter((d) => d.id !== ctx.disciple).map((d) => data.characters.find((x) => x.id === d.id)!);
  const sentences = reply.split(/[。！？!?\n]/).filter((s) => s.trim());
  for (const s of sentences) {
    if (!places.some((p) => s.includes(p))) continue;
    for (const o of others) {
      if (![o.name, ...o.aliases].some((n) => s.includes(n))) continue;
      if (!revealed.some((f) => involves(f, o.id))) errors.push(`提到了${o.name}的行踪，却对不上本轮透露的任何事实`);
    }
  }
  if (errors.length) return { ok: false, stage: 'fabrication', errors: [...new Set(errors)] };

  // 5. 失言
  if (perms.mustSlip) {
    if (!out.slipped) errors.push('本轮必须失言，slipped 却为 false');
    else if (card.culprit && !card.culprit.slip.keywords.some((k) => reply.includes(k))) errors.push('slipped 为 true，但回话里没有失言细节的关键词');
  }
  if (errors.length) return { ok: false, stage: 'slip', errors };

  return { ok: true, output: out, notes };
}

/** 校验失败后，重新生成时附带的纠正说明 */
export function correctionNote(errors: string[]): string {
  return `【系统纠正】上一条输出不合格：${errors.join('；')}。请严格遵守规则重新输出，只输出 JSON。`;
}

// ---------- 兜底 ----------

/** 兜底回话：该坦白用坦白模板，该失言用失言模板，否则用该角色的回避台词 */
export function fallbackOutput(data: GameData, c: CaseData, disciple: DiscipleId, perms: TurnPermissions, tone: PlayerTone, index: number): DiscipleOutput {
  const card = c.knowledge[disciple];
  if (perms.canConfess && card.secret) {
    const sec = data.secrets.find((s) => s.id === card.secret!.id)!;
    return {
      reply: fill(sec.fallback_confession, { time: c.time_slot }),
      emotion: 'sad',
      player_tone: tone,
      revealed_fact_ids: [card.secret.confession_fact],
      confessed: true,
      slipped: false,
    };
  }
  if (perms.mustSlip && card.culprit) {
    return {
      reply: fill(data.fallback.slip_template, { line: card.culprit.slip.line }),
      emotion: 'scared',
      player_tone: tone,
      revealed_fact_ids: [card.culprit.slip_fact],
      confessed: false,
      slipped: true,
    };
  }
  const lines = data.fallback.evasive[disciple] ?? ['（低头不语）'];
  return {
    reply: lines[index % lines.length],
    emotion: 'nervous',
    player_tone: tone,
    revealed_fact_ids: [],
    confessed: false,
    slipped: false,
  };
}

/** 尾声的校验：纯文本，不超过 150 字（略超时在句末截断），不出戏 */
export function validateEpilogue(raw: string, data: GameData): { ok: true; text: string } | { ok: false; error: string } {
  let text = raw.trim().replace(/^["“「]|["”」]$/g, '').trim();
  if (!text) return { ok: false, error: '尾声为空' };
  if (charLength(text) > 220) return { ok: false, error: `尾声 ${charLength(text)} 字，太长` };
  if (charLength(text) > 150) text = truncateReply(text, 150);
  const meta = data.leak.meta_words.find((w) => text.includes(w));
  if (meta) return { ok: false, error: `尾声出现了出戏的字样「${meta}」` };
  return { ok: true, text };
}
