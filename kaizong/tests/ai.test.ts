import { describe, expect, it } from 'vitest';
import { asJson, createDeepSeek, type AiClient } from '../src/ai/client';
import { decidePrompt } from '../src/ai/prompts';
import { afterSeason, askSeason, cleanLine } from '../src/ai/runner';
import { planSeason } from '../src/game/season';
import { newWorld, randomStart } from '../src/game/setup';
import { members } from '../src/game/world';
import type { Person } from '../src/game/types';

/** 假的 DeepSeek：把一段文字切成 SSE 流 */
function fakeFetch(reply: string, capture?: (body: any) => void): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    capture?.(JSON.parse(String(init.body)));
    const chunks = reply.match(/.{1,5}/gs) ?? [];
    const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    lines.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 40 } })}\n\n`, 'data: [DONE]\n\n');
    const body = new ReadableStream({ start(ctl) { for (const l of lines) ctl.enqueue(new TextEncoder().encode(l)); ctl.close(); } });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

const fakeAi = (fn: (system: string, prompt: string) => string): AiClient => ({ kind: 'deepseek', chat: async (q) => ({ text: fn(q.system, q.prompt), usage: { inputHit: 0, inputMiss: 0, output: 0 }, ms: 1 }) });

describe('DeepSeek 客户端', () => {
  it('流式拼回完整回答，报用量，关思考、要 JSON', async () => {
    let sent: any;
    let used: any;
    const ai = createDeepSeek({ apiKey: 'sk-test', onUsage: (u) => { used = u; } }, fakeFetch('{"pick":"work","why":"好好干活"}', (b) => { sent = b; }));
    const res = await ai.chat({ system: 's', prompt: 'p' });
    expect(asJson(res.text)?.pick).toBe('work');
    expect(sent.thinking).toEqual({ type: 'disabled' });
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(used.inputHit).toBe(800);
  });
});

describe('AI 拿主意', () => {
  it('提示词里有人设、处境和选项；固定部分放在 system', () => {
    const w = newWorld(randomStart(5));
    const plan = planSeason(w, 'normal');
    const p = members(w)[0];
    const q = decidePrompt(w, p, plan.options[p.id], plan.unc);
    expect(q.system).toContain(p.name);
    expect(q.prompt).toContain('这一季你能做的事');
    expect(q.prompt).toContain(plan.options[p.id][0].id);
  });
  it('挑了不存在的选项就丢掉；出戏的话不要', async () => {
    const w = newWorld(randomStart(6));
    const plan = planSeason(w, 'normal');
    const [a, b] = plan.aiWho;
    const ai = fakeAi((system) => (system.includes(`【你是谁】${w.people[a].name}`) ? '{"pick":"work","why":"作为AI我选这个"}' : '{"pick":"fly","why":"飞"}'));
    const res = await askSeason(w, plan, ai, () => {});
    expect(res.picks[a]?.id).toBe('work');
    expect(res.picks[a]?.why).toBeUndefined();
    expect(res.picks[b]).toBeUndefined();
  });
  it('AI 写的新心愿要落在合法方向上', async () => {
    const w = newWorld(randomStart(8));
    const p = members(w)[0];
    p.wish = null as Person["wish"]; p.wishPending = true;
    const ai = fakeAi(() => '{"pick":0,"text":"我要做这山上最快筑基的人"}');
    await afterSeason(w, ai, [p.id], [], 8);
    expect(p.wish?.by).toBe('ai');
    expect(p.wish?.text).toContain('筑基');
  });
  it('一句话太长就截在句读处', () => {
    expect(cleanLine('这一句话实在是太长了，我要把它截断，后面的就不要了吧，真的太长', 20)).toMatch(/。$/);
    expect(cleanLine('选项二最合适')).toBeNull();
  });
});
