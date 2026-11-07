// 新手教学在真实浏览器里走一遍：严长老的提示随操作推进；顺带检查掌门直觉、标记矛盾和声音不报错。
//   node tools/ui-tutorial.mjs
// 截图写到 artifacts/tutorial/（不进仓库）。

import { createBrowserCapture } from '@forgeax/engine/devkit';

const outputDir = process.argv[2] ?? 'artifacts/tutorial';
const browser = createBrowserCapture(process.cwd());

async function main() {
  const session = await browser.open({ backend: 'software', deterministic: true, requireUi: true, outputDir });
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
  const state = () => page.evaluate(() => {
    const host = [...document.querySelectorAll('div')].find((d) => d.dataset.zongmen === 'ready');
    const g = host.zongmen.game;
    return { step: host.zongmen.ui.tutorialStep, done: host.zongmen.ui.settings.tutorialDone, culprit: g?.case.culprit, ids: g?.case.disciples.map((d) => d.id), clues: g?.state.clues.map((c) => c.factId), contradictions: g?.case.contradictions, conviction: g?.case.conviction_set };
  });
  const tap = async (sel, wait = 900) => {
    await page.locator(sel).first().click({ force: true });
    await page.waitForTimeout(wait);
  };
  const steps = [];
  try {
    await page.waitForFunction(() => !document.body.innerText.includes('Preparing scene'), null, { timeout: 120000 });
    await tap('[data-act="tutorial"]');
    await tap('[data-act="intro-skip"]');
    steps.push((await state()).step);
    await snap('01-coach-start');
    await tap('[data-act="map"]', 300);
    await settled();
    await tap('[data-loc="library"]', 300);
    steps.push((await state()).step);
    await tap('[data-act="plaza"]', 300);
    let s = await state();
    for (const id of s.ids) {
      await tap(`[data-act="talk"][data-id="${id}"]`, 400);
      await tap('[data-act="quick"][data-i="0"]', 1200);
      await tap('[data-act="quick"][data-i="1"]', 1200);
      await tap('[data-act="plaza"]', 300);
    }
    s = await state();
    steps.push(s.step);
    // 线索簿：掌门直觉、标记矛盾
    await tap('[data-act="cluebook"]');
    await tap('[data-act="intuition"]');
    await tap('[data-act="mark-mode"]', 300);
    const two = s.clues.slice(0, 2);
    for (const f of two) await tap(`[data-act="mark-pick"][data-fact="${f}"]`, 300);
    await snap('02-cluebook-tools');
    await tap('[data-act="close"]', 300);
    // 出示打破内奸说法的证据
    const breaker = s.contradictions.find((x) => x.target === s.culprit && s.clues.includes(x.evidence));
    await tap(`[data-act="talk"][data-id="${s.culprit}"]`, 400);
    await tap('[data-act="present"]', 400);
    await tap(`[data-act="present-fact"][data-fact="${breaker.evidence}"]`, 2500);
    steps.push((await state()).step);
    await snap('03-coach-accuse');
    await tap('[data-act="plaza"]', 300);
    await tap('[data-act="accuse"]', 400);
    await tap(`[data-act="pick-who"][data-id="${s.culprit}"]`, 300);
    s = await state();
    for (const f of s.conviction.filter((x) => s.clues.includes(x)).slice(0, 2)) await tap(`[data-act="pick-ev"][data-fact="${f}"]`, 300);
    await tap('[data-act="accuse-confirm"]', 300);
    await tap('[data-act="accuse-final"]', 5000);
    s = await state();
    steps.push(s.step);
    await snap('04-ending');
    console.log(JSON.stringify({ ok: true, errors, steps, tutorialDone: s.done }, null, 1));
  } finally {
    await session.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
