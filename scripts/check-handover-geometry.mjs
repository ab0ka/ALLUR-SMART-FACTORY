import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDist } from './build.mjs';
import { createApp } from '../server/index.mjs';
import { Workshop } from '../server/simulation.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// The stored geometry fixture must retain the exact original public sources.
execFileSync('git', ['diff', '--quiet', 'eae50107d0ff6bbced9040e65d3f43e936d13a95', '--', 'public']);
const cssCommit = '348935f43a48d583d7ac49966ca47137efa736d6';
const patch = execFileSync('git', ['show', '--format=', cssCommit, '--', 'public/styles.css'], { encoding: 'utf8' });
assert.equal(patch.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length, 0, 'Expected an additive CSS-only patch');
const addedRules = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
assert.equal(addedRules.trim(), '@media(max-width:760px){#analytics-navigation>a{min-width:0;white-space:normal;min-height:40px}}');
await buildDist();
const css = await readFile('public/styles.css', 'utf8');
const output = path.resolve('screenshots/t2-handover');
await mkdir(output, { recursive: true });
const sim = new Workshop(); sim.running = false;
const before = sim.snapshot();
const server = createApp({ simulation: sim, aiOptions: { provider: 'local' }, storePath: null });
const report = { baseIntegration: 'eae50107d0ff6bbced9040e65d3f43e936d13a95', checkout: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cssCommit, cssOverlayOnly: true, addedRules, sizes: [], errors: [] };
let browser;
try {
  server.listen(3029, '127.0.0.1'); await once(server, 'listening');
  browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 60000 });
  for (const [width, height] of [[414,896],[896,414],[640,320]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.route('**/styles.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: css + '\n' + addedRules }));
    await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:3029/#handover');
    await page.waitForFunction(() => document.querySelectorAll('[data-handover-metric]').length === 9);
    const geometry = await page.evaluate(() => ({ innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, nav: [...document.querySelectorAll('#analytics-navigation > a')].map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), x: r.x, width: r.width, height: r.height, right: r.right, clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, whiteSpace: getComputedStyle(e).whiteSpace }; }) }));
    report.sizes.push({ width, height, ...geometry });
    await page.screenshot({ path: path.join(output, `final-geometry-${width}x${height}.png`) });
    console.log(JSON.stringify(report.sizes.at(-1)));
    assert.equal(geometry.innerWidth, width);
    assert.equal(geometry.scrollWidth, width);
    assert.ok(geometry.nav.every(e => e.right <= width + 1));
    if (width <= 760) assert.ok(geometry.nav.every(e => e.height >= 40));
    await context.close();
  }
  assert.deepEqual(sim.snapshot(), before);
  assert.deepEqual(report.errors, []);
  report.readOnly = true;
  report.pass = true;
  await writeFile(path.join(output, 'final-geometry.json'), JSON.stringify(report, null, 2));
  console.log('PASS: final geometry; original provider sources unchanged');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
