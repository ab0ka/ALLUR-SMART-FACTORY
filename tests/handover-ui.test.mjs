import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Workshop } from '../server/simulation.mjs';
const code = await readFile(new URL('../public/app/45-handover.js', import.meta.url), 'utf8');
function setup() {
  const elements = new Map();
  const document = { activeElement: null, body: { closest: () => null } };
  const $ = id => { if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', dataset: {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], closest() { return null; }, focus() { if (!this.disabled) document.activeElement = this; } }); return elements.get(id); };
  const calls = [];
  const context = vm.createContext({ $, state: { elapsed: 180, revision: 1, seed: 42, csrf: 'test' }, view: 'handover', document, AbortController, setTimeout, clearTimeout, esc: v => String(v ?? '').replaceAll('<', '&lt;'), fmt: String, pct: n => `${n * 100}%`, fetch: (url, options) => new Promise(resolve => calls.push({ url, options, resolve })) });
  vm.runInContext(code, context);
  const run = script => vm.runInContext(script, context);
  return { $, calls, run, context };
}
const report = { schemaVersion: 1, synthetic: true, shiftStart: 480, elapsed: 180, revision: 1, metrics: { planTarget: 0, accepted: 0, firstPassYield: null }, problems: [], jobs: [], tasks: [], orders: [] };
test('handover preserves zero, unknown quality and honest missing renderer state', async () => {
  const h = setup(), pending = h.run('loadHandover()');
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
  assert.match(h.$('handover-content').innerHTML, /<dd data-handover-metric="planTarget">0<\/dd>/);
  assert.match(h.$('handover-content').innerHTML, /11:00/);
  assert.match(h.$('handover-content').innerHTML, /Открытых проблем/);
  assert.match(h.$('handover-content').innerHTML, /после подключения/);
  assert.match(h.$('handover-content').innerHTML, /<dd data-handover-metric="firstPassYield">—<\/dd>/);
});
test('production polling never refetches; leaving aborts and rejects late response', async () => {
  const h = setup(), pending = h.run('loadHandover()');
  for (let i = 0; i < 20; i++) h.run('renderHandover()');
  assert.equal(h.calls.length, 1);
  h.run("view = 'shift'; handoverRoute()");
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
  assert.equal(h.$('handover-content').innerHTML, '');
});
test('retry supersedes previous request and shift reset invalidates snapshot', async () => {
  const h = setup(), first = h.run('loadHandover()'), second = h.run('loadHandover()');
  h.calls[1].resolve({ ok: true, json: async () => ({ ...report, revision: 2 }) }); await second;
  h.calls[0].resolve({ ok: true, json: async () => report }); await first;
  assert.match(h.$('handover-content').innerHTML, /Ревизия 2/);
  h.run('state.elapsed = 0; renderHandover()');
  assert.equal(h.$('handover-content').innerHTML, '');
  assert.match(h.$('handover-status').textContent, /Смена изменилась/);
  assert.equal(h.calls.length, 2);
});
test('HTTP errors expose accessible retry without leaking server response', async () => {
  const h = setup(), pending = h.run('loadHandover()');
  h.calls[0].resolve({ ok: false }); await pending;
  assert.equal(h.$('handover-refresh').disabled, false);
  assert.equal(h.$('handover-refresh').textContent, 'Повторить запрос');
  assert.match(h.$('handover-status').textContent, /Не удалось/);
});
test('keyboard refresh focus is restored only after enabling button, including error', async () => {
  for (const ok of [true, false]) {
    const h = setup(), refresh = h.$('handover-refresh');
    refresh.dataset.focusKey = 'handover-refresh'; refresh.closest = () => refresh;
    h.$('view-handover').querySelectorAll = selector => selector === '[data-focus-key]' ? [refresh] : [];
    h.context.document.activeElement = refresh;
    const pending = h.run('loadHandover()');
    assert.equal(refresh.disabled, true);
    h.context.document.activeElement = h.context.document.body;
    h.calls[0].resolve({ ok, json: async () => report }); await pending;
    assert.equal(h.context.document.activeElement, refresh);
  }
});
test('expanded detail and its focused link survive repaint, without selecting a hidden duplicate', async () => {
  const h = setup(), summary = { dataset: { focusKey: 'more-tasks' }, parentElement: { open: true } };
  const old = { dataset: { focusKey: 'handover-vehicle' }, closest() { return this; } };
  const next = { dataset: old.dataset, focus() { assert.equal(summary.parentElement.open, true); h.context.document.activeElement = this; } };
  h.context.document.activeElement = old;
  h.$('view-handover').querySelectorAll = selector => selector === '[data-focus-key]' ? [next] : [summary];
  const pending = h.run('loadHandover()');
  summary.parentElement.open = false;
  h.context.document.activeElement = h.context.document.body;
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
  assert.equal(h.context.document.activeElement, next);
});
test('successful reset at unchanged minute invalidates report and cancels pending request', async () => {
  const h = setup();
  const core = await readFile(new URL('../public/app/00-core.js', import.meta.url), 'utf8');
  const action = core.slice(core.indexOf('async function action('), core.indexOf('function resetAi('));
  h.run('updating = false; api = async () => state; error = () => {}; resetAi = () => {}; render = () => renderHandover();');
  h.run(action);
  const pending = h.run('loadHandover()');
  assert.equal(await h.run("action({ action: 'reset' })"), true);
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.match(h.$('handover-status').textContent, /Смена изменилась/);
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
  assert.equal(h.$('handover-content').innerHTML, '');
});
test('refresh never steals focus moved outside the report during request', async () => {
  const h = setup(), old = { dataset: { focusKey: 'gone-link' }, closest() { return this; } };
  h.context.document.activeElement = old;
  const pending = h.run('loadHandover()'), outside = {};
  h.context.document.activeElement = outside;
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
  assert.equal(h.context.document.activeElement, outside);
});
test('reset during refresh returns lost report focus to refresh control', async () => {
  const h = setup(), old = { dataset: { focusKey: 'old-link' }, closest() { return this; } };
  h.context.document.activeElement = old;
  const pending = h.run('loadHandover()');
  h.context.document.activeElement = h.context.document.body;
  h.run('invalidateHandover()');
  assert.equal(h.context.document.activeElement, h.$('handover-refresh'));
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
});
test('focused record moved into collapsed overflow is revealed before focus', async () => {
  const h = setup(), details = { open: false };
  const old = { dataset: { focusKey: 'moved-link' }, closest() { return this; } };
  const next = { dataset: old.dataset, closest: () => details, focus() { assert.equal(details.open, true); h.context.document.activeElement = this; } };
  h.context.document.activeElement = old;
  h.$('view-handover').querySelectorAll = selector => selector === '[data-focus-key]' ? [next] : [];
  const pending = h.run('loadHandover()');
  h.context.document.activeElement = h.context.document.body;
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
  assert.equal(h.context.document.activeElement, next);
});
test('public event sequence regression detects another tab reset on the same minute', async () => {
  const h = setup(), sim = new Workshop();
  const initial = sim.snapshot();
  sim.setPlanTarget(initial.plan.target + 1);
  h.context.state = { ...sim.snapshot(), csrf: 'test' };
  const before = h.context.state;
  const pending = h.run('loadHandover()');
  sim.reset(42);
  h.context.state = { ...sim.snapshot(), csrf: 'test' };
  assert.equal(h.context.state.elapsed, before.elapsed);
  assert.equal(h.context.state.seed, before.seed);
  assert.ok(h.context.state.revision > before.revision);
  assert.ok(h.context.state.events.at(-1).seq < before.events.at(-1).seq);
  h.run('renderHandover()');
  assert.match(h.$('handover-status').textContent, /Смена изменилась/);
  h.calls[0].resolve({ ok: true, json: async () => report }); await pending;
  assert.equal(h.$('handover-content').innerHTML, '');
});
test('epoch rotation invalidates pending request even when all legacy reset clues are unchanged', async () => {
  const h = setup(); h.context.state.shiftEpoch = 'shift-a';
  const pending = h.run('loadHandover()');
  h.context.state = { ...h.context.state, shiftEpoch: 'shift-b', revision: 2 };
  h.run('renderHandover()');
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.calls[0].resolve({ ok: true, json: async () => ({ ...report, shiftEpoch: 'shift-a' }) }); await pending;
  assert.equal(h.$('handover-content').innerHTML, '');
  assert.match(h.$('handover-status').textContent, /Смена изменилась/);
});
test('mismatched response epoch is rejected in both response orders without another request', async () => {
  for (const [currentEpoch, reportEpoch] of [['shift-a', 'shift-b'], ['shift-b', 'shift-a']]) {
    const h = setup(); h.context.state.shiftEpoch = currentEpoch;
    const pending = h.run('loadHandover()');
    h.calls[0].resolve({ ok: true, json: async () => ({ ...report, shiftEpoch: reportEpoch }) }); await pending;
    assert.equal(h.$('handover-content').innerHTML, '');
    assert.match(h.$('handover-status').textContent, /Смена изменилась/);
    h.run('renderHandover()'); assert.equal(h.calls.length, 1);
  }
});
test('matching epoch preserves snapshot across polling and legacy missing epoch remains supported', async () => {
  for (const shiftEpoch of ['shift-a', undefined]) {
    const h = setup(); h.context.state.shiftEpoch = 'shift-a';
    const pending = h.run('loadHandover()');
    h.calls[0].resolve({ ok: true, json: async () => ({ ...report, shiftEpoch }) }); await pending;
    const html = h.$('handover-content').innerHTML;
    assert.match(html, /Срез на/);
    h.context.state.revision++; h.run('renderHandover()');
    assert.equal(h.$('handover-content').innerHTML, html);
    assert.equal(h.calls.length, 1);
  }
});
test('route return token is captured once and restored after success or error after controls are enabled', async () => {
  for (const ok of [true, false]) {
    const h = setup(), token = { selector: '#view-handover [data-focus-key="source"]' };
    let captures = 0, restores = 0;
    h.context.captureNavigationReturnFocus = root => { assert.equal(root, h.$('view-handover')); captures++; return token; };
    h.context.restoreNavigationReturnFocus = (actual, fallback) => {
      assert.equal(actual, token); assert.equal(fallback, h.$('handover-refresh'));
      assert.equal(fallback.disabled, false); restores++;
    };
    h.run('handoverRoute()');
    h.calls[0].resolve({ ok, json: async () => report });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(captures, 1); assert.equal(restores, 1);
    const manual = h.run('loadHandover()');
    h.calls[1].resolve({ ok: true, json: async () => report }); await manual;
    assert.equal(captures, 1); assert.equal(restores, 1, 'manual refresh cannot reuse a navigation return token');
  }
});
test('a late route return response never invokes focus restoration after leaving handover', async () => {
  const h = setup();
  h.context.captureNavigationReturnFocus = () => ({});
  h.context.restoreNavigationReturnFocus = () => assert.fail('late request restored another route focus');
  h.run('handoverRoute()');
  h.run("view = 'orders'; handoverRoute()");
  h.calls[0].resolve({ ok: true, json: async () => report });
  await new Promise(resolve => setImmediate(resolve));
});
