import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { Workshop } from '../server/simulation.mjs';
import { createHandover } from '../server/handover.mjs';
import { handoverCsv } from '../server/handover-export.mjs';
const raw = (base, route, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request(base + route, { method, headers }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
  });
  req.on('error', reject); req.end();
});
async function withApp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-t8-handover-'));
  const storePath = path.join(dir, 't8-state.json');
  const sim = new Workshop(); sim.running = false;
  const server = createApp({ simulation: sim, storePath, aiOptions: { provider: 'local' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`, sim, storePath); }
  finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('allur-t8-handover-'));
    await rm(dir, { recursive: true, force: true });
  }
}
test('handover GET and downloads use one public snapshot and never mutate or persist the shift', async () => {
  await withApp(async (base, sim, storePath) => {
    const expected = createHandover(sim.snapshot());
    const before = JSON.stringify(sim.serialize());
    const snapshot = sim.snapshot.bind(sim); let calls = 0;
    Object.defineProperty(sim, 'snapshot', { configurable: true, value: () => { calls++; return snapshot(); } });
    for (const format of [null, 'json', 'csv']) {
      calls = 0;
      const result = await raw(base, '/api/handover' + (format === null ? '' : `?format=${format}`));
      assert.equal(result.status, 200); assert.equal(calls, 1);
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.headers['x-content-type-options'], 'nosniff');
      assert.match(result.headers['content-security-policy'], /style-src 'self'/);
      assert.equal(result.headers['content-disposition'], format === null ? undefined : `attachment; filename="allur-handover.${format}"`);
      assert.equal(result.headers['content-type'], format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
      if (format === 'csv') assert.equal(result.body, handoverCsv(expected));
      else { assert.deepEqual(JSON.parse(result.body), expected); assert.equal(Object.hasOwn(JSON.parse(result.body), 'csrf'), false); assert.equal(Object.hasOwn(JSON.parse(result.body), 'chat'), false); }
      assert.equal(JSON.stringify(sim.serialize()), before);
      await assert.rejects(access(storePath), { code: 'ENOENT' });
    }
  });
});
test('handover rejects unsupported formats and follows existing API method convention', async () => {
  await withApp(async (base, sim) => {
    const before = JSON.stringify(sim.serialize());
    for (const format of ['', 'xml', 'CSV', '..%2Ffile', 'json%0d%0aX-Evil%3Ayes']) {
      const result = await raw(base, `/api/handover?format=${format}`);
      assert.equal(result.status, 400); assert.equal(result.headers['content-disposition'], undefined);
    }
    for (const method of ['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const result = await raw(base, '/api/handover', { method });
      assert.equal(result.status, 404);
      if (method === 'HEAD') assert.equal(result.body, '');
    }
    assert.equal(JSON.stringify(sim.serialize()), before);
  });
});
test('handover retains Host, Origin and Sec-Fetch protections for all formats', async () => {
  await withApp(async base => {
    for (const route of ['/api/handover', '/api/handover?format=json', '/api/handover?format=csv']) {
      for (const headers of [{ Host: 'evil.invalid' }, { Origin: 'https://evil.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }]) {
        const result = await raw(base, route, { headers });
        assert.equal(result.status, 403); assert.equal(result.headers['content-disposition'], undefined);
      }
    }
  });
});


