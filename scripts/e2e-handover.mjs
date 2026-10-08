import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
export function checkViewport(geometry, width) {
  assert.ok(geometry.innerWidth <= width + 1 && geometry.scrollWidth <= width + 1, `overflow at ${width}: ${JSON.stringify(geometry)}`);
}
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else cell += c;
  }
  assert.equal(quoted, false, 'CSV has unmatched quote');
  if (cell || row.length) rows.push([...row, cell.replace(/\r$/, '')]);
  return rows;
}
export function checkReport(report, snapshot) {
  assert.equal(report.schemaVersion, 1); assert.equal(report.synthetic, true);
  for (const key of ['revision', 'elapsed', 'shift', 'shiftStart', 'finished']) assert.deepEqual(report[key], snapshot[key], key);
  for (const [key, expected] of Object.entries({ planTarget: snapshot.plan.target, referenceTotal: snapshot.plan.reference?.total ?? null,
    forecast: snapshot.forecast.projected, forecastLow: snapshot.forecast.low, forecastHigh: snapshot.forecast.high,
    accepted: snapshot.totals.accepted, shipped: snapshot.totals.shipped, wip: snapshot.totals.wip, firstPassYield: snapshot.quality.firstPassYield })) {
    assert.deepEqual(report.metrics[key], expected ?? null, `metrics.${key}`);
  }
  const ids = values => values.map(value => value.id).sort();
  for (const [key, expected] of Object.entries({ problems: snapshot.problems.filter(p => ['open', 'unresolved'].includes(p.status)),
    jobs: snapshot.jobs.filter(j => ['queued', 'running'].includes(j.status)), tasks: snapshot.tasks,
    orders: snapshot.orders.filter(o => o.state !== 'completed') })) {
    assert.deepEqual(ids(report[key]), ids(expected), key); assert.equal(report.counts[key], expected.length, `counts.${key}`);
  }
  for (const key of ['technicians', 'stock']) assert.deepEqual(ids(report.resources[key]), ids(snapshot[key]), key);
  assert.deepEqual(ids(report.resources.heldPosts), [...snapshot.holds].sort(), 'held posts');
  for (const technician of report.resources.technicians) assert.equal(technician.jobId, snapshot.technicians.find(t => t.id === technician.id).jobId);
  for (const stock of report.resources.stock) {
    const expected = snapshot.stock.find(s => s.id === stock.id);
    for (const key of ['onHand', 'reserved', 'available']) assert.equal(stock[key], expected[key], `stock.${stock.id}.${key}`);
  }
  assert.deepEqual(report.events.map(e => [e.id, e.kind]), snapshot.events.slice(-20).map(e => [e.seq, e.type]));
  for (const key of ['csrf', 'chat', 'health', 'serialize']) assert.ok(!Object.hasOwn(report, key), `private field ${key}`);
}

class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) { const p = this.pending.get(message.id); if (!p) return; clearTimeout(p.timer); this.pending.delete(message.id);
        message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
      else for (const handler of this.listeners.get(message.method) || []) handler(message.params);
    });
  }
  on(event, handler) { this.listeners.set(event, [...(this.listeners.get(event) || []), handler]); }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value;
  }
  close() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); } this.pending.clear(); this.socket.close(); }
}

export async function main() {
  const port = Number(process.env.HANDOVER_PORT || 3054);
  assert.ok(Number.isInteger(port) && port >= 3054 && port <= 65535, 'HANDOVER_PORT must be 3054..65535');
  const browser = process.env.HANDOVER_BROWSER || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
  ].find(existsSync);
  if (!browser || !existsSync(browser)) { console.log('SKIP: Edge is unavailable. Set HANDOVER_BROWSER to an installed Edge executable.'); return; }
  process.env.AI_PROVIDER = 'local';
  const { buildDist } = await import('./build.mjs');
  const { createApp } = await import('../server/index.mjs');
  const { Workshop } = await import('../server/simulation.mjs');
  await buildDist();
  const outputRoot = path.join(root, 'screenshots', 'handover');
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(path.join(outputRoot, 'run-'));
  console.log(`Artifacts: ${output}`);
  const sim = new Workshop(); sim.running = false;
  // Only this fresh synthetic simulation is changed; no saved production state is loaded.
  sim.command({ action: 'fault', postId: 'A1', kind: 'breakdown', requestId: 'handover-fault' }, 'operator');
  sim.command({ action: 'job', postId: 'A1', kind: 'repair_generic', requestId: 'handover-job' }, 'operator');
  sim.advance(15);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'allur-handover-'));
  const server = createApp({ simulation: sim, aiOptions: { provider: 'local' }, storePath: path.join(profile, 'synthetic-state.json') });
  let child, cdp, failure;
  const deadline = setTimeout(() => {
    console.error('FAIL: overall E2E deadline'); process.exitCode = 1;
    cdp?.close();
    try { child?.kill(); } catch (error) { console.error(`Deadline browser stop failed: ${error.message}`); }
    server.closeAllConnections(); server.close();
  }, 180000);
  const base = `http://127.0.0.1:${port}`;
  const get = url => fetch(base + url, { signal: AbortSignal.timeout(10000) });
  try {
    server.listen(port, '127.0.0.1'); await once(server, 'listening');
    const before = sim.snapshot();
    const response = await get('/api/handover'); assert.equal(response.status, 200, 'handover endpoint must be integrated');
    const report = await response.json(); checkReport(report, before);
    assert.ok(report.problems.length > 0 && report.jobs.length > 0, 'fixture exercises both problems and active jobs');
    checkReport(report, await (await get('/api/state')).json());
    assert.deepEqual(report, await (await get('/api/handover')).json(), 'deterministic report');
    const json = await get('/api/handover?format=json');
    assert.match(json.headers.get('content-type'), /application\/json/i);
    assert.match(json.headers.get('content-disposition'), /attachment;.*\.json/i); assert.deepEqual(await json.json(), report);
    const csv = await get('/api/handover?format=csv');
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv.*charset=utf-8/i);
    assert.match(csv.headers.get('content-disposition'), /attachment;.*\.csv/i);
    const csvText = await csv.text(); const rows = parseCsv(csvText); assert.ok(rows.length > 5, 'CSV contains sections');
    assert.deepEqual(rows[0], ['section', 'row', 'field', 'value']);
    for (const [key, value] of Object.entries(report.metrics)) {
      assert.equal(rows.find(row => row[0] === 'metrics' && row[2] === key)?.[3], value === null ? '' : String(value), `CSV metric ${key}`);
    }
    for (const item of [...report.problems, ...report.jobs, ...report.resources.stock]) assert.ok(rows.some(row => row.includes(item.id)), `CSV includes ${item.id}`);
    for (const row of rows) for (const cell of row) assert.ok(!/^[=+@\t\r]/.test(cell), 'unsafe formula cell');
    for (const format of ['xml', 'JSON', '%00']) assert.equal((await get(`/api/handover?format=${format}`)).status, 400, format);
    assert.deepEqual(sim.snapshot(), before, 'GET requests must not mutate production');
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(path.join(output, 'report.csv'), csvText);
    console.log('PASS: HTTP exports, deterministic public snapshot and read-only semantics');

    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let launchError; child.on('error', error => { launchError = error; });
    const debugPort = await until(async () => {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Edge exited: ${child.exitCode}`);
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }, 'Edge debugging endpoint');
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket connection timeout')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', error => { clearTimeout(timer); reject(error); }, { once: true });
    });
    cdp = new CDP(socket);
    const errors = []; let faultMode = false, pausedRequest;
    cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
    cdp.on('Runtime.consoleAPICalled', e => { if (e.type === 'error') errors.push(e.args.map(a => a.value || a.description).join(' ')); });
    cdp.on('Log.entryAdded', e => { if (e.entry.level === 'error' && !(faultMode && e.entry.url === base + '/api/handover')) errors.push(e.entry.text); });
    cdp.on('Fetch.requestPaused', e => { pausedRequest = e.requestId; });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Log.enable');
    const visible = `document.querySelector('#view-handover') && !document.querySelector('#view-handover').hidden`;
    const content = `document.querySelector('#view-handover')?.innerText || ''`;
    for (const width of [1280, 390]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
      await cdp.send('Page.navigate', { url: base + '/#handover' });
      await until(() => cdp.evaluate(`${visible} && (${content}).includes(${JSON.stringify(report.resources.stock[0].name)})`), 'handover content');
      const geometry = await cdp.evaluate(`({ innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, visualWidth: visualViewport.width,
        overflowing: [...document.querySelectorAll('body *')].filter(e => { const r=e.getBoundingClientRect(); return r.width && r.right > ${width} + 1; }).slice(0,12).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right})) })`);
      await writeFile(path.join(output, `geometry-${width}.json`), JSON.stringify(geometry, null, 2));
      checkViewport(geometry, width);
      const text = await cdp.evaluate(content);
      for (const item of [...report.problems, ...report.jobs]) assert.ok(text.includes(item.title), `UI includes ${item.id}`);
      for (const item of report.resources.technicians) assert.ok(text.includes(item.name), `UI technician ${item.id}`);
      const metrics = await cdp.evaluate(`Array.from(document.querySelectorAll('#view-handover [data-handover-metric]')).map(e=>[e.dataset.handoverMetric,e.textContent])`);
      assert.equal(metrics.length, 9, 'all nine UI metrics have stable hooks');
      for (const [key, value] of metrics) {
        assert.ok(Object.hasOwn(report.metrics, key), key); const expected = report.metrics[key];
        const formatted = expected === null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(key === 'firstPassYield' ? expected * 100 : expected) + (key === 'firstPassYield' ? '%' : '');
        assert.equal(value.replace(/\s/g, ''), formatted.replace(/\s/g, ''), `UI metric ${key}`);
      }
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(path.join(output, `handover-${width}.png`), Buffer.from(capture.data, 'base64'));
      console.log(`PASS: UI ${width}px content and overflow`);
    }
    const ref = '#view-handover a.handover-items-link[href*="/problem/"]';
    assert.equal(await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(ref)}))`), true, 'real entity reference');
    await cdp.evaluate(`document.querySelector(${JSON.stringify(ref)}).focus()`);
    const selectedProblem = await cdp.evaluate(`decodeURIComponent(document.querySelector(${JSON.stringify(ref)}).hash.split('/').at(-1))`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => cdp.evaluate(`location.hash !== '#handover'`), 'keyboard card navigation');
    assert.equal(await cdp.evaluate(`!document.querySelector('#side').hidden && document.querySelector('#side h2').textContent.includes(${JSON.stringify(selectedProblem)})`), true, 'selected real problem card');
    await cdp.evaluate('history.back()'); await until(() => cdp.evaluate(`location.hash === '#handover' && ${visible}`), 'browser Back');
    await until(() => cdp.evaluate(`(${content}).includes(${JSON.stringify(report.resources.stock[0].name)})`), 'report after Back');
    const orderLink = '#view-handover a.handover-items-link[href*="/order/"]';
    const selectedOrder = await cdp.evaluate(`decodeURIComponent(document.querySelector(${JSON.stringify(orderLink)}).hash.split('/').at(-1))`);
    await cdp.evaluate(`document.querySelector(${JSON.stringify(orderLink)}).click()`);
    await until(() => cdp.evaluate(`location.hash.includes('/order/') && document.activeElement.closest('#order-' + ${JSON.stringify(selectedOrder)}) !== null`), 'real focused order card');
    await cdp.evaluate('history.back()');
    await until(() => cdp.evaluate(`location.hash === '#handover' && (${content}).includes(${JSON.stringify(report.resources.stock[0].name)})`), 'report after order Back');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await cdp.evaluate(`document.activeElement !== document.body && document.activeElement.getBoundingClientRect().width > 0`), true, 'visible keyboard focus');

    faultMode = true;
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: base + '/api/handover', requestStage: 'Request' }] });
    await cdp.evaluate(`document.querySelector('#handover-refresh').focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => pausedRequest, 'intercepted report request');
    await until(() => cdp.evaluate(`/загруз/i.test(${content})`), 'loading state');
    await cdp.send('Fetch.fulfillRequest', { requestId: pausedRequest, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"Synthetic E2E failure"}').toString('base64') });
    await until(() => cdp.evaluate(`/ошиб|не удалось|недоступ/i.test(${content})`), 'error state');
    assert.equal(await cdp.evaluate('document.activeElement.id'), 'handover-refresh', 'focus restored after error');
    await cdp.send('Fetch.disable'); pausedRequest = null;
    const retry = await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('#view-handover button')].find(e=>/повтор|обнов/i.test(e.textContent)); if(!b)return false; b.focus(); return true; })()`);
    assert.equal(retry, true, 'retry control');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => cdp.evaluate(`(${content}).includes(${JSON.stringify(report.resources.stock[0].name)})`), 'successful retry');
    assert.equal(await cdp.evaluate('document.activeElement.id'), 'handover-refresh', 'focus restored after retry');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await cdp.evaluate('document.activeElement.dataset.focusKey'), 'handover-json', 'Tab follows refresh to JSON');
    pausedRequest = null;
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: base + '/api/handover', requestStage: 'Request' }] });
    await cdp.evaluate(`document.querySelector('#handover-refresh').focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => pausedRequest, 'delayed refresh');
    await cdp.evaluate(`document.querySelector('[data-focus-key="handover-json"]').focus()`);
    await cdp.send('Fetch.continueRequest', { requestId: pausedRequest });
    await until(() => cdp.evaluate(`(${content}).includes(${JSON.stringify(report.resources.stock[0].name)})`), 'refresh after focus movement');
    assert.equal(await cdp.evaluate('document.activeElement.dataset.focusKey'), 'handover-json', 'refresh does not steal moved focus');
    await cdp.send('Fetch.disable');
    faultMode = false;
    assert.deepEqual(errors, [], 'unexpected console/page errors');
    assert.deepEqual(sim.snapshot(), before, 'UI is read-only');
    console.log('PASS: keyboard/card/Back, loading/error/retry, no console/page errors; cleaning up');
  } catch (error) { failure = error; throw error; }
  finally {
    clearTimeout(deadline);
    const cleanupErrors = [];
    let browserExited = !child?.pid;
    try {
      try {
        if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.close(); }
        if (child?.pid && child.exitCode === null && child.signalCode === null) {
          // Give graceful Browser.close time to stop its own subprocesses before fallback kill.
          await Promise.race([once(child, 'exit'), delay(3000)]);
        }
        if (child?.pid && child.exitCode === null && child.signalCode === null) {
          let timer;
          const exited = once(child, 'exit');
          try {
            child.kill();
            await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Edge did not exit; profile retained')), 10000); })]);
          } finally { clearTimeout(timer); }
        }
        browserExited = !child?.pid || child.exitCode !== null || child.signalCode !== null;
        if (!browserExited) throw new Error('Edge exit was not confirmed');
      } catch (error) { cleanupErrors.push(error); }
    } finally {
      try {
        if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      } catch (error) { cleanupErrors.push(error); }
      finally {
        try {
          // Remove only this run's exact temporary directory, after confirmed browser exit.
          assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
          if (browserExited) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
          else throw new Error(`Profile retained for live browser: ${profile}`);
        } catch (error) { cleanupErrors.push(error); }
      }
    }
    for (const error of cleanupErrors) console.error(`Cleanup: ${error.message}`);
    if (!failure && cleanupErrors.length) throw new AggregateError(cleanupErrors, 'E2E cleanup failed');
  }
  console.log('PASS: handover E2E complete, server/browser/profile cleanup confirmed');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`FAIL: ${error.stack}`); process.exitCode = 1; });
}
