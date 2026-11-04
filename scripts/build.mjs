// 构建：把 TypeScript 打成一个 JS，连同样式内联进单个 HTML。
//   dist/index.html     完整网页，双击即可玩
//   dist/artifact.html  去掉文档骨架的版本，用于发布成 claude.ai Artifact
//   dist/sim.cjs        无头平衡模拟（--sim）

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

if (process.argv.includes('--sim')) {
  await build({
    entryPoints: ['scripts/sim.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist/sim.cjs',
    logLevel: 'warning',
  });
} else {
  const out = await build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2019',
    minify: true,
    write: false,
    charset: 'utf8',
    logLevel: 'warning',
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = (await readFile('tiangong/assets/ui/art.css', 'utf8')) + (await readFile('tiangong/assets/ui/style.css', 'utf8'));
  const head = (await readFile('src/ui/head.html', 'utf8')).replace('/*__CSS__*/', () => css);
  const body = `<div id="app" class="hanyi"></div>\n<script>${js}</script>\n`;
  await writeFile('dist/artifact.html', head + body);
  await writeFile(
    'dist/index.html',
    `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${head}</head>\n<body>\n${body}</body>\n</html>\n`,
  );
  console.log(`built dist/index.html (${((head.length + body.length) / 1024).toFixed(0)} KB)`);
}
