import test from 'node:test';
import assert from 'node:assert/strict';
import { Workshop } from '../server/simulation.mjs';
import { compareOptions, applyOption, decisionReport, buildOptions } from '../server/decisions.mjs';

function detected() { const w = new Workshop(); while (!w.problems.length) w.advance(5); return w; }
// Production state without decision records: experiments are records, not production.
const production = w => { const { experiments, experimentSeq, recordVersion, _forecast, ...rest } = w; return JSON.stringify(rest); };

test('comparing options does not change the working shift, its events or its PRNG', () => {
  const w = detected(), before = production(w), events = w.events.length, rng = w.rng, revision = w.revision;
  const exp = compareOptions(w, w.problems[0].id);
  assert.equal(production(w), before); assert.equal(w.events.length, events); assert.equal(w.rng, rng); assert.equal(w.revision, revision);
  assert.equal(exp.options[0].id, 'continue', 'baseline first'); assert.deepEqual(Object.values(exp.options[0].delta).filter(x => x !== 0), []);
  for (const o of exp.options.filter(o => o.available)) for (const k of ['accepted', 'downtime', 'wip', 'techMinutes', 'cost']) assert.equal(o.delta[k], Math.round((o.expected[k] - exp.options[0].expected[k]) * 100) / 100);
  for (const o of exp.options.filter(o => !o.available)) { assert.equal(typeof o.reason, 'string'); assert.ok(o.reason.length > 5); assert.equal(o.expected, undefined); }
});
test('identical start conditions reproduce identical option results', () => {
  const a = compareOptions(detected(), 'PR-1'), b = compareOptions(detected(), 'PR-1');
  assert.deepEqual(a.options, b.options); assert.deepEqual(a.scenarios, b.scenarios);
});
test('every option has the same scenario weights and the diagnosis option beats doing nothing on expectation', () => {
  const exp = compareOptions(detected(), 'PR-1'), weights = exp.scenarios.map(s => s.weight);
  for (const o of exp.options.filter(o => o.available)) assert.deepEqual(o.perScenario.map(s => s.weight), weights);
  const diag = exp.options.find(o => o.id === 'diagnose_repair'), base = exp.options[0];
  assert.ok(diag.available); assert.ok(diag.expected.accepted >= base.expected.accepted);
  assert.ok(diag.expected.techMinutes > 0 && diag.expected.cost > 0, 'resources and synthetic cost are counted');
});
test('an unavailable option cannot be applied and explains why', () => {
  const w = detected(), exp = compareOptions(w, 'PR-1'), t = exp.options.find(o => o.id === 'transfer');
  if (t.available) return assert.ok(t.commands.length > 0);
  assert.match(t.reason, /занят|нет автомобиля|завершил/);
  assert.throws(() => applyOption(w, { experimentId: exp.id, optionId: 'transfer', requestId: 'transfer-req-1' }), e => e.status === 409 && /недоступен/.test(e.message));
  assert.equal(w.decisions.length, 0);
});
test('a stale comparison cannot be applied until it is recalculated', () => {
  const w = detected(), exp = compareOptions(w, 'PR-1');
  w.advance(5);
  assert.throws(() => applyOption(w, { experimentId: exp.id, optionId: 'diagnose_repair', requestId: 'stale-req-01' }), e => e.status === 409 && e.code === 'stale');
  assert.equal(w.jobs.length, 0, 'nothing applied from a stale snapshot');
  const fresh = compareOptions(w, 'PR-1'); const r = applyOption(w, { experimentId: fresh.id, optionId: 'diagnose_repair', requestId: 'fresh-req-01' });
  assert.equal(r.duplicate, false); assert.equal(w.jobs.length, 1);
});
test('repeating an apply request does not repeat its effect; a second decision on the same comparison is refused', () => {
  const w = detected(), exp = compareOptions(w, 'PR-1');
  const first = applyOption(w, { experimentId: exp.id, optionId: 'diagnose_repair', requestId: 'repeat-req-01' });
  const again = applyOption(w, { experimentId: exp.id, optionId: 'diagnose_repair', requestId: 'repeat-req-01' });
  assert.equal(again.duplicate, true); assert.equal(again.decision.id, first.decision.id);
  assert.equal(w.jobs.length, 1); assert.equal(w.decisions.length, 1);
  assert.throws(() => applyOption(w, { experimentId: exp.id, optionId: 'continue', requestId: 'repeat-req-02' }), e => e.status === 409);
  assert.throws(() => applyOption(w, { experimentId: exp.id, optionId: 'continue', requestId: 'x' }), e => e.status === 400);
});
test('apply is all-or-nothing when a command turns out to be invalid', () => {
  const w = detected(), exp = compareOptions(w, 'PR-1'), option = exp.options.find(o => o.id === 'diagnose_repair');
  option.commands = [...option.commands, { action: 'job', postId: 'W1', kind: 'repair_pump' }];
  const before = production(w);
  assert.throws(() => applyOption(w, { experimentId: exp.id, optionId: option.id, requestId: 'atomic-req-01' }), e => e.status === 409);
  assert.equal(production(w), before); assert.equal(w.decisions.length, 0);
});
test('a decision stores the expectation and baseline; the report separates observed fact from simulated alternatives', () => {
  const w = detected(), exp = compareOptions(w, 'PR-1');
  const { decision } = applyOption(w, { experimentId: exp.id, optionId: 'diagnose_repair', requestId: 'report-req-01' });
  assert.equal(decision.expected.accepted, exp.options.find(o => o.id === 'diagnose_repair').expected.accepted);
  assert.equal(decision.baseline.expected.accepted, exp.options[0].expected.accepted);
  assert.ok(decision.alternatives.every(a => a.optionId !== 'diagnose_repair'));
  let r = decisionReport(w, decision); assert.equal(r.observed.final, false); assert.match(r.observed.label, /смена продолжается/);
  assert.match(r.alternativesLabel, /только симуляция/);
  w.runToEnd(); r = decisionReport(w, decision);
  assert.equal(r.observed.final, true); assert.equal(r.observed.accepted, w.acceptedCount());
  assert.ok(r.notes.some(n => /подтверждено/.test(n)), 'later confirmed cause is reported');
  assert.equal(w.problems[0].status, 'resolved');
});
test('options for a manual breakdown include repair with duration and a transfer only to a free working post', () => {
  const w = new Workshop({ episode: false });
  let target = null;
  for (let i = 0; i < 200 && !target; i++) { const s = w.snapshot(); target = s.posts.find(p => p.vehicleId && p.progress < .5 && s.posts.some(q => q.stage === p.stage && q.id !== p.id && !q.vehicleId)); if (!target) w.advance(1); }
  w.injectIncident(target.id, 'breakdown');
  const options = buildOptions(w, w.problems[0]);
  assert.ok(options.find(o => o.id === 'repair_now').available);
  const t = options.find(o => o.id === 'transfer'); assert.ok(t.available); assert.equal(t.commands[0].action, 'transfer');
  const exp = compareOptions(w, w.problems[0].id), base = exp.options[0], repair = exp.options.find(o => o.id === 'repair_now');
  assert.ok(repair.expected.accepted >= base.expected.accepted); assert.equal(repair.expected.techMinutes, 30);
});
