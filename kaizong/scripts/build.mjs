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
    banner: { js: '/*! 开宗立派。内含 MainLoop.js（MIT，Copyright (C) 2016 Isaac Sukin）和 ZzFX（MIT，Copyright (c) 2019 Frank Force），许可证全文见 kaizong/THIRD_PARTY.md */' },
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  // 游戏一律横着摆，竖拿手机时整体转 90 度；这时视口的宽高和游戏的宽高对调了，
  // 所以按宽高、横竖写的 @media 一律改成按游戏根节点量的 @container
  const css = (await Promise.all(['src/ui/style.css', 'src/ui/refinement.css', 'src/ui/polish.css', 'src/ui/stage.css'].map(p => readFile(p, 'utf8')))).join('\n')
    .replace(/@media\s*(\((?:max|min)-(?:width|height)|\(orientation)/g, '@container app $1');
  const head = (await readFile('src/ui/head.html', 'utf8')).replace('/*__CSS__*/', () => css);
  const html = `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${head}</head>\n<body>\n<div id="app"></div>\n<script>${js}</script>\n</body>\n</html>\n`;
  await writeFile('index.html', html);
  console.log(`built index.html (${(html.length / 1024).toFixed(0)} KB)`);
}

