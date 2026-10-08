import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, access, readFile, rm } from 'node:fs/promises';
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
    const state = JSON.parse((await raw(base, '/api/state')).body);
    const expected = createHandover({ ...sim.snapshot(), shiftEpoch: state.shiftEpoch });
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


const getState = async base => JSON.parse((await raw(base, '/api/state')).body);
const command = (base, csrf, body, route = '/api/action') => fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body),
});
test('shift epoch is shared by tabs and rotates on reset at the same model minute', async () => {
  await withApp(async (base, sim, storePath) => {
    const firstTab = await getState(base), secondTab = await getState(base);
    const epoch = firstTab.shiftEpoch;
    assert.match(epoch, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(secondTab.shiftEpoch, epoch);
    const reportBefore = JSON.parse((await raw(base, '/api/handover')).body);
    assert.equal(reportBefore.shiftEpoch, epoch);
    const reset = await command(base, firstTab.csrf, { action: 'reset' });
    assert.equal(reset.status, 200); const resetState = await reset.json();
    assert.notEqual(resetState.shiftEpoch, epoch);
    assert.equal(resetState.elapsed, firstTab.elapsed);
    assert.equal(resetState.seed, firstTab.seed);
    assert.equal(resetState.csrf, firstTab.csrf);
    const current = await getState(base);
    assert.equal(current.shiftEpoch, resetState.shiftEpoch);
    assert.equal((await getState(base)).shiftEpoch, current.shiftEpoch);
    for (const route of ['/api/handover', '/api/handover?format=json']) {
      const report = JSON.parse((await raw(base, route)).body);
      assert.equal(report.shiftEpoch, current.shiftEpoch);
      assert.equal(Object.hasOwn(report, 'csrf'), false);
    }
    const csv = (await raw(base, '/api/handover?format=csv')).body;
    assert.ok(csv.includes(`"report",1,"shiftEpoch","${current.shiftEpoch}"`));
    assert.equal(Object.hasOwn(sim.snapshot(), 'shiftEpoch'), false);
    assert.equal(JSON.stringify(sim.serialize()).includes('shiftEpoch'), false);
    assert.equal((await readFile(storePath, 'utf8')).includes('shiftEpoch'), false);
    const secondReset = await command(base, secondTab.csrf, { action: 'reset' });
    assert.equal(secondReset.status, 200);
    assert.notEqual((await secondReset.json()).shiftEpoch, current.shiftEpoch);
  });
});
test('ordinary commands, nested state responses and rejected requests preserve epoch', async () => {
  await withApp(async (base, sim) => {
    const initial = await getState(base), epoch = initial.shiftEpoch;
    for (const body of [{ action: 'step' }, { action: 'plan', target: 17 }, { action: 'hold', postId: 'A1', on: true }]) {
      const result = await command(base, initial.csrf, body);
      assert.equal(result.status, 200); assert.equal((await result.json()).shiftEpoch, epoch);
    }
    for (let step = 0; step < 24 && !sim.problems.length; step++) {
      const advanced = await command(base, initial.csrf, { action: 'step' });
      assert.equal(advanced.status, 200); assert.equal((await advanced.json()).shiftEpoch, epoch);
    }
    const problem = sim.snapshot().problems[0]; assert.ok(problem);
    const compared = await command(base, initial.csrf, { problemId: problem.id }, '/api/compare');
    assert.equal(compared.status, 200); assert.equal((await compared.json()).state.shiftEpoch, epoch);
    const chat = await command(base, initial.csrf, { message: 'Что угрожает плану?' }, '/api/chat');
    assert.equal(chat.status, 200); assert.equal((await chat.json()).state.shiftEpoch, epoch);
    for (const [csrf, body, status] of [
      [initial.csrf, { action: 'unknown' }, 400],
      [initial.csrf, { action: 'plan', target: 0 }, 400],
      [initial.csrf, { action: 'hold', postId: 'missing', on: true }, 404],
      ['wrong-token', { action: 'reset' }, 403],
    ]) {
      assert.equal((await command(base, csrf, body)).status, status);
      assert.equal((await getState(base)).shiftEpoch, epoch);
    }
    const malformed = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': initial.csrf }, body: '{broken' });
    assert.equal(malformed.status, 400);
    assert.equal((await getState(base)).shiftEpoch, epoch);
    Object.defineProperty(sim, 'reset', { configurable: true, value() { throw Object.assign(new Error('Synthetic reset rejected'), { status: 409, expose: true }); } });
    try {
      assert.equal((await command(base, initial.csrf, { action: 'reset' })).status, 409);
      assert.equal((await getState(base)).shiftEpoch, epoch);
      assert.equal(JSON.parse((await raw(base, '/api/handover')).body).shiftEpoch, epoch);
    } finally { delete sim.reset; }
  });
});
test('each server instance starts with its own public epoch', async () => {
  await withApp(async base => {
    const first = await getState(base);
    await withApp(async otherBase => assert.notEqual((await getState(otherBase)).shiftEpoch, first.shiftEpoch));
  });
});
