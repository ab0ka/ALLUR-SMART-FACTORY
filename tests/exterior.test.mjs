import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { Workshop } from '../server/simulation.mjs';

// The downloaded Sportage exterior is optional: only two fixed files are served from its folder, nothing else.
async function withApp(modelDir, fn) {
  const app = createApp({ simulation: new Workshop(), aiOptions: { provider: 'local' }, modelDir });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  try { await fn(`http://127.0.0.1:${app.address().port}`); } finally { await new Promise(r => { app.close(r); app.closeAllConnections(); }); }
}
test('exterior model: two fixed files are served, the rest of the folder is not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'allur-ext-'));
  writeFileSync(path.join(dir, 'scene.gltf'), '{"asset":{"version":"2.0"}}'); writeFileSync(path.join(dir, 'scene.bin'), Buffer.alloc(16)); writeFileSync(path.join(dir, 'license.txt'), 'CC BY 4.0');
  await withApp(dir, async base => {
    const g = await fetch(`${base}/models/kia-sportage/scene.gltf`);
    assert.equal(g.status, 200); assert.match(g.headers.get('content-type'), /gltf/);
    const b = await fetch(`${base}/models/kia-sportage/scene.bin`);
    assert.equal(b.status, 200); assert.equal((await b.arrayBuffer()).byteLength, 16);
    for (const p of ['/models/kia-sportage/license.txt', '/models/kia-sportage/../../.env', '/models/kia-sportage/textures/a.png', '/assets-src/kia-sportage/scene.gltf']) assert.equal((await fetch(base + p)).status, 404, p);
  });
});
test('exterior model missing: a clear 404, the app keeps working', async () => {
  await withApp(path.join(tmpdir(), 'allur-no-such-dir'), async base => {
    const r = await fetch(`${base}/models/kia-sportage/scene.gltf`);
    assert.equal(r.status, 404); assert.match((await r.json()).error, /assets-src/);
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
  });
});
