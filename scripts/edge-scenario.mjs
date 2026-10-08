// Real local server + installed Edge. Playwright is supplied externally, never installed by this script.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.EDGE_PORT || 3033);
assert.ok(Number.isInteger(port) && port >= 3027 && port <= 65535, 'Use a dedicated port >= 3027');
const runtime = process.env.PLAYWRIGHT_MODULE;
assert.ok(runtime, 'Set PLAYWRIGHT_MODULE to an existing Playwright index.mjs (no npm install required)');
let chromium;
try {
  ({ chromium } = await import(pathToFileURL(path.resolve(runtime)).href));
  assert.equal(typeof chromium?.launch, 'function');
} catch (cause) {
  throw new Error('Cannot load Playwright. Set PLAYWRIGHT_MODULE to an existing Playwright index.mjs exporting chromium.launch; nothing was installed.', { cause });
}
const artifactRoot = path.resolve(process.env.EDGE_ARTIFACT_DIR || path.join(root, 'data'));
await mkdir(artifactRoot, { recursive: true });
// Atomic allocation: simultaneous runs and clocks with identical timestamps cannot reuse evidence.
const output = await mkdtemp(path.join(artifactRoot, 'edge-'));
const server = createApp({ aiOptions: { provider: 'local' }, storePath: path.join(output, 'state.json') });
let browser, page;
const issues = [], checkpoints = [];
try {
  // Never attach to or terminate a server already using this port.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
  catch (cause) { throw new Error('Cannot start Microsoft Edge. Check that Edge is installed and accessible to Playwright; no browser was installed by this script.', { cause }); }
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => issues.push(e.message));
  page.on('console', m => { if (m.type() === 'error') issues.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) issues.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const base = `http://127.0.0.1:${port}`;
  const state = async () => {
    const response = await page.request.get(`${base}/api/state`);
    assert.equal(response.status(), 200);
    return response.json();
  };
  const clickResponse = async (selector, route) => {
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === 'POST');
    // Attach handlers to both operations immediately, including when either one fails first.
    const [response] = await Promise.all([pending, page.locator(selector).click()]);
    assert.equal(response.status(), 200, `${route} failed`);
    return response.json();
  };
  const shot = async name => {
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    const s = await state();
    checkpoints.push({ name, minute: s.elapsed, jobs: s.jobs.map(j => ({ id: j.id, kind: j.kind, status: j.status })), decisions: s.decisions.length });
  };
  const step = async () => { await page.locator('#menu summary').click(); await clickResponse('#step-menu', '/api/action'); };
  await page.goto(base);
  await page.locator('#play:enabled').waitFor();
  let s = await state();
  assert.equal(s.running, false);
  assert.equal(s.jobs.length, 0);
  for (let i = 0; !s.problems.length && i < 12; i++) { await step(); s = await state(); }
  const problem = s.problems.find(p => p.status === 'open' && p.kind === 'equipment');
  assert.ok(problem, 'Natural equipment anomaly must be detected');
  const vehicleId = s.posts.find(p => p.id === problem.postId).vehicleId;
  assert.ok(vehicleId, 'Affected post has a synthetic vehicle');
  await page.locator(`#scene [data-vehicle="${vehicleId}"]`).click();
  assert.ok((await page.locator('#side').innerText()).includes(vehicleId));
  await shot('01-vehicle');
  await page.locator(`#side button.primary[data-problem="${problem.id}"]`).click();
  const check = '#side [data-check="pump_check"]';
  await page.locator(check).click();
  await page.locator('#confirm[open]').waitFor();
  assert.equal((await state()).jobs.length, 0, 'Opening confirmation must not schedule work');
  await page.locator('#confirm button[value="cancel"]').click();
  assert.equal((await state()).jobs.length, 0, 'Cancelling must not schedule work');
  await page.locator(check).click();
  await shot('02-diagnostic-confirmation');
  await clickResponse('#confirm-ok', '/api/action');
  s = await state();
  assert.equal(s.jobs.length, 1);
  assert.equal(s.jobs[0].kind, 'pump_check');
  assert.equal(s.jobs[0].status, 'running');
  await step(); await step();
  s = await state();
  assert.equal(s.jobs[0].status, 'done');
  assert.ok(s.jobs[0].result?.text, 'Diagnosis produces an observed result');
  assert.equal(s.jobs.length, 1, 'Standalone diagnosis does not silently repair');
  assert.ok((await page.locator('#side').innerText()).includes(s.jobs[0].result.text));
  await shot('03-diagnosis-result');
  await clickResponse(`#side [data-compare="${problem.id}"]`, '/api/compare');
  await page.locator('#side input[value="repair_confirmed"]').check();
  await page.locator('#side [data-apply-choice]').click();
  await page.locator('#confirm[open]').waitFor();
  assert.equal((await state()).decisions.length, 0);
  await page.locator('#confirm button[value="cancel"]').click();
  assert.equal((await state()).decisions.length, 0);
  await page.locator('#side [data-apply-choice]').click();
  await shot('04-repair-confirmation');
  await clickResponse('#confirm-ok', '/api/decision');
  s = await state();
  assert.equal(s.decisions.length, 1);
  const repair = s.jobs.find(j => j.kind.startsWith('repair_'));
  assert.ok(repair);
  assert.equal(repair.status, 'running');
  const partBefore = s.stock.find(p => p.id === repair.part);
  await shot('05-repair-running');
  for (let i = 0; i < repair.duration / 5; i++) await step();
  s = await state();
  const verify = s.jobs.find(j => j.kind === 'verify');
  assert.ok(verify, 'Repair automatically schedules verification');
  assert.equal(verify.status, 'running');
  assert.equal(s.problems.find(p => p.id === problem.id).status, 'open');
  await shot('06-verification');
  await step();
  s = await state();
  assert.equal(s.problems.find(p => p.id === problem.id).status, 'resolved');
  assert.equal(s.jobs.length, 3, 'Exactly one diagnosis, repair and verification');
  assert.ok(s.jobs.every(j => j.status === 'done'));
  assert.equal(s.decisions.length, 1);
  assert.equal(s.technicians[0].jobId, null);
  assert.equal(s.jobs.find(j => j.kind === 'verify').result.restored, true);
  const partAfter = s.stock.find(p => p.id === repair.part);
  assert.equal(partBefore.reserved, 1);
  assert.equal(partAfter.reserved, 0);
  assert.equal(partAfter.used - partBefore.used, 1, 'Repair consumes exactly one part');
  assert.equal(partBefore.onHand - partAfter.onHand, 1);
  assert.notEqual(s.posts.find(p => p.id === problem.postId).state, 'maintenance');
  await page.reload();
  await page.locator('#play:enabled').waitFor();
  assert.match(await page.locator('#side').innerText(), /Закрыта/);
  await shot('07-resolved');
  assert.deepEqual(issues, [], 'No browser, CSP or HTTP errors');
  const report = { synthetic: true, browser: browser.version(), port, vehicleId, problemId: problem.id, checkpoints,
    result: { status: 'passed', resolvedAt: s.problems.find(p => p.id === problem.id).resolvedAt, jobs: s.jobs, decisions: s.decisions.map(d => ({ id: d.id, title: d.title })), partAfterScheduling: partBefore, partAfterVerification: partAfter }, issues };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Edge scenario PASS: ${path.relative(root, output)} (7 screenshots + report.json)`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(`Edge scenario FAILED; evidence: ${output}`);
  throw error;
} finally {
  try { await browser?.close(); }
  finally {
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    else server.emit('close');
  }
}
