import test from 'node:test';
import assert from 'node:assert/strict';
import { route, placeOf, pointOf, carFootprint, overlaps, OBSTACLES, SLOTS, BAY_Y, techRoute, techPoint, depthOrder, iso, LIFT_ARMS } from '../public/scene.js';
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

// Scene objects as drawn: footprint for sorting plus the real 3D boxes [x0, x1, y0, y1, z0, z1] of their parts.
const box = (fp, z0, z1) => [fp.x0, fp.x1, fp.y0, fp.y1, z0, z1];
const STATICS = [
  ...OBSTACLES.map(o => ({ name: o.name, fp: o, h: /верстак/.test(o.name) ? 40 : /стеллаж/.test(o.name) ? 56 : /ворота/.test(o.name) ? 74 : 76 })).map(s => ({ ...s, parts: [box(s.fp, 0, s.h)] })),
  ...LIFT_ARMS.map(a => ({ ...a, parts: [box(a.fp, 14, 20)] })),
];
const hull = ([x0, x1, y0, y1, z0, z1]) => [x0, x1].flatMap(x => [y0, y1].flatMap(y => [z0, z1].map(z => iso(x, y, z))));
function screenOverlap(a, b) { // convex silhouettes of two iso boxes; their edges run along these four screen axes
  const A = hull(a), B = hull(b);
  return [[1, 0], [0, 1], [.5, .866], [.5, -.866]].every(([ax, ay]) => {
    const pa = A.map(p => p[0] * ax + p[1] * ay), pb = B.map(p => p[0] * ax + p[1] * ay);
    return Math.max(...pa) > Math.min(...pb) + .5 && Math.max(...pb) > Math.min(...pa) + .5;
  });
}
function truth(a, b) { // -1: a is behind b, 1: b is behind a, 0: the boxes intersect
  for (const [lo, hi] of [[0, 1], [2, 3], [4, 5]]) { if (a[hi] <= b[lo]) return -1; if (b[hi] <= a[lo]) return 1; }
  return 0;
}
function* motion() { // every 2 units of every car path, with the lift height interpolated as the scene does
  for (const [a, b] of moves) {
    const path = route(a, b);
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1], q = path[i], n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 2));
      for (let k = 0; k <= n; k++) yield { x: p.x + (q.x - p.x) * k / n, y: p.y + (q.y - p.y) * k / n, z: (p.z ?? 0) + ((q.z ?? 0) - (p.z ?? 0)) * k / n, o: k === n ? q.o : p.o };
    }
  }
}

test('moving cars and equipment are painted in their real 3D order; lift arms stay under the car', () => {
  let checked = 0;
  for (const pos of motion()) {
    const fp = carFootprint(pos), carBox = box(fp, pos.z, pos.z + 44), car = { name: 'car', fp, h: 60 };
    const order = depthOrder([...STATICS, car]), ci = order.indexOf(car);
    for (const s of STATICS) for (const part of s.parts) {
      if (!screenOverlap(carBox, part)) continue;
      const t = truth(part, carBox), drawnFirst = order.indexOf(s) < ci;
      if (s.low && overlaps(fp, s.fp)) assert.ok(drawnFirst, `${s.name} painted over the car at ${Math.round(pos.x)},${Math.round(pos.y)} z${pos.z.toFixed(1)}`);
      else if (t) assert.equal(drawnFirst, t < 0, `${s.name} vs car at ${Math.round(pos.x)},${Math.round(pos.y)} z${pos.z.toFixed(1)} (${pos.o})`);
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('found case: a car leaving lift СБ-1 towards B3 is painted over the front lift arm', () => {
  const pos = { x: 372, y: BAY_Y.A1 + 25, z: 7, o: 'x' }, car = { name: 'car', fp: carFootprint(pos), h: 60 };
  const arm = LIFT_ARMS.find(a => a.name === 'A1:передняя лапа'), post = { name: 'post', fp: OBSTACLES.find(o => o.name === 'A1:стойка и насос'), h: 76 };
  const order = depthOrder([post, car, arm]).map(o => o.name);
  assert.deepEqual(order.indexOf(arm.name) < order.indexOf('car'), true, order.join(','));
});

test('overlapping footprints: the object nearer to the viewer is painted on top', () => {
  const tech = { name: 'tech', fp: { x0: 180, x1: 190, y0: 300, y1: 310 }, h: 40 }, car = { name: 'car', fp: carFootprint({ x: 185, y: 260, o: 'y' }), h: 60 };
  assert.deepEqual(depthOrder([tech, car]).map(o => o.name), ['car', 'tech']);
  assert.deepEqual(depthOrder([{ ...tech, fp: { ...tech.fp, y0: 220, y1: 230 } }, car]).map(o => o.name), ['tech', 'car']);
});
