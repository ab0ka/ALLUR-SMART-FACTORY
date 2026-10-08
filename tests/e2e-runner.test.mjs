import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createApp } from '../server/index.mjs';
import { CDP, findBrowser, withOwnedRun, listenLocal, stopChild, launchBrowser, devToolsPort } from '../scripts/e2e-support.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class Socket extends EventTarget {
  send(text) { this.sent = JSON.parse(text); }
  reply(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close() { this.dispatchEvent(new Event('close')); }
}
test('CDP rejects protocol errors, early connection loss and timeout without abandoned requests', async () => {
  const socket = new Socket(), cdp = new CDP(socket, 30);
  const failed = cdp.send('Runtime.evaluate');
  socket.reply({ id: socket.sent.id, error: { message: 'injected protocol failure' } });
  await assert.rejects(failed, /injected protocol failure/);
  const disconnected = cdp.send('Page.navigate'); socket.close();
  await assert.rejects(disconnected, /соединение закрыто/);
  await assert.rejects(cdp.send('No.reply'), /Таймаут CDP: No.reply/);
  assert.equal(cdp.pending.size, 0);
});
test('missing browser skips the CLI successfully and explicit path overrides installed browsers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-e2e-skip-'));
  const missing = path.join(dir, 'missing-browser.exe');
  assert.equal(await findBrowser({ BROWSER_PATH: missing }), null);
  const output = execFileSync(process.execPath, ['scripts/e2e-ui.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, BROWSER_PATH: missing }, windowsHide: true });
  assert.match(output, /пропущено: браузер не найден/);
  assert.doesNotMatch(output, /Build OK/);
});
test('failed browser launch and absent DevTools are bounded and explained', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-e2e-launch-'));
  const child = launchBrowser(path.join(dir, 'does-not-exist'), path.join(dir, 'profile'));
  await assert.rejects(devToolsPort(child, dir, 1000), /Не удалось запустить браузер|Браузер завершился/);
  await assert.rejects(devToolsPort({ exitCode: null, signalCode: null }, dir, 60), /браузер не открыл CDP/);
});
test('intermediate assertion failure closes owned server/process and preserves pre-existing e2e.json', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-e2e-owned-'));
  await writeFile(path.join(dir, 'e2e.json'), 'existing user state');
  let owned, app, child, port;
  await assert.rejects(withOwnedRun(dir, async run => {
    owned = run.owned;
    app = createApp({ aiOptions: { provider: 'local' }, storePath: path.join(owned, 'e2e.json') });
    run.defer(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
    port = await listenLocal(app);
    child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
    run.defer(() => stopChild(child));
    run.defer(() => { throw new Error('injected CDP cleanup failure'); });
    assert.fail('injected intermediate assertion');
  }), /injected intermediate assertion/);
  assert.equal(app.listening, false);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await assert.rejects(access(owned), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(dir, 'e2e.json'), 'utf8'), 'existing user state');
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
});
test('occupied port is skipped without closing its owner', async () => {
  const owner = net.createServer();
  await new Promise(resolve => owner.listen(0, '127.0.0.1', resolve));
  const candidate = net.createServer();
  try {
    const first = owner.address().port;
    const selected = await listenLocal(candidate, first);
    assert.notEqual(selected, first); assert.ok(owner.listening);
  } finally { await Promise.all([new Promise(r=>owner.close(r)), new Promise(r=>candidate.close(r))]); }
});
test('concurrent runs allocate disjoint directories and clean only their own files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'allur-e2e-isolation-'));
  const names = [];
  await Promise.all([1,2].map(i => withOwnedRun(dir, async ({owned}) => {
    names.push(owned); await writeFile(path.join(owned,'e2e.json'), String(i));
    assert.equal(await readFile(path.join(owned,'e2e.json'),'utf8'), String(i));
  })));
  assert.notEqual(names[0], names[1]); assert.deepEqual(await readdir(dir), []);
});

test('cleanup accepts an already absent owned PID even if its exit notification is delayed', async () => {
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  await stopChild({ pid: child.pid, exitCode: null, signalCode: null, kill() { assert.fail('Must not signal a process already absent from the OS'); } });
});
