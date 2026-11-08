// 构建：把 TypeScript 打成一个 JS，连同样式内联进 index.html（放在 kaizong/ 根目录，GitHub Pages 直接用）。
//   node scripts/build.mjs          → index.html
//   node scripts/build.mjs --sim    → dist/sim.cjs（无头平衡模拟）

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

if (process.argv.includes('--sim')) {
  await mkdir('dist', { recursive: true });
  await build({ entryPoints: ['scripts/sim.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/sim.cjs', logLevel: 'warning' });
} else {
  const out = await build({
    entryPoints: ['src/main.ts'], bundle: true, format: 'iife', target: 'es2019', minify: true, write: false, charset: 'utf8', logLevel: 'warning',
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = (await Promise.all(['src/ui/style.css', 'src/ui/refinement.css', 'src/ui/polish.css'].map(p => readFile(p, 'utf8')))).join('\n');
  const head = (await readFile('src/ui/head.html', 'utf8')).replace('/*__CSS__*/', () => css);
  const html = `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${head}</head>\n<body>\n<div id="app"></div>\n<script>${js}</script>\n</body>\n</html>\n`;
  await writeFile('index.html', html);
  console.log(`built index.html (${(html.length / 1024).toFixed(0)} KB)`);
}

