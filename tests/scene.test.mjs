import test from 'node:test';
import assert from 'node:assert/strict';
import { route, placeOf, pointOf, carFootprint, overlaps, OBSTACLES, SLOTS, BAY_Y, techRoute, techPoint, depthOrder, iso, labelLayout, plateHeight, PLATE_W, VIEW } from '../public/scene.js';
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

// ---------- Plates and chips ----------
const hull = ([x0, x1, y0, y1, z0, z1]) => [x0, x1].flatMap(x => [y0, y1].flatMap(y => [z0, z1].map(z => iso(x, y, z))));
function rectHitsHull(r, pts) { // r: screen rect; pts: silhouette of an iso box (edges along these four axes)
  const R = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
  return [[1, 0], [0, 1], [.5, .866], [.5, -.866]].every(([ax, ay]) => {
    const a = R.map(p => p[0] * ax + p[1] * ay), b = pts.map(p => p[0] * ax + p[1] * ay);
    return Math.max(...a) > Math.min(...b) && Math.max(...b) > Math.min(...a);
  });
}
function* carSilhouettes() { // every 4 units of every path, skipping the faded ends of entries and exits
  for (const [a, b] of moves) {
    const path = route(a, b);
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1], q = path[i], n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 4));
      for (let k = 0; k <= n; k++) {
        const t = k / n, op = q.fade === 'out' ? 1 - t : p.fade === 'in' ? t : 1;
        if (op < .5) continue;
        const pos = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, o: k === n ? q.o : p.o }, z = (p.z ?? 0) + ((q.z ?? 0) - (p.z ?? 0)) * t, fp = carFootprint(pos);
        yield { at: `${JSON.stringify(a)} → ${JSON.stringify(b)} at ${Math.round(pos.x)},${Math.round(pos.y)}`, pts: hull([fp.x0, fp.x1, fp.y0, fp.y1, z, z + 44]) };
      }
    }
  }
  for (const from of [null, 'A1', 'A2', 'A3']) for (const to of [null, 'A1', 'A2', 'A3']) for (const p of techRoute(from, to)) yield { at: `technician at ${p.x},${p.y}`, pts: hull([p.x - 11, p.x + 11, p.y - 11, p.y + 11, 0, 58]) };
}
// Page controls over the scene, in scene units, measured at 1280 px with the card open (the tightest case)
// and the hint shown without a card.
const PAGE = [{ name: 'shop card and view switches', x: 0, y: 0, w: 370, h: 312 }, { name: 'camera buttons', x: 925, y: 0, w: 75, h: 160 }, { name: 'hint', x: 290, y: 0, w: 420, h: 58 }];

test('plates and chips cover no car, no queue place, no technician, no page control and no other label', () => {
  const sil = [...carSilhouettes()];
  for (const k of [1, 1.05, 1.1, 1.15, 1.2]) for (const sub of [false, true]) for (const diag of [false, true]) {
    const h = plateHeight(sub, diag), L = labelLayout(k, { A1: h, A2: h, A3: h });
    const rects = [...Object.entries(L.plates).map(([id, p]) => ({ name: id, x: p.x, y: p.y, w: PLATE_W * k, h: h * k })), ...Object.entries(L.chips).map(([id, c]) => ({ name: id, x: c.x, y: c.y, w: c.w * k, h: c.h * k }))];
    const where = `k=${k}${sub ? ' with sub' : ''}${diag ? ' with diagnostics' : ''}`;
    for (const r of rects) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW.w && r.y + r.h <= VIEW.h, `${r.name} leaves the scene (${where})`);
      for (const c of sil) assert.ok(!rectHitsHull(r, c.pts), `${r.name} covers ${c.at} (${where})`);
      for (const o of [...PAGE, ...rects]) if (o !== r) assert.ok(r.x + r.w <= o.x || o.x + o.w <= r.x || r.y + r.h <= o.y || o.y + o.h <= r.y, `${r.name} overlaps ${o.name} (${where})`);
    }
  }
});
