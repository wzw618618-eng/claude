// 美术素材生成：
//   art/paintings/*.jpg  → tiangong/assets/ui/art.css   （画作内联成 data URI，两个版本共用）
//   人物形象（Open Peeps）→ art/portraits/*.svg，并写进 art.css 的 .pt-<角色>-<心情> 类
//   game-icons 图标挑选 → tiangong/assets/ui/icons.ts
// 画作来源和授权见 art/credits.json，图标授权见 CREDITS.md。改了素材后运行：npm run art

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createAvatar } from '@dicebear/core';
import { openPeeps } from '@dicebear/collection';

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

// 人物形象：每人固定的长相，三种表情对应心情好 / 平常 / 低落（Open Peeps，CC0）
const PEOPLE = {
  qin: { head: 'hatBeanie', facialHair: 'goatee2', skin: 'e0a878', cloth: '5f7d5c', faces: ['calm', 'old', 'tired'] },
  lin: { head: 'bun', skin: 'f5dcc8', cloth: 'c58a7a', faces: ['smile', 'calm', 'concerned'] },
  jie: { head: 'pomp', skin: 'f1d0b0', cloth: '5b88b0', faces: ['smileBig', 'cheeky', 'tired'] },
  ma: { head: 'noHair2', facialHair: 'moustache2', skin: 'e0a878', cloth: 'b08a3c', faces: ['eatingHappy', 'smile', 'concerned'] },
  su: { head: 'mediumBangs3', accessories: 'glasses4', skin: 'f5dcc8', cloth: '80609a', faces: ['contempt', 'serious', 'tired'] },
  man: { head: 'buns', skin: 'f8e1d0', cloth: 'e0a3a3', faces: ['cute', 'awe', 'concernedFear'] },
  gesang: { head: 'longBangs', skin: 'c98a5a', cloth: 'b5523b', faces: ['driven', 'serious', 'solemn'] },
  wu: { head: 'short5', facialHair: 'chin', skin: 'd29a6a', cloth: '6c7884', faces: ['calm', 'blank', 'solemn'] },
  unknown: { head: 'medium1', skin: '3a4450', cloth: '2a3440', faces: ['blank'] },
};

function peep(id, face) {
  const b = PEOPLE[id];
  return createAvatar(openPeeps, {
    seed: id,
    head: [b.head],
    face: [face],
    facialHair: b.facialHair ? [b.facialHair] : undefined,
    facialHairProbability: b.facialHair ? 100 : 0,
    accessories: b.accessories ? [b.accessories] : undefined,
    accessoriesProbability: b.accessories ? 100 : 0,
    maskProbability: 0,
    skinColor: [b.skin],
    clothingColor: [b.cloth],
    headContrastColor: [id === 'unknown' ? '1c242d' : '2c1b18'],
  }).toString();
}

const paintings = (await readdir('art/paintings')).filter((f) => f.endsWith('.jpg')).sort();
let css = '/* 由 scripts/art.mjs 生成，不要手改。画作：大都会艺术博物馆开放获取（CC0），详见 art/credits.json */\n:root, .hanyi {\n';
for (const f of paintings) {
  const b64 = (await readFile(`art/paintings/${f}`)).toString('base64');
  css += `  --art-${f.replace(/\.jpg$/, '')}: url("data:image/jpeg;base64,${b64}");\n`;
}
css += '}\n';
await mkdir('art/portraits', { recursive: true });
let portraits = 0;
for (const [id, b] of Object.entries(PEOPLE)) {
  for (const [i, face] of b.faces.entries()) {
    const svg = peep(id, face);
    await writeFile(`art/portraits/${id}-${i}.svg`, svg);
    css += `.pt-${id}-${i} { background-image: url("data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"); }\n`;
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
