import test from 'node:test';
import assert from 'node:assert/strict';
import { Workshop } from '../server/simulation.mjs';
import { createHandover } from '../server/handover.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

for (const [name, minutes] of [['initial', 0], ['active', 220], ['finished', 480]]) {
  test(`handover projects an ${name} public shift without mutation`, () => {
    const w = new Workshop({ warmup: 0 });
    for (let elapsed = 0; elapsed < minutes; elapsed += 60) w.advance(Math.min(60, minutes - elapsed));
    const snapshot = w.snapshot(), before = structuredClone(snapshot);
    const report = createHandover(freeze(snapshot));
    assert.deepEqual(snapshot, before);
    assert.deepEqual(createHandover(snapshot), report);
    assert.equal(JSON.stringify(createHandover(snapshot)), JSON.stringify(report));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.synthetic, true);
    for (const key of ['revision', 'elapsed', 'shift', 'shiftStart', 'finished']) assert.equal(report[key], snapshot[key]);
    assert.equal(report.finished, minutes === 480);
    assert.deepEqual(report.metrics, {
      planTarget: snapshot.plan.target, referenceTotal: snapshot.plan.reference.total,
      forecast: snapshot.forecast.projected, forecastLow: snapshot.forecast.low, forecastHigh: snapshot.forecast.high,
      accepted: snapshot.totals.accepted, shipped: snapshot.totals.shipped, wip: snapshot.totals.wip,
      firstPassYield: snapshot.quality.firstPassYield,
    });
    for (const key of ['problems', 'jobs', 'tasks', 'orders']) assert.equal(report.counts[key], report[key].length);
    assert.deepEqual(report.tasks.map(t => t.id), snapshot.tasks.map(t => t.id));
    assert.deepEqual(report.problems.map(p => p.id), snapshot.problems.filter(p => ['open', 'unresolved'].includes(p.status)).map(p => p.id));
    if (minutes === 480) assert.ok(report.problems.some(p => p.status === 'unresolved'));
    assert.deepEqual(report.orders.map(o => o.id), snapshot.orders.filter(o => o.state !== 'completed').map(o => o.id));
    assert.deepEqual(report.events.map(e => e.id), snapshot.events.slice(-20).map(e => e.seq));
    assert.deepEqual(report.events.map(e => e.kind), snapshot.events.slice(-20).map(e => e.type));
    assert.deepEqual(report.resources.stock, snapshot.stock.map(({ id, name, onHand, reserved, available }) => ({ id, name, onHand, reserved, available })));
  });
}

test('filters closed problems, completed jobs and orders; preserves zeros and resources', () => {
  const snapshot = {
    revision: 0, elapsed: 0, shift: 0, shiftStart: 0, finished: false,
    plan: { target: 0, reference: { total: 0 } }, forecast: { projected: 0, low: 0, high: 0 },
    totals: { accepted: 0, shipped: 0, wip: 0 }, quality: { firstPassYield: 0 },
    problems: [{ id: 'PR-1', status: 'open', detectedAt: 0, vehicleIds: ['DEMO-001'] }, { id: 'PR-2', status: 'resolved' }],
    jobs: [{ id: 'JOB-1', status: 'queued', remaining: 0, createdAt: 0 }, { id: 'JOB-2', status: 'running', technicianId: 'T1' }, { id: 'JOB-3', status: 'completed' }],
    tasks: [{ id: 'TASK-1', object: { type: 'problem', id: 'PR-1' }, since: 0 }],
    orders: [{ id: 'ORD-1', state: 'released', quantity: 0, accepted: 0, shipped: 0, dueMinute: 0, overdue: false }, { id: 'ORD-2', state: 'completed' }],
    technicians: [{ id: 'T1', name: 'Техник', jobId: 'JOB-2' }, { id: 'T2', name: 'Свободный', jobId: null }],
    stock: [{ id: 'pump', name: 'Насос', onHand: 0, reserved: 0, available: 0 }],
    posts: [{ id: 'A1', code: 'СБ-1' }], holds: ['A1', 'unknown'],
    events: Array.from({ length: 25 }, (_, id) => ({ seq: id, minute: id, type: 'test', text: 'Событие' })),
  };
  const report = createHandover(freeze(snapshot));
  assert.deepEqual(report.counts, { problems: 1, jobs: 2, tasks: 1, orders: 1 });
  assert.ok(Object.values(report.metrics).every(value => value === 0));
  assert.equal(report.revision, 0); assert.equal(report.finished, false);
  assert.equal(report.problems[0].detectedAt, 0);
  assert.equal(report.jobs[0].remaining, 0); assert.equal(report.jobs[0].createdAt, 0);
  assert.equal(report.tasks[0].since, 0); assert.equal(report.orders[0].dueMinute, 0);
  assert.equal(report.orders[0].overdue, false);
  assert.deepEqual(report.resources.technicians, snapshot.technicians);
  assert.deepEqual(report.resources.stock, snapshot.stock);
  assert.deepEqual(report.resources.heldPosts, [{ id: 'A1', code: 'СБ-1' }, { id: 'unknown', code: null }]);
  assert.deepEqual(report.events.map(e => e.id), Array.from({ length: 20 }, (_, i) => i + 5));
  report.problems[0].vehicleIds.push('DEMO-999'); report.tasks[0].object.id = 'other';
  report.resources.stock[0].available = 99;
  assert.deepEqual(snapshot.problems[0].vehicleIds, ['DEMO-001']);
  assert.equal(snapshot.tasks[0].object.id, 'PR-1'); assert.equal(snapshot.stock[0].available, 0);
});

test('explicit allowlists exclude hidden fields at every level and reject object-valued scalar fields', () => {
  const secret = { csrf: 'private-marker', key: 'private-marker', hidden: 'private-marker', health: 'private-marker', chat: ['private-marker'], repairedCause: 'private-marker' };
  const row = { ...secret, id: 'DEMO', title: { ...secret }, name: { ...secret }, status: 'open', state: 'released' };
  const report = createHandover({
    ...secret, revision: { ...secret }, plan: { ...secret, target: 0 },
    problems: [{ ...row, vehicleIds: [{ ...secret }, 'DEMO-001'] }], jobs: [{ ...row, status: 'running' }],
    tasks: [{ ...row, object: { ...secret, type: 'vehicle', id: 'DEMO-001' } }], orders: [row],
    technicians: [row], stock: [row], posts: [{ ...row, code: { ...secret } }], holds: ['DEMO'], events: [row],
  });
  assert.doesNotMatch(JSON.stringify(report), /private-marker|csrf|hidden|health|chat|repairedCause/);
  assert.equal(report.revision, null); assert.equal(report.problems[0].title, null);
  assert.deepEqual(report.problems[0].vehicleIds, [null, 'DEMO-001']);
  assert.deepEqual(report.tasks[0].object, { type: 'vehicle', id: 'DEMO-001' });
  assert.deepEqual(Object.keys(report).sort(), ['schemaVersion', 'synthetic', 'shiftEpoch', 'revision', 'elapsed', 'shift', 'shiftStart', 'finished', 'metrics', 'counts', 'problems', 'jobs', 'tasks', 'orders', 'resources', 'events'].sort());
});

test('shiftEpoch copies only a public scalar and stays null when absent or object-valued', () => {
  for (const shiftEpoch of ['synthetic-run-1', 0, false]) {
    const snapshot = freeze({ shiftEpoch });
    assert.equal(createHandover(snapshot).shiftEpoch, shiftEpoch);
    assert.deepEqual(snapshot, { shiftEpoch });
  }
  assert.equal(createHandover().shiftEpoch, null);
  for (const shiftEpoch of [null, undefined, { csrf: 'private-marker' }, ['private-marker']]) {
    const report = createHandover(freeze({ shiftEpoch }));
    assert.equal(report.shiftEpoch, null);
    assert.doesNotMatch(JSON.stringify(report), /private-marker|csrf/);
  }
});

test('missing values stay null, empty collections stay empty, no forecast or resource data invented', () => {
  const report = createHandover({ plan: { reference: null }, tasks: [{}], problems: [{ status: 'open' }], stock: [{ onHand: 2, reserved: 1 }] });
  assert.ok(Object.values(report.metrics).every(value => value === null));
  assert.equal(report.problems[0].vehicleIds, null);
  assert.deepEqual(report.tasks[0].object, { type: null, id: null });
  assert.equal(report.resources.stock[0].available, null);
  assert.deepEqual(createHandover().counts, { problems: 0, jobs: 0, tasks: 0, orders: 0 });
  assert.deepEqual(report.events, []);
});
