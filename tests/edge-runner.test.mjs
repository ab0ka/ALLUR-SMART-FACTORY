import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 3033;
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}
function run(module, artifacts, preload) {
  return new Promise((resolve, reject) => {
    const args = [...(preload ? ['--import', pathToFileURL(preload).href] : []), 'scripts/edge-scenario.mjs'];
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true,
      env: { ...process.env, PLAYWRIGHT_MODULE: module, EDGE_PORT: String(port), EDGE_ARTIFACT_DIR: artifacts } });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Runner did not exit: ${output}`)); }, 15000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test('Edge runner failure paths close owned resources and preserve other evidence', async () => {
  await freePort(); // Never run against an occupied demo port.
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-edge-failures-'));
  const artifacts = path.join(dir, 'artifacts');
  const missing = await run(path.join(dir, 'missing.mjs'), artifacts);
  assert.notEqual(missing.code, 0);
  assert.match(missing.output, /Cannot load Playwright.*PLAYWRIGHT_MODULE/);
  await freePort();

  const noEdge = path.join(dir, 'no-edge.mjs');
  const frozen = path.join(dir, 'frozen.mjs');
  await writeFile(noEdge, "export const chromium = { launch: async () => { throw new Error('injected unavailable Edge'); } };\n");
  await writeFile(frozen, 'Date.now = () => 1234567890042;\n');
  const existing = path.join(artifacts, 'edge-1234567890042');
  await mkdir(existing, { recursive: true });
  await writeFile(path.join(existing, 'state.json'), 'previous evidence');
  for (let i = 0; i < 2; i++) {
    const result = await run(noEdge, artifacts, frozen);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Cannot start Microsoft Edge/);
    await freePort();
  }
  assert.equal(await readFile(path.join(existing, 'state.json'), 'utf8'), 'previous evidence');
  assert.equal((await readdir(artifacts)).length, 3, 'Every run receives a new evidence folder');

  const mock = path.join(dir, 'intermediate-failure.mjs');
  const closed = path.join(dir, 'closed.txt');
  await writeFile(mock, `
    import { writeFile } from 'node:fs/promises';
    export const chromium = { launch: async () => ({
      close: async () => writeFile(${JSON.stringify(closed)}, 'closed'),
      newPage: async () => ({
        setDefaultTimeout() {}, on() {}, goto: async () => {},
        request: { get: async () => ({ status: () => 200, json: async () => ({ running: false, jobs: [], problems: [] }) }) },
        locator: selector => ({ waitFor: async () => {}, click: async () => {
          if (selector === '#step-menu') { await new Promise(r => setTimeout(r, 100)); throw new Error('injected click failure'); }
        } }),
        waitForResponse: () => Promise.reject(new Error('injected response timeout')),
        screenshot: async ({ path }) => writeFile(path, 'failure evidence')
      })
    }) };
  `);
  const before = new Set(await readdir(artifacts));
  const failed = await run(mock, artifacts);
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /Edge scenario FAILED; evidence:/);
  assert.match(failed.output, /injected response timeout/);
  assert.equal(await readFile(closed, 'utf8'), 'closed', 'Browser cleanup must run before child exits');
  const created = (await readdir(artifacts)).filter(name => !before.has(name));
  assert.equal(created.length, 1);
  assert.equal(await readFile(path.join(artifacts, created[0], 'failure.png'), 'utf8'), 'failure evidence');
  await freePort();
});
