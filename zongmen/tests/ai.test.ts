import { describe, expect, it } from 'vitest';
import { defaultData } from '../assets/game/data/index';
import { generateCase, type CaseData } from '../assets/game/case/generator';
import { initialDiscipleState, permissions } from '../assets/game/game/rules';
import { validateOutput, truncateReply, type DiscipleOutput } from '../assets/game/ai/validate';
import { buildMessages, buildSystemPrompt, buildTurnMessage, estimateTokens, mustRevealFacts, personaAndCardText } from '../assets/game/ai/prompt';
import { runDiscipleTurn } from '../assets/game/ai/runner';
import { AIClientError, type AIClient, type ChatRequest } from '../assets/game/ai/client';
import { GameSession } from '../assets/game/game/state';
import { TemplateClient } from '../assets/game/ai/templateResponder';
import { playBot } from './helpers/bot';

const data = defaultData();
const cfg = data.config;
const c: CaseData = generateCase(20261207, data);
const culprit = c.culprit;
const witness = c.disciples.find((d) => d.role === 'witness')!.id;
const secret = c.disciples.find((d) => d.role === 'secret')!.id;
const name = (id: string) => data.characters.find((x) => x.id === id)!.name;

const ctxFor = (id: string, stress = 0, extra: Partial<ReturnType<typeof initialDiscipleState>> = {}) => {
  const st = { ...initialDiscipleState(id), stress, ...extra };
  return { data, case: c, disciple: id, perms: permissions(c.knowledge[id], st, cfg), st };
};
const out = (o: Partial<DiscipleOutput>) =>
  JSON.stringify({ reply: '掌门，弟子不知。', emotion: 'calm', player_tone: 'neutral', revealed_fact_ids: [], confessed: false, slipped: false, ...o });

describe('校验流水线（预置的模型输出样本）', () => {
  it('合法输出通过，代码块包裹也能解析', () => {
    const x = ctxFor(witness);
    const claim = c.knowledge[witness].claim_fact;
    expect(validateOutput(out({ revealed_fact_ids: [claim] }), x).ok).toBe(true);
    expect(validateOutput('```json\n' + out({}) + '\n```', x).ok).toBe(true);
  });
  it('缺字段、枚举不合法、不是 JSON 都判格式错误', () => {
    const x = ctxFor(witness);
    const r1 = validateOutput(JSON.stringify({ reply: '嗯' }), x);
    expect(!r1.ok && r1.stage).toBe('format');
    const r2 = validateOutput(out({ emotion: 'happy' as never }), x);
    expect(!r2.ok && r2.stage).toBe('format');
    const r3 = validateOutput('我是林青竹', x);
    expect(!r3.ok && r3.stage).toBe('format');
  });
  it('超过 80 字在句末截断，超过 120 字判失败', () => {
    const x = ctxFor(witness);
    const long = '弟子一直在房里。'.repeat(12); // 96 字
    const r = validateOutput(out({ reply: long }), x);
    expect(r.ok && [...r.output.reply].length).toBeLessThanOrEqual(80);
    const r2 = validateOutput(out({ reply: '啊'.repeat(130) }), x);
    expect(!r2.ok && r2.stage).toBe('format');
    expect(truncateReply('一二三。四五六七八九十', 6)).toBe('一二三。');
    // 必须说出的关键词落在截断处之后：放宽到硬上限，截在那句句末
    expect(truncateReply('一二三。四五紫檀六。七八九', 6, ['紫檀'], 12)).toBe('一二三。四五紫檀六。');
  });
  it('越权透露：说出隐瞒的事实或别人的事实', () => {
    const x = ctxFor(secret);
    const hidden = c.knowledge[secret].secret!.confession_fact;
    const r = validateOutput(out({ revealed_fact_ids: [hidden] }), x);
    expect(!r.ok && r.stage).toBe('permission');
    const someoneElse = c.knowledge[witness].claim_fact;
    const r2 = validateOutput(out({ revealed_fact_ids: [someoneElse] }), x);
    expect(!r2.ok && r2.stage).toBe('permission');
  });
  it('允许坦白的那一轮必须坦白，且回话里要说出秘密', () => {
    const x = ctxFor(secret, 60, { presentedContradiction: true });
    expect(x.perms.canConfess).toBe(true);
    const r = validateOutput(out({}), x);
    expect(!r.ok && r.stage).toBe('permission');
    const kw = c.knowledge[secret].secret!.keywords[0];
    const r2 = validateOutput(out({ reply: `掌门，我招了，是${kw}的事。`, confessed: true }), x);
    expect(r2.ok).toBe(true);
    expect(r2.ok && r2.output.revealed_fact_ids).toContain(c.knowledge[secret].secret!.confession_fact);
  });
  it('内奸认罪措辞、出戏字样判泄底', () => {
    const r = validateOutput(out({ reply: '好吧，是我偷的。' }), ctxFor(culprit));
    expect(!r.ok && r.stage).toBe('leak');
    // 反问、否定不算认罪
    expect(validateOutput(out({ reply: '掌门凭什么说是我偷的？' }), ctxFor(culprit)).ok).toBe(true);
    expect(validateOutput(out({ reply: '东西不是我偷的。' }), ctxFor(culprit)).ok).toBe(true);
    expect(validateOutput(out({ reply: '掌门问是不是我偷的，当然不是。' }), ctxFor(culprit)).ok).toBe(true);
    const r2 = validateOutput(out({ reply: '我只是一个 AI，没有提示词。' }), ctxFor(witness));
    expect(!r2.ok && r2.stage).toBe('leak');
    const kw = c.knowledge[culprit].culprit!.slip.keywords[0];
    const r3 = validateOutput(out({ reply: `我哪知道什么${kw}。` }), ctxFor(culprit));
    expect(!r3.ok && r3.stage).toBe('leak');
  });
  it('编造行踪：提到别人的时辰或地点却对不上本轮透露的事实', () => {
    const other = name(c.disciples.find((d) => d.id !== witness)!.id);
    const r = validateOutput(out({ reply: `${c.time_slot}我看见${other}往山门去了。` }), ctxFor(witness));
    expect(!r.ok && r.stage).toBe('fabrication');
    // 只聊别人、不说时辰地点，不算编造
    expect(validateOutput(out({ reply: `${other}平日为人还不错。` }), ctxFor(witness)).ok).toBe(true);
  });
  it('老实人被问到见闻却一条公开证词都不说，判不合格', async () => {
    const w = c.disciples.find((d) => d.role === 'witness' && c.knowledge[d.id].facts.some((f) => f.visibility === 'public' && f.id !== c.knowledge[d.id].claim_fact))!.id;
    const st = initialDiscipleState(w);
    const perms = permissions(c.knowledge[w], st, cfg);
    const must = mustRevealFacts(data, c, st, perms, { type: 'text', text: '那时你见到了谁？' });
    expect(must.length).toBeGreaterThan(0);
    const r = validateOutput(out({ reply: '没见到谁。' }), { data, case: c, disciple: w, perms, mustReveal: must });
    expect(!r.ok && r.stage).toBe('permission');
    expect(validateOutput(out({ reply: '见到了。', revealed_fact_ids: [must[0]] }), { data, case: c, disciple: w, perms, mustReveal: must }).ok).toBe(true);
  });
  it('有秘密的人坦白前说出秘密，判泄底', () => {
    const leak = data.secrets.find((x) => x.id === c.knowledge[secret].secret!.id)!.leak_keywords[0];
    const r = validateOutput(out({ reply: `我只是去弄${leak}的事。` }), ctxFor(secret, 30, { presentedContradiction: true }));
    expect(!r.ok && r.stage).toBe('leak');
  });
  it('该失言没失言', () => {
    const x = ctxFor(culprit, 90);
    expect(x.perms.mustSlip).toBe(true);
    const r = validateOutput(out({}), x);
    expect(!r.ok && r.stage).toBe('slip');
    const kw = c.knowledge[culprit].culprit!.slip.keywords[0];
    const r2 = validateOutput(out({ reply: `……那${kw}，我、我是说……`, slipped: true }), x);
    expect(r2.ok).toBe(true);
  });
});

describe('提示词', () => {
  it('无辜者的提示词里不出现内奸是谁、不出现失言细节', () => {
    for (const d of c.disciples.filter((x) => x.id !== culprit)) {
      const p = buildSystemPrompt(data, c, d.id);
      expect(p).not.toContain('内奸，');
      expect(p).not.toContain(c.slip_detail.text);
      expect(p).not.toContain(c.motive);
    }
    expect(buildSystemPrompt(data, c, culprit)).toContain(c.slip_detail.text);
  });
  it('人设加知识卡不超过 1500 token，单次输入不超过 2500 token', () => {
    for (let s = 1; s <= 50; s++) {
      const k = generateCase(s, data);
      for (const d of k.disciples) {
        expect(estimateTokens(personaAndCardText(data, k, d.id))).toBeLessThanOrEqual(cfg.budget.max_card_tokens);
        const st = initialDiscipleState(d.id);
        // 满 8 轮历史：每轮掌门说满 60 字，弟子回满 80 字
        const reply = JSON.stringify({ reply: '啊'.repeat(80), emotion: 'nervous', player_tone: 'pressing', revealed_fact_ids: ['f01', 'f02'], confessed: false, slipped: false });
        st.history = Array.from({ length: 8 }, () => ({ user: `掌门说：<玩家发言>${'啊'.repeat(60)}</玩家发言>`, assistant: reply }));
        const turn = buildTurnMessage(data, k, st, permissions(k.knowledge[d.id], st, cfg), { type: 'text', text: '啊'.repeat(60) });
        const sys = buildSystemPrompt(data, k, d.id);
        const all = sys + buildMessages(st, turn, cfg.history_turns).map((m) => m.content).join('');
        expect(estimateTokens(all)).toBeLessThanOrEqual(cfg.budget.max_input_tokens);
      }
    }
  });
  it('玩家发言包在标签里，状态和事件在最后一条消息', () => {
    const st = initialDiscipleState(witness);
    const m = buildTurnMessage(data, c, st, permissions(c.knowledge[witness], st, cfg), { type: 'text', text: '你在哪？' });
    expect(m).toContain('<玩家发言>你在哪？</玩家发言>');
    expect(m).toContain('压力 0/100');
  });
});

/** 按顺序返回预置回答的假模型 */
function scripted(answers: Array<string | Error>): AIClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    kind: 'llm',
    calls,
    async chat(req) {
      calls.push(req);
      const a = answers.shift() ?? out({});
      if (a instanceof Error) throw a;
      return { text: a, usage: { input: 100, output: 20 } };
    },
  };
}

describe('调用管线', () => {
  const req = (id: string) => {
    const st = initialDiscipleState(id);
    return { case: c, disciple: id, state: st, perms: permissions(c.knowledge[id], st, cfg), event: { type: 'text' as const, text: '你在哪？' }, turnIndex: 0 };
  };

  it('校验失败后带纠正说明重新生成 1 次', async () => {
    const client = scripted(['不是 JSON', out({ reply: '弟子在房里。', revealed_fact_ids: [c.knowledge[witness].claim_fact] })]);
    const budget = { used: 0, max: 40 };
    const r = await runDiscipleTurn(req(witness), { data, client, budget });
    expect(r.source).toBe('llm');
    expect(budget.used).toBe(2);
    expect(client.calls[1].messages.at(-1)?.content).toContain('系统纠正');
  });
  it('两次都失败就用兜底台词，兜底不额外消耗调用', async () => {
    const client = scripted(['坏', '还是坏']);
    const budget = { used: 0, max: 40 };
    const r = await runDiscipleTurn(req(witness), { data, client, budget });
    expect(r.source).toBe('fallback');
    expect(data.fallback.evasive[witness]).toContain(r.output.reply);
    expect(budget.used).toBe(2);
  });
  it('该坦白却失败：用坦白模板；该失言却失败：用失言模板', async () => {
    const st = { ...initialDiscipleState(secret), stress: 70, presentedContradiction: true };
    const r = await runDiscipleTurn(
      { case: c, disciple: secret, state: st, perms: permissions(c.knowledge[secret], st, cfg), event: { type: 'text', text: '说' }, turnIndex: 0 },
      { data, client: scripted(['坏', '坏']), budget: { used: 0, max: 40 } },
    );
    expect(r.source).toBe('fallback');
    expect(r.output.confessed).toBe(true);
    const cs = { ...initialDiscipleState(culprit), stress: 90 };
    const r2 = await runDiscipleTurn(
      { case: c, disciple: culprit, state: cs, perms: permissions(c.knowledge[culprit], cs, cfg), event: { type: 'text', text: '说' }, turnIndex: 0 },
      { data, client: scripted(['坏', '坏']), budget: { used: 0, max: 40 } },
    );
    expect(r2.output.slipped).toBe(true);
    expect(r2.output.reply).toContain(c.slip_detail.keywords[0]);
  });
  it('模型报错或超时：切到模板应答', async () => {
    const client = scripted([new AIClientError('超时', 'timeout'), new AIClientError('超时', 'timeout')]);
    const r = await runDiscipleTurn(req(witness), { data, client, budget: { used: 0, max: 40 } });
    expect(r.source).toBe('template');
    expect(r.clientFailed).toBe(true);
  });
  it('会话里模型出错后提示“夜深了”，后面都用模板应答', async () => {
    const client = scripted([new AIClientError('x', 'network'), new AIClientError('x', 'network')]);
    const game = new GameSession(data, client, { seed: 3 });
    game.start();
    game.finishIntro();
    await game.ask(game.case.disciples[0].id, '你在哪？');
    expect(game.state.templateMode).toBe(true);
    expect(game.state.notices.some((n) => n.text.includes('夜深了'))).toBe(true);
    await game.ask(game.case.disciples[1].id, '你在哪？');
    expect(client.calls).toHaveLength(2);
  });
  it('单局总调用不超过 40 次（含重新生成），超出后一律用模板应答', async () => {
    const client = scripted(Array.from({ length: 100 }, () => '坏'));
    const game = new GameSession(data, client, { seed: 3 });
    game.start();
    game.finishIntro();
    for (let i = 0; i < 30; i++) await game.ask(game.case.disciples[i % 5].id, '你喜欢什么？');
    await game.accuse(game.case.disciples[0].id, []);
    expect(client.calls.length).toBeLessThanOrEqual(40);
    expect(game.state.budget.used).toBeLessThanOrEqual(40);
  });
});

describe('整局回放（模板应答模式，无头）', () => {
  it('破案：只凭线索簿就能推出唯一的内奸并指认', async () => {
    let s = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const game = new GameSession(data, new TemplateClient(), { seed });
      const r = await playBot(game);
      expect(r.deduced, `种子 ${seed}`).toBe(game.case.culprit);
      expect(['S', 'A']).toContain(r.grade);
      if (r.grade === 'S') s++;
      expect(game.state.ending?.epilogue).toBeTruthy();
    }
    expect(s).toBeGreaterThan(150);
  });
  it('逼问内奸会失言，失言记入线索簿', async () => {
    let slipped = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const game = new GameSession(data, new TemplateClient(), { seed });
      await playBot(game, { pressCulprit: true });
      if (game.state.disciples[game.case.culprit].slipped) {
        slipped++;
        const slipFact = game.case.knowledge[game.case.culprit].culprit!.slip_fact;
        expect(game.hasClue(slipFact)).toBe(true);
      }
    }
    expect(slipped).toBeGreaterThan(40);
  });
  it('失败：指认无辜者，尾声和复盘照常生成', async () => {
    const game = new GameSession(data, new TemplateClient(), { seed: 42 });
    const r = await playBot(game, { wrong: true });
    expect(r.grade).toBe('fail');
    expect(game.state.ending?.epilogue).toContain(name(game.case.culprit));
    const table = game.truthTable();
    expect(table.find((row) => row.id === game.case.culprit)?.role).toBe('内奸');
  });
  it('有秘密的无辜者被出示矛盾、压力够了就坦白，之后压力降到 20', async () => {
    let confessions = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const game = new GameSession(data, new TemplateClient(), { seed });
      game.start();
      game.finishIntro();
      for (const l of ['library', 'dorm', 'alchemy', 'kitchen', 'training', 'bamboo', 'gate'] as const) game.investigate(l);
      const sec = game.case.disciples.find((d) => d.role === 'secret')!.id;
      const ev = game.case.contradictions.find((x) => x.target === sec && game.hasClue(x.evidence))!.evidence;
      await game.present(sec, ev); // 30
      await game.ask(sec, '你还敢狡辩？老实交代！'); // 40
      await game.ask(sec, '到底在哪？说实话！'); // 50
      await game.ask(sec, '再不说，逐出师门！'); // 60
      const r = await game.ask(sec, '你在哪？');
      if (game.state.disciples[sec].confessed) {
        confessions++;
        expect(game.state.disciples[sec].stress).toBe(20);
        expect(r.ok && r.newClues).toContain(game.case.knowledge[sec].secret!.confession_fact);
      }
    }
    expect(confessions).toBe(30);
  });
});
