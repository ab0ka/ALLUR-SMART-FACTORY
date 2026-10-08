import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../public/app/45-handover.js', import.meta.url), 'utf8');
function setup() {
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] }); return elements.get(id); };
  const calls = [];
  const context = vm.createContext({ $, state: { elapsed: 180, revision: 1, seed: 42, csrf: 'test' }, view: 'handover', document: { activeElement: null }, AbortController, setTimeout, clearTimeout, esc: v => String(v ?? '').replaceAll('<', '&lt;'), fmt: String, pct: n => `${n * 100}%`, fetch: (url, options) => new Promise(resolve => calls.push({ url, options, resolve })) });
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
