import test from 'node:test';
import assert from 'node:assert/strict';
import { Workshop, POSTS, STAGES, SHIFT, MAX_VEHICLES, postOee, DEFAULT_ORDERS } from '../server/simulation.mjs';

const stripCache = w => { const { _forecast, ...rest } = w; return JSON.parse(JSON.stringify(rest)); };
// Every vehicle is in exactly one place; posts and buffers never exceed capacity; balance holds.
function assertInvariants(w) {
  const places = new Map();
  const put = (id, where) => { assert.ok(!places.has(id), `${id} is in ${places.get(id)} and ${where}`); places.set(id, where); };
  for (const s of STAGES) {
    const queue = w.buffers[s.buffer.id];
    if (s.buffer.capacity !== null) assert.ok(queue.length <= s.buffer.capacity, `${s.buffer.id} over capacity`);
    for (const id of queue) { put(id, s.buffer.id); assert.deepEqual(w.vehicle(id).location, { type: 'buffer', id: s.buffer.id }); }
  }
  for (const p of POSTS) {
    const id = w.posts[p.id].vehicleId;
    if (id) { put(id, p.id); assert.deepEqual(w.vehicle(id).location, { type: 'post', id: p.id }); assert.equal(w.execution(w.posts[p.id].executionId).vehicleId, id); }
    const st = w.posts[p.id].stats; assert.equal(st.run + st.fault + st.starved + st.blocked, w.minute, `${p.id} time partition`);
  }
  for (const id of w.shipped) { put(id, 'SHIPPED'); assert.ok(w.vehicle(id).accepted); }
  assert.equal(places.size, w.vehicles.length);
  const t = w.totals(); assert.ok(t.balanced); assert.equal(t.created, t.notStarted + t.inProcess + t.ready + t.shipped);
  for (const v of w.vehicles) assert.ok(v.executionIds.filter(id => w.execution(id).stage === 'quality' && w.execution(id).completedAt !== null).length <= 1);
}

test('seed and the same command sequence reproduce identical vehicles, moves and totals', () => {
  const run = seed => { const w = new Workshop({ seed }); w.injectIncident('A1', 'breakdown'); w.advance(30); w.setPriority('ORD-103', 'high'); w.releaseOrder({ modelId: 'B', quantity: 2, priority: 'high' }); w.advance(60); return w; };
  const a = run(42), b = run(42), c = run(7);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.vehicles.map(v => v.work), c.vehicles.map(v => v.work));
});
test('each vehicle has one location, posts hold at most one vehicle, buffers respect capacity over a full disturbed shift', () => {
  const w = new Workshop({ warmup: 0 });
  for (let m = 0; m < SHIFT; m++) {
    if (m === 60) w.injectIncident('S1', 'breakdown');
    if (m === 130) w.injectIncident('A2', 'slowdown');
    if (m === 200) w.injectIncident('P1', 'breakdown');
    if (m === 250) w.releaseOrder({ modelId: 'A', quantity: 3, priority: 'high' });
    w.advance(1); assertInvariants(w);
  }
  assert.equal(w.finished, true);
});
test('a faulted post pauses only itself; its parallel post and other zones keep working', () => {
  const w = new Workshop(), stuck = w.posts.W1.vehicleId, before = w.execution(w.posts.W1.executionId).remaining;
  const w2 = w.execution(w.posts.W2.executionId).remaining;
  w.injectIncident('W1', 'breakdown'); w.advance(5);
  assert.equal(w.execution(w.posts.W1.executionId).remaining, before); assert.equal(w.posts.W1.vehicleId, stuck);
  assert.equal(w.snapshot().vehicles.find(v => v.id === stuck).state, 'paused');
  assert.equal(w.posts.W1.stats.fault, 5); assert.equal(w.posts.W2.stats.fault, 0);
  assert.equal(w.posts.W2.stats.run, 185, 'W2 kept working every minute'); assert.ok(w.executions.some(e => e.postId === 'W2' && (e.completedAt !== null || e.remaining < w2)));
  for (const p of POSTS.filter(p => p.id !== 'W1')) assert.equal(w.posts[p.id].stats.fault, 0);
  const snap = w.snapshot(); assert.equal(snap.posts.find(p => p.id === 'W1').state, 'fault');
  assert.ok(snap.posts.filter(p => p.id !== 'W1').every(p => p.state !== 'fault'));
  assert.ok(snap.posts.find(p => p.id === 'W1').reason.includes('Синтетический сигнал'));
});
test('finite buffers propagate a blockage upstream instead of losing or duplicating vehicles', () => {
  const w = new Workshop(); w.injectIncident('S1', 'breakdown'); w.incidents[0].expires = SHIFT + 100;
  w.advance(60); w.advance(60); w.advance(60);
  assert.equal(w.buffers.FG.length, 4); assert.ok(w.buffers.B3.length <= 2);
  const snap = w.snapshot();
  assert.ok(snap.posts.some(p => p.stage === 'quality' && p.state === 'blocked'));
  assert.match(snap.posts.find(p => p.state === 'blocked').reason, /заполнен \(\d\/\d\)/);
  assertInvariants(w);
});
test('priority reorders only not-started work and never interrupts a running operation', () => {
  const w = new Workshop(), onPosts = POSTS.map(p => [p.id, w.posts[p.id].executionId]);
  const firstBefore = w.queueOrder('BACKLOG')[0];
  w.setPriority('ORD-103', 'high');
  const c = w.orders.find(o => o.id === 'ORD-103').vehicleIds, order = w.queueOrder('BACKLOG');
  assert.ok(c.includes(order[0])); assert.notEqual(order[0], firstBefore);
  assert.deepEqual(POSTS.map(p => [p.id, w.posts[p.id].executionId]), onPosts);
  w.advance(30);
  const next = w.executions.filter(e => e.stage === 'weld' && e.startedAt > 180);
  assert.ok(next.length > 0 && next.every(e => c.includes(e.vehicleId)));
  assert.throws(() => w.setPriority('ORD-999', 'high'), e => e.status === 404);
  assert.throws(() => w.setPriority('ORD-103', 'urgent'), e => e.status === 400);
});
test('released order expands into concrete vehicles; high priority jumps the input queue; vehicle limit enforced', () => {
  const w = new Workshop(), created = w.vehicles.length;
  const order = w.releaseOrder({ modelId: 'B', quantity: 2, priority: 'high' });
  assert.equal(w.vehicles.length, created + 2); assert.deepEqual(w.queueOrder('BACKLOG').slice(0, 2), order.vehicleIds);
  assert.ok(order.vehicleIds.every(id => /^DEMO-\d{3}$/.test(id)));
  assert.throws(() => w.releaseOrder({ modelId: 'A', quantity: MAX_VEHICLES, priority: 'normal' }), e => e.status === 400);
  w.releaseOrder({ modelId: 'A', quantity: MAX_VEHICLES - w.vehicles.length, priority: 'low' });
  assert.throws(() => w.releaseOrder({ modelId: 'A', quantity: 1 }), e => e.status === 409);
  for (const bad of [{ modelId: 'Z', quantity: 1 }, { modelId: 'A', quantity: 0 }, { modelId: 'A', quantity: 1.5 }, { modelId: '__proto__', quantity: 1 }, { modelId: 'A', quantity: 1, priority: 'constructor' }]) assert.throws(() => new Workshop().releaseOrder(bad), e => e.status === 400);
});
test('output is counted once at acceptance; shipping does not add output; history, events and orders agree', () => {
  const w = new Workshop({ warmup: 0 }); while (w.minute < SHIFT) w.advance(15);
  const s = w.snapshot();
  const acceptedEvents = w.events.filter(e => e.type === 'vehicle_accepted');
  assert.equal(new Set(acceptedEvents.map(e => e.vehicleId)).size, acceptedEvents.length);
  assert.equal(acceptedEvents.length, s.totals.accepted); assert.equal(s.history.at(-1).accepted, s.totals.accepted);
  assert.ok(s.totals.shipped <= s.totals.accepted);
  assert.equal(s.orders.reduce((a, o) => a + o.accepted, 0), s.totals.accepted);
  assert.equal(s.orders.reduce((a, o) => a + o.quantity, 0), s.totals.created);
  for (const stage of STAGES) assert.equal(POSTS.filter(p => p.stage === stage.id).reduce((a, p) => a + w.posts[p.id].stats.completed, 0), w.executions.filter(e => e.stage === stage.id && e.completedAt !== null).length);
  for (const v of s.vehicles.filter(v => v.accepted)) assert.ok(v.route.slice(0, 4).every(r => r.status === 'done'));
});
test('plan is achievable: the incident-free reference run of the same engine reaches it exactly', () => {
  const w = new Workshop(); const plan = w.snapshot().plan;
  assert.ok(plan.total >= 12 && plan.total <= w.vehicles.length, `plan ${plan.total}`);
  assert.equal(plan.total, DEFAULT_ORDERS.reduce((a, o) => a + o.quantity, 0) - 2);
  const free = new Workshop(); while (free.minute < SHIFT) free.advance(60);
  assert.equal(free.acceptedCount(), plan.total); assert.equal(plan.now, w.acceptedCount());
  assert.equal(w.snapshot().forecast.projected, plan.total);
});
test('forecast runs on a copy: state, revision and PRNG are unchanged; a bottleneck fault lowers output, a long fault lowers the bound', () => {
  const w = new Workshop(); const before = stripCache(w);
  const f = w.forecast(); assert.deepEqual(stripCache(w), before); assert.equal(w.rng, before.rng);
  assert.equal(f.limiting.id, 'assembly');
  w.injectIncident('A1', 'breakdown'); const g = w.snapshot().forecast;
  assert.ok(g.projected < f.projected, 'bottleneck fault reduces projected output');
  assert.ok(g.low < g.projected); assert.equal(g.scenarios.length, 2); assert.match(g.constraints[0], /СБ-1/);
  const x = new Workshop(); x.injectIncident('W1', 'breakdown'); const h = x.snapshot().forecast;
  assert.equal(h.projected, f.projected, 'non-bottleneck fault recovered in time does not reduce shift output'); assert.ok(h.low <= h.projected);
});
test('transfer moves a paused vehicle to a free parallel post and keeps remaining work', () => {
  const w = new Workshop();
  let found = null;
  for (let i = 0; i < 200 && !found; i++) {
    for (const s of STAGES) {
      const ps = POSTS.filter(p => p.stage === s.id), busy = ps.find(p => w.posts[p.id].executionId && w.execution(w.posts[p.id].executionId).completedAt === null), idle = ps.find(p => !w.posts[p.id].vehicleId);
      if (busy && idle) { found = { busy: busy.id, idle: idle.id }; break; }
    }
    if (!found) w.advance(1);
  }
  assert.ok(found, 'a stage with a busy and an idle post exists');
  const v = w.posts[found.busy].vehicleId;
  assert.throws(() => w.transfer(v, found.idle), e => e.status === 409);
  w.injectIncident(found.busy, 'breakdown'); w.advance(1);
  assert.equal(w.posts[found.idle].vehicleId, null, 'parallel post is still free');
  const exec = w.execution(w.vehicle(v).currentExecutionId), remaining = exec.remaining;
  w.transfer(v, found.idle);
  assert.equal(w.posts[found.idle].vehicleId, v); assert.equal(w.posts[found.busy].vehicleId, null);
  assert.equal(exec.remaining, remaining); assert.equal(exec.posts.length, 2);
  w.advance(1); assert.ok(exec.remaining < remaining); assertInvariants(w);
  assert.throws(() => w.transfer('DEMO-999', found.busy), e => e.status === 404);
});
test('incidents: one active per post, scheduled recovery, operator resolve, post A drops only on that post', () => {
  const w = new Workshop(); w.injectIncident('P2', 'breakdown');
  assert.throws(() => w.injectIncident('P2', 'slowdown'), e => e.status === 409);
  assert.throws(() => w.injectIncident('X9', 'breakdown'), e => e.status === 404);
  assert.throws(() => w.injectIncident('P1', 'meteor'), e => e.status === 400);
  w.advance(60); const inc = w.incidents.find(i => i.postId === 'P2');
  assert.equal(inc.status, 'resolved'); assert.equal(inc.end, 240); assert.equal(inc.resolution, 'Восстановлено по сценарию');
  const s = w.snapshot(), p2 = s.posts.find(p => p.id === 'P2'), p1 = s.posts.find(p => p.id === 'P1');
  assert.ok(p2.metrics.availability < p1.metrics.availability); assert.equal(p2.stats.fault, 60);
  w.injectIncident('A3', 'slowdown'); w.resolveIncident(w.incidents[0].id);
  assert.equal(w.incidents[0].resolution, 'Устранено оператором демо');
  assert.throws(() => w.resolveIncident(w.incidents[0].id), e => e.status === 404);
});
test('slowdown lowers performance of that post only', () => {
  const w = new Workshop(); w.injectIncident('A3', 'slowdown'); w.advance(30);
  const s = w.snapshot(), a3 = s.posts.find(p => p.id === 'A3'), a2 = s.posts.find(p => p.id === 'A2');
  assert.ok(a3.metrics.performance < a2.metrics.performance); assert.equal(a3.stats.fault, 0);
});
test('end of shift keeps unfinished vehicles, open operations and incidents; nothing becomes completed by itself', () => {
  const w = new Workshop(); for (let i = 0; i < 4; i++) w.advance(60); w.advance(55); assert.equal(w.minute, 475);
  w.injectIncident('A2', 'breakdown'); w.advance(10);
  const s = w.snapshot();
  assert.equal(s.finished, true); assert.equal(s.running, false); assert.equal(s.elapsed, SHIFT);
  const inc = s.incidents.find(i => i.postId === 'A2'); assert.equal(inc.status, 'unresolved'); assert.equal(inc.end, null); assert.equal(inc.expires, 535);
  const open = s.vehicles.filter(v => !v.accepted); assert.ok(open.length > 0);
  assert.ok(open.every(v => v.acceptedAt === null && v.state !== 'shipped'));
  assert.ok(w.executions.some(e => e.completedAt === null));
  assert.ok(s.posts.every(p => p.state === 'shift_over'));
  assert.equal(s.forecast.projected, s.totals.accepted); assert.equal(s.forecast.limiting, null);
  assert.ok(s.events.at(-1).text.startsWith('Смена завершена'));
  for (const act of [() => w.injectIncident('W1', 'breakdown'), () => w.releaseOrder({ modelId: 'A', quantity: 1 }), () => w.setPriority('ORD-103', 'high')]) assert.throws(act, e => e.status === 409);
  const before = JSON.stringify(w.snapshot()); w.advance(5); assert.equal(w.minute, SHIFT); assert.equal(JSON.stringify({ ...w.snapshot(), revision: 0 }), JSON.stringify({ ...JSON.parse(before), revision: 0 }));
  w.reset(); assert.equal(w.minute, 180); assert.equal(w.finished, false); assert.equal(w.incidents.length, 0);
});
test('post OEE: known values, zero time and run/fault partition', () => {
  const m = postOee({ run: 80, nominal: 60 }, 100);
  assert.equal(m.availability, .8); assert.equal(m.performance, .75); assert.equal(m.quality, 1); assert.ok(Math.abs(m.oee - .6) < 1e-12);
  assert.deepEqual(postOee({ run: 0, nominal: 0 }, 0), { availability: 0, performance: 0, quality: 1, oee: 0 });
  const s = new Workshop().snapshot();
  for (const p of s.posts) for (const k of ['availability', 'performance', 'quality', 'oee']) assert.ok(Number.isFinite(p.metrics[k]) && p.metrics[k] >= 0 && p.metrics[k] <= 1);
});
test('one snapshot revision is consistent across map, vehicles, orders and analytics', () => {
  const w = new Workshop(); w.injectIncident('A1', 'breakdown'); w.advance(25); const s = w.snapshot();
  for (const p of s.posts.filter(p => p.vehicleId)) { const v = s.vehicles.find(v => v.id === p.vehicleId); assert.deepEqual(v.location, { type: 'post', id: p.id }); assert.equal(v.currentOperation.postId, p.id); }
  for (const st of s.stages) for (const id of st.buffer.vehicleIds) assert.equal(s.vehicles.find(v => v.id === id).location.id, st.buffer.id);
  for (const o of s.orders) assert.equal(o.accepted, s.vehicles.filter(v => v.orderId === o.id && v.accepted).length);
  assert.equal(s.vehicles.filter(v => v.state === 'paused').length, s.posts.filter(p => p.state === 'fault' && p.vehicleId && p.progress < 1).length);
  assert.equal(s.history.at(-1).accepted, s.totals.accepted);
});
