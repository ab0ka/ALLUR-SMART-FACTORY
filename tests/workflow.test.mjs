import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Workshop } from '../server/simulation.mjs';
import { createApp } from '../server/index.mjs';

// The default demo shift: DEMO-003 failed control with «Зазор двери вне допуска» and stands on ДР-1 at 11:00;
// DEMO-005 (scripted weak battery) arrives later with «Не запускается».
const view = (w, id) => w.snapshot().vehicles.find(v => v.id === id);
const run = (w, cmd) => w.command(cmd);
const rejects = (w, cmd, re) => assert.throws(() => run(w, cmd), err => err.status === 409 && re.test(err.message));
function doorVehicle(w) { const v = w.vehicles.find(x => w.atReworkPost(x) && w.reworkProcedure(x)?.type === 'door'); assert.ok(v, 'door vehicle on ДР-1'); return v.id; }

test('a door-gap defect is not fixed automatically: it waits for measurement and adjustment on ДР-1', () => {
  const w = new Workshop(), id = doorVehicle(w);
  const v = view(w, id);
  assert.equal(v.procedure.type, 'door'); assert.equal(v.procedure.defect, 'Зазор двери вне допуска');
  assert.equal(v.nextAction.op, 'door_measure'); assert.match(v.nextAction.title, /Измерить зазор двери/);
  assert.equal(v.state, 'paused'); assert.match(v.status, /зазор двери/i);
  w.advance(30);
  assert.equal(view(w, id).location.id, 'R1', 'still on ДР-1 after 30 minutes'); assert.equal(view(w, id).accepted, false);
  assert.equal(w.snapshot().posts.find(p => p.id === 'R1').state, 'diagnosis');
});
test('door procedure: measure → adjust → re-measure → re-inspection; good output counted once', () => {
  const w = new Workshop(), id = doorVehicle(w);
  rejects(w, { action: 'door_adjust', vehicleId: id }, /Сначала измерьте/);
  run(w, { action: 'door_measure', vehicleId: id });
  let v = view(w, id), m = v.procedure.door.checks[0];
  assert.equal(m.ok, false); assert.ok(m.value > 5); assert.equal(v.nextAction.op, 'door_adjust');
  run(w, { action: 'door_measure', vehicleId: id });
  assert.equal(view(w, id).procedure.door.checks[1].ok, false, 'measuring again without repair changes nothing');
  run(w, { action: 'door_adjust', vehicleId: id });
  rejects(w, { action: 'door_adjust', vehicleId: id }, /повторный замер/);
  assert.match(view(w, id).nextAction.title, /после регулировки/);
  run(w, { action: 'door_measure', vehicleId: id });
  v = view(w, id);
  assert.equal(v.procedure.door.ok, true); assert.match(v.nextAction.title, /повторный контроль/);
  rejects(w, { action: 'door_measure', vehicleId: id }, /уже в допуске/);
  const acceptedBefore = w.acceptedCount();
  for (let i = 0; i < 60 && !view(w, id).accepted; i++) w.advance(1);
  v = view(w, id);
  assert.equal(v.accepted, true); assert.equal(v.reworked, true);
  assert.deepEqual(v.inspections.map(i => i.result), ['fail', 'pass']);
  assert.equal(w.acceptedCount() - acceptedBefore >= 1, true);
  assert.equal(w.events.filter(e => e.type === 'vehicle_accepted' && e.vehicleId === id).length, 1);
  assert.deepEqual(w.checkIntegrity(), []);
});
test('a start test is not a repair for a door defect, and door operations do not apply to a start defect', () => {
  const w = new Workshop(), id = doorVehicle(w);
  run(w, { action: 'start_test', vehicleId: id });
  assert.equal(view(w, id).procedure.door.ok, false); assert.equal(view(w, id).nextAction.op, 'door_measure');
  w.advance(20); assert.equal(view(w, id).accepted, false); assert.equal(view(w, id).location.id, 'R1');
  // Fix the door so DEMO-005 can reach ДР-1, then check that door operations are refused for it.
  run(w, { action: 'door_measure', vehicleId: id }); run(w, { action: 'door_adjust', vehicleId: id }); run(w, { action: 'door_measure', vehicleId: id });
  while (view(w, 'DEMO-005').location.id !== 'R1' && w.minute < 470) w.advance(1);
  const d5 = view(w, 'DEMO-005');
  assert.equal(d5.procedure.type, 'start'); assert.equal(d5.nextAction.op, 'component_check'); assert.equal(d5.nextAction.component, 'battery');
  assert.equal(d5.doorActions, null);
  rejects(w, { action: 'door_measure', vehicleId: 'DEMO-005' }, /нет дефекта двери/);
});
test('operations on one vehicle never touch another; a vehicle off ДР-1 gets a clear reason', () => {
  const w = new Workshop(), id = doorVehicle(w), other = w.vehicles.find(v => v.id !== id && !v.accepted && v.location.type === 'post').id;
  rejects(w, { action: 'door_measure', vehicleId: other }, /ДР-1/);
  rejects(w, { action: 'component_check', vehicleId: other, component: 'battery' }, /ДР-1/);
  const before = JSON.stringify(w.vehicle(other));
  run(w, { action: 'door_measure', vehicleId: id });
  assert.equal(JSON.stringify(w.vehicle(other)), before);
  const card = view(w, other);
  assert.ok(card.components.every(c => !c.actions || c.actions.check.ok === false));
});
test('repeated requests do not repeat an adjustment or a part write-off', () => {
  const w = new Workshop(), id = doorVehicle(w);
  run(w, { action: 'door_measure', vehicleId: id, requestId: 'door-measure-0001' });
  const a = run(w, { action: 'door_adjust', vehicleId: id, requestId: 'door-adjust-0001' });
  const b = run(w, { action: 'door_adjust', vehicleId: id, requestId: 'door-adjust-0001' });
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(w.vehicle(id).door.adjustments, 1);
});
test('rework of weld and paint defects is automatic and explained; with manual rework off the door is done in norm time', () => {
  const w = new Workshop({ episode: false, warmup: 0 });
  let seen = null;
  while (w.minute < 480 && !seen) { w.advance(1); seen = w.vehicles.find(v => w.atReworkPost(v) && w.reworkProcedure(v)); }
  assert.ok(seen); const v = view(w, seen.id);
  assert.equal(w.manualRework, false);
  assert.match(v.nextAction.title, /Действий не требуется/); assert.match(v.nextAction.why, /осталось/);
  if (v.procedure.type === 'auto') assert.ok(v.procedure.auto.work.length > 5);
});
test('task list: equipment, defects and risks with stable ids; header count equals the list', () => {
  const w = new Workshop();
  let s = w.snapshot();
  const door = s.tasks.find(t => t.object.type === 'vehicle' && t.category === 'defect');
  assert.ok(door, 'the door defect is a task'); assert.equal(door.certainty, 'confirmed'); assert.match(door.next, /Измерить зазор/);
  assert.equal(new Set(s.tasks.map(t => t.id)).size, s.tasks.length, 'no duplicate ids');
  assert.deepEqual(w.snapshot().tasks.map(t => t.id), s.tasks.map(t => t.id), 'polling does not create tasks');
  while (!w.problems.length) w.advance(5);
  s = w.snapshot();
  const eq = s.tasks.find(t => t.category === 'equipment');
  assert.equal(eq.certainty, 'hypothesis'); assert.equal(eq.object.id, w.problems[0].id);
  assert.ok(s.tasks.some(t => t.id === door.id), 'same defect keeps its id over time');
  for (const t of s.tasks) for (const k of ['object', 'categoryName', 'certaintyText', 'reason', 'status', 'impact', 'next']) assert.ok(t[k] !== undefined && t[k] !== '', `${t.id}.${k}`);
  for (const t of s.tasks.filter(t => t.category === 'risk')) assert.equal(t.certainty, 'forecast');
  w.command({ action: 'job', postId: 'A2', kind: 'pump_check' }); w.advance(10);
  assert.equal(w.snapshot().tasks.find(t => t.category === 'equipment').certainty, 'confirmed', 'a decisive check confirms the cause');
});
test('an older save without defect workflow data loads, keeps balances and gets the door procedure', () => {
  const w = new Workshop(), data = JSON.parse(JSON.stringify(w.serialize()));
  delete data.manualRework;
  for (const v of data.vehicles) { delete v.door; delete v.doorOk; delete v.hidden.doorGap; }
  const r = Workshop.restore(data);
  assert.deepEqual(r.checkIntegrity(), []); assert.equal(r.manualRework, true);
  const id = doorVehicle(r);
  assert.equal(view(r, id).nextAction.op, 'door_measure');
  r.command({ action: 'door_measure', vehicleId: id }); assert.equal(r.vehicle(id).door.checks.length, 1);
});
test('without an AI key the API serves tasks, the next action and accepts door operations', async () => {
  const app = createApp({ simulation: new Workshop(), aiOptions: { provider: 'local' } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const s = await (await fetch(base + '/api/state')).json();
    assert.equal(s.ai.configured, false); assert.ok(s.tasks.length > 0);
    const id = s.tasks.find(t => t.category === 'defect').object.id;
    assert.equal(s.vehicles.find(v => v.id === id).nextAction.op, 'door_measure');
    const r = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify({ action: 'door_measure', vehicleId: id, requestId: 'http-door-0001' }) });
    assert.equal(r.status, 200); const after = await r.json();
    assert.equal(after.vehicles.find(v => v.id === id).procedure.door.checks.length, 1);
  } finally { await new Promise(res => { app.close(res); app.closeAllConnections(); }); }
});
test('chat: a problem context answers about the vehicle on that post, and "what to do" uses the server next action', async () => {
  const { answerChat } = await import('../server/chat.mjs');
  const w = new Workshop(); while (!w.problems.length) w.advance(5);
  const p = w.problems[0], onPost = w.posts[p.postId].vehicleId;
  const r = await answerChat(w, { message: 'Почему задерживается этот автомобиль?', context: { type: 'problem', id: p.id } });
  assert.ok(r.text.startsWith(onPost), r.text.slice(0, 60)); assert.match(r.text, /Следующее действие:/);
  const id = w.vehicles.find(v => w.atReworkPost(v) && w.reworkProcedure(v)?.type === 'door')?.id;
  if (id) {
    const n = await answerChat(w, { message: 'Что делать с этой машиной?', context: { type: 'vehicle', id } });
    assert.equal(n.intent, 'next_action'); assert.match(n.text, /Измерить зазор двери/); assert.equal(w.vehicle(id).door.checks.length, 0, 'chat does not act');
  }
  const t = await answerChat(w, { message: 'Что сейчас угрожает плану?' });
  assert.match(t.text, /Задачи по автомобилям|Неисправности оборудования/);
});
