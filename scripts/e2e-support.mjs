import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await sleep(50); } while (Date.now() < end);
  throw new Error(`Таймаут: ${label}`);
}
export async function findBrowser(env = process.env) {
  const candidates = env.BROWSER_PATH ? [env.BROWSER_PATH] : [
    path.join(env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env.PROGRAMFILES || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    ...(env.LOCALAPPDATA ? ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'].map(p => path.join(env.LOCALAPPDATA, p)) : [])
  ];
  for (const candidate of candidates) { try { await access(candidate); return path.resolve(candidate); } catch {} }
  return null;
}
export async function listenLocal(server, first = 3040) {
  for (let port = first; port < first + 100 && port <= 65535; port++) {
    try {
      await new Promise((resolve, reject) => {
        const error = e => { server.off('listening', ready); reject(e); };
        const ready = () => { server.off('error', error); resolve(); };
        server.once('error', error); server.once('listening', ready); server.listen(port, '127.0.0.1');
      });
      return port;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('Нет свободного локального порта для e2e');
}
export async function stopChild(child) {
  if (!child) return;
  const stopped = () => {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    if (!child.pid) return Boolean(child.launchError);
    try { process.kill(child.pid, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  };
  const waitExit = async timeout => {
    const end = Date.now() + timeout;
    while (!stopped() && Date.now() < end) await sleep(50);
    return stopped();
  };
  if (await waitExit(1500)) return;
  child.kill();
  if (await waitExit(5000)) return;
  child.kill('SIGKILL');
  if (!await waitExit(10000)) throw new Error(`Собственный браузер PID ${child.pid} не завершился (${child.launchError?.code || 'no exit event'})`);
}
export async function withOwnedRun(dataRoot, action) {
  await mkdir(dataRoot, { recursive: true });
  const owned = await mkdtemp(path.join(dataRoot, 'e2e-'));
  const cleanups = [];
  let failure;
  try { return await action({ owned, defer: fn => cleanups.push(fn) }); }
  catch (error) { failure = error; throw error; }
  finally {
    const errors = [];
    for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch (error) { errors.push(error); } }
    // Only the exclusively allocated child directory is removed, never an existing e2e.json.
    try { await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); } catch (error) { errors.push(error); }
    if (errors.length) { if (failure) console.error('Ошибка cleanup:', errors.map(e => e.message).join('; ')); else throw new AggregateError(errors, `Ошибка cleanup e2e: ${errors.map(e => e.message).join('; ')}`); }
  }
}
export function launchBrowser(browserPath, profile) {
  const child = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  // Store spawn errors immediately; no unhandled EventEmitter error while waiting for DevTools.
  child.on('error', error => { child.launchError = error; });
  return child;
}
export async function devToolsPort(child, profile, timeout = 15000) {
  return until(async () => {
    if (child.launchError) throw new Error(`Не удалось запустить браузер: ${child.launchError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Браузер завершился до запуска CDP');
    try { const port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return Number.isInteger(port) && port > 0 ? port : false; } catch { return false; }
  }, 'браузер не открыл CDP', timeout);
}
export class CDP {
  constructor(socket, timeout = 15000) {
    this.socket = socket; this.timeout = timeout; this.nextId = 0; this.pending = new Map(); this.listeners = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const item = this.pending.get(message.id);
      if (item) { clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
      else if (message.method) for (const listener of this.listeners) listener(message.method, message.params);
    });
    for (const type of ['close', 'error']) socket.addEventListener(type, () => this.rejectAll(new Error('CDP соединение закрыто')));
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Таймаут подключения CDP')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Не удалось подключить CDP')); }, { once: true });
    });
    return new CDP(socket);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Таймаут CDP: ${method}`)); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  rejectAll(error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  close() { this.rejectAll(new Error('CDP закрыт')); this.socket.close(); }
}
