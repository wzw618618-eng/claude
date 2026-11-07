// 把 data/ 和 config/ 下的数据文件打包成 src/data/bundle.gen.ts，
// 这样逻辑层在 Node、测试和引擎打包里都只需要 import 一个 TS 模块。
// 用法：npm run data（改了数据文件后运行）；测试会检查打包结果是否最新。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(root, 'assets/game/data/bundle.gen.ts');

const json = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const text = (p: string) => readFileSync(join(root, p), 'utf8');

export function buildBundleSource(): string {
  const bundle = {
    characters: json('data/characters.json'),
    traits: json('data/traits.json'),
    locations: json('data/locations.json'),
    secrets: json('data/secrets.json'),
    templates: json('data/case_templates.json'),
    templateLines: json('data/template_lines.json'),
    fallback: json('data/fallback_lines.json'),
    leak: json('data/leak_patterns.json'),
    blocklist: json('data/blocklist.json'),
    prompts: {
      system_disciple: text('data/prompts/system_disciple.md'),
      rules: text('data/prompts/rules.md'),
      turn: text('data/prompts/turn.md'),
      epilogue: text('data/prompts/epilogue.md'),
    },
    config: json('config/game.json'),
  };
  return (
    '// 自动生成，请勿手改。源文件在 data/ 和 config/，改完运行 npm run data。\n' +
    "import type { GameData } from './types';\n\n" +
    `export const GAME_DATA: GameData = ${JSON.stringify(bundle, null, 2)} as unknown as GameData;\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OUT, buildBundleSource());
  console.log(`已写入 ${OUT}`);
}
