import test from 'node:test';
import assert from 'node:assert/strict';
import { Workshop, POSTS, STAGES, SHIFT, MAX_VEHICLES, postOee, JOB_KINDS, DEFAULT_PLAN_TARGET } from '../server/simulation.mjs';
import { degradationAt } from '../server/equipment.mjs';

const stripCache = w => { const { _forecast, ...rest } = w; return JSON.parse(JSON.stringify(rest)); };
const assertOk = w => assert.deepEqual(w.checkIntegrity(), []);
// A workshop advanced to the moment the default lift problem is detected.
function detected(seed = 42) { const w = new Workshop({ seed }); while (!w.problems.length && w.minute < 300) w.advance(5); assert.ok(w.problems.length, 'lift problem detected'); return w; }

test('seed and the same command sequence reproduce identical vehicles, jobs, inspections and totals', () => {
  const run = seed => { const w = new Workshop({ seed }); w.injectIncident('W1', 'breakdown'); w.advance(30); w.command({ action: 'job', postId: 'W1', kind: 'repair_generic' }); w.setPriority('ORD-103', 'high'); w.releaseOrder({ modelId: 'B', quantity: 2, priority: 'high' }); w.advance(60); return w; };
  const a = run(42), b = run(42), c = run(7);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.vehicles.map(v => v.work), c.vehicles.map(v => v.work));
});
test('integrity holds every minute of a disturbed shift: one place per vehicle, capacities, balance, stock, technician', () => {
  const w = new Workshop({ warmup: 0 });
  for (let m = 0; m < SHIFT; m++) {
    if (m === 60) w.injectIncident('S1', 'breakdown');
    if (m === 130) { w.injectIncident('A3', 'slowdown'); w.command({ action: 'job', postId: 'S1', kind: 'repair_generic' }); }
    if (m === 200 && w.problems.some(p => p.postId === 'A2' && p.status === 'open')) w.command({ action: 'job', postId: 'A2', kind: 'pump_check', followUp: 'repair_by_result' });
    if (m === 250) w.releaseOrder({ modelId: 'A', quantity: 3, priority: 'high' });
    w.advance(1); assertOk(w);
  }
  assert.equal(w.finished, true); assert.ok(w.inspections.some(i => i.result === 'fail'), 'quality failures occurred');
});
test('a faulted post pauses only itself; its parallel post and other zones keep working', () => {
  const w = new Workshop({ episode: false }), stuck = w.posts.W1.vehicleId, before = w.execution(w.posts.W1.executionId).remaining;
  w.injectIncident('W1', 'breakdown'); w.advance(5);
  assert.equal(w.execution(w.posts.W1.executionId).remaining, before); assert.equal(w.posts.W1.vehicleId, stuck);
  assert.equal(w.snapshot().vehicles.find(v => v.id === stuck).state, 'paused');
  assert.equal(w.posts.W1.stats.fault, 5); assert.equal(w.posts.W2.stats.run, 185, 'W2 kept working every minute');
  for (const p of POSTS.filter(p => p.id !== 'W1')) assert.equal(w.posts[p.id].stats.fault, 0);
  assert.equal(w.snapshot().posts.find(p => p.id === 'W1').state, 'fault');
});
test('a breakdown is not repaired by itself: it needs a repair job that takes time and the technician', () => {
  const w = new Workshop({ episode: false }); w.injectIncident('W1', 'breakdown'); w.advance(60);
  assert.equal(w.postIncident('W1').status, 'active', 'no automatic recovery');
  const job = w.createJob({ postId: 'W1', kind: 'repair_generic' });
  assert.equal(job.status, 'running'); assert.equal(w.technicians.T1.jobId, job.id);
  w.injectIncident('P1', 'breakdown'); const second = w.createJob({ postId: 'P1', kind: 'repair_generic' });
  assert.equal(second.status, 'queued', 'one technician: the second repair waits');
  w.advance(15); assert.equal(w.snapshot().posts.find(p => p.id === 'W1').state, 'maintenance'); assert.ok(w.postIncident('W1'));
  w.advance(15); assert.equal(job.status, 'done'); assert.equal(job.completedAt - job.startedAt, JOB_KINDS.repair_generic.duration);
  assert.equal(w.postIncident('W1'), undefined); assert.equal(second.status, 'running'); assert.equal(second.startedAt, job.completedAt);
  assert.equal(w.posts.W1.stats.maintenance, 30); assertOk(w);
  assert.throws(() => w.createJob({ postId: 'P1', kind: 'repair_generic' }), e => e.status === 409);
  assert.throws(() => w.createJob({ postId: 'W2', kind: 'repair_generic' }), e => e.status === 409);
});
test('lift degradation, measurements and failure come from one model', () => {
  const w = new Workshop({ warmup: 0 }), eq = w.equipment['LIFT-A2'];
  w.runToEnd();
  assert.equal(eq.failed, true); assert.equal(eq.failedAt, 320, 'onset 150 + 170 minutes');
  assert.equal(degradationAt(eq.hidden, 320), 1);
  const mean = (a, b) => { const rs = eq.readings.filter(r => r.minute > a && r.minute <= b); return rs.reduce((s, r) => s + r.pressure, 0) / rs.length; };
  assert.ok(mean(150, 180) - mean(290, 320) > 10, 'pressure drops as degradation grows');
  const healthy = w.equipment['LIFT-A1'].readings; assert.ok(Math.abs(healthy.reduce((s, r) => s + r.pressure, 0) / healthy.length - 180) < 1.5);
  const p = w.problems.find(p => p.equipmentId === 'LIFT-A2');
  assert.ok(p.detectedAt < 320, 'deviation detected before failure'); assert.equal(p.status, 'unresolved');
  assert.ok(w.incidents.some(i => i.kind === 'lift_failure' && i.postId === 'A2'));
  assert.ok(w.posts.A2.stats.fault > 100);
});
test('a check takes model time and changes confirmed hypotheses; the hidden cause is never shown before that', () => {
  const w = detected(), p = w.problems[0], cause = w.equipment[p.equipmentId].hidden.cause;
  const view = w.snapshot().problems[0];
  assert.ok(view.hypotheses.every(h => h.status !== 'confirmed'), 'no hypothesis confirmed before a check');
  assert.ok(!JSON.stringify(w.snapshot()).includes('"hidden"'), 'hidden generator state is not in the snapshot');
  const job = w.createJob({ postId: 'A2', kind: 'pump_check' });
  w.advance(5); assert.equal(job.status, 'running'); assert.equal(p.checks.length, 0);
  w.advance(5); assert.equal(job.status, 'done'); assert.equal(job.completedAt - job.startedAt, 10);
  assert.equal(p.hypothesisStatus.wear?.status, cause === 'wear' ? 'confirmed' : 'rejected');
  const after = w.snapshot().problems[0].hypotheses.find(h => h.id === cause);
  assert.ok(after.probability > .9, 'probability follows the decisive check');
  assert.equal(w.posts.A2.stats.maintenance, 0, 'pump check does not stop the post');
});
test('correct repair after diagnosis restores the lift and closes the problem; repair uses the part once', () => {
  const w = detected(), p = w.problems[0];
  w.createJob({ postId: 'A2', kind: 'pump_check', followUp: 'repair_by_result' });
  for (let i = 0; i < 30 && p.status === 'open'; i++) w.advance(5);
  const cause = w.indicatedCause(p), repair = w.jobs.find(j => j.type === 'repair');
  assert.ok(repair, 'repair created by follow-up'); assert.equal(JOB_KINDS[repair.kind].fixes, cause);
  assert.equal(p.status, 'resolved'); assert.ok(w.jobs.some(j => j.kind === 'verify' && j.result?.restored));
  const part = JOB_KINDS[repair.kind].part; assert.equal(w.stock[part].used, 1); assert.equal(w.stock[part].reserved, 0);
  assert.equal(repair.completedAt - repair.startedAt, JOB_KINDS[repair.kind].duration);
  assert.equal(w.equipment['LIFT-A2'].hidden.cause, null); assertOk(w);
});
test('a wrong repair consumes the part, fails verification and excludes that hypothesis', () => {
  const w = detected(), p = w.problems[0], cause = w.equipment['LIFT-A2'].hidden.cause, wrong = cause === 'wear' ? 'repair_seal' : 'repair_pump';
  w.createJob({ postId: 'A2', kind: wrong });
  for (let i = 0; i < 16; i++) w.advance(5);
  const verify = w.jobs.find(j => j.kind === 'verify');
  assert.equal(verify.status, 'done'); assert.equal(verify.result.restored, false);
  assert.equal(p.status, 'open'); assert.equal(p.hypothesisStatus[cause === 'wear' ? 'leak' : 'wear'].status, 'rejected');
  assert.equal(w.stock[JOB_KINDS[wrong].part].used, 1); assert.equal(w.indicatedCause(p), cause);
});
test('parts and duplicate jobs are validated on the server', () => {
  const w = detected();
  w.createJob({ postId: 'A2', kind: 'repair_pump' });
  assert.throws(() => w.createJob({ postId: 'A2', kind: 'repair_pump' }), e => e.status === 409);
  assert.throws(() => w.createJob({ postId: 'A2', kind: 'repair_seal' }), e => e.status === 409 && /другой ремонт/.test(e.message));
  assert.throws(() => w.createJob({ postId: 'A1', kind: 'repair_pump' }), e => e.status === 409 && /Нет на складе/.test(e.message));
  assert.throws(() => w.createJob({ postId: 'W1', kind: 'pump_check' }), e => e.status === 409);
  assert.throws(() => w.createJob({ postId: 'A2', kind: 'verify' }), e => e.status === 400);
  const r1 = w.command({ action: 'job', postId: 'A1', kind: 'pump_check', requestId: 'same-request-01' });
  const r2 = w.command({ action: 'job', postId: 'A1', kind: 'pump_check', requestId: 'same-request-01' });
  assert.equal(r2.duplicate, true); assert.equal(r2.result, r1.result); assert.equal(w.jobs.filter(j => j.kind === 'pump_check').length, 1);
});
test('quality: a failed inspection sends the vehicle to rework and re-inspection; good output is counted once', () => {
  const w = new Workshop({ warmup: 0, episode: false }); w.runToEnd();
  const failed = w.inspections.filter(i => i.result === 'fail'); assert.ok(failed.length > 0);
  for (const f of failed) {
    const v = w.vehicle(f.vehicleId), all = w.inspections.filter(i => i.vehicleId === v.id);
    assert.equal(all[0].result, 'fail'); assert.ok(all.filter(i => i.result === 'pass').length <= 1);
    if (v.accepted) { assert.ok(v.reworked); assert.ok(v.executionIds.some(id => w.execution(id).stage === 'rework')); assert.equal(all.at(-1).result, 'pass'); }
  }
  const s = w.snapshot();
  assert.equal(s.totals.accepted, w.inspections.filter(i => i.result === 'pass').length);
  assert.equal(w.events.filter(e => e.type === 'vehicle_accepted').length, s.totals.accepted);
  assert.equal(s.quality.firstPass + s.quality.reworkedAccepted, s.totals.accepted);
  assert.ok(s.quality.firstPassYield < 1); assert.equal(s.totals.created, 20);
  const origin = failed.find(f => f.originPostId), p = s.posts.find(x => x.id === origin.originPostId);
  assert.ok(p.metrics.quality < 1, 'quality of the post that made the defect is below 100%');
});
test('finite buffers propagate a blockage upstream instead of losing or duplicating vehicles', () => {
  const w = new Workshop({ episode: false }); w.injectIncident('S1', 'breakdown');
  w.advance(60); w.advance(60); w.advance(60);
  assert.equal(w.buffers.FG.length, 4); assert.ok(w.buffers.B3.length <= 2);
  assert.ok(w.snapshot().posts.some(p => p.stage === 'quality' && p.state === 'blocked')); assertOk(w);
});
test('priority reorders only not-started work and never interrupts a running operation', () => {
  const w = new Workshop({ episode: false }), onPosts = POSTS.map(p => [p.id, w.posts[p.id].executionId]);
  w.setPriority('ORD-103', 'high');
  const c = w.orders.find(o => o.id === 'ORD-103').vehicleIds;
  assert.ok(c.includes(w.queueOrder('BACKLOG')[0])); assert.deepEqual(POSTS.map(p => [p.id, w.posts[p.id].executionId]), onPosts);
  w.advance(30);
  const next = w.executions.filter(e => e.stage === 'weld' && e.startedAt > 180);
  assert.ok(next.length > 0 && next.every(e => c.includes(e.vehicleId)));
  assert.throws(() => w.setPriority('ORD-999', 'high'), e => e.status === 404);
});
test('released order expands into vehicles; limit and validation enforced', () => {
  const w = new Workshop(), order = w.releaseOrder({ modelId: 'B', quantity: 2, priority: 'high' });
  assert.deepEqual(w.queueOrder('BACKLOG').slice(0, 2), order.vehicleIds);
  w.releaseOrder({ modelId: 'A', quantity: MAX_VEHICLES - w.vehicles.length, priority: 'low' });
  assert.throws(() => w.releaseOrder({ modelId: 'A', quantity: 1 }), e => e.status === 409);
  for (const bad of [{ modelId: 'Z', quantity: 1 }, { modelId: 'A', quantity: 0 }, { modelId: '__proto__', quantity: 1 }]) assert.throws(() => new Workshop().releaseOrder(bad), e => e.status === 400);
});
test('plan is the operator commitment, separate from reference capacity, forecast and actual', () => {
  const w = new Workshop(); const s = w.snapshot();
  assert.equal(s.plan.target, DEFAULT_PLAN_TARGET); assert.notEqual(s.plan.reference.total, undefined);
  const ref = new Workshop({ episode: false, beliefDefects: true }); ref.runToEnd(); assert.equal(ref.acceptedCount(), s.plan.reference.total);
  w.runToEnd(); assert.equal(w.planTarget, DEFAULT_PLAN_TARGET, 'plan is never adjusted to hide a shortfall');
  const v = new Workshop(); v.setPlanTarget(14); assert.equal(v.snapshot().plan.target, 14); assert.equal(v.snapshot().forecast.gap, v.snapshot().forecast.projected - 14);
  assert.throws(() => v.setPlanTarget(0), e => e.status === 400); assert.throws(() => v.setPlanTarget(2.5), e => e.status === 400);
});
test('forecast runs on copies: state and PRNG unchanged, and it never uses the hidden cause', () => {
  const w = detected(); const before = stripCache(w);
  const f = w.forecast(); assert.deepEqual(stripCache(w), before); assert.equal(w.rng, before.rng);
  assert.ok(f.scenarios.length === 2 && Math.abs(f.scenarios.reduce((a, s) => a + s.weight, 0) - 1) < 1e-9);
  const swapped = w.clone(); const eq = swapped.equipment['LIFT-A2']; eq.hidden = { ...eq.hidden, cause: eq.hidden.cause === 'wear' ? 'leak' : 'wear' };
  delete swapped._forecast;
  assert.deepEqual(swapped.forecast().scenarios, f.scenarios, 'same observations → same forecast, whatever the hidden truth');
  const fresh = new Workshop(); assert.equal(fresh.snapshot().forecast.scenarios.length, 1, 'undetected degradation is not foreseen');
});
test('end of shift keeps unfinished vehicles, open jobs, incidents and problems; nothing completes by itself', () => {
  const w = new Workshop(); for (let i = 0; i < 4; i++) w.advance(60); w.advance(50);
  w.injectIncident('W2', 'breakdown'); w.createJob({ postId: 'W2', kind: 'repair_generic' }); w.advance(10);
  const s = w.snapshot();
  assert.equal(s.finished, true); assert.equal(s.elapsed, SHIFT);
  assert.ok(s.jobs.some(j => j.status === 'running'), 'repair still running at 16:00');
  assert.equal(s.incidents.find(i => i.postId === 'W2').status, 'unresolved');
  assert.ok(s.problems.filter(p => p.postId === 'W2').every(p => p.status === 'unresolved'));
  assert.ok(s.vehicles.filter(v => !v.accepted).every(v => v.acceptedAt === null));
  assert.ok(s.posts.every(p => p.state === 'shift_over'));
  assert.equal(s.forecast.projected, s.totals.accepted);
  for (const act of [() => w.injectIncident('W1', 'breakdown'), () => w.releaseOrder({ modelId: 'A', quantity: 1 }), () => w.createJob({ postId: 'P1', kind: 'repair_generic' })]) assert.throws(act, e => e.status === 409);
});
test('post OEE: known values and time partition with maintenance', () => {
  const m = postOee({ run: 80, nominal: 60 }, 100, .9);
  assert.equal(m.availability, .8); assert.equal(m.performance, .75); assert.equal(m.quality, .9); assert.ok(Math.abs(m.oee - .54) < 1e-12);
  assert.deepEqual(postOee({ run: 0, nominal: 0 }, 0), { availability: 0, performance: 0, quality: 1, oee: 0 });
  for (const p of new Workshop().snapshot().posts) for (const k of ['availability', 'performance', 'quality', 'oee']) assert.ok(p.metrics[k] >= 0 && p.metrics[k] <= 1);
});
test('serialize/restore keeps an identical, consistent shift', () => {
  const w = detected(); w.createJob({ postId: 'A2', kind: 'pump_check', followUp: 'repair_by_result' }); w.advance(15);
  const r = Workshop.restore(JSON.parse(JSON.stringify(w.serialize())));
  assert.deepEqual(r.checkIntegrity(), []); assert.deepEqual(r.snapshot(), w.snapshot());
  r.advance(30); w.advance(30); assert.deepEqual(r.snapshot(), w.snapshot());
});
