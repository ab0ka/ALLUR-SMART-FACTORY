import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { Workshop } from '../server/simulation.mjs';
import { createApp } from '../server/index.mjs';
import { compareOptions } from '../server/decisions.mjs';
import { delayedQaRoute, closeQaFixture } from './lib/qa-lifecycle.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const port = Number(process.env.T5_PORT || 3032);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('screenshots/t5-v45', { recursive: true });
try {
  for (const width of [1280, 390]) {
    const w = new Workshop(); while (!w.problems.some(p => p.kind === 'equipment')) w.advance(5);
    const problem = w.problems.find(p => p.kind === 'equipment'); compareOptions(w, problem.id);
    const server = createApp({ simulation: w, aiOptions: { provider: 'local' } });
    let page, delay;
    try {
      await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
      page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/#space/assembly/compare/${problem.id}`);
      await page.locator('[data-choice][value=diagnose_repair]').check();
      await page.locator('[data-apply-choice]').click();
      await page.locator('#confirm[open]').waitFor();
      w.advance(1); // Real server changes after confirmation opens; no client snapshot/render yet.
      const staleResponse = page.waitForResponse(r => r.url().endsWith('/api/decision'));
      await page.locator('#confirm-ok').click();
      assert.equal((await staleResponse).status(), 409);
      await page.waitForFunction(() => document.getElementById('error').textContent.includes('Снимок устарел'));
      assert.equal(w.decisions.length, 0); assert.equal(w.jobs.length, 0);
      assert.equal(await page.locator('[data-apply-choice]').count(), 0);
      await page.screenshot({ path: `screenshots/t5-v45/stale-${width}.png`, fullPage: true });
      await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/compare')), page.locator('#side [data-compare]').click()]);
      await page.locator('[data-choice][value=diagnose_repair]').check();
      delay = delayedQaRoute('decision-after-recalculate');
      await page.route('**/api/decision', route => delay.handle(route), { times: 1 });
      await page.locator('[data-apply-choice]').evaluate(b => { b.click(); b.click(); });
      await page.locator('#confirm-ok').evaluate(b => { b.click(); b.click(); });
      await delay.committed;
      assert.equal(await page.locator('[data-apply-choice]').isDisabled(), true);
      assert.equal(await page.locator('[data-apply-choice]').textContent(), 'Выполняется…');
      await page.screenshot({ path: `screenshots/t5-v45/busy-${width}.png`, fullPage: true });
      const applied = page.waitForResponse(r => r.url().endsWith('/api/decision'));
      delay.release(); await Promise.all([applied, delay.finished]);
      assert.equal(w.decisions.length, 1); assert.equal(w.jobs.length, 1); assert.deepEqual(errors, []);
      console.log(`stale -> recalculate -> one decision, visible busy: ${width} PASS`);
    } finally { try { delay?.dispose(); } finally { await closeQaFixture(page, server); } }
  }
} finally { await browser.close(); }
