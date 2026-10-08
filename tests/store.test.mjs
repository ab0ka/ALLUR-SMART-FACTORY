import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rmdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workshop } from '../server/simulation.mjs';
import { compareOptions, applyOption } from '../server/decisions.mjs';
import { saveState, loadState, STATE_FORMAT, STATE_VERSION } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

async function withDir(fn) { const dir = await mkdtemp(path.join(tmpdir(), 'allur-store-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
function busyShift() { const w = new Workshop(); while (!w.problems.length) w.advance(5); const e = compareOptions(w, 'PR-1'); applyOption(w, { experimentId: e.id, optionId: 'diagnose_repair', requestId: 'store-req-001' }); w.advance(20); return w; }

test('restart restores the same consistent shift with decisions, jobs, inspections and balances', () => withDir(async dir => {
  const w = busyShift(), file = path.join(dir, 'state.json');
  saveState(file, w);
  const { workshop, error } = loadState(file); assert.equal(error, undefined);
  assert.deepEqual(workshop.checkIntegrity(), []); assert.ok(workshop.totals().balanced);
  assert.deepEqual(workshop.snapshot(), w.snapshot());
  workshop.advance(60); w.advance(60); assert.deepEqual(workshop.snapshot(), w.snapshot(), 'continues identically after restore');
}));
test('tampered, unknown-version or inconsistent files are rejected and moved aside, not deleted', () => withDir(async dir => {
  const w = busyShift(), file = path.join(dir, 'state.json');
  saveState(file, w);
  const payload = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...payload, data: { ...payload.data, minute: 400 } }));
  let r = loadState(file); assert.equal(r.error, 'checksum mismatch'); assert.ok((await readdir(dir)).some(f => f.includes('rejected')));
  await writeFile(file, JSON.stringify({ ...payload, version: STATE_VERSION + 1 }));
  r = loadState(file); assert.match(r.error, /unsupported version/);
  const broken = structuredClone(payload.data); broken.buffers.B1.push(broken.vehicles[0].id);
  const { createHash } = await import('node:crypto');
  await writeFile(file, JSON.stringify({ ...payload, data: broken, sha256: createHash('sha256').update(JSON.stringify(broken)).digest('hex') }));
  r = loadState(file); assert.match(r.error, /integrity/);
  assert.equal(loadState(path.join(dir, 'missing.json')).error, 'missing');
}));
test('the saved file never contains API keys; saving refuses credential-like values', () => withDir(async dir => {
  const file = path.join(dir, 'state.json'), key = 'sk-proj-test-key-should-never-be-saved-123456';
  const app = createApp({ simulation: busyShift(), storePath: file, aiOptions: { provider: 'openai', key, fetchImpl: async () => new Response('x', { status: 500 }) }, chatMinIntervalMs: 0 });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  try {
    const base = `http://127.0.0.1:${app.address().port}`, { csrf } = await (await fetch(base + '/api/state')).json();
    await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ action: 'step' }) });
    await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ message: 'Что угрожает плану?' }) });
    const text = await readFile(file, 'utf8');
    assert.ok(!text.includes(key)); assert.ok(!/Bearer|Authorization/.test(text)); assert.equal(JSON.parse(text).version, STATE_VERSION);
  } finally { await new Promise(res => { app.close(res); app.closeAllConnections(); }); }
  const w = new Workshop(); w.chat.push({ role: 'user', text: `мой ключ ${key}` });
  assert.throws(() => saveState(path.join(dir, 'other.json'), w), /credential/);
}));

test('failed quarantine stops recovery and preserves the only rejected state file', t => withDir(async dir => {
  const file = path.join(dir, 'state.json');
  const original = JSON.stringify({ format: STATE_FORMAT, version: STATE_VERSION + 1, data: { synthetic: true } });
  await writeFile(file, original);
  const timestamp = '2026-10-08T12:34:56.789Z';
  const aside = `${file}.rejected-${timestamp.replace(/[:.]/g, '-')}`;
  await mkdir(aside); // Renaming a file onto an existing directory must fail on Windows and POSIX.
  const date = t.mock.method(Date.prototype, 'toISOString', () => timestamp);
  try {
    assert.throws(() => loadState(file), error => /Cannot quarantine rejected shift state/.test(error.message) && Boolean(error.cause?.code));
    assert.equal(await readFile(file, 'utf8'), original);
    assert.deepEqual(await readdir(aside), []);
    assert.deepEqual((await readdir(dir)).sort(), [path.basename(file), path.basename(aside)].sort());
    await rmdir(aside);
    const recovered = loadState(file);
    assert.match(recovered.error, /unsupported version/);
    assert.equal(recovered.movedTo, aside);
    assert.equal(await readFile(aside, 'utf8'), original);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
  } finally { date.mock.restore(); }
}));
