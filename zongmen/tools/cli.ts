// 命令行：打印案件、批量校验求解器、文字版试玩。
//
//   npm run cli -- case 20261207 [--tutorial] [--prompts] [--json]
//   npm run cli -- check [--from 1] [--count 1000]
//   npm run cli -- play [种子] [--provider template|openai_compatible] [--tutorial]
//
// 文字版试玩里的命令：
//   查 地点            勘察（藏经阁、居所、丹房、膳堂、练武场、竹林、山门）
//   问 名字 话         审问，消耗 1 次问话（快捷问题：问 名字 1/2/3）
//   示 名字 编号       出示线索簿里的证据，消耗 1 次问话
//   簿                 看线索簿
//   况                 看剩余问话和各人压力
//   指认 名字 编号 编号  指认内奸
//   退                 退出

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, env, exit } from 'node:process';
import { defaultData, type LocationId } from '../assets/game/data/index';
import { generateCase } from '../assets/game/case/generator';
import { solveCase } from '../assets/game/case/solver';
import { describeCase } from '../assets/game/case/describe';
import { GameSession } from '../assets/game/game/state';
import { createClient, type ProviderName } from '../assets/game/ai/factory';
import { GRADE_NAMES } from '../assets/game/game/rules';
import { quickQuestions } from '../assets/game/game/quick';

const data = defaultData();
const args = argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['tutorial', 'prompts', 'json'].includes(args[i - 1].slice(2))));

async function main() {
  const cmd = positional[0] ?? 'help';
  if (cmd === 'case') {
    const seed = Number(positional[1] ?? 1);
    const c = generateCase(seed, data, { tutorial: flag('tutorial') });
    if (flag('json')) console.log(JSON.stringify(c, null, 2));
    else console.log(describeCase(c, data, { cards: true, prompts: flag('prompts') }));
    return;
  }
  if (cmd === 'check') {
    const from = Number(opt('from', '1'));
    const count = Number(opt('count', '1000'));
    let ok = 0;
    let maxAttempt = 0;
    let maxMs = 0;
    let total = 0;
    const patterns: Record<string, number> = {};
    for (let s = from; s < from + count; s++) {
      const t0 = performance.now();
      try {
        const c = generateCase(s, data);
        const r = solveCase(c, data);
        if (r.ok) ok++;
        else console.log(`种子 ${s} 未通过：${r.errors.join('；')}`);
        maxAttempt = Math.max(maxAttempt, c.attempt);
        patterns[c.pattern] = (patterns[c.pattern] ?? 0) + 1;
      } catch (e) {
        console.log(String(e));
      }
      const dt = performance.now() - t0;
      total += dt;
      maxMs = Math.max(maxMs, dt);
    }
    console.log(`通过 ${ok}/${count}；最多重试 ${maxAttempt} 次；平均 ${(total / count).toFixed(2)} 毫秒，最慢 ${maxMs.toFixed(1)} 毫秒；伪证模式 ${JSON.stringify(patterns)}`);
    if (ok !== count) exit(1);
    return;
  }
  if (cmd === 'play') {
    await play();
    return;
  }
  console.log('用法：npm run cli -- case <种子> | check [--from N --count N] | play [种子] [--provider template|openai_compatible]');
}

const LOC_ALIASES: Record<string, LocationId> = {
  藏经阁: 'library', 居所: 'dorm', 弟子居所: 'dorm', 丹房: 'alchemy', 膳堂: 'kitchen', 练武场: 'training', 竹林: 'bamboo', 后山竹林: 'bamboo', 山门: 'gate',
};

async function play() {
  const seed = Number(positional[1] ?? Math.floor(Math.random() * 1e8));
  const provider = (opt('provider') ?? data.config.model.provider) as ProviderName;
  const client = createClient(data, provider, { env });
  const game = new GameSession(data, client, { seed, options: { tutorial: flag('tutorial') } });
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | undefined> => {
    stdout.write(prompt);
    const r = await lines.next();
    if (r.done) return undefined;
    if (!stdin.isTTY) stdout.write(r.value + '\n');
    return r.value;
  };
  const say = (s: string) => console.log(s);
  const findDisciple = (n: string) =>
    game.case.disciples.find((d) => {
      const ch = data.characters.find((x) => x.id === d.id)!;
      return ch.name === n || ch.name.includes(n) || ch.aliases.includes(n);
    })?.id;

  say(`《宗门内奸》文字版　案件编号 ${seed}　（模型：${provider}）\n`);
  game.start();
  for (const l of game.introLines()) say(`严长老：${l}`);
  game.finishIntro();
  say('\n命令：查 地点 / 问 名字 话（或 1、2、3 快捷问题）/ 示 名字 编号 / 簿 / 况 / 指认 名字 编号 编号 / 退\n');

  let shownNotices = game.state.notices.length;
  const flushNotices = () => {
    for (const n of game.state.notices.slice(shownNotices)) say(`${n.from === 'elder' ? '严长老' : '【提示】'}：${n.text}`);
    shownNotices = game.state.notices.length;
  };

  while (game.state.phase === 'investigate' || game.state.phase === 'accuse') {
    const prompt = game.state.phase === 'accuse' ? '（天亮了，必须指认）> ' : `[香炉 ${game.state.questionsLeft}] > `;
    const got = await ask(prompt);
    if (got === undefined) break;
    const line = got.trim();
    if (!line) continue;
    const [verb, ...rest] = line.split(/\s+/);
    if (verb === '退') break;
    if (verb === '簿') {
      for (const c of game.state.clues) say(`  ${c.factId}　[${{ physical: '物证', testimony: '证词', confession: '坦白与失言' }[c.category]}]　${game.fact(c.factId).text}　（${c.via}）`);
      if (!game.state.clues.length) say('  线索簿还是空的。');
      continue;
    }
    if (verb === '况') {
      for (const d of game.case.disciples) {
        const st = game.state.disciples[d.id];
        say(`  ${game.name(d.id)}：压力 ${'■'.repeat(Math.round(st.stress / 10)).padEnd(10, '□')}　${st.emotion}${st.refused ? '（拒答）' : ''}${st.confessed ? '（已坦白）' : ''}`);
      }
      const s = game.state.stats;
      say(`  本局模型调用 ${s.calls} 次，token ${s.inputTokens}/${s.outputTokens}，平均延迟 ${game.averageLatencyMs()} 毫秒，兜底 ${s.fallbackTurns}/${s.turns}`);
      continue;
    }
    if (verb === '查') {
      const loc = LOC_ALIASES[rest[0] ?? ''];
      if (!loc) {
        say('  地点：藏经阁、居所、丹房、膳堂、练武场、竹林、山门');
        continue;
      }
      const r = game.investigate(loc);
      if (!r.ok) say(`  ${r.error}`);
      else {
        say(`  ${r.text}`);
        for (const f of r.found) say(`  ＋线索 ${f}：${game.fact(f).text}`);
      }
      continue;
    }
    if (verb === '问' || verb === '示') {
      const id = findDisciple(rest[0] ?? '');
      if (!id) {
        say('  没有这名弟子。');
        continue;
      }
      let r;
      if (verb === '问') {
        let text = rest.slice(1).join(' ');
        const quick = quickQuestions(game);
        if (['1', '2', '3'].includes(text)) text = quick[Number(text) - 1];
        say(`  掌门：${text}`);
        say(`  （${game.name(id)}思索中……）`);
        r = await game.ask(id, text);
      } else {
        r = await game.present(id, rest[1] ?? '');
      }
      if (!r.ok) say(`  ${r.error}`);
      else {
        if (r.verdict) say(`  【判定】${r.verdict === 'contradiction' ? '矛盾成立！' : r.verdict === 'explained' ? '已坦白过的事' : '不构成矛盾'}`);
        say(`  ${game.name(id)}（${r.emotion}）：${r.reply}`);
        for (const f of r.newClues) say(`  ＋线索 ${f}：${game.fact(f).text}`);
        if (r.refusedNow) say(`  ${game.name(id)}不肯再开口了。`);
      }
      flushNotices();
      continue;
    }
    if (verb === '指认') {
      const id = findDisciple(rest[0] ?? '');
      if (!id) {
        say('  没有这名弟子。');
        continue;
      }
      const r = game.accuse(id, rest.slice(1, 3));
      if (!r.ok) {
        say(`  ${r.error}`);
        continue;
      }
      say(`\n评级：${GRADE_NAMES[r.rating.grade]}（有效证据 ${r.rating.validEvidence.length} 条）`);
      say(await game.epilogue());
      say('\n真相复盘：');
      for (const row of game.truthTable()) {
        say(`  ${row.name}（${row.role}）：真实在${row.truth}，对掌门说在${row.claim}${row.secret ? `；秘密：${row.secret}` : ''}`);
        if (row.role === '内奸') for (const f of row.flaws) say(`    破绽：${f}`);
      }
      break;
    }
    say('  看不懂这条命令。');
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
