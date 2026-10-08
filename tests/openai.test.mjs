import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { explain } from '../server/ai.mjs';
import { aiOptionsFromEnv } from '../server/ai-config.mjs';
import { createApp } from '../server/index.mjs';
import { Workshop } from '../server/simulation.mjs';

const snapshot = new Workshop().snapshot();
const completed = text => ({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });

test('provider selection keeps vendor credentials separate and supports forced offline', () => {
  const env = { OPENAI_API_KEY: ' openai-test ', NVIDIA_API_KEY: 'nvidia-test' };
  assert.deepEqual(aiOptionsFromEnv(env), { provider: 'openai', key: 'openai-test', model: 'gpt-4.1-mini' });
  assert.equal(aiOptionsFromEnv({ ...env, AI_PROVIDER: 'nvidia' }).key, 'nvidia-test');
  assert.equal(aiOptionsFromEnv({ NVIDIA_API_KEY: 'nvidia-test' }).provider, 'nvidia');
  assert.equal(aiOptionsFromEnv({ NVIDIA_API_KEY: 'nvidia-test', AI_PROVIDER: 'openai' }).key, '');
  assert.equal(aiOptionsFromEnv({ ...env, OPENAI_MODEL: 'custom-model' }).model, 'custom-model');
  assert.deepEqual(aiOptionsFromEnv({ ...env, AI_PROVIDER: 'local' }), { provider: 'local', key: '' });
  assert.throws(() => aiOptionsFromEnv({ AI_PROVIDER: 'https://other.invalid' }), /AI_PROVIDER must/);
});

test('OpenAI Responses sends only server snapshot, disables storage and redacts credentials', async () => {
  const key = 'test-openai-secret';
  const result = await explain(snapshot, { provider: 'openai', key, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4.1-mini'); assert.equal(body.store, false); assert.equal(body.stream, false);
    assert.equal(body.max_output_tokens, 900); assert.match(body.instructions, /синтетические/);
    const sent = JSON.parse(body.input); assert.equal(sent.synthetic, true); assert.equal(sent.accepted, snapshot.totals.accepted);
    assert.ok(!options.body.includes(key)); assert.equal(body.tools, undefined);
    return Response.json(completed(`Синтетическое объяснение: ${key} sk-proj-fake-secret nvapi-fake-secret`));
  } });
  assert.equal(result.source, 'openai'); assert.equal(result.synthetic, true); assert.equal(result.revision, snapshot.revision);
  assert.match(result.message, /OpenAI/); assert.ok(!result.text.includes(key)); assert.ok(!result.text.includes('sk-proj-')); assert.ok(!result.text.includes('nvapi-'));
});

test('OpenAI without key and forced offline never call the network', async () => {
  const fetchImpl = () => { throw new Error('network must not run'); };
  const missing = await explain(snapshot, { provider: 'openai', fetchImpl });
  assert.equal(missing.reason, 'missing_key'); assert.match(missing.message, /Ключ OpenAI не настроен/);
  assert.equal((await explain(snapshot, { provider: 'local', key: 'unused', fetchImpl })).reason, 'offline');
  assert.equal((await explain(snapshot, { provider: 'unknown', key: 'unused', fetchImpl })).reason, 'invalid_configuration');
});

for (const [status, reason] of [[401, 'auth_rejected'], [403, 'auth_rejected'], [429, 'rate_limited'], [500, 'server_error'], [503, 'server_error'], [404, 'http_error']]) {
  test(`OpenAI HTTP ${status} has a safe local fallback`, async () => {
    const result = await explain(snapshot, { provider: 'openai', key: 'secret', fetchImpl: async () => new Response('secret vendor details', { status }) });
    assert.equal(result.source, 'local'); assert.equal(result.reason, reason); assert.match(result.message, /OpenAI/);
    assert.ok(!JSON.stringify(result).includes('secret'));
  });
}

for (const [name, response] of [
  ['malformed', () => new Response('not json')],
  ['oversized', () => new Response('x'.repeat(70000))],
  ['missing output', () => Response.json({ status: 'completed' })],
  ['empty', () => Response.json(completed(''))],
  ['incomplete', () => Response.json({ ...completed('Частичный синтетический ответ'), status: 'incomplete' })],
  ['refusal', () => Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'refused' }] }] })],
]) test(`OpenAI ${name} response falls back`, async () => {
  assert.equal((await explain(snapshot, { provider: 'openai', key: 'secret', fetchImpl: async () => response() })).reason, 'invalid_response');
});

test('OpenAI timeout and network failures are bounded and hide diagnostics', async () => {
  assert.equal((await explain(snapshot, { provider: 'openai', key: 'secret', timeoutMs: 20, fetchImpl: () => new Promise(() => {}) })).reason, 'timeout');
  const result = await explain(snapshot, { provider: 'openai', key: 'secret', fetchImpl: async () => { throw new Error('secret details'); } });
  assert.equal(result.reason, 'network'); assert.ok(!JSON.stringify(result).includes('secret'));
});

test('OpenAI HTTP roundtrip exposes no credentials and rate limits concurrent requests', async () => {
  let calls = 0;
  const key = 'test-openai-secret';
  const app = createApp({ aiOptions: { provider: 'openai', key, fetchImpl: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 30)); return Response.json(completed('Синтетическое объяснение снимка цеха.'));
  } } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const health = await (await fetch(base + '/api/health')).json();
    assert.deepEqual(health, { ok: true, synthetic: true, aiProvider: 'openai', aiConfigured: true });
    const state = await (await fetch(base + '/api/state')).json(); assert.ok(!JSON.stringify(state).includes(key));
    const ask = () => fetch(base + '/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: '{}' }).then(r => r.json());
    const results = await Promise.all([ask(), ask()]);
    assert.deepEqual(results.map(r => r.source).sort(), ['local', 'openai']);
    assert.equal(results.find(r => r.source === 'local').reason, 'busy'); assert.equal(calls, 1);
    assert.equal((await ask()).reason, 'busy'); assert.ok(!JSON.stringify(results).includes(key));
  } finally { await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }); }
});
