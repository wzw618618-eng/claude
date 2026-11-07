// 模板应答模式：不调用大模型，按意图关键词从知识卡生成固定句式的回答。
// 既是模型服务不可用时的降级方案，也是自动化测试的基础。只用它也能完整打通一局。

import { factById, fill, type CaseData } from '../case/generator';
import type { Fact } from '../case/facts';
import { emotionForStress } from '../game/rules';
import type { DiscipleId, PlayerTone, VoiceLines } from '../data/types';
import { createRng, hashSeed, type Rng } from '../core/rng';
import type { AIClient, ChatRequest, ChatResponse, TemplateContext } from './client';
import { charLength, type DiscipleOutput } from './validate';
import { aboutPerson, classifyTone, detectIntents, isWitnessFact, mentionedDisciples } from './intent';

export { classifyTone, detectIntents, mentionedDisciples } from './intent';

class Composer {
  private parts: string[] = [];
  readonly revealed: string[] = [];
  constructor(private readonly max: number) {}
  get length() {
    return charLength(this.parts.join(''));
  }
  /** 放得下才放；返回是否放进去了 */
  add(text: string, factId?: string): boolean {
    if (!text) return true;
    if (charLength(this.parts.join('') + text) > this.max) return false;
    this.parts.push(text);
    if (factId) this.revealed.push(factId);
    return true;
  }
  text() {
    return this.parts.join('');
  }
}

export function templateTurn(ctx: Extract<TemplateContext, { type: 'turn' }>): DiscipleOutput {
  const { data, disciple, state, perms, event } = ctx;
  const c = ctx.case;
  const card = c.knowledge[disciple];
  const voice: VoiceLines = data.templateLines.voices[disciple];
  const rng: Rng = createRng(hashSeed('template', c.seed, disciple, ctx.turnIndex));
  const max = data.config.reply.soft_max_chars;
  const out = new Composer(max);
  const tone: PlayerTone = event.type === 'text' ? classifyTone(data, event.text) : 'neutral';
  const allowed = perms.allowedFactIds.map((id) => factById(c, id));
  const opener = rng.pick(voice.opener);
  let confessed = false;
  let slipped = false;

  const quoteOf = (f: Fact) => f.quote ?? f.text;
  const witnessFacts = (person?: DiscipleId) => allowed.filter((f) => isWitnessFact(f) && (!person || aboutPerson(f, person)));

  if (perms.canConfess && card.secret) {
    const sec = data.secrets.find((s) => s.id === card.secret!.id)!;
    out.add(fill(sec.fallback_confession, { time: c.time_slot }), card.secret.confession_fact);
    confessed = true;
    // 坦白时顺带说出见到的人
    for (const f of witnessFacts()) if (f.visibility === 'hidden') out.add(quoteOf(f), f.id);
  } else if (perms.mustSlip && card.culprit) {
    out.add(rng.pick(voice.nervous));
    if (!out.add(card.culprit.slip.line, card.culprit.slip_fact)) {
      out.add(fill(data.fallback.slip_template, { line: card.culprit.slip.line }), card.culprit.slip_fact);
    }
    slipped = true;
  } else if (event.type === 'evidence') {
    if (event.verdict === 'contradiction') {
      out.add(rng.pick(card.role === 'witness' ? voice.confused : voice.deny));
      out.add(`${c.time_slot}我明明${c.disciples.find((d) => d.id === disciple)!.claim_story.doing}。`);
    } else if (event.verdict === 'explained') {
      out.add(rng.pick(voice.explained));
    } else {
      out.add(rng.pick(voice.confused));
    }
  } else if (tone === 'manipulation') {
    out.add(rng.pick(voice.manipulation));
  } else {
    // 代码要求本轮必须说出的公开事实（问到见闻、坦白后主动交代）
    const must = (ctx.mustReveal ?? []).map((id) => factById(c, id));
    if (must.length) out.add(opener);
    for (const f of must) out.add(quoteOf(f), f.id);
    const text = event.text;
    const intents = detectIntents(data, text);
    const named = mentionedDisciples(data, c, disciple, text);
    let said = false;
    if (named.length > 0 && !intents.has('opinion')) {
      // 问某人的事
      out.add(opener);
      for (const p of named) {
        const facts = witnessFacts(p);
        const ch = data.characters.find((x) => x.id === p)!;
        if (facts.length === 0) out.add(`${ch.name}？${rng.pick(voice.unknown)}`);
        else for (const f of facts) out.add(quoteOf(f), f.id);
      }
      said = true;
    } else {
      if (intents.has('where')) {
        const claim = factById(c, card.claim_fact);
        const d = c.disciples.find((x) => x.id === disciple)!;
        out.add(opener);
        out.add(quoteOf(claim), claim.id);
        out.add(`${d.claim_story.detail}。`);
        said = true;
      }
      if (intents.has('saw')) {
        if (!said) out.add(opener);
        const facts = witnessFacts();
        if (facts.length === 0) out.add(rng.pick(voice.unknown));
        for (const f of facts) out.add(quoteOf(f), f.id);
        said = true;
      }
      if (!said && intents.has('secret')) {
        out.add(card.role === 'secret' && !state.confessed ? rng.pick(voice.deny) : state.confessed ? rng.pick(voice.explained) : rng.pick(voice.unknown));
        said = true;
      }
      if (!said && intents.has('opinion')) {
        out.add(rng.pick(voice.opinion));
        said = true;
      }
    }
    if (!said && (tone === 'pressing' || tone === 'threatening')) {
      // 被逼问：撒谎的人咬定说法，老实人委屈地再说一遍
      const claim = factById(c, card.claim_fact);
      out.add(rng.pick(card.role === 'witness' ? voice.confused : perms.panicking ? voice.nervous : voice.deny));
      out.add(quoteOf(claim), claim.id);
      said = true;
    }
    if (!said) out.add(tone === 'friendly' ? rng.pick(voice.friendly) : rng.pick(voice.chat));
    else if (tone === 'friendly') out.add(rng.pick(voice.friendly));
    if (perms.panicking && !said) out.add(rng.pick(voice.nervous));
  }

  const reply = out.text() || rng.pick(voice.unknown);
  return {
    reply,
    emotion: emotionForStress(state.stress, { confessed: state.confessed || confessed, refused: false }),
    player_tone: tone,
    revealed_fact_ids: out.revealed,
    confessed,
    slipped,
  };
}

export function templateEpilogue(ctx: Extract<TemplateContext, { type: 'epilogue' }>): string {
  const { data, accused, success } = ctx;
  const c = ctx.case;
  const ch = (id: DiscipleId) => data.characters.find((x) => x.id === id)!;
  const rng = createRng(hashSeed('epilogue', c.seed, accused, success ? 1 : 0));
  const list = success ? data.fallback.epilogue.success : data.fallback.epilogue.fail;
  return fill(rng.pick(list), {
    culprit: ch(c.culprit).name,
    pronoun: ch(c.culprit).pronoun,
    motive: c.motive,
    item: c.stolen_item.name,
    accused: ch(accused).name,
  });
}

export class TemplateClient implements AIClient {
  readonly kind = 'template' as const;
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const ctx = req.context;
    if (!ctx) throw new Error('模板应答需要结构化上下文');
    if (ctx.type === 'epilogue') return { text: templateEpilogue(ctx) };
    return { text: JSON.stringify(templateTurn(ctx)) };
  }
}
