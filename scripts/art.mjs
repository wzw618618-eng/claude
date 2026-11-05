// 美术素材生成：
//   art/paintings/*.jpg →（scripts/pixelate.py）→ art/pixel-bg/*.png → tiangong/assets/ui/art.css（内联成 data URI，两个版本共用）
//   人物形象（scripts/pixel 手绘像素画）→ art/portraits/*.png，并写进 art.css 的 .pt-<角色>-<心情> 类
//   game-icons 图标挑选 → tiangong/assets/ui/icons.ts
// 画作来源和授权见 art/credits.json，图标授权见 CREDITS.md。改了素材后运行：npm run art

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { encodePNG } from './pixel/png.mjs';
import { PEOPLE, blinkLayer, portrait } from './pixel/people.mjs';

const require = createRequire(import.meta.url);

// 游戏里的名字 → game-icons 的图标名（作者）
const ICONS = {
  food: 'roast-chicken', wood: 'wood-pile', mat: 'toolbox', med: 'medicines',
  t_wood: 'wood-axe', t_hunt: 'bow-arrow', t_scavenge: 'backpack', t_explore: 'footprint',
  t_build: 'hammer-nails', t_cook: 'cooking-pot', t_care: 'first-aid-kit', t_comfort: 'conversation',
  t_guard: 'lantern-flame', t_rest: 'night-sleep',
  w_clear: 'sun', w_snow: 'snowflake-2', w_blizzard: 'snowing', fire: 'campfire', cold: 'thermometer-cold',
  nav_people: 'meeple-group', nav_build: 'wood-cabin', nav_log: 'scroll-unfurled', talk: 'chat-bubble',
};

// 人物形象：scripts/pixel/people.mjs 里手绘的 48×48 像素半身像，每人三种表情（心情好 / 平常 / 低落）
const CAST = ['qin', 'lin', 'jie', 'ma', 'su', 'man', 'gesang', 'wu', 'unknown'];

// 背景用像素化之后的画（scripts/pixelate.py 从 art/paintings 生成）
const paintings = (await readdir('art/pixel-bg')).filter((f) => f.endsWith('.png')).sort();
let css = '/* 由 scripts/art.mjs 生成，不要手改。画作：大都会艺术博物馆开放获取（CC0），详见 art/credits.json */\n:root, .hanyi {\n';
for (const f of paintings) {
  const b64 = (await readFile(`art/pixel-bg/${f}`)).toString('base64');
  css += `  --art-${f.replace(/\.png$/, '')}: url("data:image/png;base64,${b64}");\n`;
}
css += '}\n';
await rm('art/portraits', { recursive: true, force: true });
await mkdir('art/portraits', { recursive: true });
let portraits = 0;
for (const id of CAST) {
  for (let i = 0; i < (PEOPLE[id].moods ?? 3); i++) {
    const cv = portrait(id, i);
    const png = encodePNG(cv.w, cv.h, cv.rgba());
    await writeFile(`art/portraits/${id}-${i}.png`, png);
    // 眨眼：闭眼叠层 + 每人不同的节奏，免得大家一起眨
    const blink = blinkLayer(id, i);
    const h = [...id].reduce((v, ch) => Math.imul(v ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
    const timing = blink ? ` --blink: url("data:image/png;base64,${encodePNG(blink.w, blink.h, blink.rgba()).toString('base64')}"); --blink-dur: ${(4.2 + (h % 23) / 10).toFixed(1)}s; --blink-delay: -${((h >>> 9) % 50) / 10}s;` : '';
    css += `.pt-${id}-${i} { background-image: url("data:image/png;base64,${png.toString('base64')}");${timing} }\n`;
    portraits++;
  }
}
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
console.log(`art.css: ${paintings.length} 幅画、${portraits} 张人物（${(css.length / 1024).toFixed(0)} KB），icons.ts: ${Object.keys(out).length} 个图标`);
