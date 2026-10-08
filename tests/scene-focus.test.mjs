import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyScene, enterpriseSvg } from '../public/scene.js';
import { Workshop } from '../server/simulation.mjs';

function* permutations(items) {
  if (!items.length) { yield []; return; }
  for (let i = 0; i < items.length; i++) for (const rest of permutations(items.filter((_, j) => i !== j))) yield [items[i], ...rest];
}

test('depth sorting preserves the focused node while ordering every sibling correctly', () => {
  const previous = globalThis.document;
  try {
    for (const order of permutations([0, 1, 2, 3, 4])) for (const active of [-1, 0, 1, 2, 3, 4]) {
      const nodes = Array.from({ length: 5 }, (_, id) => ({ id, contains(el) { return el === this; } }));
      const children = order.map(i => nodes[i]);
      globalThis.document = { activeElement: nodes[active] ?? null };
      for (const node of nodes) Object.defineProperty(node, 'nextSibling', { get: () => children[children.indexOf(node) + 1] ?? null });
      const objectsEl = { children, insertBefore(el, next) {
        assert.notEqual(el, document.activeElement, 'detaching the active node would blur it in the browser');
        children.splice(children.indexOf(el), 1);
        children.splice(next === null ? children.length : children.indexOf(next), 0, el);
      } };
      AssemblyScene.prototype.sortObjects.call({ objectsEl,
        statics: nodes.slice(0, 4).map((el, i) => ({ el, fp: { x0: i * 200, x1: i * 200 + 20, y0: 0, y1: 20 }, h: 30 })),
        tech: { el: nodes[4], pos: { x: 810, y: 10 } }, cars: new Map(),
      });
      assert.deepEqual(children.map(el => el.id), [0, 1, 2, 3, 4]);
    }
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('scene objects have distinct focus identities and expose diagnostic status', () => {
  const snapshot = new Workshop({ warmup: 195 }).snapshot();
  const map = enterpriseSvg(snapshot);
  for (const post of snapshot.posts) assert.ok(map.includes(`data-focus-key="enterprise-post-${post.id}"`));
  assert.match(map, /aria-label="СБ-2: Темп снижен/);
  const scene = Object.create(AssemblyScene.prototype);
  scene.overlay = { innerHTML: '' }; scene.cars = new Map(); scene.positionTag = () => {};
  scene.renderOverlay(snapshot, { diag: true });
  const keys = [...scene.overlay.innerHTML.matchAll(/data-focus-key="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(keys).size, keys.length);
  assert.match(scene.overlay.innerHTML, /aria-label="[^"]*Отклонение подъёмника/);
});
