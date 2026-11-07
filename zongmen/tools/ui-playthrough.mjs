// 真实浏览器里从标题玩到结局，每一步截图（引擎自带的持久截图会话）。
//   node tools/ui-playthrough.mjs [输出目录]
// 截图和 run.json 写到 artifacts/playthrough/（不进仓库）。

import { createBrowserCapture } from '@forgeax/engine/devkit';

const outputDir = process.argv[2] ?? 'artifacts/playthrough';
const browser = createBrowserCapture(process.cwd());
const shots = [];

async function main() {
  const session = await browser.open({ backend: 'software', deterministic: true, requireUi: true, outputDir });
  const page = session.page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const click = async (name, opts = {}) => {
    await page.getByRole('button', { name, exact: opts.exact ?? false }).first().click();
    await page.waitForTimeout(opts.wait ?? 900);
  };
  const settled = () => page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.dataset.zongmen === 'ready' && d.dataset.cameraSettled === '1'), null, { timeout: 60000 });
  const snap = async (name) => {
    await settled();
    // 截图会话等页面公布这个检查点名
    await page.evaluate((n) => { document.documentElement.dataset.forgeaxCaptureReady = n; }, name);
    shots.push(await session.capture(name));
  };
  const game = () => page.evaluate(() => {
    const host = [...document.querySelectorAll('div')].find((d) => d.dataset.zongmen === 'ready');
    const g = host?.zongmen?.game;
    return g ? { culprit: g.case.culprit, disciples: g.case.disciples.map((d) => d.id), names: Object.fromEntries(g.case.disciples.map((d) => [d.id, g.name(d.id)])), clues: g.state.clues.map((c) => c.factId), conviction: g.case.conviction_set, left: g.state.questionsLeft, contradictions: g.case.contradictions } : null;
  });
  try {
    // 等引擎的“Preparing scene”加载层消失
    await page.waitForFunction(() => !document.body.innerText.includes('Preparing scene'), null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await snap('01-title');
    await click('开始新案', { wait: 1500 });
    await snap('02-intro');
    await click('跳过', { wait: 2500 });
    await snap('03-plaza');
    let g = await game();
    // 勘察：地图 → 藏经阁
    await click('勘察各处', { wait: 2500 });
    await snap('04-map');
    await page.locator(`[data-loc="library"]`).click({ force: true });
    await page.waitForTimeout(2500);
    await snap('05-library');
    for (const loc of ['dorm', 'alchemy', 'kitchen', 'training', 'bamboo', 'gate']) {
      await click('看看别处', { wait: 300 });
      await settled();
      await page.locator(`[data-loc="${loc}"]`).click({ force: true });
      await page.waitForTimeout(600);
    }
    await click('回广场', { wait: 2000 });
    // 审问：每人问在哪、见到谁
    g = await game();
    for (const id of g.disciples) {
      await page.locator(`[data-act="talk"][data-id="${id}"]`).click();
      await page.waitForTimeout(1500);
      await page.locator('[data-act="quick"][data-i="0"]').click();
      await page.waitForTimeout(1500);
      await page.locator('[data-act="quick"][data-i="1"]').click();
      await page.waitForTimeout(1500);
      if (id === g.disciples[0]) await snap('06-talk');
      await page.locator('[data-act="plaza"]').first().click();
      await page.waitForTimeout(500);
    }
    // 打字问话（中文输入）
    g = await game();
    await page.locator(`[data-act="talk"][data-id="${g.culprit}"]`).click();
    await page.waitForTimeout(1500);
    await page.locator('[data-input="ask"]').fill('你那时候到底在做什么？说实话！');
    await page.locator('[data-input="ask"]').press('Enter');
    await page.waitForTimeout(2500);
    // 出示矛盾证据
    g = await game();
    const breaker = g.contradictions.find((x) => x.target === g.culprit && g.clues.includes(x.evidence));
    if (breaker) {
      await page.locator('[data-act="present"]').click();
      await page.waitForTimeout(800);
      await snap('07-present');
      await page.locator(`[data-act="present-fact"][data-fact="${breaker.evidence}"]`).click();
      await page.waitForTimeout(3000);
    }
    await snap('08-contradiction');
    await page.locator('[data-act="cluebook"]').count();
    await page.locator('[data-act="plaza"]').first().click();
    await page.waitForTimeout(1500);
    await click('线索簿', { wait: 800 });
    await snap('09-cluebook');
    await click('关闭', { wait: 500 });
    // 指认
    g = await game();
    await click('指认内奸', { wait: 800 });
    await page.locator(`[data-act="pick-who"][data-id="${g.culprit}"]`).click();
    const picks = g.conviction.filter((id) => g.clues.includes(id)).slice(0, 2);
    for (const id of picks) await page.locator(`[data-act="pick-ev"][data-fact="${id}"]`).click();
    await page.waitForTimeout(500);
    await snap('10-accuse');
    await page.locator('[data-act="accuse-confirm"]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-act="accuse-final"]').click();
    await page.waitForTimeout(6000);
    await snap('11-ending');
    console.log(JSON.stringify({ ok: true, errors, shots: shots.map((s) => s.path ?? s), culprit: g.names[g.culprit], picks }, null, 1));
  } finally {
    await session.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
