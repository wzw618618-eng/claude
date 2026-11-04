import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '@forgeax/engine/ecs';
import { createIntelligenceRuntime } from '@forgeax/engine/intelligence';
import { createFakeIntelligenceProvider } from '@forgeax/engine/intelligence-fake';
import { NPC_COGNITIVE_LOD_AMBIENT, NPC_COGNITIVE_LOD_OFFSTAGE, NPC_COGNITIVE_LOD_SPOTLIGHT, NpcBrain } from '@forgeax/engine/npc';
import { AssetGuid } from '@forgeax/engine/pack/guid';
import { CampSession } from '../camp/session.ts';
import type { ToHost } from '../camp/protocol.ts';
import { EVENTS } from '../hanyi/data/events.ts';
import { ch } from '../hanyi/core/world.ts';
import { CAMP_PACKAGE, UI_PACKAGE } from '../ids.ts';
import { acceptReply, replySoFar } from '../souls/envelope.ts';
import { createChatApiProvider, createOfflineProvider, TALK_LIMITS } from '../souls/providers.ts';
import { createSoulAdapter } from '../souls/soul-client.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 跑到第一天夜里：结束白天，事件都选第一个，进入围炉 */
function toFirstNight(session: CampSession) {
  session.act({ type: 'endDay' });
  while (session.s.pending.length) session.act({ type: 'choose', i: 0 });
  session.act({ type: 'toNight' });
  expect(session.s.phase).toBe('night');
}

function brains(world: World, session: CampSession) {
  const out: Record<string, { lod: number; enabled: boolean; soulId: string }> = {};
  for (const c of session.s.chars) {
    const e = (session as unknown as { entities: Map<string, never> }).entities.get(c.id)!;
    const v = world.get(e, NpcBrain).unwrap();
    out[c.id] = { lod: v.lod, enabled: v.enabled, soulId: v.soulId };
  }
  return out;
}

describe('寒驿 · 工程身份', () => {
  it('forge.json 的两个根分别指向营地插件和界面插件', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'forge.json'), 'utf8'));
    expect(manifest.id).toBe('hanyi');
    expect(manifest.roots.engine).toBe(AssetGuid.format(AssetGuid.derive(CAMP_PACKAGE, 'plugin/camp')));
    expect(manifest.roots.frontend).toBe(AssetGuid.format(AssetGuid.derive(UI_PACKAGE, 'plugin/ui')));
  });
});

describe('寒驿 · 每个角色都是一个 NPC 灵魂', () => {
  it('开局五个人各有一个 NpcBrain，在场时是 ambient；被聚光时是 spotlight；离开后 offstage 且停用', () => {
    const world = new World();
    world.components.register(NpcBrain).unwrap();
    const session = new CampSession(() => undefined, 42);
    session.attach(world);
    let b = brains(world, session);
    expect(Object.keys(b)).toEqual(['qin', 'lin', 'jie', 'ma', 'su']);
    expect(Object.values(b).every((x) => x.lod === NPC_COGNITIVE_LOD_AMBIENT && x.enabled)).toBe(true);
    expect(b.qin.soulId).toBe('hanyi.qin');

    toFirstNight(session);
    session.receive({ channel: 'hanyi/camp', kind: 'focus', id: 'qin' });
    b = brains(world, session);
    expect(b.qin.lod).toBe(NPC_COGNITIVE_LOD_SPOTLIGHT);
    expect(b.lin.lod).toBe(NPC_COGNITIVE_LOD_AMBIENT);

    ch(session.s, 'su')!.status = 'left';
    session.align();
    b = brains(world, session);
    expect(b.su).toMatchObject({ lod: NPC_COGNITIVE_LOD_OFFSTAGE, enabled: false });
  });

  it('灵魂客户端按认知层级感知：聚光每帧更新，离场不再感知', () => {
    const world = new World();
    world.components.register(NpcBrain).unwrap();
    const session = new CampSession(() => undefined, 7);
    session.attach(world);
    toFirstNight(session);
    session.receive({ channel: 'hanyi/camp', kind: 'focus', id: 'lin' });
    const adapter = createSoulAdapter(session.souls, {
      affordances: (_r, binding) => session.affordances(binding.soulId),
      sample: (binding) => session.perceive(binding.soulId),
    });
    const bindings = Object.entries(brains(world, session)).map(([id, v]) => ({
      entity: (session as unknown as { entities: Map<string, never> }).entities.get(id)!,
      soulId: v.soulId, affordanceRef: 'camp', enabled: v.enabled, lod: v.lod as 0 | 1 | 2,
    }));
    adapter.sync(bindings, world);
    const lin0 = session.souls.get('hanyi.lin')!;
    const qin0 = session.souls.get('hanyi.qin')!;
    expect(lin0.lod).toBe('spotlight');
    expect(lin0.affordances.some((a) => a.id === 'talk:past')).toBe(true);
    adapter.tick(0.5, world);
    expect(session.souls.get('hanyi.lin')!.samples).toBe(lin0.samples + 1);
    expect(session.souls.get('hanyi.qin')!.samples).toBe(qin0.samples);
    adapter.tick(2, world);
    expect(session.souls.get('hanyi.qin')!.samples).toBe(qin0.samples + 1);
  });
});

describe('寒驿 · 夜谈走引擎的 Intelligence Activity', () => {
  it('AI 的合规回复会流式显示，并按规则改变信任', () => {
    const reply = '{"reply":"嗯。火别烧太旺。","trust":3,"mood":2,"revealed":false}';
    const provider = createFakeIntelligenceProvider({ script: () => ({ deltas: [reply.slice(0, 20), reply.slice(20)], output: reply }) });
    const out: ToHost[] = [];
    const session = new CampSession((m) => out.push(m), 3);
    void session.connect(createIntelligenceRuntime(provider, { limits: TALK_LIMITS }), '测试');
    toFirstNight(session);
    const before = ch(session.s, 'qin')!.trust;
    session.talk('qin', 'chat');
    for (let i = 0; i < 6; i++) { provider.advance(); session.poll(); }
    const streams = out.filter((m) => m.kind === 'stream').map((m) => (m as { text: string }).text);
    expect(streams.at(-1)).toBe('嗯。火别烧太旺。');
    const log = session.s.chat.qin!;
    expect(log.at(-1)).toEqual({ from: 'them', text: '嗯。火别烧太旺。' });
    // 第一次聊天 +1，AI 给 +3，单次上限 4
    expect(ch(session.s, 'qin')!.trust).toBe(before + 4);
  });

  it('格式不对的回复不会被采纳，改用手写台词', () => {
    const provider = createFakeIntelligenceProvider({ script: () => ({ deltas: ['我不按格式说话'], output: '我不按格式说话' }) });
    const session = new CampSession(() => undefined, 5);
    void session.connect(createIntelligenceRuntime(provider, { limits: TALK_LIMITS }), '测试');
    toFirstNight(session);
    session.talk('lin', 'past');
    for (let i = 0; i < 4; i++) { provider.advance(); session.poll(); }
    const last = session.s.chat.lin!.at(-1)!;
    expect(last.from).toBe('them');
    expect(last.text).not.toBe('我不按格式说话');
  });

  it('信任够了，角色说出心事，就会解锁对应的故事线（老秦的地窖）', () => {
    const reply = '{"reply":"我儿子叫秦川……","trust":2,"mood":3,"revealed":true}';
    const provider = createFakeIntelligenceProvider({ script: () => ({ deltas: [reply], output: reply }) });
    const session = new CampSession(() => undefined, 9);
    void session.connect(createIntelligenceRuntime(provider, { limits: TALK_LIMITS }), '测试');
    toFirstNight(session);
    expect(EVENTS.cellar.bind!(session.s, { next: () => 0 } as never)).toBeNull();
    ch(session.s, 'qin')!.trust = 60;
    session.talk('qin', 'past');
    for (let i = 0; i < 3; i++) { provider.advance(); session.poll(); }
    expect(session.s.flags.heard_qin).toBe(true);
    expect(EVENTS.cellar.bind!(session.s, { next: () => 0 } as never)).toEqual({ actors: ['qin'] });
  });

  it('离线台词提供方也走同一条 Activity 流程', async () => {
    const session = new CampSession(() => undefined, 11);
    void session.connect(createIntelligenceRuntime(createOfflineProvider({ delayMs: 0, chunk: 50 }), { limits: TALK_LIMITS }), '离线台词');
    toFirstNight(session);
    session.talk('jie', 'cheer');
    for (let i = 0; i < 20 && session.s.chat.jie!.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 5));
      session.poll();
    }
    expect(session.s.chat.jie!.map((m) => m.from)).toEqual(['me', 'them']);
  });
});

describe('寒驿 · 回复解析', () => {
  it('能从写了一半的 JSON 里取出已经写出的话', () => {
    expect(replySoFar('{"reply":"老秦看')).toBe('老秦看');
    expect(replySoFar('{"reply":"a\\"b","trust"')).toBe('a"b');
    expect(acceptReply('好的：{"reply":"嗯","trust":9,"mood":-9}')).toEqual({ reply: '嗯', trust: 3, mood: -5, revealed: false });
  });
});

describe('寒驿 · DeepSeek 等 OpenAI 兼容接口', () => {
  it('解析流式返回，把信封里的提示词发给接口', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"{\\"reply\\":\\"嗯"}}]}',
      'data: {"choices":[{"delta":{"content":"。\\",\\"trust\\":1,\\"mood\\":0,\\"revealed\\":false}"}}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    let sent: { url: string; body: { model: string; messages: { content: string }[] } } | null = null;
    const fakeFetch = (async (url: string, init: { body: string }) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(sse, { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createChatApiProvider({ id: 'deepseek', baseUrl: 'https://api.deepseek.com/', apiKey: 'k', model: 'deepseek-chat' }, fakeFetch);
    const runtime = createIntelligenceRuntime(provider, { limits: TALK_LIMITS });
    const session = new CampSession(() => undefined, 13);
    void session.connect(runtime, 'DeepSeek');
    toFirstNight(session);
    session.talk('ma', 'chat');
    for (let i = 0; i < 40 && session.s.chat.ma!.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 5));
      session.poll();
    }
    expect(sent!.url).toBe('https://api.deepseek.com/chat/completions');
    expect(sent!.body.model).toBe('deepseek-chat');
    expect(sent!.body.messages[0]!.content).toContain('你扮演】马德福');
    expect(session.s.chat.ma!.at(-1)).toEqual({ from: 'them', text: '嗯。' });
  });
});
