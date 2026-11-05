// 预览：把所有人物 × 三种表情拼成一张放大图。用法：node scripts/pixel/preview.mjs 输出.png [放大倍数] [只画这些人,逗号分隔]
import { writeFile } from 'node:fs/promises';
import { Canvas, scale, sheet } from './draw.mjs';
import { encodePNG } from './png.mjs';
import { PEOPLE, portrait } from './people.mjs';

const [out, n = '6', only] = process.argv.slice(2);
const k = Number(n);
const ids = only ? only.split(',') : Object.keys(PEOPLE);
const cells = [];
for (const id of ids) {
  for (let m = 0; m < 3; m++) {
    const cv = portrait(id, m);
    const bg = new Canvas(cv.w + 4, cv.h + 4);
    for (let y = 0; y < bg.h; y++) for (let x = 0; x < bg.w; x++) bg.put(x, y, PEOPLE[id].bg ?? '#cccccc', 'x');
    for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) if (cv.get(x, y)) bg.put(x + 2, y + 2, cv.get(x, y), 'x');
    cells.push(scale(bg, k));
  }
}
const s = sheet(cells, 3, 52 * k, 52 * k, '#222222');
await writeFile(out, encodePNG(s.w, s.h, s.rgba()));
console.log(`${out}: ${ids.length} 人`);
