// 用真实模型无头玩完整局：一局破案（含逼出坦白和失言），一局故意指认错人。
// 对话全文、调用次数、token 和费用估算写到 docs/eval/playthrough-日期.md。
//
//   ZONGMEN_API_KEY=... npm run playthrough -- [破案种子] [失败种子]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env } from 'node:process';
import { defaultData, type LocationId } from '../../src/data/index';
import { GameSession } from '../../src/game/state';
import { createClient } from '../../src/ai/factory';
import { quickQuestions } from '../../src/game/quick';
import { GRADE_NAMES } from '../../src/game/rules';
import { deduce } from '../../tests/helpers/bot';

const data = defaultData();
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCS: LocationId[] = ['library', 'dorm', 'alchemy', 'kitchen', 'training', 'bamboo', 'gate'];
const price = data.config.model.providers.openai_compatible.price_usd_per_million;

async function playOne(seed: number, wrong: boolean, out: string[]) {
  const game = new GameSession(data, createClient(data, 'openai_compatible', { env }), { seed });
  const t0 = Date.now();
  game.start();
  game.finishIntro();
  out.push(`## 种子 ${seed}（${wrong ? '故意指认错人' : '正常破案'}）`, '');
  for (const l of game.introLines()) out.push(`> 严长老：${l}`);
  out.push('');
  for (const l of LOCS) game.investigate(l);
  const ask = async (id: string, text: string) => {
    const r = await game.ask(id, text);
    out.push(`- **掌门 → ${game.name(id)}**：${text}`);
    out.push(r.ok ? `  - ${game.name(id)}（${r.emotion}，${r.source}）：${r.reply}${r.newClues.length ? `　＋${r.newClues.join('、')}` : ''}` : `  - （${r.error}）`);
  };
  const present = async (id: string, fid: string) => {
    const r = await game.present(id, fid);
    out.push(`- **掌门向${game.name(id)}出示** ${fid}：${game.fact(fid).text}`);
    out.push(r.ok ? `  - 【${r.verdict}】${game.name(id)}（${r.emotion}，${r.source}）：${r.reply}${r.newClues.length ? `　＋${r.newClues.join('、')}` : ''}` : `  - （${r.error}）`);
  };
  const [where, saw] = quickQuestions(game);
  for (const d of game.case.disciples) {
    await ask(d.id, where);
    await ask(d.id, saw);
  }
  // 逼一名有秘密的人坦白
  const sec = game.case.disciples.find((d) => d.role === 'secret')!.id;
  const secEv = game.case.contradictions.find((x) => x.target === sec && game.hasClue(x.evidence));
  if (secEv) {
    await present(sec, secEv.evidence);
    for (let i = 0; i < 5 && !game.state.disciples[sec].confessed; i++) await ask(sec, i % 2 ? '你还敢狡辩？老实交代！' : '证据摆在这里，你到底瞒着什么？');
  }
  const { culprit, breakers } = deduce(game);
  if (culprit && !wrong) {
    for (const b of breakers) await present(culprit, b);
    for (let i = 0; i < 8 && !game.state.disciples[culprit].slipped && game.state.questionsLeft > 2; i++) {
      await ask(culprit, ['你还敢狡辩？老实交代！', '那时你到底在哪？说实话！', '再不说，逐出师门！'][i % 3]);
    }
  }
  const target = wrong ? game.case.disciples.find((d) => d.id !== game.case.culprit)!.id : culprit ?? game.case.disciples[0].id;
  const trait = game.state.clues.find((c) => game.fact(c.factId).kind === 'trait_clue')!.factId;
  const evidence = [...new Set([...breakers, trait, ...game.state.clues.map((c) => c.factId)])].slice(0, 2);
  const r = game.accuse(target, evidence);
  if (!r.ok) throw new Error(r.error);
  const epi = await game.epilogue();
  const s = game.state.stats;
  const miss = s.inputTokens - s.cachedInputTokens;
  const usd = price ? (miss * price.input_miss + s.cachedInputTokens * price.input_hit + s.outputTokens * price.output) / 1e6 : 0;
  out.push('', `**指认**：${game.name(target)}，证据 ${evidence.join('、')} → ${GRADE_NAMES[r.rating.grade]}`, '', `**尾声**（${game.state.ending?.epilogueSource}）：${epi}`, '');
  out.push('| 项目 | 数值 |', '| --- | --- |');
  out.push(`| 推理出的内奸 / 真内奸 | ${culprit ? game.name(culprit) : '推不出'} / ${game.name(game.case.culprit)} |`);
  out.push(`| 坦白 / 失言 | ${game.state.disciples[sec].confessed ? '有' : '无'} / ${game.state.disciples[game.case.culprit].slipped ? '有' : '无'} |`);
  out.push(`| 问话用掉 | ${data.config.questions - game.state.questionsLeft} |`);
  out.push(`| 模型调用（含尾声、重新生成） | ${s.calls}（上限 ${data.config.budget.max_calls_per_case}） |`);
  out.push(`| 兜底回合 / 总回合 | ${s.fallbackTurns} / ${s.turns} |`);
  out.push(`| 输入 token（缓存命中） | ${s.inputTokens}（${s.cachedInputTokens}，${s.inputTokens ? Math.round((s.cachedInputTokens / s.inputTokens) * 100) : 0}%） |`);
  out.push(`| 输出 token | ${s.outputTokens} |`);
  out.push(`| 平均延迟 | ${game.averageLatencyMs()} 毫秒 |`);
  out.push(`| 本局费用估算 | 约 $${usd.toFixed(4)}（约 ¥${(usd * 7.1).toFixed(3)}） |`);
  out.push(`| 用时 | ${Math.round((Date.now() - t0) / 1000)} 秒 |`, '');
  return { grade: r.rating.grade, calls: s.calls, usd };
}

async function main() {
  const winSeed = Number(argv[2] ?? 20261207);
  const failSeed = Number(argv[3] ?? 42);
  const date = new Date().toISOString().slice(0, 10);
  const out: string[] = [`# 真实模型整局回放 ${date}`, '', `模型：\`${data.config.model.providers.openai_compatible.model}\`（关闭思考）。玩家是脚本：勘察全部地点 → 每人问“在哪”“见到谁” → 逼一名有秘密的人坦白 → 推理 → 对内奸出示矛盾并逼到失言 → 指认。`, ''];
  const a = await playOne(winSeed, false, out);
  const b = await playOne(failSeed, true, out);
  const file = join(root, 'docs/eval', `playthrough-${date}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out.join('\n') + '\n');
  console.log(`破案局：${a.grade}，调用 ${a.calls} 次，约 $${a.usd.toFixed(4)}；失败局：${b.grade}，调用 ${b.calls} 次，约 $${b.usd.toFixed(4)}`);
  console.log(`已写入 ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
