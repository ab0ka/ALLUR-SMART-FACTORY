// Print presentation/slides.html to presentation/slides.pdf with headless Microsoft Edge (no dependencies).
// Usage: node presentation/tools/print-pdf.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!EDGE) throw new Error('Microsoft Edge не найден');
const profile = mkdtempSync(path.join(tmpdir(), 'pres-edge-'));
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
try {
  let port = null;
  for (let i = 0; i < 100 && !port; i++) { await new Promise(r => setTimeout(r, 150)); try { port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch {} }
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let id = 0; const wait = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const n = ++id; wait.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(path.join(dir, 'slides.html')).href });
  await new Promise(r => setTimeout(r, 1500));
  const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  writeFileSync(path.join(dir, 'slides.pdf'), Buffer.from(r.result.data, 'base64'));
  console.log('presentation/slides.pdf готов');
  ws.close();
} finally { edge.kill(); await new Promise(r => setTimeout(r, 400)); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
