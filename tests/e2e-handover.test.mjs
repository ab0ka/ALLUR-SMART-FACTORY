import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, until, checkReport } from '../scripts/e2e-handover.mjs';

test('CSV parser preserves UTF-8, escaped quotes, commas and multiline text', () => {
  assert.deepEqual(parseCsv('\uFEFFtype,title\r\nproblem,"Сбой, пост ""A1""\nстрока"\r\n'), [
    ['type', 'title'], ['problem', 'Сбой, пост "A1"\nстрока'],
  ]);
  assert.throws(() => parseCsv('"unfinished'), /unmatched quote/);
});
test('polling has a bounded failure and propagates real errors', async () => {
  assert.equal(await until(() => 'ready', 'ready', 10), 'ready');
  await assert.rejects(until(() => false, 'missing element', 1), /Timeout: missing element/);
  await assert.rejects(until(() => { throw new Error('real browser failure'); }, 'check'), /real browser failure/);
});
test('report checks preserve zero values and reject forecast/shipped mixups', () => {
  const s = { revision: 0, elapsed: 0, shift: 480, shiftStart: 480, finished: false,
    plan: { target: 0, reference: { total: 0 } }, forecast: { projected: 4, low: 0, high: 7 },
    totals: { accepted: 0, shipped: 0, wip: 0 }, quality: { firstPassYield: null },
    problems: [{ id: 'P1', status: 'unresolved' }], jobs: [], tasks: [], orders: [], technicians: [], stock: [], holds: [], events: [{ seq: 1, type: 'test' }] };
  const r = { schemaVersion: 1, synthetic: true, revision: 0, elapsed: 0, shift: 480, shiftStart: 480, finished: false,
    metrics: { planTarget: 0, referenceTotal: 0, forecast: 4, forecastLow: 0, forecastHigh: 7, accepted: 0, shipped: 0, wip: 0, firstPassYield: null },
    counts: { problems: 1, jobs: 0, tasks: 0, orders: 0 }, problems: [{ id: 'P1' }], jobs: [], tasks: [], orders: [],
    resources: { technicians: [], stock: [], heldPosts: [] }, events: [{ id: 1, kind: 'test' }] };
  checkReport(r, s);
  assert.throws(() => checkReport({ ...r, metrics: { ...r.metrics, forecast: 0 } }, s), /metrics.forecast/);
  assert.throws(() => checkReport({ ...r, csrf: 'unexpected' }, s), /private field/);
});
