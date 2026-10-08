import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOP_LAYOUTS, ShopScene, geometry } from '../public/shop-scene.js';
import { POSTS, STAGES, REWORK, Workshop } from '../server/simulation.mjs';

const BUFFERS = new Set([...STAGES.map(s => s.buffer.id), REWORK.buffer.id]);
test('every shop layout uses real posts of its stage and real buffers of the engine', () => {
  for (const [id, L] of Object.entries(SHOP_LAYOUTS)) {
    assert.deepEqual(L.posts, POSTS.filter(p => p.stage === L.stage).map(p => p.id), `${id}: posts`);
    assert.ok(BUFFERS.has(L.input.buffer), `${id}: input ${L.input.buffer}`);
    for (const o of L.outputs) assert.ok(BUFFERS.has(o.buffer), `${id}: output ${o.buffer}`);
  }
});
test('places and routes: every vehicle of a shop gets a point on the floor and a path between places', () => {
  const w = new Workshop(); for (let i = 0; i < 3; i++) w.advance(60);
  const state = w.snapshot();
  for (const L of Object.values(SHOP_LAYOUTS)) {
    // Places, points and routes need no DOM: the scene is used without its SVG.
    const scene = Object.assign(Object.create(ShopScene.prototype), { L, G: geometry(L) });
    for (const v of state.vehicles) {
      const place = scene.placeOf(v, state); if (!place) continue;
      const pt = scene.pointOf(place);
      assert.ok(pt.x >= 0 && pt.x <= 640 && pt.y >= 0 && pt.y <= 480, `${L.stage}: ${v.id} on the floor`);
      assert.ok(scene.route(null, place).length >= 1 && scene.route(place, null).length >= 1);
    }
    for (const p of L.posts) for (let i = 0; i < L.input.slots; i++) assert.ok(scene.route({ kind: 'in', index: i }, { kind: 'post', id: p }).length >= 2);
  }
});
