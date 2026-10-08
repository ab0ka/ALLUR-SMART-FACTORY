// Screenshots of the running MVP for the slides (headless Microsoft Edge, no dependencies).
// Usage: node presentation/tools/screenshots.mjs [http://127.0.0.1:3028]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'img');
const base = process.argv[2] ?? 'http://127.0.0.1:3028';
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync(dir, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'pres-shot-'));
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let port = null;
  for (let i = 0; i < 100 && !port; i++) { await sleep(150); try { port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch {} }
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let id = 0; const wait = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const n = ++id; wait.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/#space/assembly` }); await sleep(2500);
  const shot = async (name, hash, prep = '', delay = 1500) => {
    await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(900);
    if (prep) { await js(prep); }
    await sleep(delay);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(dir, `${name}.png`), Buffer.from(r.result.data, 'base64'));
    console.log(`  img/${name}.png`);
  };
  await shot('1-shop', 'space/assembly', `for (let i = 0; i < 2; i++) { document.querySelector('[data-cam="in"]')?.click(); await new Promise(r => setTimeout(r, 200)); } true`);
  await shot('2-tasks', 'dispatcher');
  await shot('3-car3d', 'vehicles/car3d/DEMO-005', `for (let i = 0; i < 40 && document.querySelector('#c3-hood')?.disabled; i++) await new Promise(r => setTimeout(r, 250)); document.querySelector('[data-c3view="hood"]')?.click(); true`, 3500);
  await shot('4-analytics', 'lab', `await new Promise(r => setTimeout(r, 800)); [...document.querySelectorAll('#lab .panel')].find(p => p.innerText.includes('Смена без системы'))?.scrollIntoView({ block: 'start' }); true`);
  ws.close();
} finally { edge.kill(); await sleep(400); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
