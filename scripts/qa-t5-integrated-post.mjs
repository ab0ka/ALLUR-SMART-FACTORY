// T2/T3/T5 integration: real mobile post actions, sheet rerender and in-flight locking.
// Run after build with PLAYWRIGHT_MODULE pointing to the existing Playwright module.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Workshop } from '../server/simulation.mjs';
import { createApp } from '../server/index.mjs';
import { delayedQaRoute, closeQaFixture } from './lib/qa-lifecycle.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const port = 3032;
const output = new URL(`../data/t5-integrated-post-${Date.now()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
let browser;

async function verifyPostActions(page, workshop, { pending = false } = {}) {
  const actions = workshop.snapshot().posts.find(p => p.id === 'A2').actions;
  const actual = await page.locator('#side .post-action').evaluateAll(rows => rows.map(row => {
    const button = row.querySelector('button');
    return {
      label: button.textContent, disabled: button.disabled,
      reason: row.querySelector('.why')?.textContent ?? null,
      describedBy: button.getAttribute('aria-describedby'),
      linkedReason: button.getAttribute('aria-describedby') ? document.getElementById(button.getAttribute('aria-describedby'))?.textContent : null,
      actionable: ['job', 'transfer', 'hold'].some(key => key in button.dataset),
    };
  }));
  assert.equal(actual.length, actions.length);
  for (const [index, action] of actions.entries()) {
    const rendered = actual[index];
    assert.equal(rendered.label, pending && action.ok ? 'Выполняется…' : action.label);
    assert.equal(rendered.disabled, pending || !action.ok);
    assert.equal(rendered.actionable, action.ok);
    if (!action.ok) {
      assert.equal(rendered.reason, `Недоступно: ${action.reason}`);
      assert.equal(rendered.linkedReason, rendered.reason);
      assert.ok(rendered.describedBy);
    } else assert.equal(rendered.reason, null);
  }
  return actions.filter(action => !action.ok).map(action => ({ label: action.label, reason: action.reason }));
}

try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const scenario of ['pump-check', 'hold-then-resume']) {
    const workshop = new Workshop();
    while (!workshop.problems.length && workshop.minute < 480) workshop.advance(5);
    assert.ok(workshop.problems.length);
    const server = createApp({ simulation: workshop, aiOptions: { provider: 'local' } });
    let page, delayed;
    const errors = [], requests = [];
    try {
      page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/action') requests.push(request.postDataJSON());
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      await page.goto(`http://127.0.0.1:${port}/#space/assembly/post/A2`);
      await page.locator('#side [data-sheet-toggle]').waitFor();
      await page.evaluate(() => {
        window.t5PostErrors = [];
        const error = document.getElementById('error');
        new MutationObserver(() => { if (!error.hidden && error.textContent) window.t5PostErrors.push(error.textContent); })
          .observe(error, { childList: true, subtree: true, attributes: true });
      });
      const initialUnavailable = await verifyPostActions(page, workshop);
      assert.ok(initialUnavailable.some(action => action.reason.includes('занят')), 'Server must expose occupied parallel post reasons');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
      await page.locator('#side .post-action').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL(`${scenario}-initial-390.png`, output).pathname.replace(/^\//, '') });

      const operations = scenario === 'pump-check'
        ? [{ name: 'pump_check', selector: '#side [data-job="pump_check"][data-post-id="A2"]', action: 'job', kind: 'pump_check' }]
        : [{ name: 'hold', selector: '#side [data-hold="A2"][data-on="1"]', action: 'hold', on: true },
          { name: 'resume', selector: '#side [data-hold="A2"][data-on="0"]', action: 'hold', on: false }];

      for (const operation of operations) {
        const button = page.locator(operation.selector);
        assert.equal(await button.isDisabled(), false);
        const before = JSON.stringify(workshop.serialize()), beforeRequests = requests.length;
        for (const cancel of ['button', 'escape']) {
          await button.click();
          if (cancel === 'button') await page.locator('#confirm [value="cancel"]').click();
          else await page.keyboard.press('Escape');
          await page.locator('#confirm').waitFor({ state: 'hidden' });
          assert.equal(JSON.stringify(workshop.serialize()), before, `${operation.name}: cancel changed production`);
          assert.equal(requests.length, beforeRequests);
          assert.equal(await page.locator('#side').isVisible(), true, 'Escape must leave the mobile post card open');
        }
        for (const failure of ['409', 'network']) {
          await page.evaluate(() => { window.t5PostErrors = []; });
          await page.route('**/api/action', route => failure === '409'
            ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"T5 mobile post conflict"}' })
            : route.abort('connectionfailed'), { times: 1 });
          await button.click(); await page.locator('#confirm-ok').click();
          await page.waitForFunction(kind => window.t5PostErrors.some(message => kind === '409' ? message.includes('T5 mobile post conflict') : !message.includes('T5 mobile post conflict')), failure);
          assert.equal(await button.isDisabled(), false, `${operation.name}: failed POST kept the button locked`);
          assert.equal(JSON.stringify(workshop.serialize()), before);
          await verifyPostActions(page, workshop);
        }

        // Keep the pre-POST snapshot for the controls rendered while its response is delayed.
        const prePost = workshop.snapshot();
        const attempts = requests.length, jobs = workshop.jobs.length, eventSeq = workshop.eventSeq;
        delayed = delayedQaRoute(`mobile-${operation.name}`);
        // Both phases may reject independently; keep either rejection observed during cleanup.
        delayed.committed.catch(() => {}); delayed.finished.catch(() => {});
        await page.route('**/api/action', route => delayed.handle(route), { times: 1 });
        await button.evaluate(element => { element.click(); element.click(); });
        await page.locator('#confirm[open]').waitFor();
        await page.locator('#confirm-ok').evaluate(element => { element.click(); element.click(); });
        await delayed.committed;
        assert.equal(requests.length, attempts + 1);
        const command = requests.at(-1);
        assert.equal(command.action, operation.action); assert.equal(command.postId, 'A2');
        assert.equal(typeof command.requestId, 'string'); assert.ok(command.requestId.length > 10);
        if (operation.kind) assert.equal(command.kind, operation.kind);
        else assert.equal(command.on, operation.on);
        assert.equal(await button.isDisabled(), true);
        assert.equal(await button.textContent(), 'Выполняется…');

        const previousButton = await button.elementHandle();
        await page.locator('#side [data-sheet-toggle]').click();
        assert.equal(await page.locator('#side').evaluate(side => side.classList.contains('sheet-collapsed')), true);
        // A real presentation action rerenders the card without a production request.
        const mode = await page.locator('[data-mode="table"]').getAttribute('aria-pressed') === 'true' ? 'scene' : 'table';
        await page.locator(`[data-mode="${mode}"]`).click();
        assert.equal(await previousButton.evaluate(element => element.isConnected), false, 'Expected a real card replacement');
        await previousButton.dispose();
        assert.equal(await page.locator('#side').evaluate(side => side.classList.contains('sheet-collapsed')), true);
        await page.locator('#side [data-sheet-toggle]').click();
        assert.equal(await page.locator('#side [data-sheet-toggle]').getAttribute('aria-expanded'), 'true');
        await verifyPostActions(page, { snapshot: () => prePost }, { pending: true });
        await button.evaluate(element => { element.click(); element.click(); });
        assert.equal(await page.locator('#confirm').evaluate(dialog => dialog.open), false);
        assert.equal(requests.length, attempts + 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
        await button.scrollIntoViewIfNeeded();
        await page.screenshot({ path: new URL(`${operation.name}-rerender-busy-390.png`, output).pathname.replace(/^\//, '') });

        // The response itself also rerenders; its current sheet position must survive.
        const scrollBefore = await page.locator('#side .sheet-content').evaluate(content => {
          content.scrollTop = Math.min(110, content.scrollHeight - content.clientHeight); return content.scrollTop;
        });
        const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/action');
        delayed.release(); await Promise.all([response, delayed.finished]);
        await page.waitForFunction(() => [...document.querySelectorAll('#side .post-action button')].every(element => element.textContent !== 'Выполняется…'));
        const unavailable = await verifyPostActions(page, workshop);
        assert.equal(await page.locator('#side [data-sheet-toggle]').getAttribute('aria-expanded'), 'true');
        assert.ok(Math.abs(await page.locator('#side .sheet-content').evaluate(content => content.scrollTop) - scrollBefore) <= 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
        if (operation.action === 'job') assert.equal(workshop.jobs.length, jobs + 1);
        else {
          assert.equal(workshop.snapshot().posts.find(post => post.id === 'A2').hold, operation.on);
          assert.equal(workshop.events.filter(event => event.seq > eventSeq && event.type === 'hold_changed').length, 1);
        }
        assert.equal(requests.length, attempts + 1);
        assert.deepEqual(errors, []);
        await page.locator('#side .post-action').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: new URL(`${operation.name}-complete-390.png`, output).pathname.replace(/^\//, '') });
        results.push({ operation: operation.name, width: 390, height: 844, cancel: true, escapeLeavesSheet: true,
          injected409Recovery: true, networkRecovery: true, delayedRealPost: true, requestId: true,
          onePostAndEffect: true, collapsedDuringPost: true, replacedButtonsRemainBusy: true,
          sheetExpansionAndScrollPreserved: true, noHorizontalOverflow: true, unavailable, pageErrors: [...errors] });
        console.log(`${operation.name}: PASS (390px mobile post/A2)`);
        delayed.dispose(); delayed = undefined;
      }
    } finally {
      try { delayed?.dispose(); }
      finally { await closeQaFixture(page, server); }
    }
  }
  await writeFile(new URL('report.json', output), JSON.stringify({ status: 'passed', results }, null, 2));
  console.log(`PASS: ${output.pathname}`);
} catch (error) {
  await writeFile(new URL('report.json', output), JSON.stringify({ status: 'failed', error: error.stack, results }, null, 2));
  console.error(`FAIL: ${output.pathname}`); throw error;
} finally { await browser?.close(); }
