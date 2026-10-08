import test from 'node:test';
import assert from 'node:assert/strict';
import { Workshop, POSTS } from '../server/simulation.mjs';

function fixture() {
  const w = new Workshop({ episode: false });
  for (let i = 0; i < 200; i++, w.advance(1)) {
    for (const source of POSTS) {
      const v = w.posts[source.id].vehicleId;
      const ex = v && w.execution(w.vehicle(v).currentExecutionId);
      const target = POSTS.find(p => p.stage === source.stage && p.id !== source.id && !w.posts[p.id].vehicleId);
      if (ex && ex.completedAt === null && target) return { w, source, target, v, ex };
    }
  }
  throw new Error('No transfer fixture');
}
const option = (w, source, target) => w.snapshot().posts.find(p => p.id === source.id).transfer.targets.find(t => t.postId === target.id);

test('post snapshot explains empty posts, single-post stages and shift end on the server', () => {
  const w = new Workshop({ warmup: 0, episode: false });
  assert.match(w.postTransferOptions('A1').reason, /нет автомобиля/);
  for (let i = 0; i < 3; i++) w.advance(60);
  for (let i = 0; i < 250 && !w.posts.S1.vehicleId; i++) w.advance(1);
  assert.ok(w.posts.S1.vehicleId);
  assert.match(w.postTransferOptions('S1').reason, /нет параллельных постов/);
  w.runToEnd();
  for (const p of w.snapshot().posts) assert.equal(p.transfer.reason, 'Смена завершена');
});

test('server snapshot and command share the same rejection reasons without changing production', () => {
  for (const scenario of ['healthy', 'held', 'broken', 'repair', 'problem', 'completed', 'finished']) {
    const { w, source, target, v, ex } = fixture();
    if (scenario !== 'healthy') w.injectIncident(source.id, 'breakdown');
    if (scenario === 'held') w.setHold(target.id, true);
    if (scenario === 'broken' || scenario === 'repair') w.injectIncident(target.id, 'breakdown');
    if (scenario === 'repair') w.createJob({ postId: target.id, kind: 'repair_generic' });
    if (scenario === 'problem') w.injectIncident(target.id, 'slowdown');
    if (scenario === 'completed') ex.completedAt = w.minute;
    if (scenario === 'finished') w.finished = true;
    const a = option(w, source, target);
    assert.equal(a.ok, false, scenario);
    const expected = { healthy: /исправен/, held: /снят с загрузки/, broken: /неисправен/, repair: /ремонте/, problem: /открытую проблему/, completed: /не выполняет/, finished: /Смена завершена/ };
    assert.match(a.reason, expected[scenario], scenario);
    const before = w.serialize();
    assert.throws(() => w.command({ action: 'transfer', vehicleId: v, postId: target.id }), e => e.status === a.status && e.message === a.reason);
    assert.deepEqual(w.serialize(), before);
  }
});

test('occupied target names its vehicle and command rechecks a previously available target', () => {
  const { w, source, target, v } = fixture();
  w.injectIncident(source.id, 'breakdown');
  assert.equal(option(w, source, target).ok, true);
  w.setHold(target.id, true);
  assert.throws(() => w.command({ action: 'transfer', vehicleId: v, postId: target.id }), /снят с загрузки/);
  const busy = new Workshop({ episode: false });
  busy.injectIncident('W1', 'breakdown');
  const a = busy.postTransferOptions('W1').targets.find(t => t.postId === 'W2');
  assert.equal(a.ok, false);
  assert.ok(a.reason.includes(busy.posts.W2.vehicleId));
  assert.match(a.reason, /занят/);
});

test('confirmed transfer preserves execution, remaining work and integrity; duplicate request has no effect', () => {
  const { w, source, target, v, ex } = fixture();
  w.injectIncident(source.id, 'breakdown');
  assert.equal(option(w, source, target).ok, true);
  const remaining = ex.remaining, executionId = ex.id;
  const cmd = { action: 'transfer', vehicleId: v, postId: target.id, requestId: 't3-transfer-001' };
  w.command(cmd); w.command(cmd);
  assert.equal(w.vehicle(v).location.id, target.id);
  assert.equal(w.vehicle(v).currentExecutionId, executionId);
  assert.equal(ex.remaining, remaining);
  assert.equal(w.events.filter(e => e.type === 'vehicle_transferred').length, 1);
  assert.deepEqual(w.checkIntegrity(), []);
});
