import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Workshop } from '../server/simulation.mjs';
import { createApp } from '../server/index.mjs';

const DEMO = 'DEMO-005';
const view = (w, id = DEMO) => w.snapshot().vehicles.find(v => v.id === id);
const comp = (w, id, c) => view(w, id).components.find(x => x.id === c);
// A door-gap vehicle ahead of DEMO-005 waits for the operator on ДР-1: measure, adjust, measure again.
function serviceDoors(w) {
  for (const v of w.vehicles) if (w.atReworkPost(v) && w.reworkProcedure(v)?.type === 'door' && !v.doorOk) {
    w.command({ action: 'door_measure', vehicleId: v.id }); w.command({ action: 'door_adjust', vehicleId: v.id }); w.command({ action: 'door_measure', vehicleId: v.id });
  }
}
// Runs the default shift until the scripted vehicle sits on the diagnostics post.
function atDiagnostics() {
  const w = new Workshop();
  while (view(w).location.id !== 'R1' && w.minute < 470) { serviceDoors(w); w.advance(1); }
  assert.equal(view(w).location.id, 'R1');
  return w;
}
const run = (w, cmd) => w.command({ vehicleId: DEMO, ...cmd });
const rejects = (w, cmd, re) => assert.throws(() => run(w, cmd), err => err.status === 409 && re.test(err.message));

test('the scripted vehicle fails the start check, goes to diagnostics and does not repair itself', () => {
  const w = atDiagnostics(), v = view(w);
  assert.equal(v.diagnosis.symptom, 'Не запускается'); assert.equal(v.diagnosis.awaiting, true);
  assert.match(v.diagnosis.hypothesis, /гипотеза/i);
  assert.equal(v.inspections[0].result, 'fail');
  w.advance(30);
  assert.equal(view(w).location.id, 'R1'); assert.equal(view(w).diagnosis.awaiting, true);
  assert.equal(w.snapshot().posts.find(p => p.id === 'R1').state, 'diagnosis');
  assert.deepEqual(w.checkIntegrity(), []);
});

test('hidden part health is not sent to the client before a check', () => {
  const s = JSON.stringify(view(atDiagnostics()));
  assert.ok(!s.includes('"health"')); assert.ok(!s.includes('faulty'));
});

test('the fault persists: repeated checks and start tests without a repair keep failing', () => {
  const w = atDiagnostics();
  for (let i = 0; i < 3; i++) {
    run(w, { action: 'component_check', component: 'battery' });
    assert.equal(comp(w, DEMO, 'battery').state, 'faulty');
    assert.ok(comp(w, DEMO, 'battery').lastCheck.measurements[1].value < 9.6);
    run(w, { action: 'start_test' });
    assert.equal(view(w).diagnosis.startTests.at(-1).result, 'fail');
  }
  assert.equal(view(w).diagnosis.awaiting, true);
});

test('remove and install change the component state; invalid operations are rejected', () => {
  const w = atDiagnostics();
  assert.equal(comp(w, DEMO, 'battery').state, 'installed');
  run(w, { action: 'component_check', component: 'battery' });
  run(w, { action: 'component_remove', component: 'battery' });
  assert.equal(comp(w, DEMO, 'battery').state, 'missing'); assert.equal(comp(w, DEMO, 'battery').removedScrapped, true);
  rejects(w, { action: 'component_remove', component: 'battery' }, /уже снят/);
  rejects(w, { action: 'component_check', component: 'battery' }, /отсутствующий/);
  rejects(w, { action: 'start_test' }, /не установлены — аккумулятор/);
  rejects(w, { action: 'component_remove', component: 'engine' }, /не предусмотрено/);
  assert.throws(() => run(w, { action: 'component_check', component: 'turbo' }), /Неизвестный узел/);
  const stock = () => w.snapshot().stock.find(s => s.id === 'battery').onHand;
  const before = stock();
  run(w, { action: 'component_install', component: 'battery' });
  assert.equal(comp(w, DEMO, 'battery').state, 'installed'); assert.equal(stock(), before - 1);
  rejects(w, { action: 'component_install', component: 'battery' }, /уже установлен/);
  // A healthy part that was taken off goes back without using stock.
  run(w, { action: 'component_remove', component: 'airbox' }); run(w, { action: 'component_install', component: 'airbox' });
  assert.equal(stock(), before - 1);
});

test('after the battery replacement the check and the start test pass and the vehicle is accepted after re-inspection', () => {
  const w = atDiagnostics();
  run(w, { action: 'component_check', component: 'battery' });
  run(w, { action: 'component_remove', component: 'battery' });
  run(w, { action: 'component_install', component: 'battery' });
  run(w, { action: 'component_check', component: 'battery' });
  assert.equal(comp(w, DEMO, 'battery').state, 'checked');
  run(w, { action: 'start_test' });
  const v = view(w);
  assert.equal(v.diagnosis.passed, true); assert.equal(v.diagnosis.startTests.at(-1).result, 'pass');
  while (!view(w).accepted && w.minute < 470) w.advance(1);
  const done = view(w);
  assert.equal(done.accepted, true); assert.equal(done.reworked, true);
  assert.deepEqual(done.inspections.map(i => i.result), ['fail', 'pass']);
  assert.deepEqual(w.checkIntegrity(), []);
});

test('component state is isolated per vehicle and component operations need the diagnostics post', () => {
  const w = atDiagnostics();
  const others = () => w.snapshot().vehicles.filter(v => v.id !== DEMO && v.components.some(c => c.state !== 'missing')).map(v => JSON.stringify(v.components));
  const before = others();
  assert.ok(before.length > 0);
  run(w, { action: 'component_check', component: 'battery' }); run(w, { action: 'component_remove', component: 'battery' }); run(w, { action: 'component_install', component: 'battery' });
  assert.deepEqual(others(), before);
  const other = w.snapshot().vehicles.find(v => v.id !== DEMO && v.components.some(c => c.state === 'installed'));
  assert.throws(() => w.command({ action: 'component_check', vehicleId: other.id, component: 'battery' }), err => err.status === 409 && /ДР-1/.test(err.message));
  const fresh = w.snapshot().vehicles.find(v => v.location.id === 'BACKLOG');
  assert.ok(fresh.components.every(c => c.state === 'missing'), 'before assembly every node is missing');
});

test('component state survives serialize and restore', () => {
  const w = atDiagnostics();
  run(w, { action: 'component_check', component: 'battery' }); run(w, { action: 'component_remove', component: 'battery' });
  const r = Workshop.restore(w.serialize());
  assert.equal(comp(r, DEMO, 'battery').state, 'missing'); assert.deepEqual(r.checkIntegrity(), []);
});

test('the scenario works over HTTP with the local AI mode and duplicate requests do not repeat an operation', async () => {
  const w = atDiagnostics(), server = createApp({ simulation: w, aiOptions: { provider: 'local' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { csrf } = await (await fetch(base + '/api/state')).json();
    const act = body => fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ vehicleId: DEMO, ...body }) });
    assert.equal((await act({ action: 'component_check', component: 'battery', requestId: 'check-battery-01' })).status, 200);
    const removed = await (await act({ action: 'component_remove', component: 'battery', requestId: 'remove-battery-01' })).json();
    const again = await (await act({ action: 'component_remove', component: 'battery', requestId: 'remove-battery-01' })).json();
    assert.equal(again.duplicate, true);
    assert.equal(removed.vehicles.find(v => v.id === DEMO).components.find(c => c.id === 'battery').state, 'missing');
    assert.equal((await act({ action: 'component_remove', component: 'battery', requestId: 'remove-battery-02' })).status, 409);
    assert.equal((await act({ action: 'component_install', component: 'battery' })).status, 200);
    const start = await (await act({ action: 'start_test' })).json();
    assert.equal(start.vehicles.find(v => v.id === DEMO).diagnosis.passed, true);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});

test('a shift saved before components existed is restored and served without errors', () => {
  const w = new Workshop(); w.advance(30);
  const old = w.serialize();
  delete old.stock.battery; delete old.componentCheckSeq; delete old.scriptedFaults;
  for (const v of old.vehicles) { delete v.components; delete v.componentChecks; delete v.startTests; delete v.hidden.componentHealth; }
  const r = Workshop.restore(old);
  assert.deepEqual(r.checkIntegrity(), []);
  const s = r.snapshot();
  assert.equal(s.stock.find(x => x.id === 'battery').available, 2);
  assert.ok(s.vehicles.every(v => Array.isArray(v.components)));
  r.advance(30); assert.deepEqual(r.checkIntegrity(), []);
});
