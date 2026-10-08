import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { route, placeOf, pointOf, carFootprint, overlaps, OBSTACLES, SLOTS, BAY_Y, techRoute, techPoint, depthOrder, enterpriseCards, enterpriseSvg, SHOPS } from '../public/scene.js';
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

for (const equipmentProblem of [false, true]) test(`enterprise cards stay clear with all posts faulted${equipmentProblem ? ' and an equipment problem on the same assembly post' : ''}`, () => {
  const w = new Workshop({ warmup: 195, episode: equipmentProblem ? 'default' : false });
  for (const id of Object.keys(w.posts)) w.injectIncident(id, 'breakdown');
  const state = w.snapshot(), cards = enterpriseCards(state);
  assert.equal(cards.reduce((n, c) => n + c.problems.length, 0), state.posts.length + Number(equipmentProblem), 'all open problems remain on their shop cards');
  if (equipmentProblem) assert.equal(cards.find(c => c.space === 'assembly').problems.length, 4, 'equipment and manual problems on A2 both remain visible');
  const [vx, vy, vw, vh] = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
    .match(/id="enterprise"[^>]*viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const box = points => ({ x0: Math.min(...points.map(p => p.x)), x1: Math.max(...points.map(p => p.x)), y0: Math.min(...points.map(p => p.y)), y1: Math.max(...points.map(p => p.y)) });
  const project = (x, y, z = 0) => ({ x: 380 + .866 * (x - y), y: 100 + .5 * (x + y) - z });
  // Conservative envelopes include the 44-unit back walls, not just the floor.
  const shops = [...SHOPS.map(s => ({ name: s.space, x: s.x0, y: 0, w: s.w, h: 140 })), { name: 'rework', x: 670, y: 210, w: 140, h: 110 }]
    .map(s => ({ name: s.name, ...box([project(s.x, s.y, 44), project(s.x + s.w, s.y), project(s.x, s.y + s.h), project(s.x + s.w, s.y + s.h)]) }));
  // Read the actual route path so extending the drawn route is checked too.
  const tokens = enterpriseSvg(state).match(/<path d="([^"]+)" class="em-route"/)[1].match(/[MHV]|-?\d+(?:\.\d+)?/g);
  const routes = []; let x = 0, y = 0;
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++], before = project(x, y);
    if (command === 'M') { x = Number(tokens[i++]); y = Number(tokens[i++]); continue; }
    if (command === 'H') x = Number(tokens[i++]);
    else if (command === 'V') y = Number(tokens[i++]);
    else assert.fail(`unsupported route command ${command}`);
    const b = box([before, project(x, y)]);
    routes.push({ name: `route ${routes.length + 1}`, x0: b.x0 - 4, x1: b.x1 + 4, y0: b.y0 - 4, y1: b.y1 + 4 });
  }
  const bounds = cards.map(c => ({ name: c.space, x0: c.left, x1: c.left + c.width, y0: c.top, y1: c.top + c.height }));
  for (const [i, card] of bounds.entries()) {
    assert.ok(card.x0 >= vx && card.y0 >= vy && card.x1 <= vx + vw && card.y1 <= vy + vh, `${card.name} leaves the viewBox`);
    for (const other of [...bounds.slice(i + 1), ...shops, ...routes]) assert.ok(!overlaps(card, other), `${card.name} covers ${other.name}`);
  }
  assert.ok(bounds.filter(c => ['weld', 'paint', 'assembly'].includes(c.name)).every(c => c.y0 >= 410 && c.y1 <= vy + vh - 10), 'left cards retain the HUD clearance and bottom margin');
});
