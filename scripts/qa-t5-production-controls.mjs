// Isolated synthetic fixtures exercise controls, not the T6 repair lifecycle.
// Run after build with PLAYWRIGHT_MODULE pointing to an existing Playwright file URL.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Workshop } from '../server/simulation.mjs';
import { createApp } from '../server/index.mjs';
import { compareOptions } from '../server/decisions.mjs';
import { delayedQaRoute, closeQaFixture } from './lib/qa-lifecycle.mjs';
import { answerChat } from '../server/chat.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const port = Number(process.env.T5_PORT || 3032);
assert.ok(Number.isInteger(port) && port >= 3027 && port <= 65535);
const output = new URL(`../data/t5-controls-${Date.now()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
async function fixture(name) {
  const w = new Workshop(name === 'transfer' ? { warmup: 0, episode: false } : {});
  let selector, view = 'workshop', selectPost = 'A2', endpoint = '/api/action';
  if (name === 'transfer') {
    let from, to;
    while (w.minute < 480) {
      from = ['W1', 'W2'].find(id => w.posts[id].vehicleId && !w.posts[id === 'W1' ? 'W2' : 'W1'].vehicleId);
      if (from) break;
      w.advance(1);
    }
    assert.ok(from, 'A natural free sibling is required');
    to = from === 'W1' ? 'W2' : 'W1';
    w.injectIncident(from, 'breakdown');
    assert.equal(w.transferAvailability(w.posts[from].vehicleId, to).ok, true);
    selector = '[data-transfer][data-to="' + to + '"]'; selectPost = from;
  } else if (name === 'job') {
    w.injectIncident('W1', 'breakdown'); selector = '[data-job="repair_generic"]'; selectPost = 'W1';
  } else if (name === 'hold') selector = '[data-hold="A2"][data-on="1"]';
  else {
    while (!w.problems.length) w.advance(5);
    view = 'dispatcher';
    if (name === 'check') selector = '[data-check="pump_check"]';
    if (name === 'decision') {
      compareOptions(w, w.problems[0].id); selector = '[data-apply="diagnose_repair"]'; endpoint = '/api/decision';
    }
    if (name.startsWith('proposal')) {
      const reply = await answerChat(w, { message: name === 'proposal-command' ? 'Какую проверку выполнить?' : 'Сравни варианты', context: { type: 'problem', id: w.problems[0].id } }, { aiOptions: { provider: 'local' } });
      assert.equal(reply.proposal.kind, name === 'proposal-command' ? 'command' : 'decision');
      selector = `[data-proposal="${reply.id}"]`;
      if (reply.proposal.kind === 'decision') endpoint = '/api/decision';
    }
  }
  return { w, selector, view, selectPost, endpoint };
}
try {
  for (const width of [1440, 390]) for (const name of ['check', 'job', 'transfer', 'hold', 'decision', 'proposal-command', 'proposal-decision']) {
    const { w, selector, view, selectPost, endpoint } = await fixture(name);
    const server = createApp({ simulation: w, aiOptions: { provider: 'local' } });
    let page, delayed;
    const errors = [];
    try {
      page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.on('pageerror', e => errors.push(e.message));
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      await page.goto(`http://127.0.0.1:${port}/#${view}`);
      if (view === 'workshop') await page.locator(`#workshop-map [data-post="${selectPost}"]`).click();
      const button = page.locator(selector).first();
      await button.waitFor();
      const original = JSON.stringify(w.serialize());
      const requests = [];
      page.on('request', r => { if (r.method() === 'POST' && ['/api/action', '/api/decision'].includes(new URL(r.url()).pathname)) requests.push(r.postDataJSON()); });
      for (const cancel of ['button', 'escape']) {
        await button.click();
        if (cancel === 'button') await page.locator('#confirm [value=cancel]').click(); else await page.keyboard.press('Escape');
        assert.equal(JSON.stringify(w.serialize()), original, `${name}: ${cancel} changed state`);
        assert.equal(requests.length, 0);
      }
      // Fault injection tests client recovery on both routes; no production request reaches the server.
      for (const failure of ['409', 'network']) {
        await page.route(`**${endpoint}`, route => failure === '409'
          ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"T5 controlled conflict"}' })
          : route.abort('connectionfailed'), { times: 1 });
        await button.click(); await page.locator('#confirm-ok').click();
        await page.waitForFunction(kind => {
          const el = document.getElementById('error');
          return !el.hidden && (kind === '409' ? el.textContent.includes('T5 controlled conflict') : !el.textContent.includes('T5 controlled conflict'));
        }, failure);
        assert.equal(JSON.stringify(w.serialize()), original, `${name}: rejected request changed state`);
      }
      const attempts = requests.length, jobs = w.jobs.length, decisions = w.decisions.length;
      const eventSeq = w.eventSeq;
      delayed = delayedQaRoute(name);
      await page.route(`**${endpoint}`, route => delayed.handle(route), { times: 1 });
      await button.evaluate(b => { b.click(); b.click(); });
      await page.locator('#confirm[open]').waitFor();
      await page.locator('#confirm-ok').evaluate(b => { b.click(); b.click(); });
      await delayed.committed;
      await button.evaluate(b => { b.click(); b.click(); });
      assert.equal(await page.locator('#confirm').evaluate(d => d.open), false);
      assert.equal(requests.length, attempts + 1, `${name}: duplicate POST`);
      const response = page.waitForResponse(r => r.url().endsWith(endpoint));
      delayed.release(); await Promise.all([response, delayed.finished]);
      const newEvents = w.events.filter(e => e.seq > eventSeq);
      if (name === 'transfer') assert.equal(newEvents.filter(e => e.type === 'vehicle_transferred').length, 1);
      else if (name === 'hold') assert.equal(newEvents.filter(e => e.type === 'hold_changed').length, 1);
      else {
        assert.equal(w.jobs.length, jobs + 1, `${name}: job count`);
        assert.equal(w.decisions.length, decisions + (endpoint === '/api/decision' ? 1 : 0), `${name}: decision count`);
      }
      // A new, different intent can be cancelled after completion: the shared lock recovered.
      await page.locator('#menu summary').click(); await page.locator('#reset').click();
      await page.locator('#confirm[open]').waitFor(); await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      results.push({ name, width, cancel: true, escape: true, injected409Recovery: true, networkRecovery: true, delayedRealResponse: true, successfulPosts: 1, singleProductionEffect: true, newIntentAfterCompletion: true });
      console.log(`${name} ${width}: PASS`);
    } finally {
      try { delayed?.dispose(); }
      finally { await closeQaFixture(page, server); }
    }
  }
  await writeFile(new URL('report.json', output), JSON.stringify(results, null, 2));
  console.log(`PASS: ${output.pathname}`);
} finally { await browser.close(); }
