// 美术素材生成：
//   art/paintings/*.jpg  → tiangong/assets/ui/art.css   （画作内联成 data URI，两个版本共用）
//   game-icons 图标挑选 → tiangong/assets/ui/icons.ts
// 画作来源和授权见 art/credits.json，图标授权见 CREDITS.md。改了素材后运行：npm run art

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 游戏里的名字 → game-icons 的图标名（作者）
const ICONS = {
  food: 'roast-chicken', wood: 'wood-pile', mat: 'toolbox', med: 'medicines',
  t_wood: 'wood-axe', t_hunt: 'bow-arrow', t_scavenge: 'backpack', t_explore: 'footprint',
  t_build: 'hammer-nails', t_cook: 'cooking-pot', t_care: 'first-aid-kit', t_comfort: 'conversation',
  t_guard: 'lantern-flame', t_rest: 'night-sleep',
  w_clear: 'sun', w_snow: 'snowflake-2', w_blizzard: 'snowing', fire: 'campfire', cold: 'thermometer-cold',
};

const paintings = (await readdir('art/paintings')).filter((f) => f.endsWith('.jpg')).sort();
let css = '/* 由 scripts/art.mjs 生成，不要手改。画作：大都会艺术博物馆开放获取（CC0），详见 art/credits.json */\n:root, .hanyi {\n';
for (const f of paintings) {
  const b64 = (await readFile(`art/paintings/${f}`)).toString('base64');
  css += `  --art-${f.replace(/\.jpg$/, '')}: url("data:image/jpeg;base64,${b64}");\n`;
}
css += '}\n';
await writeFile('tiangong/assets/ui/art.css', css);

const set = JSON.parse(await readFile(require.resolve('@iconify-json/game-icons/icons.json'), 'utf8'));
const out = {};
for (const [key, name] of Object.entries(ICONS)) {
  const icon = set.icons[name];
  if (!icon) throw new Error(`game-icons 里没有 ${name}`);
  out[key] = icon.body;
}
await writeFile(
  'tiangong/assets/ui/icons.ts',
  `// 由 scripts/art.mjs 生成，不要手改。图标来自 game-icons.net（作者 Lorc、Delapouite），CC BY 3.0。\n` +
    `export const ICON_BODIES: Record<string, string> = ${JSON.stringify(out, null, 2)};\n\n` +
    `export const icon = (key: string, cls = '') =>\n  ICON_BODIES[key] ? \`<svg class="ico \${cls}" viewBox="0 0 512 512" aria-hidden="true">\${ICON_BODIES[key]}</svg>\` : '';\n`,
);
console.log(`art.css: ${paintings.length} 幅画（${(css.length / 1024).toFixed(0)} KB），icons.ts: ${Object.keys(out).length} 个图标`);
