import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildDist, assembleApp, PUBLIC_ASSETS } from '../scripts/build.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Copies the real client sources (static assets plus the app.js parts) into a temporary public folder.
async function copyPublic(publicDir) {
  await mkdir(publicDir, { recursive: true });
  for (const file of PUBLIC_ASSETS.filter(f => f !== 'app.js')) await copyFile(path.join(root, 'public', file), path.join(publicDir, file));
  await cp(path.join(root, 'public', 'app'), path.join(publicDir, 'app'), { recursive: true });
}

test('build keeps only allowlisted public assets and moves unexpected dist entries to quarantine without deleting them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-build-'));
  try {
    const publicDir = path.join(dir, 'public'), distDir = path.join(dir, 'dist'), quarantineRoot = path.join(dir, 'quarantine');
    await copyPublic(publicDir); await mkdir(path.join(distDir, 'old'), { recursive: true });
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

test('client script is assembled from the numbered parts in public/app in name order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-build-'));
  try {
    const publicDir = path.join(dir, 'public');
    await copyPublic(publicDir);
    await writeFile(path.join(publicDir, 'app', 'notes.txt'), 'not a part');
    const { parts, code } = await assembleApp(publicDir);
    assert.equal(parts[0], '00-core.js'); assert.deepEqual(parts, [...parts].sort()); assert.ok(!parts.includes('notes.txt'));
    await buildDist({ publicDir, distDir: path.join(dir, 'dist'), quarantineRoot: path.join(dir, 'q') });
    assert.equal(await readFile(path.join(dir, 'dist', 'app.js'), 'utf8'), code);
    assert.match(code, /^\/\/ Allur client\./); assert.match(code, /await refresh\(\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const prefix of ['nvapi-', 'sk-proj-']) test(`build refuses client assets that look like a ${prefix} key`, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-build-'));
  try {
    const publicDir = path.join(dir, 'public');
    await copyPublic(publicDir);
    await writeFile(path.join(publicDir, 'app', '99-leak.js'), `const k = '${prefix}${'x'.repeat(24)}';`);
    await assert.rejects(buildDist({ publicDir, distDir: path.join(dir, 'dist'), quarantineRoot: path.join(dir, 'q') }), /Possible secret/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [name, first, second] of [
  ['a trailing line comment without a final newline', 'const steps = ["setup"]; // trailing comment', 'steps.push("startup");'],
  ['an expression without a semicolon before an IIFE', 'const steps = ["setup"]', '(function () { steps.push("startup"); })();'],
]) test(`client parts keep their boundaries with ${name}`, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-build-boundary-'));
  try {
    const appDir = path.join(dir, 'app');
    await mkdir(appDir);
    await writeFile(path.join(appDir, '00-setup.js'), first);
    await writeFile(path.join(appDir, '10-startup.js'), second + '\nglobalThis.result = steps;');
    const { code } = await assembleApp(dir), context = {};
    runInNewContext(code, context, { timeout: 1000 });
    assert.deepEqual(Array.from(context.result), ['setup', 'startup']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
