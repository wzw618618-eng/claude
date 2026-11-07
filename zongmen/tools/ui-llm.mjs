// 本地预览里，体素弟子由真实大模型对话（第 0 阶段的最小演示）。
// 先启动本机代理：ZONGMEN_API_KEY=… pnpm run proxy
//   node tools/ui-llm.mjs
// 截图写到 artifacts/llm/（不进仓库）。

import { mkdirSync } from 'node:fs';
import { createBrowserCapture } from '@forgeax/engine/devkit';

const outputDir = process.argv[2] ?? 'artifacts/llm';
mkdirSync(outputDir, { recursive: true });
const browser = createBrowserCapture(process.cwd());

async function main() {
  const session = await browser.open({ backend: 'software', requireUi: true, outputDir });
  const page = session.page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    const url = new URL(page.url());
    url.searchParams.set('proxy', '1');
    await page.goto(url.toString());
    await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.dataset.zongmen === 'ready'), null, { timeout: 180000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Preparing scene'), null, { timeout: 180000 });
    const label = await page.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.dataset.zongmen === 'ready').zongmen.ui.aiLabel);
    await page.locator('[data-act="new"]').click();
    await page.waitForTimeout(800);
    await page.locator('[data-act="intro-skip"]').click();
    await page.waitForTimeout(800);
    const id = await page.locator('[data-act="talk"]').first().getAttribute('data-id');
    await page.locator(`[data-act="talk"][data-id="${id}"]`).click();
    await page.waitForTimeout(1000);
    for (const q of ['quick-0', 'type', 'quick-1']) {
      if (q === 'type') {
        await page.locator('[data-input="ask"]').fill('你平日和谁最要好？');
        await page.locator('[data-input="ask"]').press('Enter');
      } else {
        await page.locator(`[data-act="quick"][data-i="${q.slice(-1)}"]`).click();
      }
      await page.waitForFunction(() => {
        const host = [...document.querySelectorAll('div')].find((d) => d.dataset.zongmen === 'ready');
        return host && !host.zongmen.ui.thinking;
      }, null, { timeout: 60000 });
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${outputDir}/talk-llm.png` });
    const result = await page.evaluate(() => {
      const host = [...document.querySelectorAll('div')].find((d) => d.dataset.zongmen === 'ready');
      const g = host.zongmen.game;
      return { stats: g.state.stats, lines: Object.values(g.state.transcripts).flat().map((l) => `${l.from}${l.source ? `(${l.source})` : ''}：${l.text}`) };
    });
    console.log(JSON.stringify({ ok: true, label, errors, ...result }, null, 1));
  } finally {
    await session.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
