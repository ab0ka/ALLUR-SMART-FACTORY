// Run after build against a dedicated synthetic server; no dependency is added.
// PLAYWRIGHT_MODULE must be a file URL to an installed Playwright module.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const base = process.env.T5_BASE_URL || 'http://127.0.0.1:3032';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('screenshots', { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/#orders`);
    await page.locator('#release-form').waitFor();
    await page.locator('#menu summary').click();
    await page.locator('#reset').click();
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/action')), page.locator('#confirm-ok').click()]);
    const snapshot = () => page.evaluate(async () => (await fetch('/api/state')).json());
    const initial = await snapshot();
    const posts = [];
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/action')) posts.push(r.postDataJSON()); });
    const release = page.locator('#release-form button[type=submit]');
    await page.locator('#release-quantity').fill('1');
    await release.evaluate(b => { b.click(); b.click(); });
    await page.locator('#confirm[open]').waitFor();
    assert.match(await page.locator('#confirm-title').textContent(), /Выпустить задание/);
    assert.equal(posts.length, 0);
    await page.keyboard.press('Escape');
    assert.equal(posts.length, 0);
    await page.locator('[data-priority=high]:not([disabled])').first().click();
    await page.locator('#confirm[open]').waitFor();
    assert.match(await page.locator('#confirm-title').textContent(), /Изменить приоритет/);
    await page.locator('#confirm button[value=cancel]').click();
    assert.equal(posts.length, 0);

    let releaseRequest;
    const waiting = new Promise(resolve => { releaseRequest = resolve; });
    let received;
    const intercepted = new Promise(resolve => { received = resolve; });
    await page.route('**/api/action', async route => { received(); await waiting; await route.continue(); });
    await release.click();
    await page.screenshot({ path: `screenshots/t5-release-confirmation-${width}.png`, fullPage: true });
    await page.locator('#confirm-ok').evaluate(b => { b.click(); b.click(); });
    await intercepted;
    // Programmatic repeat exercises the guard even though real modal clicks are inert.
    await release.evaluate(b => b.click());
    await page.locator('[data-priority=high]:not([disabled])').first().evaluate(b => b.click());
    assert.equal(await page.locator('#confirm').evaluate(d => d.open), false);
    assert.equal(posts.length, 1);
    const completed = page.waitForResponse(r => r.url().endsWith('/api/action'));
    releaseRequest(); await completed;
    await page.unroute('**/api/action');
    const released = await snapshot();
    assert.equal(released.orders.length, initial.orders.length + 1);
    assert.equal(released.vehicles.length, initial.vehicles.length + 1);
    assert.ok(posts[0].requestId);

    await page.route('**/api/action', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'T5 synthetic conflict' }) }), { times: 1 });
    await page.locator('[data-priority=low]:not([disabled])').first().click();
    await page.locator('#confirm-ok').click();
    await page.waitForFunction(() => document.getElementById('error').textContent === 'T5 synthetic conflict');
    const target = page.locator('[data-priority=low]:not([disabled])').first();
    const orderId = await target.getAttribute('data-order');
    await target.click();
    await page.screenshot({ path: `screenshots/t5-priority-confirmation-${width}.png`, fullPage: true });
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/action')), page.locator('#confirm-ok').click()]);
    const changed = await snapshot();
    assert.equal(changed.orders.find(o => o.id === orderId).priority, 'low');
    assert.ok(posts.at(-1).requestId);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, cancelAndEscape: true, releaseCount: 1, pendingRepeatSuppressed: true, recoveryAfter409: true, pageErrors: errors }));
    await page.close();
  }
} finally { await browser.close(); }
