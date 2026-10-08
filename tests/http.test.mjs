import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const server = createApp();
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let csrf;
test.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
const post = (path, body, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...extra }, body: JSON.stringify(body) });
test('state is synthetic and includes CSRF but no credentials', async () => {
  const r = await fetch(base + '/api/state'); const s = await r.json(); csrf = s.csrf;
  assert.equal(r.status, 200); assert.equal(s.synthetic, true); assert.equal(csrf.length, 64);
  assert.ok(!JSON.stringify(s).includes('NVIDIA_API_KEY')); assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
});
test('rejects CSRF, cross origin, DNS rebinding host, and cross-site browser calls', async () => {
  assert.equal((await post('/api/action', { action: 'step' }, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await post('/api/action', { action: 'step' }, { Origin: 'https://evil.invalid' })).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/state', { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(base + '/api/state', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});
test('rejects invalid actions, oversized requests, invalid content type and JSON', async () => {
  assert.equal((await post('/api/action', { action: 'exec' })).status, 400);
  assert.equal((await post('/api/action', { action: 'speed', value: 999 })).status, 400);
  assert.equal((await post('/api/action', { action: 'step', padding: 'x'.repeat(5000) })).status, 413);
  assert.equal((await post('/api/action', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{broken' })).status, 400);
});
test('API roundtrip: release order -> fault one post -> step -> repair job -> priority -> reset', async () => {
  const before = await (await fetch(base + '/api/state')).json();
  const released = await (await post('/api/action', { action: 'release', model: 'B', quantity: 2, priority: 'high' })).json();
  assert.equal(released.totals.created, before.totals.created + 2); assert.equal(released.orders.at(-1).priority, 'high');
  assert.deepEqual(released.stages[0].buffer.vehicleIds.slice(0, 2), released.orders.at(-1).vehicleIds);
  const faulted = await (await post('/api/action', { action: 'fault', postId: 'A1', kind: 'breakdown' })).json();
  assert.ok(faulted.forecast.projected < released.forecast.projected); assert.equal(faulted.posts.find(p => p.id === 'A1').state, 'fault');
  const held = faulted.posts.find(p => p.id === 'A1').vehicleId;
  const step = await (await post('/api/action', { action: 'step' })).json(); assert.equal(step.elapsed, before.elapsed + 5);
  assert.equal(step.vehicles.find(v => v.id === held).state, 'paused'); assert.ok(step.posts.filter(p => p.id !== 'A1').some(p => p.state === 'working'));
  const repair = await (await post('/api/action', { action: 'job', postId: 'A1', kind: 'repair_generic', requestId: 'roundtrip-repair-1' })).json();
  assert.equal(repair.posts.find(p => p.id === 'A1').state, 'maintenance'); assert.equal(repair.incidents[0].status, 'active');
  const again = await (await post('/api/action', { action: 'job', postId: 'A1', kind: 'repair_generic', requestId: 'roundtrip-repair-1' })).json();
  assert.equal(again.duplicate, true); assert.equal(again.jobs.filter(j => j.kind === 'repair_generic').length, 1);
  for (let i = 0; i < 6; i++) await post('/api/action', { action: 'step' });
  const repaired = await (await fetch(base + '/api/state')).json(); assert.equal(repaired.incidents[0].status, 'resolved'); assert.equal(repaired.jobs[0].status, 'done');
  assert.equal((await post('/api/action', { action: 'priority', orderId: 'ORD-103', priority: 'high' })).status, 200);
  const reset = await (await post('/api/action', { action: 'reset' })).json(); assert.equal(reset.elapsed, 180); assert.equal(reset.incidents.length, 0); assert.equal(reset.totals.created, before.totals.created);
});
test('AI endpoint without key always returns local explanation, never throttled; rejects arbitrary prompts', async () => {
  for (let n = 0; n < 3; n++) { const local = await (await post('/api/explain', {})).json(); assert.equal(local.source, 'local'); assert.equal(local.reason, 'missing_key'); }
  assert.equal((await post('/api/explain', { prompt: 'arbitrary' })).status, 400);
});
test('public allowlist never serves env or server source', async () => {
  for (const path of ['/.env', '/server/ai.mjs', '/package.json', '/MASTER_PROMPT.md', '/%2e%2e/.env']) assert.equal((await fetch(base + path)).status, 404);
});

async function withApp(options, fn) {
  const app = createApp(options); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const url = `http://127.0.0.1:${app.address().port}`;
  try { return await fn(url); }
  finally { await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }); }
}
const tokenFor = async url => (await (await fetch(url + '/api/state')).json()).csrf;
// node:http is used because fetch overrides Host and Sec-Fetch-* headers.
const rawGet = (url, headers) => new Promise((resolve, reject) => {
  http.get(url, { headers }, response => { let body = ''; response.setEncoding('utf8'); response.on('data', c => { body += c; }); response.on('end', () => resolve({ status: response.statusCode, body })); }).on('error', reject);
});
test('external link may open the page, but cross-site API, assets, non-navigation and wrong Host stay blocked', async () => {
  await withApp({ publicDir }, async url => {
    const nav = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
    const page = await rawGet(url + '/', nav); assert.equal(page.status, 200); assert.match(page.body, /Синтетические данные/);
    assert.equal((await rawGet(url + '/api/state', nav)).status, 403);
    assert.equal((await rawGet(url + '/app.js', { ...nav, 'Sec-Fetch-Dest': 'script', 'Sec-Fetch-Mode': 'no-cors' })).status, 403);
    assert.equal((await rawGet(url + '/', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' })).status, 403);
    assert.equal((await rawGet(url + '/', { ...nav, Host: 'evil.invalid' })).status, 403);
    assert.equal((await rawGet(url + '/', { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' })).status, 200);
  });
});
test('keyed AI calls are rate limited and concurrent calls do not reach NVIDIA twice', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; await new Promise(r => setTimeout(r, 50)); return Response.json({ choices: [{ message: { content: 'Синтетическое объяснение снимка.' } }] }); };
  await withApp({ aiOptions: { key: 'test-key', fetchImpl } }, async url => {
    const token = await tokenFor(url);
    const ask = () => fetch(url + '/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}' }).then(r => r.json());
    const [a, b] = await Promise.all([ask(), ask()]);
    assert.deepEqual([a.source, b.source].sort(), ['local', 'nvidia']); assert.equal([a, b].find(r => r.source === 'local').reason, 'busy');
    assert.equal((await ask()).reason, 'busy'); assert.equal(calls, 1);
  });
});
test('expected client errors are 4xx with clear messages', async () => {
  await withApp({}, async url => {
    const token = await tokenFor(url);
    const act = body => fetch(url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
    assert.equal((await act({ action: 'fault', postId: 'W1', kind: 'breakdown' })).status, 200);
    const dup = await act({ action: 'fault', postId: 'W1', kind: 'slowdown' }); assert.equal(dup.status, 409); assert.equal((await dup.json()).error, 'На этом посту уже есть активный инцидент');
    assert.equal((await act({ action: 'job', postId: 'W1', kind: 'repair_pump' })).status, 409);
    assert.equal((await act({ action: 'fault', postId: '__proto__', kind: 'breakdown' })).status, 404);
    assert.equal((await act({ action: 'fault', postId: 'W2', kind: 'constructor' })).status, 400);
    assert.equal((await act({ action: 'job', postId: 'W1', kind: 'verify' })).status, 400);
    assert.equal((await act({ action: 'job', postId: 'W1', kind: 'repair_generic', requestId: 'bad id!' })).status, 400);
    assert.equal((await act({ action: 'resolve', id: 1 })).status, 400);
    assert.equal((await act({ action: 'plan', target: 0 })).status, 400);
    assert.equal((await act({ action: 'release', model: 'Z', quantity: 1, priority: 'high' })).status, 400);
    assert.equal((await act({ action: 'release', model: 'A', quantity: '3', priority: 'high' })).status, 400);
    assert.equal((await act({ action: 'release', model: 'A', quantity: 8, priority: 'high' })).status, 409);
    assert.equal((await act({ action: 'priority', orderId: 'ORD-999', priority: 'high' })).status, 404);
    assert.equal((await act({ action: 'transfer', vehicleId: 'DEMO-001', postId: 'W2' })).status, 409);
    assert.equal((await act({ action: 'transfer', vehicleId: 'nope', postId: 'W2' })).status, 404);
  });
});
test('unexpected server errors are 500 without internal details in response or log', async () => {
  const broken = { running: false, snapshot() { throw new TypeError('internal detail: /secret/path'); } };
  const original = console.error; const logged = []; console.error = (...args) => logged.push(args.join(' '));
  try {
    await withApp({ simulation: broken }, async url => {
      const r = await fetch(url + '/api/state'); const text = await r.text();
      assert.equal(r.status, 500); assert.ok(!text.includes('internal detail')); assert.ok(!text.includes('/secret/path'));
    });
    assert.equal(logged.length, 1); assert.ok(!logged[0].includes('/secret/path'));
  } finally { console.error = original; }
});
