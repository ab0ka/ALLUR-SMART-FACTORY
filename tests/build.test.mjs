import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDist, PUBLIC_ASSETS } from '../scripts/build.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('build keeps only allowlisted public assets and moves unexpected dist entries to quarantine without deleting them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-build-'));
  try {
    const publicDir = path.join(dir, 'public'), distDir = path.join(dir, 'dist'), quarantineRoot = path.join(dir, 'quarantine');
    await mkdir(publicDir); await mkdir(path.join(distDir, 'old'), { recursive: true });
    for (const file of PUBLIC_ASSETS) await copyFile(path.join(root, 'public', file), path.join(publicDir, file));
    await writeFile(path.join(distDir, '.env'), 'NVIDIA_API_KEY=placeholder-not-a-secret');
    await writeFile(path.join(distDir, 'old', 'server.mjs'), 'stale');
    const result = await buildDist({ publicDir, distDir, quarantineRoot, now: new Date('2026-10-08T12:00:00Z') });
    assert.deepEqual((await readdir(distDir)).sort(), [...PUBLIC_ASSETS].sort());
    assert.deepEqual(result.strays.sort(), ['.env', 'old']);
    assert.equal(await readFile(path.join(result.quarantineDir, '.env'), 'utf8'), 'NVIDIA_API_KEY=placeholder-not-a-secret');
    assert.equal(await readFile(path.join(result.quarantineDir, 'old', 'server.mjs'), 'utf8'), 'stale');
    const clean = await buildDist({ publicDir, distDir, quarantineRoot }); assert.deepEqual(clean.strays, []); assert.equal(clean.quarantineDir, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('build refuses client assets that look like an NVIDIA key', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-build-'));
  try {
    const publicDir = path.join(dir, 'public');
    await mkdir(publicDir);
    for (const file of PUBLIC_ASSETS) await copyFile(path.join(root, 'public', file), path.join(publicDir, file));
    await writeFile(path.join(publicDir, 'app.js'), `const k = 'nvapi-${'x'.repeat(24)}';`);
    await assert.rejects(buildDist({ publicDir, distDir: path.join(dir, 'dist'), quarantineRoot: path.join(dir, 'q') }), /Possible secret/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
