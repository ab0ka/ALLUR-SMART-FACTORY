// Optional Edge check for T1. Build and run a local AI_PROVIDER=local server first.
// PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs CHAT_CHECK_URL=http://127.0.0.1:3028 node scripts/check-chat-context.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { Workshop } from '../server/simulation.mjs';
import { fullState } from '../server/index.mjs';
import { compareOptions, applyOption } from '../server/decisions.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CHAT_CHECK_URL || 'http://127.0.0.1:3028';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local test server only');
await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const ctx = async (p, label) => p.waitForFunction(expected => document.querySelector('#side-chat-context')?.textContent.includes(expected), label);
const waitRequest = (p, path) => p.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'POST');
try {
  // Run the original acceptance example against the real local HTTP server.
  let live = await (await page.request.get(base + '/api/state')).json();
  assert.equal(live.ai.provider, 'local', 'Paid AI providers must not be enabled');
  assert(!live.running, 'Use a paused, isolated test shift');
  assert(live.elapsed <= 190, 'Use a fresh isolated state file for this check');
  await page.goto(base + '/#space/assembly');
  await page.locator('#scene').waitFor({ state: 'visible' });
  while (live.elapsed < 190) {
    await page.locator('#menu summary').click(); const reply = waitRequest(page, '/api/action');
    await page.locator('#step-menu').click(); live = await (await reply).json();
    const time = `${String(Math.floor((480 + live.elapsed) / 60)).padStart(2, '0')}:${String(live.elapsed % 60).padStart(2, '0')}`;
    await page.waitForFunction(expected => document.querySelector('#clock')?.textContent === expected, time);
  }
  await page.goto(base + '/#space/assembly/problem/PR-1');
  await page.locator('#side h2').filter({ hasText: 'PR-1' }).waitFor();
  await page.goto(base + '/#space/assembly/chat/DEMO-008'); await ctx(page, 'автомобиль DEMO-008');
  const result = waitRequest(page, '/api/chat');
  await page.locator('#side-chat-input').fill('Почему задерживается этот автомобиль?'); await page.locator('#side-chat-send').click();
  const response = await result; assert.equal(response.status(), 200);
  assert.equal(response.request().postDataJSON().context.id, 'DEMO-008');
  const answered = await response.json(); assert(answered.state.chat.at(-1).text.startsWith('DEMO-008'));
  await page.screenshot({ path: 'screenshots/t1-v45-chat-1280.png' });
  console.log('PASS original PR-1 → /chat/DEMO-008 scenario and real local response');

  // Rich synthetic fixture for every reference, without changing production through the fixture page.
  const sim = new Workshop(); while (!sim.problems.length) sim.advance(5);
  const exp = compareOptions(sim, 'PR-1'); applyOption(sim, { experimentId: exp.id, optionId: 'continue', requestId: 't1-fixture-decision' });
  sim.command({ action: 'job', postId: 'A2', kind: 'pump_check', requestId: 't1-fixture-job' });
  const snapshot = fullState(sim, { aiOptions: { provider: 'local' } }), eventId = String(snapshot.events[0].seq);
  snapshot.chat.push({ id: 't1-fixture-references', role: 'assistant', source: 'local', minute: snapshot.elapsed, text: 'Синтетические ссылки для проверки контекста.',
    refs: [['vehicle', 'DEMO-008'], ['post', 'A2'], ['order', 'ORD-101'], ['problem', 'PR-1'], ['experiment', exp.id], ['decision', 'DEC-1'], ['job', 'JOB-1'], ['event', eventId]].map(([type, id]) => ({ type, id, label: id })),
    proposal: { kind: 'command', title: 'Учебная проверка', consequences: 'Синтетическая проверка диалога; серверное производство в этом fixture не меняется.', command: { action: 'job', postId: 'A2', kind: 'pump_check' } } });
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }); p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.route('**/api/state', r => r.fulfill({ json: snapshot }));
  const posted = [];
  await p.route('**/api/**', r => { if (r.request().method() !== 'POST') return r.fallback(); posted.push(r.request().postDataJSON()); return r.fulfill({ json: snapshot }); });
  async function goto(route) { await p.goto(base + '/#' + route); }
  for (const [suffix, label] of [['DEMO-008', 'DEMO-008'], ['PR-1', 'PR-1'], ['ORD-101', 'ORD-101'], ['A2', 'СБ-2'], [encodeURIComponent('СБ-2'), 'СБ-2'], ['vehicle%3ADEMO-007', 'DEMO-007'], ['vehicle/DEMO-008', 'DEMO-008']]) {
    await goto('space/assembly/problem/PR-1'); await p.locator('#side h2').waitFor();
    await goto('space/assembly/chat/' + suffix); await ctx(p, label); await p.reload(); await ctx(p, label);
  }
  for (const suffix of ['MISSING', '%ZZ', 'vehicle:MISSING', 'vehicle/', '__proto__:DEMO-008', 'vehicle/DEMO-008/extra']) {
    await goto('space/assembly/chat/' + suffix); await ctx(p, 'Объект не найден');
  }
  await goto('space/assembly/chat'); await ctx(p, 'без контекста');
  for (const [type, id, label] of [['vehicle', 'DEMO-008', 'DEMO-008'], ['post', 'A2', 'СБ-2'], ['problem', 'PR-1', 'PR-1'], ['compare', 'PR-1', 'PR-1']]) {
    await goto(`space/assembly/${type}/${id}`);
    const opener = p.locator('#side [data-open-chat]').first();
    await opener.evaluate(button => { const hidden = button.cloneNode(true); hidden.hidden = true; document.body.prepend(hidden); });
    await opener.click(); await ctx(p, label);
    await p.locator('#side-chat-input').press('Escape');
    await p.waitForURL(new RegExp(`/${type}/${id}$`));
    await p.waitForFunction(() => document.activeElement?.matches('#side [data-open-chat]'));
  }
  await goto('space/assembly/chat/DEMO-008');
  await p.locator('#scene [data-vehicle="DEMO-007"]').first().focus(); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.activeElement?.matches('#side h2[tabindex="-1"]'));
  await p.locator('#side [data-open-chat]').first().click(); await ctx(p, 'DEMO-007');
  await p.locator('[data-mode="table"]').click(); await p.locator('#table-view [data-vehicle="DEMO-008"]').first().click();
  await p.locator('#side [data-open-chat]').first().click(); await ctx(p, 'DEMO-008');
  await p.locator('[data-mode="scene"]').click();
  for (const [type, expected] of [['vehicle', 'space/assembly/vehicle/DEMO-008'], ['post', 'space/assembly/post/A2'], ['order', 'orders/order/ORD-101'], ['problem', 'space/assembly/problem/PR-1'], ['experiment', 'space/assembly/compare/PR-1'], ['decision', 'dispatcher/decision/DEC-1'], ['job', 'space/assembly/problem/PR-1'], ['event', `space/assembly/event/${eventId}`]]) {
    await goto('space/assembly/chat/DEMO-008'); await p.locator(`#side-chat-log [data-ref-type="${type}"]`).click(); await p.waitForURL(base + '/#' + expected);
    if (type === 'decision') { await p.locator('#decision-DEC-1.ref-highlight').waitFor(); assert.equal(await p.locator('#decision-DEC-1').getAttribute('tabindex'), '-1'); }
    if (type === 'event') { await p.locator(`#ribbon-event-${eventId}.ref-highlight`).waitFor(); assert.equal(await p.locator(`#ribbon-event-${eventId}`).getAttribute('aria-current'), 'true'); await p.screenshot({ path: 'screenshots/t1-v45-event-1280.png' }); }
    await p.goBack(); await ctx(p, 'DEMO-008'); await p.goForward(); await p.waitForURL(base + '/#' + expected);
  }
  await goto('space/assembly/chat/DEMO-008'); await p.locator('#side-chat-log [data-ref-type="order"]').click(); await p.goBack(); await p.goForward();
  await p.locator('#chat-toggle').click(); await ctx(p, 'задание ORD-101'); await p.reload(); await ctx(p, 'задание ORD-101');
  for (const route of ['orders', 'orders/order/MISSING', 'orders/order/%ZZ']) { await goto(route); await p.locator('#chat-toggle').click(); await ctx(p, 'без контекста'); await p.reload(); await ctx(p, 'без контекста'); }
  await goto('vehicles/chat/DEMO-008'); await p.locator('#side-chat-log [data-ref-type="vehicle"]').click(); await p.waitForURL(base + '/#vehicles/vehicle/DEMO-008'); assert(await p.locator('#side').isHidden());
  await goto('space/assembly/chat/DEMO-008'); await p.locator('#side [data-chat-clear]').click(); await ctx(p, 'без контекста'); await p.goBack(); await ctx(p, 'DEMO-008');
  console.log('PASS all context formats, invalid IDs, four card entry points, Escape/focus, all eight refs and order history/reload');

  // Proposal remains gated; fixture intercepts the eventual action instead of changing the server.
  await p.locator('#side [data-proposal]').click(); await p.locator('#confirm').waitFor({ state: 'visible' }); assert.equal(posted.length, 0);
  await p.locator('#confirm [value="cancel"]').click(); assert.equal(posted.length, 0);
  await p.locator('#side [data-proposal]').click(); const proposalReply = waitRequest(p, '/api/action'); await p.locator('#confirm-ok').click(); await proposalReply;
  assert.equal(posted.length, 1); assert(posted[0].requestId); assert.equal(posted[0].action, 'job');

  let release, arrived; const gate = new Promise(r => { release = r; }), ready = new Promise(r => { arrived = r; });
  await p.route('**/api/chat', async route => { arrived(); await gate; await route.fulfill({ json: { state: snapshot } }); });
  await goto('space/assembly/chat/DEMO-008'); await p.locator('#side-chat-input').fill('Первый вопрос'); await p.locator('#side-chat-send').click(); await ready;
  await goto('space/assembly/vehicle/DEMO-007'); await p.locator('#side [data-open-chat]').first().click(); await p.locator('#side-chat-input').fill('Новый черновик о DEMO-007');
  const pendingReply = waitRequest(p, '/api/chat'); release(); await pendingReply; await p.waitForFunction(() => document.querySelector('#side-chat-send')?.textContent === 'Спросить');
  assert.equal(await p.locator('#side-chat-input').inputValue(), 'Новый черновик о DEMO-007'); await ctx(p, 'DEMO-007'); assert((await p.locator('#side-chat-switch').innerText()).includes('DEMO-008'));
  await p.setViewportSize({ width: 390, height: 844 }); await p.locator('#side-chat-input').scrollIntoViewIfNeeded(); await p.screenshot({ path: 'screenshots/t1-v45-chat-390.png' });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
  await p.locator('#side-chat-input').press('Escape'); await p.waitForURL(base + '/#space/assembly/vehicle/DEMO-007'); await p.waitForFunction(() => document.activeElement?.matches('#side [data-open-chat]'));
  assert.deepEqual(errors, []); console.log('PASS proposal dialog/requestId, pending reply/draft, mobile Escape/focus; no page errors');
} finally { await browser.close(); }
