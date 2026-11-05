// 用真的 DeepSeek 自动玩几年《青冥录》，看灵魂演得怎么样、花了多少钱。
// 密钥只从环境变量读，不写进任何文件：
//   DEEPSEEK_API_KEY=sk-… pnpm live（要走代理时加 NODE_USE_ENV_PROXY=1）
//   参数： [年数=12] [种子=2026] [用量=normal] [跟着谁]
// 「跟着谁」填一个人的 id（比如 hua）：开局就和他交情很深（刻骨），每年都去他在的地方，好看深想的灵魂。
// 打印：每年谁自己拿了主意、谁主动开口、你和他们的对话、听见的话、年底「心里的你」，最后是交情和账单。

import { createIntelligenceRuntime } from '@forgeax/engine/intelligence';
import type { PlaceId } from '../assets/game/core/types.ts';
import { nm, npcs, placeName } from '../assets/game/core/world.ts';
import { isMode, MODES } from '../assets/game/mind/bond.ts';
import { canBreak } from '../assets/game/systems/body.ts';
import { viewEncounter } from '../assets/game/player.ts';
import { heardText } from '../assets/game/ai/souls.ts';
import { createMeter, totalsText, USD_CNY } from '../assets/souls/meter.ts';
import { createChatApiProvider, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, TALK_LIMITS, type UsageReport } from '../assets/souls/providers.ts';
import { WorldSession } from '../assets/world/session.ts';

const key = process.env.DEEPSEEK_API_KEY ?? '';
if (!key) {
  console.error('需要环境变量 DEEPSEEK_API_KEY');
  process.exit(1);
}
const YEARS = Number(process.argv[2] ?? 12);
const SEED = Number(process.argv[3] ?? 2026);
const MODE = isMode(process.argv[4]) ? process.argv[4] : 'normal';
const FOLLOW = process.argv[5] ?? '';

/** 主角每年去哪：先在山脚的村子结交，再上青岚宗，偶尔去坊市和洞府 */
const ROUTE: PlaceId[] = ['village', 'village', 'village', 'qinglan', 'qinglan', 'market', 'qinglan', 'village', 'qinglan', 'cave', 'qinglan', 'village'];
/** 主角会说的话 */
const LINES = [
  '前辈好，晚辈初来乍到，想请教几句。', '您还记得我吗？', '最近江湖上不太平，您怎么看？', '有什么我能帮上忙的？',
  '您心里是不是有什么放不下的事？', '说实话，我有点信不过您。', '这些年您过得好吗？', '我听说了一些关于您的传闻……',
  '要是有一天我们成了对头，您会手下留情吗？', '谢谢您上次的照顾。', '您年轻的时候，也像我这样吗？', '我想变强，您能指条路吗？',
];

const reports: UsageReport[] = [];
const meter = createMeter();
const provider = createChatApiProvider({
  id: 'deepseek', baseUrl: DEEPSEEK_BASE_URL, apiKey: key, model: DEEPSEEK_MODEL, dialect: 'deepseek',
  onUsage: (r) => { reports.push(r); meter.record(r); },
});
const label = `DeepSeek（${DEEPSEEK_MODEL}）`;

const s = new WorldSession(() => undefined, SEED, { name: '林舟', root: 'dual' });
s.receive({ channel: 'qingming/world', kind: 'budget', mode: MODE });
if (FOLLOW && s.w.people[FOLLOW]) s.w.people[FOLLOW].mind.bond = 60;
await s.connect(createIntelligenceRuntime(provider, { limits: TALK_LIMITS }), label);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 等所有请求回来 */
async function settle(limitMs = 180_000) {
  const t0 = Date.now();
  while (s.waiting > 0 && Date.now() - t0 < limitMs) {
    s.poll();
    await sleep(40);
  }
  s.poll();
}
const w = () => s.w;
const say = (text: string) => console.log(text);
/** 打印某人谈话记录里新增的几行 */
function newLines(id: string, from: number) {
  for (const l of (w().chat[id] ?? []).slice(from)) say(`    ${l.from === 'me' ? '你' : l.from === 'them' ? nm(w(), id) : '旁白'}：${l.text}`);
}

let line = 0;
for (let y = 0; y < YEARS && w().phase === 'year'; y++) {
  await settle();
  const W = w();
  say(`\n════ 第${W.year}年 ════`);
  for (const n of npcs(W)) {
    if (n.plan.by === 'ai') say(`  【自己拿主意】${n.name}（${s.tier(n)}档${n.place === W.me.place ? '' : '，在远处'}）：${n.plan.why}（去${placeName(n.plan.place)}）`);
  }
  const place = (FOLLOW && W.people[FOLLOW]?.alive ? W.people[FOLLOW].place : null) ?? ROUTE[y % ROUTE.length];
  const chatBefore = Object.fromEntries(npcs(W).map((n) => [n.id, (W.chat[n.id] ?? []).length]));
  const heardBefore = W.heard.length;
  s.act({ type: 'move', place });
  say(`  你来到了${placeName(place)}。这里有：${npcs(W).filter((n) => n.place === place).map((n) => `${n.name}（${s.tier(n)}档）`).join('、') || '没有人'}`);
  await settle();
  for (const n of npcs(W)) if ((W.chat[n.id] ?? []).length > chatBefore[n.id]) { say(`  【主动开口】`); newLines(n.id, chatBefore[n.id]); }
  for (const h of W.heard.slice(heardBefore)) say(`  【听见】\n${heardText(W, h).replace(/^/gm, '    ')}`);
  while (W.pending.length && W.phase === 'year') {
    const v = viewEncounter(W, W.pending[0]);
    say(`  【${v.title}】${v.text}`);
    const i = v.choices.findIndex((c) => !c.disabled);
    say(`    你选了：${v.choices[i].label}`);
    const out = s.act({ type: 'choose', i });
    if (out) say(`    ${out}`);
    await settle();
  }
  if (W.phase !== 'year') break;
  s.act({ type: 'main', act: canBreak(W.me) ? 'seclude' : 'cultivate' });
  const here = npcs(W).filter((n) => n.place === W.me.place).sort((a, b) => s.tier(b) - s.tier(a)).slice(0, 2);
  for (const n of here) {
    const from = (W.chat[n.id] ?? []).length;
    say(`  【和${n.name}说话】（${s.tier(n)}档）`);
    for (let k = 0; k < 2; k++) {
      s.talk(n.id, LINES[line++ % LINES.length]);
      await settle();
    }
    newLines(n.id, from);
    if (W.offer) {
      const accept = W.offer.kind === 'teach' || W.offer.kind === 'spar';
      say(`    （${n.name}提出：${W.offer.kind}，你${accept ? '答应了' : '婉拒了'}）`);
      const out = s.act({ type: 'offer', accept });
      if (out) say(`    ${out}`);
    }
  }
  s.act({ type: 'endTurn' });
  await settle();
  for (const n of Object.values(W.people)) if (n.mind.heartY === W.year - 1) say(`  【${n.name}心里的你】「${n.mind.heart}」`);
}

say('\n════ 交情 ════');
for (const n of npcs(w()).sort((a, b) => s.tier(b) - s.tier(a))) say(`  ${n.name}：${s.tier(n)}档${n.mind.heart ? `　心里的你：「${n.mind.heart}」` : ''}`);

say('\n════ 账单（DeepSeek V4.1 Flash，按高峰价；闲时是一半） ════');
say(`  一共：${totalsText(meter.game)}`);
const years = Math.max(1, w().year - 1);
say(`  平均每年：约 ¥${((meter.game.usd * USD_CNY) / years).toFixed(3)}（${(meter.game.calls / years).toFixed(1)} 次）`);
const group = (key: (r: UsageReport) => string) => {
  const m = new Map<string, UsageReport[]>();
  for (const r of reports) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m].sort();
};
for (const [k, rs] of group((r) => r.ask)) {
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  say(`  ${k}：${rs.length} 次，中位耗时 ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} 秒，思考 ${rs.reduce((a, r) => a + r.usage.reasoning, 0)} token`);
}
for (const [k, rs] of group((r) => `交情${r.tier}档`)) say(`  ${k}：${rs.length} 次`);
say(`  用量档：${MODES[MODE].name}`);
await provider.close();
