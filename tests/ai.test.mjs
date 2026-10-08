import test from 'node:test';
import assert from 'node:assert/strict';
import { explain, fallback, httpReason, localExplanation, recommendations } from '../server/ai.mjs';
import { Workshop } from '../server/simulation.mjs';
const s = new Workshop().snapshot();

test('no key: complete local explanation without any network request', async () => {
  const r = await explain(s, { fetchImpl: () => { throw new Error('must not call'); } });
  assert.equal(r.source, 'local'); assert.equal(r.reason, 'missing_key'); assert.ok(r.text.includes(`Прогноз к 16:00 — ${s.forecast.projected}`)); assert.ok(r.synthetic);
});
test('NVIDIA success uses fixed endpoint, server Bearer key, and only synthetic snapshot', async () => {
  const key = 'test-server-secret';
  const r = await explain(s, { key, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(options.body); assert.equal(body.model, 'meta/llama-3.3-70b-instruct');
    const sent = JSON.parse(body.messages[1].content); assert.equal(sent.synthetic, true); assert.equal(sent.accepted, s.totals.accepted); assert.ok(Array.isArray(sent.queues));
    return Response.json({ choices: [{ message: { content: `Синтетический прогноз. ${key}` } }] });
  } });
  assert.equal(r.source, 'nvidia'); assert.ok(!r.text.includes(key)); assert.equal(r.revision, s.revision);
  assert.equal(r.synthetic, true); assert.match(r.message, /синтетическ/);
});
for (const [status, reason] of [[401, 'auth_rejected'], [403, 'auth_rejected'], [429, 'rate_limited'], [500, 'server_error'], [503, 'server_error'], [404, 'http_error']]) test(`NVIDIA HTTP ${status} falls back as ${reason} without vendor response leakage`, async () => {
  const r = await explain(s, { key: 'secret', fetchImpl: async () => new Response('secret vendor error', { status }) });
  assert.equal(r.source, 'local'); assert.equal(r.reason, reason); assert.ok(!JSON.stringify(r).includes('secret'));
  assert.ok(r.message.includes('синтетических'));
});
test('fallback reasons have distinct user-visible messages', () => {
  const messages = ['missing_key', 'auth_rejected', 'rate_limited', 'server_error', 'network', 'timeout', 'invalid_response', 'busy'].map(reason => fallback(s, reason).message);
  assert.equal(new Set(messages).size, messages.length);
  assert.equal(httpReason(401), 'auth_rejected'); assert.equal(httpReason(429), 'rate_limited'); assert.equal(httpReason(502), 'server_error');
});
test('timeout is bounded even if a vendor never resolves', async () => {
  const r = await explain(s, { key: 'secret', timeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  assert.equal(r.reason, 'timeout');
});
test('network exception does not expose exception text', async () => {
  const r = await explain(s, { key: 'secret', fetchImpl: async () => { throw new Error('secret'); } });
  assert.equal(r.reason, 'network'); assert.ok(!JSON.stringify(r).includes('secret'));
});
for (const [name, response] of [['invalid JSON', () => new Response('not json')], ['empty content', () => Response.json({ choices: [] })], ['oversized', () => new Response('x'.repeat(70000))]]) test(`${name} returns local explanation`, async () => {
  const r = await explain(s, { key: 'secret', fetchImpl: async () => response() }); assert.equal(r.reason, 'invalid_response');
});
test('local explanation is labelled synthetic and built from workshop state, incidents and recommendations', () => {
  const w = new Workshop(); const base = localExplanation(w.snapshot());
  assert.match(base, /^Синтетические данные/); assert.ok(base.includes('Ограничивающий участок до конца смены — сборка'));
  assert.ok(base.includes(`принято контролем ${w.acceptedCount()} из плана смены ${w.planProfile[480]}`));
  w.injectIncident('A1', 'breakdown'); const fault = localExplanation(w.snapshot());
  assert.ok(fault.includes('Неисправность поста СБ-1')); assert.ok(fault.includes('Рекомендации:'));
  const end = new Workshop(); for (let i = 0; i < 4; i++) end.advance(60); end.advance(55); end.injectIncident('A2', 'breakdown'); end.advance(5);
  const text = localExplanation(end.snapshot());
  assert.ok(text.includes('Смена завершена')); assert.ok(text.includes('не устранён к концу смены'));
});
test('a transfer recommendation is produced only when a free working parallel post exists', () => {
  const w = new Workshop();
  for (let i = 0; i < 200; i++) {
    const s = w.snapshot(), busy = s.posts.find(p => p.vehicleId && p.progress < 1 && s.posts.some(q => q.stage === p.stage && q.id !== p.id && !q.vehicleId));
    if (busy) { w.injectIncident(busy.id, 'breakdown'); break; }
    w.advance(1);
  }
  const s = w.snapshot(), recs = recommendations(s), inc = s.incidents[0];
  assert.ok(inc, 'scenario found');
  const post = s.posts.find(p => p.id === inc.postId), spare = s.posts.find(p => p.stage === post.stage && p.id !== post.id && !p.vehicleId && p.state !== 'fault');
  if (spare) assert.ok(recs[0].startsWith(`Перевести ${post.vehicleId} с ${post.code} на свободный ${spare.code}`)); else assert.ok(recs[0].startsWith(post.code));
});
