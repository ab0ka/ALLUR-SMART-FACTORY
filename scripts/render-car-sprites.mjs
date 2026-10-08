// Isometric sprites of the "Kia Sportage" model (karaman.arman, Sketchfab, CC BY 4.0) for the shop scene.
// The scene is SVG in a 2:1 isometric projection; the 3D model is rendered once with an orthographic camera in the
// same projection, in the three synthetic model colours, as a finished car and as an unfinished body (no wheels,
// no glass). Output: public/car-kia-<a|b|c>-<done|body>.webp and the frame printed for public/scene.js (CAR_SPRITE).
// Needs: assets-src/kia-sportage (the downloaded model), npm.cmd run build, Microsoft Edge. Usage: npm.cmd run sprites
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';
import { Workshop } from '../server/simulation.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SPRITE_COLORS = { a: 0xf1f3f5, b: 0x7db3e8, c: 0xd9c59c }; // same as the 3D view and .sc-model-*
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

// Runs inside the page (same origin as the app): imports the vendored three.js and the model loader.
const PAGE = `(async () => {
  const T = await import(location.origin + '/three.module.js'), V = await import(location.origin + '/viewer3d.js');
  const R = 3, LENGTH = 110; // SVG units of the old car footprint (110 × 50); R pixels per SVG unit
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(1);
  const env = new T.Scene(), pm = new T.PMREMGenerator(renderer);
  env.add(new T.Mesh(new T.SphereGeometry(10, 24, 12), new T.MeshBasicMaterial({ color: 0x9aa6b2, side: T.BackSide })));
  for (const [x, y, z, c] of [[0, 8, 0, 0xffffff], [6, 3, 4, 0xf4f7fa], [-6, 2, -3, 0xdfe6ee]]) { const p = new T.Mesh(new T.PlaneGeometry(6, 3), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); p.position.set(x, y, z); p.lookAt(0, 0, 0); env.add(p); }
  const envTex = pm.fromScene(env, 0.04).texture;
  const k = 1.2247; // the SVG iso projection is the true isometric one scaled by sqrt(1.5)
  const proj = p => ({ u: (p.x - p.z) / Math.SQRT2, v: (-(p.x + p.z) + 2 * p.y) / Math.sqrt(6) });
  const out = { images: {} };
  let frame = null;
  for (const [key, color] of Object.entries(${JSON.stringify(SPRITE_COLORS)})) {
    const car = await V.loadExterior(envTex, color);
    const s = LENGTH / 4.55; car.scale.multiplyScalar(s); car.position.multiplyScalar(s); car.position.x += 55; car.position.z += 25;
    const scene = new T.Scene(); scene.add(car);
    scene.add(new T.HemisphereLight(0xffffff, 0xb9c4cf, 2.2));
    const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 7, 5); scene.add(sun);
    const fill = new T.DirectionalLight(0xffffff, 0.6); fill.position.set(-5, 3, -4); scene.add(fill);
    car.updateMatrixWorld(true);
    if (!frame) {
      const b = new T.Box3().setFromObject(car), pts = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(proj(new T.Vector3(x, y, z)));
      const pad = 2 / k, u0 = Math.min(...pts.map(p => p.u)) - pad, u1 = Math.max(...pts.map(p => p.u)) + pad, v0 = Math.min(...pts.map(p => p.v)) - pad, v1 = Math.max(...pts.map(p => p.v)) + pad;
      frame = { u0, u1, v0, v1, x: Math.round(u0 * k * 100) / 100, y: Math.round(-v1 * k * 100) / 100, w: Math.round((u1 - u0) * k * 100) / 100, h: Math.round((v1 - v0) * k * 100) / 100, box: [b.min.toArray(), b.max.toArray()].map(a => a.map(n => Math.round(n * 10) / 10)) };
      renderer.setSize(Math.round(frame.w * R), Math.round(frame.h * R), false);
    }
    const cam = new T.OrthographicCamera(frame.u0, frame.u1, frame.v1, frame.v0, 1, 2000);
    cam.position.set(400, 400, 400); cam.lookAt(0, 0, 0);
    for (const state of ['done', 'body']) {
      car.traverse(o => { if (o.isMesh) o.visible = state === 'done' || !/tread|rim|brake|Windows|LightsGlass|mirror/i.test(o.material.name); });
      renderer.render(scene, cam);
      out.images[key + '-' + state] = renderer.domElement.toDataURL('image/webp', 0.9);
    }
  }
  out.frame = { x: frame.x, y: frame.y, w: frame.w, h: frame.h, box: frame.box };
  return JSON.stringify(out);
})()`;

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); await once(ws, 'open');
  let id = 0; const wait = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  return { send: (method, params = {}) => new Promise(res => { const n = ++id; wait.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); }), close: () => ws.close() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!EDGE) throw new Error('Microsoft Edge не найден');
  if (!existsSync(path.join(root, 'assets-src', 'kia-sportage', 'scene.gltf'))) throw new Error('Нет assets-src/kia-sportage: распакуйте kia_sportage.zip');
  const app = createApp({ simulation: new Workshop(), aiOptions: { provider: 'local' } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const url = `http://127.0.0.1:${app.address().port}/`;
  const profile = mkdtempSync(path.join(tmpdir(), 'allur-edge-'));
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--disable-extensions', url], { stdio: 'ignore' });
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) { await new Promise(r => setTimeout(r, 150)); try { port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch {} }
    if (!port) throw new Error('Edge не открыл порт отладки');
    let target = null;
    for (let i = 0; i < 50 && !target; i++) { await new Promise(r => setTimeout(r, 200)); target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); }
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, 800));
    for (let i = 0; i < 50; i++) { const r = await c.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }); if (r.result?.result?.value === 'complete') break; await new Promise(r => setTimeout(r, 200)); }
    const r = await c.send('Runtime.evaluate', { expression: PAGE, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'ошибка рендера');
    const out = JSON.parse(r.result.result.value);
    for (const [name, data] of Object.entries(out.images)) {
      const file = path.join(root, 'public', `car-kia-${name}.webp`);
      writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      console.log(`  ${path.relative(root, file)} — ${Math.round(Buffer.byteLength(data.split(',')[1], 'base64') / 1024)} КБ`);
    }
    console.log('CAR_SPRITE для public/scene.js:', JSON.stringify(out.frame));
    c.close();
  } finally {
    edge.kill(); app.close(); app.closeAllConnections();
    await new Promise(r => setTimeout(r, 500)); try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
