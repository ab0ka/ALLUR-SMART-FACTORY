import test from 'node:test';
import assert from 'node:assert/strict';
import { delayedQaRoute, closeQaFixture } from '../scripts/lib/qa-lifecycle.mjs';
for (const kind of ['throw', 'non-200']) test(`QA propagates route.fetch ${kind}`, async () => {
  const d = delayedQaRoute(kind, 100); let aborted = false;
  try {
    await d.handle({ fetch: async () => { if (kind === 'throw') throw new Error('fetch broke'); return { status: () => 409 }; }, abort: async () => { aborted = true; } });
    await assert.rejects(d.committed, kind === 'throw' ? /fetch broke/ : /HTTP 409/);
    await assert.rejects(d.finished);
    assert.equal(aborted, true);
  } finally { d.dispose(); }
});
test('QA commit wait has a deadline when route never arrives', async () => {
  const d = delayedQaRoute('missing', 10);
  try { await assert.rejects(d.committed, /commit: timeout/); }
  finally { d.dispose(); }
});
test('QA propagates failure after commit while fulfilling response', async () => {
  const d = delayedQaRoute('fulfill', 100);
  try {
    const running = d.handle({ fetch: async () => ({ status: () => 200 }), fulfill: async () => { throw new Error('fulfill broke'); }, abort: async () => {} });
    await d.committed; d.release(); await running;
    await assert.rejects(d.finished, /fulfill broke/);
  } finally { d.dispose(); }
});
for (const mode of ['newPage failed', 'page.close failed']) test(`QA closes owned server when ${mode}`, async () => {
  let closed = 0, connections = 0;
  const server = { close: callback => { closed++; callback(); }, closeAllConnections: () => connections++ };
  const page = mode === 'newPage failed' ? undefined : { close: async () => { throw new Error('close failed'); } };
  if (page) await assert.rejects(closeQaFixture(page, server), /close failed/);
  else await closeQaFixture(page, server);
  assert.equal(closed, 1); assert.equal(connections, 1);
});
