// 竖屏手机尺寸（390×844）下的检查：广场、审问时输入中文、地图。
//   node tools/ui-phone.mjs
// 截图写到 artifacts/phone/（不进仓库）。

import { createBrowserCapture } from '@forgeax/engine/devkit';

const outputDir = process.argv[2] ?? 'artifacts/phone';
const browser = createBrowserCapture(process.cwd());

async function main() {
  const session = await browser.open({ backend: 'software', deterministic: true, requireUi: true, outputDir, width: 390, height: 844 });
  const page = session.page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const settled = () => page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.dataset.zongmen === 'ready' && d.dataset.cameraSettled === '1'), null, { timeout: 90000 });
  const snap = async (name) => {
    await settled();
    await page.evaluate((n) => { document.documentElement.dataset.forgeaxCaptureReady = n; }, name);
    return session.capture(name);
  };
  const tap = async (sel) => {
    await page.locator(sel).first().click();
    await page.waitForTimeout(800);
  };
  try {
    await page.waitForFunction(() => !document.body.innerText.includes('Preparing scene'), null, { timeout: 120000 });
    await tap('[data-act="new"]');
    await tap('[data-act="intro-skip"]');
    await snap('01-plaza');
    const first = await page.locator('[data-act="talk"]').first().getAttribute('data-id');
    await tap(`[data-act="talk"][data-id="${first}"]`);
    // 中文输入：Playwright 的 type 走 insertText，相当于输入法上屏
    await page.locator('[data-input="ask"]').click();
    await page.keyboard.type('你那时候在做什么？');
    await page.locator('[data-input="ask"]').press('Enter');
    await page.waitForTimeout(2500);
    const transcript = await page.evaluate(() => {
      const host = [...document.querySelectorAll('div')].find((d) => d.dataset.zongmen === 'ready');
      const g = host?.zongmen?.game;
      return g ? Object.values(g.state.transcripts).flat().map((l) => `${l.from}:${l.text}`) : [];
    });
    await snap('02-talk');
    await tap('[data-act="plaza"]');
    await tap('[data-act="map"]');
    await snap('03-map');
    console.log(JSON.stringify({ ok: true, errors, transcript }, null, 1));
  } finally {
    await session.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
