import test from 'node:test';
import assert from 'node:assert/strict';
import { route, placeOf, pointOf, carFootprint, overlaps, OBSTACLES, SLOTS, BAY_Y, techRoute, techPoint, depthOrder } from '../public/scene.js';
import { Workshop } from '../server/simulation.mjs';

const places = [...Object.keys(BAY_Y).map(id => ({ kind: 'bay', id })), ...SLOTS.B2.map((_, index) => ({ kind: 'B2', index })), ...SLOTS.B3.map((_, index) => ({ kind: 'B3', index }))];
const moves = [];
for (const a of places) for (const b of places) {
  const ok = (a.kind === 'B2' && (b.kind === 'bay' || b.kind === 'B2')) || (a.kind === 'bay' && (b.kind === 'bay' || b.kind === 'B3')) || (a.kind === 'B3' && b.kind === 'B3');
  if (ok) moves.push([a, b]);
}
for (const b of places.filter(p => p.kind === 'B2')) moves.push([null, b]);
for (const a of places.filter(p => p.kind !== 'B2')) moves.push([a, null]);
function* samples(path) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k <= n; k++) yield { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, o: a.o === b.o ? a.o : k === n ? b.o : a.o };
  }
}

test('every vehicle path in the assembly scene avoids lift posts, benches, pump units, the rack and the gate posts', () => {
  for (const [a, b] of moves) {
    const path = route(a, b);
    assert.ok(path.length >= 1, `route ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    for (let i = 1; i < path.length; i++) if (path[i - 1].o !== path[i].o) assert.equal(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y), 0, 'cars turn only on the spot');
    for (const p of samples(path)) for (const o of OBSTACLES) assert.ok(!overlaps(carFootprint(p), o), `${JSON.stringify(a)} → ${JSON.stringify(b)} crosses ${o.name} at ${Math.round(p.x)},${Math.round(p.y)} (${p.o})`);
  }
});

test('technician walks through the aisle without crossing equipment', () => {
  for (const from of [null, 'A1', 'A2', 'A3']) for (const to of [null, 'A1', 'A2', 'A3']) {
    for (const p of samples(techRoute(from, to).map(q => ({ ...q, o: 'x' })))) for (const o of OBSTACLES) assert.ok(!overlaps({ x0: p.x - 5, x1: p.x + 5, y0: p.y - 5, y1: p.y + 5 }, o), `${from} → ${to} crosses ${o.name}`);
  }
  assert.deepEqual(techRoute('A2', 'A2'), [techPoint('A2')]);
});

test('scene places come from the server snapshot: every car in B2, on a lift or in B3 gets its own spot', () => {
  const w = new Workshop(); w.reset();
  for (let i = 0; i < 40; i++) {
    w.advance(5);
    const s = w.snapshot();
    const queues = { B2: s.stages.find(x => x.id === 'assembly').buffer.vehicleIds, B3: s.stages.find(x => x.id === 'quality').buffer.vehicleIds };
    const taken = new Set();
    for (const v of s.vehicles) {
      const place = placeOf(v, queues), l = v.location;
      const inside = !v.shipped && ((l.type === 'post' && BAY_Y[l.id] !== undefined) || (l.type === 'buffer' && (l.id === 'B2' || l.id === 'B3')));
      assert.equal(Boolean(place), inside, `${v.id} at ${JSON.stringify(l)}`);
      if (!place) continue;
      if (place.kind === 'bay') assert.equal(place.id, l.id);
      const key = JSON.stringify(pointOf(place));
      assert.ok(!taken.has(key), `${v.id} shares a spot`); taken.add(key);
    }
  }
});

test('depth order draws a car on a lift between the rear and the front lift posts', () => {
  const back = { name: 'back', fp: OBSTACLES.find(o => o.name === 'A2:стойка'), h: 76 };
  const front = { name: 'front', fp: OBSTACLES.find(o => o.name === 'A2:стойка и насос'), h: 76 };
  const car = { name: 'car', fp: carFootprint(pointOf({ kind: 'bay', id: 'A2' })), h: 60 };
  const order = depthOrder([front, car, back]).map(o => o.name);
  assert.ok(order.indexOf('back') < order.indexOf('car') && order.indexOf('car') < order.indexOf('front'), order.join(','));
});
