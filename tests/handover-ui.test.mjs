import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../public/app/45-handover.js', import.meta.url), 'utf8');
function setup() {
  const elements = new Map();
  const document = { activeElement: null, body: {} };
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
