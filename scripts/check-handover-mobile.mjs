import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
// Supply PLAYWRIGHT_MODULE as a file URL when Playwright is outside node_modules.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { buildDist } from './build.mjs';
import { createApp } from '../server/index.mjs';
import { Workshop } from '../server/simulation.mjs';

const output = path.resolve('screenshots/t2-handover');
await mkdir(output, { recursive: true });
await buildDist();
const sim = new Workshop(); sim.running = false;
sim.command({ action: 'fault', postId: 'A1', kind: 'breakdown', requestId: 't2-handover-fault' }, 'operator');
sim.command({ action: 'job', postId: 'A1', kind: 'repair_generic', requestId: 't2-handover-job' }, 'operator');
sim.advance(15);
const before = sim.snapshot();
const server = createApp({ simulation: sim, aiOptions: { provider: 'local' }, storePath: null });
let browser;
const result = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sizes: [], errors: [] };
const base = 'http://127.0.0.1:3029';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('QA deadline'); process.exit(1); }, 180000);
function longFixture(source) {
  const fixture = structuredClone(source), tail = 'ДЛИННЫЙИДЕНТИФИКАТОР'.repeat(8);
  const repeat = (list, fallback, count = 7) => Array.from({ length: count }, (_, i) => ({ ...structuredClone(list[0] || fallback), id: `QA-${i}-${tail}` }));
  fixture.problems = repeat(source.problems, { status: 'open' }).map((x, i) => ({ ...x, title: `Проблема${tail}`, postId: `POST-${tail}`, vehicleIds: [`CAR-${tail}`] }));
  fixture.jobs = repeat(source.jobs, { status: 'running' }).map(x => ({ ...x, title: `Работа${tail}`, technicianId: `TECH-${tail}` }));
  fixture.tasks = repeat(source.tasks, {}).map(x => ({ ...x, title: `Задача${tail}`, reason: tail, impact: tail, next: tail, object: { type: 'post', id: `POST-${tail}` } }));
  fixture.orders = repeat(source.orders, { state: 'released' }).map(x => ({ ...x, state: 'released', modelId: tail }));
  fixture.resources.technicians = repeat(source.resources.technicians, {}).map(x => ({ ...x, name: tail, jobId: tail }));
  fixture.resources.stock = repeat(source.resources.stock, {}).map(x => ({ ...x, name: tail }));
  fixture.resources.heldPosts = repeat(source.resources.heldPosts, {}).map(x => ({ ...x, code: tail }));
  fixture.events = repeat(source.events, {}, 20).map((x, i) => ({ ...x, id: i, text: tail, kind: tail, minute: i }));
  return fixture;
}
async function measure(page) {
  return page.evaluate(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const targets = [...document.querySelectorAll('#view-handover button,#view-handover a,#view-handover summary')].filter(visible).map(e => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 65), key: e.dataset.focusKey, ...rect(e) }));
    return { innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      handover: rect(document.querySelector('#view-handover')),
      outside: [...document.querySelectorAll('body *')].filter(visible).filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 20).map(e => ({ tag: e.tagName, id: e.id, class: e.className, ...rect(e) })),
      nav: [...document.querySelectorAll('#analytics-navigation a')].map(e => ({ text: e.textContent.trim(), clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, ...rect(e) })),
      targets, smallTargets: targets.filter(e => e.width < 40 || e.height < 40),
      tables: document.querySelectorAll('#view-handover table').length,
      metrics: [...document.querySelectorAll('[data-handover-metric]')].map(e => [e.dataset.handoverMetric, e.textContent]),
      sections: document.querySelectorAll('.handover-items-section').length };
  });
}
try {
  server.listen(3029, '127.0.0.1'); await once(server, 'listening');
  const report = await (await fetch(base + '/api/handover')).json();
  const long = longFixture(report);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const [width, height] of [[414,896], [896,414], [640,320]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', e => result.errors.push({ size: `${width}x${height}`, error: e.message }));
    let mode = 'real';
    await page.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') return route.abort();
      const url = new URL(route.request().url());
      if (url.pathname !== '/api/handover' || url.search || mode === 'real') return route.continue();
      await sleep(200);
      return route.fulfill({ status: mode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'error' ? { error: 'Synthetic QA failure' } : mode === 'long' ? long : report) });
    });
    await page.goto(base + '/#handover');
    await page.waitForFunction(() => document.querySelectorAll('[data-handover-metric]').length === 9);
    const item = { width, height, baseline: await measure(page) };
    await page.screenshot({ path: path.join(output, `baseline-${width}x${height}.png`), fullPage: true });
    console.log(JSON.stringify({ stage: 'baseline', size: `${width}x${height}`, scroll: item.baseline.scrollWidth, small: item.baseline.smallTargets.length, sections: item.baseline.sections }));
    const link = page.locator('#view-handover a.handover-items-link[href*="/problem/"]').first();
    await link.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash.includes('/problem/'));
    item.problemRoute = await page.evaluate(() => location.hash);
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#handover' && document.querySelectorAll('[data-handover-metric]').length === 9);
    item.back = await page.evaluate(() => !document.querySelector('#view-handover').hidden);
    mode = 'delayed';
    await page.locator('#handover-refresh').focus(); await page.keyboard.press('Enter');
    item.loading = await page.locator('#handover-content').getAttribute('aria-busy');
    await page.waitForFunction(() => !document.querySelector('#handover-refresh').disabled && document.querySelectorAll('[data-handover-metric]').length === 9);
    item.refreshFocus = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    mode = 'error';
    await page.locator('#handover-refresh').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Не удалось/.test(document.querySelector('#handover-status').textContent));
    item.error = { text: await page.locator('#handover-status').textContent(), focus: await page.evaluate(() => document.activeElement.id || document.activeElement.tagName), disabled: await page.locator('#handover-refresh').isDisabled() };
    await page.screenshot({ path: path.join(output, `error-${width}x${height}.png`) });
    mode = 'delayed';
    await page.locator('#handover-refresh').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-handover-metric]').length === 9);
    item.retryFocus = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    mode = 'long';
    await page.locator('#handover-refresh').click();
    await page.waitForFunction(() => document.querySelectorAll('.handover-items-more').length === 8);
    item.long = await measure(page);
    const summary = page.locator('.handover-items-more > summary').first();
    await summary.focus(); await page.keyboard.press('Enter');
    item.disclosure = await summary.evaluate(e => ({ open: e.parentElement.open, active: document.activeElement === e, outline: getComputedStyle(e).outline, height: e.getBoundingClientRect().height, width: e.getBoundingClientRect().width }));
    await page.screenshot({ path: path.join(output, `disclosure-${width}x${height}.png`) });
    item.expanded = await measure(page);
    await page.keyboard.press('Enter');
    item.disclosureClosed = await summary.evaluate(e => !e.parentElement.open);
    await page.locator('#handover-refresh').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `long-top-${width}x${height}.png`) });
    result.sizes.push(item);
    console.log(JSON.stringify({ stage: 'complete', size: `${width}x${height}`, focus: item.refreshFocus, errorFocus: item.error.focus, longScroll: item.long.scrollWidth, expandedScroll: item.expanded.scrollWidth, disclosure: item.disclosure }));
    await context.close();
  }
  assert.deepEqual(sim.snapshot(), before, 'QA must not mutate simulation');
  result.readOnly = true;
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log('DONE: ' + path.join(output, 'results.json'));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
