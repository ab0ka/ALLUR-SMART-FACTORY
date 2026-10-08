import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Workshop } from '../server/simulation.mjs';
import { answerChat, numbersSupported, CHAT_LIMITS } from '../server/chat.mjs';
import { createApp } from '../server/index.mjs';

function detected() { const w = new Workshop(); while (!w.problems.length) w.advance(5); return w; }
const exists = (w, r) => ({ vehicle: () => w.vehicle(r.id), order: () => w.order(r.id), problem: () => w.problem(r.id), post: () => w.posts[r.id], experiment: () => w.experiments.find(e => e.id === r.id), decision: () => w.decisions.find(d => d.id === r.id), job: () => w.job(r.id), event: () => w.events.find(e => String(e.seq) === r.id) }[r.type]?.());

test('local answers use real IDs and engine values, and every reference resolves', async () => {
  const w = detected(), s = w.snapshot();
  const threat = await answerChat(w, { message: 'Что сейчас угрожает плану?' });
  assert.equal(threat.source, 'local'); assert.match(threat.text, new RegExp(`План смены \\(задан оператором\\): ${s.plan.target}`));
  assert.match(threat.text, new RegExp(`Прогноз без новых вмешательств: ${s.forecast.projected}`)); assert.ok(threat.text.includes('PR-1'));
  const vehicleId = w.posts.A2.vehicleId;
  const delay = await answerChat(w, { message: 'Почему задерживается этот автомобиль?', context: { type: 'vehicle', id: vehicleId } });
  assert.ok(delay.text.startsWith(vehicleId)); assert.ok(delay.refs.some(r => r.type === 'post' && r.id === 'A2'));
  const basis = await answerChat(w, { message: 'На чём основана гипотеза неисправности?' });
  for (const h of w.problemView(w.problems[0]).hypotheses) assert.ok(basis.text.includes(`${Math.round(h.probability * 100)}%`));
  assert.match(basis.text, /не установленный диагноз/);
  for (const r of [...threat.refs, ...delay.refs, ...basis.refs]) assert.ok(exists(w, r), `${r.type} ${r.id} exists`);
});
test('which check and compare prepare proposals but never change the shift', async () => {
  const w = detected(), revision = w.revision;
  const check = await answerChat(w, { message: 'Какую проверку выполнить?' });
  assert.equal(check.proposal.kind, 'command'); assert.equal(check.proposal.command.kind, 'pump_check'); assert.equal(check.proposal.command.postId, 'A2');
  const cmp = await answerChat(w, { message: 'Сравни ремонт сейчас и продолжение работы' });
  const exp = w.experiments.at(-1); assert.ok(cmp.refs.some(r => r.type === 'experiment' && r.id === exp.id));
  for (const o of exp.options.filter(o => o.available)) assert.ok(cmp.text.includes(o.title));
  if (cmp.proposal) { assert.equal(cmp.proposal.experimentId, exp.id); assert.ok(exp.options.some(o => o.id === cmp.proposal.optionId && o.available)); }
  assert.equal(w.revision, revision); assert.equal(w.jobs.length, 0); assert.equal(w.decisions.length, 0);
  const tr = await answerChat(w, { message: 'Что даст перевод на другой пост?' });
  const t = w.experiments.at(-1).options.find(o => o.id === 'transfer');
  assert.ok(t.available ? tr.proposal : tr.text.includes(t.reason));
});
test('without a model, free questions are declined honestly; limits and context are validated', async () => {
  const w = detected();
  const r = await answerChat(w, { message: 'Расскажи анекдот про сварщика' });
  assert.equal(r.intent, 'unknown'); assert.match(r.text, /свободные вопросы недоступны/);
  await answerChat(w, { message: 'вот ключ sk-proj-abcdefghijklmnop12345 и Bearer zyxwvutsrq987654 проверь' });
  assert.ok(!JSON.stringify(w.chat).includes('sk-proj-abcdefghijklmnop12345')); assert.ok(!JSON.stringify(w.chat).includes('zyxwvutsrq987654')); assert.ok(w.chat.some(m => m.text.includes('[скрыто]')));
  await assert.rejects(answerChat(w, { message: 'x'.repeat(CHAT_LIMITS.message + 1) }), e => e.status === 400);
  await assert.rejects(answerChat(w, { message: '   ' }), e => e.status === 400);
  await assert.rejects(answerChat(w, { message: 'Почему?', context: { type: 'vehicle', id: 'DEMO-999' } }), e => e.status === 404);
  await assert.rejects(answerChat(w, { message: 'Почему?', context: { type: 'file', id: '/etc/passwd' } }), e => e.status === 400);
  for (let i = 0; i < 30; i++) await answerChat(w, { message: 'Что сейчас угрожает плану?' });
  assert.equal(w.chat.length, CHAT_LIMITS.history);
});
test('a model may only phrase engine facts: invented numbers and API failures fall back to the local answer', async () => {
  const w = detected(), calls = [];
  const fake = text => async (url, options) => { calls.push(JSON.parse(options.body)); return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }); };
  const projected = w.forecast().projected;
  const ok = await answerChat(w, { message: 'Что сейчас угрожает плану?' }, { aiOptions: { provider: 'openai', key: 'test-key', fetchImpl: fake(`Прогноз ${projected}, проблема PR-1 на СБ-2.`) } });
  assert.equal(ok.source, 'openai'); assert.ok(calls[0].input.includes('"planTarget"')); assert.equal(calls[0].store, false);
  const invented = await answerChat(w, { message: 'Что сейчас угрожает плану?' }, { aiOptions: { provider: 'openai', key: 'test-key', fetchImpl: fake('Точность модели 97,5% и выпуск 431 автомобиль.') }, llm: { busy: false, last: 0 } });
  assert.equal(invented.source, 'local'); assert.match(invented.note, /числа, которых нет в расчёте/);
  const failed = await answerChat(w, { message: 'Какую проверку выполнить?' }, { aiOptions: { provider: 'openai', key: 'test-key', fetchImpl: async () => new Response('down', { status: 503 }) }, llm: { busy: false, last: 0 } });
  assert.equal(failed.source, 'local'); assert.ok(failed.proposal); assert.match(failed.note, /OpenAI/);
  assert.equal(w.decisions.length, 0); assert.equal(w.jobs.length, 0, 'model text never executes commands');
  assert.equal(numbersSupported('Прогноз 15 из 16', { a: 15, b: 16 }, ''), true); assert.equal(numbersSupported('Прогноз 99', { a: 15 }, ''), false);
});
test('chat HTTP route requires CSRF, validates input, is rate limited and works without an API', async () => {
  const app = createApp({ simulation: detected(), chatMinIntervalMs: 500 });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const { csrf } = await (await fetch(base + '/api/state')).json();
    const ask = (body, token = csrf) => fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
    assert.equal((await ask({ message: 'Что угрожает плану?' }, 'bad')).status, 403);
    const r = await ask({ message: 'Что угрожает плану?' }); assert.equal(r.status, 200);
    const body = await r.json(); assert.equal(body.reply.source, 'local'); assert.equal(body.state.chat.at(-1).id, body.reply.id);
    assert.equal((await ask({ message: 'Ещё раз?' })).status, 429);
    await new Promise(res => setTimeout(res, 550));
    assert.equal((await ask({ message: 'Почему?', context: { type: 'post', id: '__proto__' } })).status, 404);
  } finally { await new Promise(res => { app.close(res); app.closeAllConnections(); }); }
});
