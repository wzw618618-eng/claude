import { describe, expect, it } from 'vitest';
import { World as Ecs } from '@forgeax/engine/ecs';
import { createIntelligenceRuntime } from '@forgeax/engine/intelligence';
import { createFakeIntelligenceProvider } from '@forgeax/engine/intelligence-fake';
import { NpcBrain } from '@forgeax/engine/npc';
import { ME, op } from '../game/core/world.ts';
import { bondScore, fadeBonds, MODES, TIER_AT, tierOf, tierText, TOUCH } from '../game/mind/bond.ts';
import { social } from '../game/player.ts';
import { startLine } from '../game/ai/talk.ts';
import { HEARD_AFF } from '../game/ai/souls.ts';
import { type Envelope, MAX_TOKENS } from '../souls/envelope.ts';
import { loadConfig, providerFor, saveConfig } from '../souls/config.ts';
import { createMeter, costOf, totalsText } from '../souls/meter.ts';
import { createChatApiProvider, readUsage, TALK_LIMITS, type UsageReport } from '../souls/providers.ts';
import { createSoulAdapter } from '../souls/soul-client.ts';
import { WorldSession } from '../world/session.ts';

type Seen = Envelope & { session: string };
type Script = Partial<Record<Envelope['ask'], (env: Envelope) => string>>;

/** 假的大模型：记下整个信封和会话 id，按请求类型回话 */
function fakeAI(script: Script = {}) {
  const seen: Seen[] = [];
  const provider = createFakeIntelligenceProvider({
    id: 'fake-llm',
    script: (sub) => {
      const env = JSON.parse(sub.input) as Envelope;
      seen.push({ ...env, session: sub.session.id });
      const out = script[env.ask]?.(env) ?? (env.ask === 'decide' ? '{"choice":"none","why":""}' : '{"reply":"嗯。"}');
      return { deltas: [out], output: out };
    },
  });
  return { provider, seen };
}

function setup(seed: number, script: Script = {}) {
  const ai = fakeAI(script);
  const s = new WorldSession(() => undefined, seed);
  void s.connect(createIntelligenceRuntime(ai.provider, { limits: TALK_LIMITS }), '测试');
  const drain = (n = 6) => { for (let i = 0; i < n; i++) { ai.provider.advance(); s.poll(); } };
  drain();
  return { s, ...ai, drain };
}

const arrive = (s: WorldSession, place: Parameters<WorldSession['act']>[0] extends infer A ? A extends { type: 'move'; place: infer P } ? P : never : never) => {
  s.act({ type: 'move', place });
  s.w.pending = [];
};
const of = (seen: Seen[], ask: Envelope['ask']) => seen.filter((x) => x.ask === ask);

describe('交情：打交道越多、爱恨越深，灵性越高', () => {
  it('说话、打交道、找上门都攒交情；每年淡一些；门槛随用量档变', () => {
    const s = new WorldSession(() => undefined, 101);
    const w = s.w;
    const hua = w.people.hua;
    expect(tierOf(w, hua)).toBe(0);
    w.me.place = 'village';
    w.turn.moved = true;
    startLine(w, 'hua', '婆婆好');
    expect(hua.mind.bond).toBe(TOUCH.line);
    social(w, 'hua', 'chat');
    expect(hua.mind.bond).toBe(TOUCH.line + TOUCH.social);
    // 聊得投机，好感也算进交情
    expect(bondScore(w, hua)).toBeGreaterThan(hua.mind.bond!);
    hua.mind.bond = TIER_AT[0] + 1;
    expect(tierOf(w, hua)).toBe(1);
    // 省电档门槛高，同样的交情还是陌路；尽兴档门槛低
    expect(tierOf(w, hua, 'save')).toBe(0);
    hua.mind.bond = 20;
    expect(tierOf(w, hua, 'rich')).toBe(2);
    fadeBonds(w);
    expect(hua.mind.bond).toBe(17);
  });

  it('爱和恨都算：恨你入骨的人和视你为至交的人一样刻骨', () => {
    const s = new WorldSession(() => undefined, 102);
    const w = s.w;
    const [a, b] = [w.people.lu, w.people.han];
    Object.assign(op(a, ME), { aff: 90, trust: 90 });
    Object.assign(op(b, ME), { aff: -100, trust: 0 });
    b.mind.goal = { kind: 'revenge', target: ME, step: 1, stuck: 0, secret: false, since: 1 };
    a.mind.bond = 20; b.mind.bond = 20;
    expect(tierOf(w, a)).toBe(3);
    expect(tierOf(w, b)).toBe(3);
    expect(tierText(w, a)).toBe('知己');
    expect(tierText(w, b)).toBe('宿敌');
    expect(bondScore(w, b)).toBeGreaterThan(bondScore(w, w.people.hua));
  });

  it('交情写进 NpcBrain.affordanceRef；交情深了，灵魂能做的事多出主动开口、旁听、年底回想', () => {
    const ecs = new Ecs();
    ecs.components.register(NpcBrain).unwrap();
    const s = new WorldSession(() => undefined, 103);
    s.attach(ecs);
    const ref = (id: string) => {
      const e = (s as unknown as { entities: Map<string, never> }).entities.get(id)!;
      return ecs.get(e, NpcBrain).unwrap().affordanceRef;
    };
    expect(ref('hua')).toBe('qingming:0');
    s.w.people.hua.mind.bond = 30;
    s.align();
    expect(ref('hua')).toBe('qingming:2');
    const adapter = createSoulAdapter(s.souls, { affordances: (_r, b) => s.affordances(b.soulId), sample: (b) => s.perceive(b.soulId) });
    const e = (s as unknown as { entities: Map<string, never> }).entities.get('hua')!;
    const v = ecs.get(e, NpcBrain).unwrap();
    adapter.sync([{ entity: e, soulId: v.soulId, affordanceRef: v.affordanceRef, enabled: v.enabled, lod: v.lod as 0 | 1 | 2 }], ecs);
    const soul = s.souls.get('qingming.hua')!;
    expect(soul.affordances.map((a) => a.id)).toEqual(expect.arrayContaining(['soul:greet', 'soul:overhear', 'soul:reflect']));
    expect(soul.affordances.map((a) => a.id)).not.toContain('soul:afar');
    expect(soul.perception?.bond).toContain('相熟');
  });
});

describe('交情决定 AI 花多少心思', () => {
  it('自由对话：陌路人不思考、短上下文；相熟浅想；刻骨深想并带上江湖传闻；system 稳定，好命中缓存', () => {
    const { s, seen, drain } = setup(111);
    arrive(s, 'village');
    s.talk('hua', '婆婆好');
    drain();
    const t0 = of(seen, 'talk').at(-1)!;
    expect(t0).toMatchObject({ tier: 0, think: 'off', maxTokens: MAX_TOKENS.off });
    expect(t0.prompt).not.toContain('【这些年江湖上的事】');

    s.w.people.hua.mind.bond = 30;
    s.talk('hua', '婆婆近来身子可好？');
    drain();
    const t2 = of(seen, 'talk').at(-1)!;
    expect(t2).toMatchObject({ tier: 2, think: 'low', maxTokens: MAX_TOKENS.low });
    expect(t2.system).toBe(t0.system);

    s.w.people.hua.mind.bond = 80;
    s.w.news.push({ y: 1, text: '花婆婆在柳溪村摆了个卦摊。', tone: 'info', about: ['hua'] });
    s.talk('hua', '婆婆，我想听听当年的事。');
    drain();
    const t3 = of(seen, 'talk').at(-1)!;
    expect(t3).toMatchObject({ tier: 3, think: 'high' });
    expect(t3.prompt).toContain('【这些年江湖上的事】');
  });

  it('自由对话接着引擎的 SessionRef 往下聊：第二句用同一个会话，不再重复塞旧对话，只补中间发生的事', () => {
    const { s, seen, drain } = setup(112, { talk: () => '{"reply":"来了啊。","affinity":1,"trust":0,"revealed":"none","offer":"none"}' });
    arrive(s, 'village');
    s.talk('hua', '婆婆好');
    drain();
    const first = of(seen, 'talk')[0];
    expect(first.keep).toBe('婆婆好');
    expect(first.prompt).toContain('【你们之前说过的话】');
    s.social('hua', 'chat');
    drain();
    s.talk('hua', '刚才说到哪了？');
    drain();
    const second = of(seen, 'talk')[1];
    expect(second.session).toBe(first.session);
    expect(second.prompt).not.toContain('【你们之前说过的话】');
    expect(second.prompt).toContain('【上次说完之后】');
    expect(second.prompt).toContain('近来可好？');
  });

  it('选项对话：陌路人照规则原文说，相识以上才由 AI 配台词', () => {
    const { s, seen, drain } = setup(113, { voice: () => '{"reply":"（眯眼）还行。"}' });
    arrive(s, 'village');
    s.social('aman', 'chat');
    drain();
    expect(of(seen, 'voice')).toHaveLength(0);
    s.w.people.hua.mind.bond = 10;
    s.social('hua', 'chat');
    drain();
    expect(of(seen, 'voice')).toHaveLength(1);
    expect(s.w.chat.hua.at(-1)).toMatchObject({ from: 'them', text: '（眯眼）还行。' });
  });
});

describe('交情深的人自己会做的事', () => {
  it('到了地方，相熟的人主动开口，接着你们的会话；你接话时还是同一个会话', () => {
    const { s, seen, drain } = setup(121, { greet: () => '{"reply":"哟，又来看我这老婆子了？"}', talk: () => '{"reply":"坐吧。","affinity":0,"trust":0,"revealed":"none","offer":"none"}' });
    s.w.people.hua.mind.bond = 30;
    arrive(s, 'village');
    const g = of(seen, 'greet');
    expect(g.map((x) => x.soul)).toEqual(['qingming.hua']);
    expect(g[0].keep).toContain('来到了柳溪村');
    // 主动开口和自由对话共用 system：同一份缓存
    drain();
    expect(s.w.chat.hua.at(-1)).toMatchObject({ from: 'them', text: '哟，又来看我这老婆子了？' });
    s.talk('hua', '婆婆好！');
    drain();
    const t = of(seen, 'talk')[0];
    expect(t.session).toBe(g[0].session);
    expect(t.system).toBe(g[0].system);
  });

  it('旁听：身边两个人说话被你听见，彼此好感按说的话变，变化有上限；不合规的当没发生', () => {
    const say = '{"lines":[{"who":"阿蛮","text":"婆婆，您又在算卦？"},{"who":"花婆婆","text":"（笑）算你这傻小子哪天开窍。"}],"a":9,"b":-1}';
    const { s, seen, drain } = setup(122, { overhear: () => say });
    s.w.people.hua.mind.bond = 30;
    const [hua0, aman0] = [op(s.w.people.hua, 'aman').aff, op(s.w.people.aman, 'hua').aff];
    arrive(s, 'village');
    const o = of(seen, 'overhear');
    expect(o).toHaveLength(1);
    expect(o[0].system).toContain('【阿蛮】');
    expect(o[0].prompt).toContain('听得见');
    drain();
    expect(s.w.heard).toHaveLength(1);
    expect(s.w.heard[0].lines.map((l) => l.who)).toEqual(['aman', 'hua']);
    // 交情深的花婆婆是 a：a 想把好感加 9，只算 +3；阿蛮是 b，-1
    expect(op(s.w.people.hua, 'aman').aff).toBe(Math.min(100, hua0 + HEARD_AFF));
    expect(op(s.w.people.aman, 'hua').aff).toBe(aman0 - 1);

    const bad = setup(123, { overhear: () => '{"lines":[{"who":"路人","text":"……"}]}' });
    bad.s.w.people.hua.mind.bond = 30;
    arrive(bad.s, 'village');
    bad.drain();
    expect(bad.s.w.heard).toHaveLength(0);
  });

  it('年底回想：今年和你有过交集的刻骨之人把这一年凝成一句「心里的你」，以后的提示词里都带着', () => {
    const { s, seen, drain } = setup(124, { reflect: () => '{"heart":"你这孩子嘴笨心实，这一年没少来陪我。"}' });
    const hua = s.w.people.hua;
    hua.mind.bond = 80;
    arrive(s, 'village');
    s.talk('hua', '婆婆，我陪您坐坐。');
    drain();
    // 阿蛮今年没和你打过交道，不回想
    s.w.people.aman.mind.bond = 80;
    s.act({ type: 'endTurn' });
    expect(s.w.year).toBe(2);
    const r = of(seen, 'reflect');
    expect(r.map((x) => x.soul)).toEqual(['qingming.hua']);
    expect(r[0].prompt).toContain('第1年快过去了');
    expect(r[0].think).toBe('low');
    drain();
    expect(hua.mind.heart).toBe('你这孩子嘴笨心实，这一年没少来陪我。');
    expect(hua.mind.heartY).toBe(1);
    hua.place = 'village';
    arrive(s, 'village');
    s.talk('hua', '婆婆新年好');
    drain();
    expect(of(seen, 'talk').at(-1)!.prompt).toContain('【你心里的对方】「你这孩子嘴笨心实');
    expect(s.perceive('qingming.hua')?.impression).toBe(hua.mind.heart);
  });

  it('刻骨的人不在你身边，年初也会自己拿主意；相识的人不在身边就不会', () => {
    const { s, seen } = setup(125);
    s.w.people.wen.mind.bond = 80;
    s.w.people.lu.mind.bond = 10;
    s.act({ type: 'endTurn' });
    const souls = of(seen, 'decide').map((x) => x.soul);
    expect(souls).toContain('qingming.wen');
    expect(souls).not.toContain('qingming.lu');
    expect(of(seen, 'decide').find((x) => x.soul === 'qingming.wen')!.think).toBe('high');
  });
});

describe('不为过时的事花钱', () => {
  it('开新局时，还在跑的请求全部取消；换了一年，去年的打算、开口、旁听也取消', () => {
    const { s, provider, seen } = setup(131);
    for (const id of ['aman', 'hua']) s.w.people[id].mind.bond = 30;
    s.act({ type: 'endTurn' });
    expect(of(seen, 'decide').length).toBeGreaterThan(0);
    expect(provider.activeCount).toBeGreaterThan(0);
    expect(s.waiting).toBeGreaterThan(0);
    s.act({ type: 'new', seed: 9 });
    expect(s.waiting).toBe(0);
    expect(provider.activeCount).toBe(0);

    const t = setup(132);
    t.s.w.people.hua.mind.bond = 30;
    arrive(t.s, 'village');
    expect(t.s.waiting).toBeGreaterThan(0);
    const greet = of(t.seen, 'greet').length + of(t.seen, 'overhear').length;
    expect(greet).toBeGreaterThan(0);
    t.s.act({ type: 'endTurn' });
    // 只剩新一年的打算和年底回想
    for (const p of (t.s as unknown as { pending: Map<string, { kind: string; y: number }> }).pending.values()) {
      expect(p.kind === 'reflect' || p.y === 2).toBe(true);
    }
  });
});

// ───────────── Host 侧：DeepSeek 提供方、记账、设置 ─────────────

const enc = new TextEncoder();
function sse(chunks: unknown[], status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
  return new Response(status === 200 ? body : 'oops', { status });
}
const delta = (content?: string, reasoning?: string) => ({ choices: [{ delta: { ...(content ? { content } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) } }] });
const USAGE = { prompt_tokens: 1000, completion_tokens: 300, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens_details: { reasoning_tokens: 250 } };

function envelope(over: Partial<Envelope> = {}) {
  const e: Envelope = { v: 2, soul: 'qingming.hua', ask: 'talk', tier: 2, system: 'SYS', prompt: 'NOW', keep: '婆婆好', think: 'low', maxTokens: 2500, fallback: null, ...over };
  return JSON.stringify(e);
}

function harness(responses: (() => Response)[]) {
  const calls: { url: string; body: any }[] = [];
  const reports: UsageReport[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error('没有更多回应');
    return next();
  }) as unknown as typeof fetch;
  const provider = createChatApiProvider({ id: 'deepseek', baseUrl: 'https://api.deepseek.com/', apiKey: 'k', model: 'deepseek-flash', dialect: 'deepseek', retryMs: 5, onUsage: (r) => reports.push(r) }, fetchImpl);
  const rt = createIntelligenceRuntime(provider, { limits: TALK_LIMITS });
  const run = async (input: string, session?: { providerId: string; id: string }) => {
    const ref = rt.submit({ input, session }).unwrap();
    const events: { type: string; text?: string; output?: string; session?: { id: string } }[] = [];
    for (let i = 0; i < 50 && !events.some((e) => e.type !== 'text-delta'); i++) {
      await new Promise((r) => setTimeout(r, 2));
      events.push(...rt.poll());
    }
    return { ref, events, done: events.find((e) => e.type !== 'text-delta')! };
  };
  return { calls, reports, run };
}

describe('DeepSeek 提供方', () => {
  it('system + 会话历史 + 当下；浅想发 reasoning_effort；只吐正文，不吐思考；报用量', async () => {
    const reply = '{"reply":"坐。"}';
    const h = harness([
      () => sse([delta(undefined, '她又来了……'), delta('{"reply":'), delta('"坐。"}'), { choices: [], usage: USAGE }]),
      () => sse([delta('{"reply":"嗯。"}'), { choices: [], usage: USAGE }]),
    ]);
    const a = await h.run(envelope());
    expect(h.calls[0].url).toBe('https://api.deepseek.com/chat/completions');
    expect(h.calls[0].body).toMatchObject({ model: 'deepseek-flash', stream: true, reasoning_effort: 'low', max_tokens: 2500, response_format: { type: 'json_object' } });
    expect(h.calls[0].body.thinking).toBeUndefined();
    expect(h.calls[0].body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'NOW' }]);
    expect(a.events.filter((e) => e.type === 'text-delta').map((e) => e.text).join('')).toBe(reply);
    expect(a.done.output).toBe(reply);
    expect(h.reports[0]).toMatchObject({ soul: 'qingming.hua', ask: 'talk', tier: 2, usage: { inputHit: 800, inputMiss: 200, output: 300, reasoning: 250 } });

    // 同一个 SessionRef：带上上一轮的问答（问的是 keep 那句短话，不是整段当下）
    await h.run(envelope({ keep: '还记得我吗', prompt: 'NOW2', think: 'off', maxTokens: 500 }), a.done.session as { providerId: string; id: string });
    expect(h.calls[1].body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: '婆婆好' },
      { role: 'assistant', content: reply },
      { role: 'user', content: 'NOW2' },
    ]);
    expect(h.calls[1].body.thinking).toEqual({ type: 'disabled' });
    expect(h.calls[1].body.temperature).toBe(0.9);
  });

  it('不同会话互不串；没有 keep 的请求不记历史；坏回复不记历史', async () => {
    const h = harness([
      () => sse([delta('{"reply":"甲"}')]),
      () => sse([delta('乱说一气')]),
      () => sse([delta('{"reply":"丙"}')]),
      () => sse([delta('{"reply":"丁"}')]),
    ]);
    const a = await h.run(envelope({ keep: undefined, ask: 'decide' }));
    const b = await h.run(envelope({ keep: '你好' }));
    await h.run(envelope({ keep: '再说一遍' }), b.done.session as never);
    await h.run(envelope({ keep: '别人' }), a.done.session as never);
    expect(h.calls[2].body.messages).toHaveLength(2);
    expect(h.calls[3].body.messages).toHaveLength(2);
  });

  it('限流时等一下再试一次；密钥不对时报错，交回规则', async () => {
    const h = harness([() => sse([], 429), () => sse([delta('{"reply":"好"}')])]);
    const ok = await h.run(envelope());
    expect(ok.done.type).toBe('completed');
    expect(h.calls).toHaveLength(2);
    const bad = harness([() => sse([], 401)]);
    const r = await bad.run(envelope());
    expect(r.done.type).toBe('failed');
    expect(JSON.stringify(r.done)).toContain('密钥不对');
  });

  it('读 DeepSeek 和 OpenAI 两种用量写法', () => {
    expect(readUsage(USAGE)).toEqual({ inputHit: 800, inputMiss: 200, output: 300, reasoning: 250 });
    expect(readUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 60 } })).toEqual({ inputHit: 60, inputMiss: 40, output: 5, reasoning: 0 });
  });
});

describe('记账和设置', () => {
  it('按缓存命中、未命中、输出算钱；分人记；总账存在本机', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const m = createMeter(storage);
    const usage = readUsage(USAGE);
    m.record({ soul: 'qingming.hua', ask: 'talk', tier: 2, model: 'deepseek-flash', usage, ms: 900 });
    m.record({ soul: 'qingming.aman', ask: 'decide', tier: 1, model: 'deepseek-flash', usage, ms: 400 });
    m.record({ soul: 'qingming.hua', ask: 'greet', tier: 2, model: 'deepseek-flash', usage, ms: 300 });
    const one = costOf('deepseek-flash', usage)!;
    expect(one).toBeCloseTo((200 * 0.3 + 800 * 0.006 + 300 * 1.2) / 1e6, 12);
    expect(m.game.usd).toBeCloseTo(one * 3, 12);
    expect(m.bySoul()[0][0]).toBe('qingming.hua');
    expect(m.byTier()[2].calls).toBe(2);
    expect(totalsText(m.game)).toContain('3 次');
    expect(totalsText(m.game)).toContain('缓存命中 80%');
    m.resetGame();
    expect(m.game.calls).toBe(0);
    expect(createMeter(storage).all.calls).toBe(3);
  });

  it('设置存在本机；DeepSeek 默认 V4.1 Flash；没填密钥就退回离线', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const cfg = loadConfig(storage);
    expect(cfg).toMatchObject({ kind: 'offline', model: 'deepseek-flash', mode: 'normal' });
    expect(providerFor({ ...cfg, kind: 'deepseek' }).label).toContain('还没填');
    saveConfig(storage, { kind: 'deepseek', apiKey: ' sk-test ', model: 'deepseek-flash', mode: 'rich' });
    const back = loadConfig(storage);
    expect(back).toMatchObject({ kind: 'deepseek', apiKey: 'sk-test', mode: 'rich' });
    const p = providerFor(back);
    expect(p.provider.id).toBe('deepseek');
    expect(p.label).toBe('DeepSeek（deepseek-flash）');
    expect(MODES.rich.cap).toBeGreaterThan(MODES.normal.cap);
  });
});
