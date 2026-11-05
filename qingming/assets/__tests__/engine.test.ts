import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World as Ecs } from '@forgeax/engine/ecs';
import { createIntelligenceRuntime } from '@forgeax/engine/intelligence';
import { createFakeIntelligenceProvider, type FakeIntelligenceProvider } from '@forgeax/engine/intelligence-fake';
import { NPC_COGNITIVE_LOD_AMBIENT, NPC_COGNITIVE_LOD_OFFSTAGE, NPC_COGNITIVE_LOD_SPOTLIGHT, NpcBrain } from '@forgeax/engine/npc';
import { AssetGuid } from '@forgeax/engine/pack/guid';
import { makeRng } from '../game/core/rng.ts';
import { ME, npcs, op } from '../game/core/world.ts';
import { PLACE_ORDER } from '../game/data/world-data.ts';
import { viewEncounter } from '../game/player.ts';
import { yearChoices } from '../game/ai/decide.ts';
import { MODES } from '../game/mind/bond.ts';
import { MAX_LINES, YEAR_AFF } from '../game/ai/talk.ts';
import { UI_PACKAGE, WORLD_PACKAGE } from '../ids.ts';
import { linkProvider } from '../souls/host.ts';
import { createOfflineProvider, TALK_LIMITS } from '../souls/providers.ts';
import { createSoulAdapter } from '../souls/soul-client.ts';
import type { ToHost } from '../world/protocol.ts';
import { WorldSession } from '../world/session.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ACTS = ['cultivate', 'seclude', 'adventure', 'task', 'trade', 'heal', 'help', 'visit', 'goal'];

type Asks = { decide?: (prompt: string) => string; talk?: (prompt: string) => string; voice?: (prompt: string) => string; encounter?: (prompt: string) => string };

/** 假的大模型：按信封里的请求类型回不同的 JSON，并记下收到的提示词（system 和当下两段拼在一起） */
function fakeAI(asks: Asks = {}) {
  const seen: { ask: string; prompt: string; soul: string }[] = [];
  const provider = createFakeIntelligenceProvider({
    id: 'fake-llm',
    script: (sub) => {
      const env = JSON.parse(sub.input) as { ask: keyof Asks; system: string; prompt: string; soul: string };
      const full = `${env.system}\n\n${env.prompt}`;
      seen.push({ ask: env.ask, soul: env.soul, prompt: full });
      const out = asks[env.ask]?.(full) ?? '{"reply":"嗯。"}';
      return { deltas: [out.slice(0, 12), out.slice(12)], output: out };
    },
  });
  return { provider, seen };
}

/** 让这几个人和你相识（交情够第一档） */
const acquaint = (s: WorldSession, ...ids: string[]) => { for (const id of ids) s.w.people[id].mind.bond = 10; };

function connect(session: WorldSession, provider: FakeIntelligenceProvider) {
  void session.connect(createIntelligenceRuntime(provider, { limits: TALK_LIMITS }), '测试');
}
const drain = (p: FakeIntelligenceProvider, s: WorldSession, n = 6) => { for (let i = 0; i < n; i++) { p.advance(); s.poll(); } };

/** 选项列表里的第一个代号；或者指定的那个（存在的话） */
const pick = (prompt: string, want?: string) => {
  const ids = [...prompt.split('【今年能做的事】')[1].matchAll(/^- ([^：\n]+)：/gm)].map((m) => m[1]);
  return want && ids.includes(want) ? want : ids[0];
};

function brains(ecs: Ecs, s: WorldSession) {
  const ents = (s as unknown as { entities: Map<string, never> }).entities;
  const out: Record<string, { lod: number; enabled: boolean; soulId: string; entity: never }> = {};
  for (const [id, e] of ents) {
    const v = ecs.get(e, NpcBrain).unwrap();
    out[id] = { lod: v.lod, enabled: v.enabled, soulId: v.soulId, entity: e };
  }
  return out;
}

/** 到了一个地方，先把找上门的事打发掉 */
function arrive(s: WorldSession, place: (typeof PLACE_ORDER)[number]) {
  s.act({ type: 'move', place });
  s.w.pending = [];
}

describe('青冥录 · 工程身份', () => {
  it('forge.json 的两个根分别指向世界插件和界面插件', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'forge.json'), 'utf8'));
    expect(manifest.id).toBe('qingming');
    expect(manifest.roots.engine).toBe(AssetGuid.format(AssetGuid.derive(WORLD_PACKAGE, 'plugin/world')));
    expect(manifest.roots.frontend).toBe(AssetGuid.format(AssetGuid.derive(UI_PACKAGE, 'plugin/ui')));
  });
});

describe('青冥录 · 每个修士都是一个 NPC 灵魂', () => {
  it('和你同处的人在场，正说话的被聚光，别处的人离场，死了的停用', () => {
    const ecs = new Ecs();
    ecs.components.register(NpcBrain).unwrap();
    const s = new WorldSession(() => undefined, 42);
    s.attach(ecs);
    let b = brains(ecs, s);
    expect(Object.keys(b).length).toBe(12);
    expect(b.hua.soulId).toBe('qingming.hua');
    // 开局在柳溪村：阿蛮和花婆婆在场，其他人离场
    expect(b.hua.lod).toBe(NPC_COGNITIVE_LOD_AMBIENT);
    expect(b.aman.lod).toBe(NPC_COGNITIVE_LOD_AMBIENT);
    expect(b.wen.lod).toBe(NPC_COGNITIVE_LOD_OFFSTAGE);

    s.receive({ channel: 'qingming/world', kind: 'focus', id: 'hua' });
    expect(brains(ecs, s).hua.lod).toBe(NPC_COGNITIVE_LOD_SPOTLIGHT);
    // 不在一处的人聚光不了
    s.receive({ channel: 'qingming/world', kind: 'focus', id: 'wen' });
    expect(brains(ecs, s).wen.lod).toBe(NPC_COGNITIVE_LOD_OFFSTAGE);

    arrive(s, 'qinglan');
    b = brains(ecs, s);
    expect(b.wen.lod).toBe(NPC_COGNITIVE_LOD_AMBIENT);
    expect(b.hua.lod).toBe(NPC_COGNITIVE_LOD_OFFSTAGE);

    s.w.people.tang.alive = false;
    s.align();
    expect(brains(ecs, s).tang).toMatchObject({ enabled: false, lod: NPC_COGNITIVE_LOD_OFFSTAGE });
  });

  it('灵魂按认知层级感知：聚光每帧都看，在场隔一会儿看一眼，离场不看；能做的事来自规则', () => {
    const ecs = new Ecs();
    ecs.components.register(NpcBrain).unwrap();
    const s = new WorldSession(() => undefined, 7);
    s.attach(ecs);
    s.receive({ channel: 'qingming/world', kind: 'focus', id: 'hua' });
    const adapter = createSoulAdapter(s.souls, {
      affordances: (_r, binding) => s.affordances(binding.soulId),
      sample: (binding) => s.perceive(binding.soulId),
    });
    const bindings = Object.values(brains(ecs, s)).map((v) => ({ entity: v.entity, soulId: v.soulId, affordanceRef: 'qingming', enabled: v.enabled, lod: v.lod as 0 | 1 | 2 }));
    adapter.sync(bindings, ecs);
    const hua0 = s.souls.get('qingming.hua')!, aman0 = s.souls.get('qingming.aman')!, wen0 = s.souls.get('qingming.wen')!;
    expect(hua0.lod).toBe('spotlight');
    expect(aman0.lod).toBe('ambient');
    expect(wen0.lod).toBe('offstage');
    expect(hua0.affordances.some((a) => a.id === 'plan:cultivate')).toBe(true);
    expect(hua0.perception?.place).toBe('柳溪村');
    adapter.tick(0.5, ecs);
    expect(s.souls.get('qingming.hua')!.samples).toBe(hua0.samples + 1);
    expect(s.souls.get('qingming.aman')!.samples).toBe(aman0.samples);
    adapter.tick(2, ecs);
    expect(s.souls.get('qingming.aman')!.samples).toBe(aman0.samples + 1);
    expect(s.souls.get('qingming.wen')!.samples).toBe(wen0.samples);
  });
});

describe('青冥录 · 年初定打算走引擎的 Intelligence Activity', () => {
  it('身边相识的人由 AI 从合法的选项里挑一件事；陌路人和离场的人照旧走规则', () => {
    const { provider, seen } = fakeAI({ decide: (p) => JSON.stringify({ choice: pick(p, 'adventure:forest'), why: '去林子里练练拳脚。' }) });
    const s = new WorldSession(() => undefined, 31);
    acquaint(s, 'aman', 'wen');
    connect(s, provider);
    const asked = seen.filter((x) => x.ask === 'decide').map((x) => x.soul);
    // 花婆婆在身边但还是陌路人；温玄相识但不在身边
    expect(asked).toEqual(['qingming.aman']);
    expect(s.w.people.hua.plan.asking).toBeFalsy();
    expect(s.w.people.aman.plan.asking).toBe(true);
    drain(provider, s);
    const aman = s.w.people.aman;
    expect(aman.plan).toMatchObject({ act: 'adventure', place: 'forest', why: '去林子里练练拳脚。', by: 'ai' });
    expect(aman.plan.asking).toBeFalsy();
    expect(aman.place).toBe('forest');
    expect(s.w.people.wen.plan.by).toBe('rule');
  });

  it('不在选项里的打算、空理由都不采用，保留规则的打算', () => {
    for (const bad of ['{"choice":"fly","why":"我要飞升"}', '{"choice":"cultivate","why":"   "}', '随便干点啥']) {
      const { provider } = fakeAI({ decide: () => bad });
      const s = new WorldSession(() => undefined, 32);
      acquaint(s, 'aman');
      const before = JSON.stringify(s.w.people.aman.plan);
      connect(s, provider);
      drain(provider, s);
      expect(s.w.people.aman.plan.by).toBe('rule');
      expect(s.w.people.aman.plan.asking).toBe(false);
      expect(JSON.stringify({ ...s.w.people.aman.plan, asking: undefined })).toBe(JSON.stringify({ ...JSON.parse(before), asking: undefined }));
    }
  });

  it('NPC 自己发起的请求每年有上限（看玩家选的用量）；一年只想一次', () => {
    for (const [mode, want] of [['save', MODES.save.cap], ['normal', 12]] as const) {
      const { provider, seen } = fakeAI({ decide: (p) => JSON.stringify({ choice: pick(p), why: '照旧。' }) });
      const s = new WorldSession(() => undefined, 33);
      // 省电档门槛高一些：交情 20 在两档下都是「相识」
      for (const n of npcs(s.w)) { n.place = 'village'; n.mind.bond = 20; }
      s.receive({ channel: 'qingming/world', kind: 'budget', mode });
      connect(s, provider);
      expect(seen.filter((x) => x.ask === 'decide').length).toBe(want);
      s.think();
      expect(seen.filter((x) => x.ask === 'decide').length).toBe(want);
    }
  });

  it('你已经到了地方，AI 想让人走掉的打算不算；换了一年才回来的直接丢掉', () => {
    const { provider } = fakeAI({ decide: (p) => JSON.stringify({ choice: pick(p, 'adventure:forest'), why: '走了。' }) });
    const s = new WorldSession(() => undefined, 34);
    acquaint(s, 'aman');
    connect(s, provider);
    arrive(s, 'village');
    drain(provider, s);
    expect(s.w.people.aman.place).toBe('village');
    expect(s.w.people.aman.plan.by).toBe('rule');

    // 第一年的主意到第二年才回来：不算数（第二年的请求故意回不合规的，好分清是哪一年的）
    const late = fakeAI({ decide: (p) => (p.includes('【此刻】第1年') ? JSON.stringify({ choice: pick(p, 'adventure:forest'), why: '去年的主意。' }) : '{"choice":"fly","why":"?"}') });
    const t = new WorldSession(() => undefined, 35);
    acquaint(t, 'aman');
    connect(t, late.provider);
    t.act({ type: 'endTurn' });
    expect(t.w.year).toBe(2);
    drain(late.provider, t);
    expect(Object.values(t.w.people).some((n) => n.plan.why === '去年的主意。')).toBe(false);
    expect(npcs(t.w).every((n) => !n.plan.asking)).toBe(true);
  });

  it('争宗主的人可以换一种合法的做法：散布丑闻、静等，或者动手', () => {
    const s = new WorldSession(() => undefined, 36);
    const lu = s.w.people.lu;
    lu.mind.goal!.step = 2;
    const ids = yearChoices(s.w, lu).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['goal:scandal', 'goal:wait']));
    lu.place = 'village';
    acquaint(s, 'lu');
    const { provider } = fakeAI({ decide: () => '{"choice":"goal:wait","why":"让那老东西自己熬死。"}' });
    connect(s, provider);
    drain(provider, s);
    expect(lu.plan).toMatchObject({ act: 'goal', scheme: 'wait', place: 'qinglan', by: 'ai' });
  });
});

describe('青冥录 · 自由对话', () => {
  it('AI 的回复边写边显示；好感按规则夹住，一年有上限；第一句花一次打交道，一人一年最多三句', () => {
    const reply = '{"reply":"娃儿来了？坐，喝口茶。","affinity":50,"trust":2,"revealed":"goal","offer":"master","remember":"你来看我，还陪我喝茶"}';
    const { provider } = fakeAI({ talk: () => reply });
    const out: ToHost[] = [];
    const s = new WorldSession((m) => out.push(m), 41);
    connect(s, provider);
    drain(provider, s);
    arrive(s, 'village');
    const hua = s.w.people.hua;
    const before = op(hua, ME).aff;
    s.receive({ channel: 'qingming/world', kind: 'talk', id: 'hua', text: '婆婆好！' });
    expect(s.w.turn.social).toBe(1);
    drain(provider, s);
    const streams = out.filter((m) => m.kind === 'stream').map((m) => (m as { text: string }).text);
    expect(streams.at(-1)).toBe('娃儿来了？坐，喝口茶。');
    expect(s.w.chat.hua.map((l) => l.from)).toEqual(['me', 'them']);
    expect(op(hua, ME).aff).toBe(before + 6);
    // 花婆婆没有秘密目标，也不够格收你为徒：透露和提议都不算数
    expect(s.w.knows.includes('goal:hua')).toBe(false);
    expect(s.w.offer).toBeNull();
    expect(hua.mind.mem.find((m) => m.note)?.note).toBe('你来看我，还陪我喝茶');

    for (let i = 0; i < 4; i++) { s.talk('hua', `第${i}句`); drain(provider, s); }
    expect(s.w.turn.talk.hua.lines).toBe(MAX_LINES);
    expect(s.w.turn.social).toBe(1);
    expect(op(hua, ME).aff).toBe(before + YEAR_AFF[1]);
  });

  it('信不过你时不会说出真实打算；信得过了才会，你就知道了', () => {
    const reply = '{"reply":"实话跟你说，宗主的位子我要定了。","affinity":1,"trust":1,"revealed":"goal","offer":"none"}';
    const { provider, seen } = fakeAI({ talk: () => reply });
    const s = new WorldSession(() => undefined, 42);
    connect(s, provider);
    drain(provider, s);
    s.w.people.lu.place = 'village';
    arrive(s, 'village');
    s.talk('lu', '师兄近来在忙什么？');
    drain(provider, s);
    expect(seen.at(-1)!.prompt).toContain('绝不能露出真实打算');
    expect(s.w.knows.includes('goal:lu')).toBe(false);

    const o = op(s.w.people.lu, ME);
    o.trust = 80; o.aff = 60;
    s.talk('lu', '我们之间还有什么不能说的？');
    drain(provider, s);
    expect(seen.at(-1)!.prompt).toContain('可以说出真实打算');
    expect(s.w.knows.includes('goal:lu')).toBe(true);
    expect(s.w.chat.lu.at(-1)).toMatchObject({ from: 'note' });
  });

  it('对方在谈话里提出指点你，答应了按规则涨修为，不花打交道的次数', () => {
    const { provider } = fakeAI({ talk: () => '{"reply":"你这口气息不对，我教你。","affinity":1,"trust":1,"revealed":"none","offer":"teach"}' });
    const s = new WorldSession(() => undefined, 43);
    connect(s, provider);
    drain(provider, s);
    arrive(s, 'village');
    op(s.w.people.hua, ME).aff = 30;
    s.talk('hua', '婆婆，我修炼总觉得气息不顺。');
    drain(provider, s);
    expect(s.w.offer).toMatchObject({ who: 'hua', kind: 'teach' });
    const exp = s.w.me.exp + s.w.me.stage * 1000;
    const social = s.w.turn.social;
    s.act({ type: 'offer', accept: true });
    expect(s.w.me.exp + s.w.me.stage * 1000).toBeGreaterThan(exp);
    expect(s.w.turn.social).toBe(social);
    expect(s.w.offer).toBeNull();
  });

  it('格式不对的回复不采用，改用规则的回答', () => {
    const { provider } = fakeAI({ talk: () => '我不按格式说话' });
    const s = new WorldSession(() => undefined, 44);
    connect(s, provider);
    drain(provider, s);
    arrive(s, 'village');
    s.talk('aman', '你好');
    drain(provider, s);
    const last = s.w.chat.aman.at(-1)!;
    expect(last.from).toBe('them');
    expect(last.text).not.toBe('我不按格式说话');
  });

  it('离线时也走同一条 Activity 流程，用规则写的回答；不请 AI 定打算', () => {
    const s = new WorldSession(() => undefined, 45);
    void s.connect(createIntelligenceRuntime(createOfflineProvider({ delayMs: 0, chunk: 500 }), { limits: TALK_LIMITS }), '离线');
    expect(npcs(s.w).every((n) => !n.plan.asking)).toBe(true);
    arrive(s, 'village');
    s.talk('hua', '婆婆好');
    return new Promise<void>((done) => {
      const tick = (i: number) => {
        s.poll();
        if (s.w.chat.hua?.length === 2 || i > 40) {
          expect(s.w.chat.hua.map((l) => l.from)).toEqual(['me', 'them']);
          done();
        } else setTimeout(() => tick(i + 1), 5);
      };
      tick(0);
    });
  });

  it('真正跨线程的那条路：Host 把提供方绑在 MessagePort 上，世界一侧经端口收发', async () => {
    const s = new WorldSession(() => undefined, 46);
    const link = linkProvider(createOfflineProvider({ delayMs: 0, chunk: 500 }));
    s.receive({ channel: 'qingming/world', kind: 'intelligence', providerId: link.providerId, label: '离线' }, link.port);
    arrive(s, 'village');
    s.talk('aman', '阿蛮哥！');
    for (let i = 0; i < 60 && (s.w.chat.aman?.length ?? 0) < 2; i++) {
      await new Promise((r) => setTimeout(r, 5));
      s.poll();
    }
    expect(s.w.chat.aman.map((l) => l.from)).toEqual(['me', 'them']);
    await link.close();
  });
});

describe('青冥录 · 选项对话和找上门的事：规则定后果，AI 配台词', () => {
  it('问陆沉舟的打算：AI 用他的口吻搪塞你，提示词里只有对外的说法，规则结果不变', () => {
    const { provider, seen } = fakeAI({ voice: () => '{"reply":"（笑）师弟说笑了，我不过想好好修炼。"}' });
    const s = new WorldSession(() => undefined, 51);
    connect(s, provider);
    drain(provider, s);
    s.w.people.lu.place = 'village';
    acquaint(s, 'lu');
    arrive(s, 'village');
    s.receive({ channel: 'qingming/world', kind: 'social', id: 'lu', topic: 'goal' });
    drain(provider, s);
    expect(s.w.chat.lu.at(-1)).toMatchObject({ from: 'them', text: '（笑）师弟说笑了，我不过想好好修炼。' });
    expect(s.w.knows.includes('goal:lu')).toBe(false);
    const prompt = seen.find((x) => x.ask === 'voice')!.prompt;
    expect(prompt).toContain('潜心修炼');
    expect(prompt).not.toContain('迟早是我的');
    expect(prompt).not.toContain('争宗主');
  });

  it('仇人找上门：AI 替他说开口的话，选项照旧', () => {
    const { provider } = fakeAI({ encounter: () => '{"reply":"（按住刀柄）找了你三年，今天该了结了。"}' });
    const s = new WorldSession(() => undefined, 52);
    const han = s.w.people.han;
    han.mind.goal = { kind: 'revenge', target: ME, step: 3, stuck: 0, secret: false, since: 1 };
    han.plan = { act: 'goal', place: 'village', why: '', by: 'rule', scheme: 'ambush', target: ME };
    connect(s, provider);
    drain(provider, s);
    s.act({ type: 'move', place: 'vein' });
    expect(s.w.pending[0]?.kind).toBe('attack');
    drain(provider, s);
    const v = viewEncounter(s.w, s.w.pending[0]);
    expect(v.text).toBe('韩烈：「（按住刀柄）找了你三年，今天该了结了。」');
    expect(v.choices.length).toBe(3);
  });
});

describe('青冥录 · 存档和长跑', () => {
  it('读档：谈话记录跟着存档走；第 1 阶段的旧存档也能读', () => {
    const s = new WorldSession(() => undefined, 61);
    arrive(s, 'village');
    s.talk('hua', '婆婆好');
    const save = JSON.stringify(s.w);
    const t = new WorldSession(() => undefined, 1);
    t.receive({ channel: 'qingming/world', kind: 'hello', save });
    expect(t.w.chat.hua.length).toBe(2);
    const old = JSON.parse(save);
    delete old.chat; delete old.offer; delete old.turn.talk;
    const u = new WorldSession(() => undefined, 1);
    u.receive({ channel: 'qingming/world', kind: 'hello', save: JSON.stringify(old) });
    expect(u.w.chat).toEqual({});
    expect(u.w.turn.talk).toEqual({});
  });

  it('三十年里身边的人都由一个乱选合法选项的 AI 定打算：每个打算都合法，世界照常转', () => {
    const r = makeRng(7);
    const { provider } = fakeAI({ decide: (p) => JSON.stringify({ choice: r.pick([...p.split('【今年能做的事】')[1].matchAll(/^- ([^：\n]+)：/gm)].map((m) => m[1])), why: '就这么定了。' }) });
    const s = new WorldSession(() => undefined, 71);
    const all = () => { for (const n of npcs(s.w)) n.mind.bond = 10; };
    all();
    connect(s, provider);
    let byAI = 0;
    for (let y = 0; y < 30 && s.w.phase === 'year'; y++) {
      drain(provider, s);
      for (const n of npcs(s.w)) {
        expect(ACTS).toContain(n.plan.act);
        expect(PLACE_ORDER).toContain(n.plan.place);
        expect(n.place).toBe(n.plan.place);
        if (n.plan.by === 'ai') byAI++;
      }
      s.act({ type: 'move', place: r.pick(PLACE_ORDER) });
      while (s.w.pending.length && s.w.phase === 'year') s.act({ type: 'choose', i: 0 });
      all();
      s.act({ type: 'endTurn' });
    }
    expect(byAI).toBeGreaterThan(20);
    expect(s.w.news.length).toBeGreaterThan(20);
  });
});
