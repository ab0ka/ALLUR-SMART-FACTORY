// Optional real-browser acceptance test. No Playwright, Puppeteer, model files or paid AI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { CDP, findBrowser, listenLocal, withOwnedRun, launchBrowser, stopChild, devToolsPort, until } from './e2e-support.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = await findBrowser();
if (!browserPath) {
  console.log('пропущено: браузер не найден. Укажите BROWSER_PATH (Edge/Chrome).');
} else {
  const started = Date.now();
  const steps = [];
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
    await mkdir(path.join(root, 'screenshots/e2e'), { recursive: true });
    const output = await mkdtemp(path.join(root, 'screenshots/e2e/run-'));
    const report = await withOwnedRun(path.join(root, 'data'), async ({ owned, defer }) => {
      const app = createApp({ aiOptions: { provider: 'local' }, storePath: path.join(owned, 'e2e.json') });
      defer(async () => { if (app.listening) await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }); else app.emit('close'); });
      const port = await listenLocal(app), base = `http://127.0.0.1:${port}`;
      const readState = async () => { const r = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(10000) }); assert.equal(r.status, 200); return r.json(); };
      // API is used only for setup and explicit idempotency assertions; the production scenario uses mouse input.
      const apiPost = async (route, body) => {
        const s = await readState();
        const response = await fetch(base + route, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', Origin: base, 'X-CSRF-Token': s.csrf }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      };
      assert.equal((await apiPost('/api/action', { action: 'reset' })).status, 200);
      const profile = path.join(owned, 'browser-profile');
      const child = launchBrowser(browserPath, profile); defer(() => stopChild(child));
      const debugPort = await devToolsPort(child, profile);
      const target = await until(async () => {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(10000) });
        return (await response.json()).find(t => t.type === 'page');
      }, 'вкладка браузера');
      const cdp = await CDP.connect(target.webSocketDebuggerUrl);
      defer(async () => { try { await cdp.send('Browser.close'); } catch { /* browser may close the socket before replying */ } finally { cdp.close(); } });
      const browserVersion = await cdp.send('Browser.getVersion');
      const errors = [];
      cdp.listeners.push((method, params) => {
        if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
        if (method === 'Log.entryAdded' && params.entry.level === 'error') errors.push(params.entry.text);
        if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map(a => a.value || a.description).join(' '));
      });
      const evaluate = async expression => {
        const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      const wait = (expression, label = expression) => until(() => evaluate(expression), label);
      const visible = selector => `(() => { const e=document.querySelector(${JSON.stringify(selector)}); return !!(e && e.getClientRects().length); })()`;
      const click = async selector => {
        const point = await until(() => evaluate(`(() => {
          const e=document.querySelector(${JSON.stringify(selector)}); if(!e || e.disabled) return null;
          e.scrollIntoView({block:'center',inline:'center'});
          const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
          return r.width && r.height && e.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
        })()`), `кнопка ${selector}`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      };
      const shot = async name => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(output, `${name}.png`), Buffer.from(r.data, 'base64')); };
      const stateUntil = (predicate, label) => until(async () => { const s = await readState(); return predicate(s) ? s : false; }, label);
      const stage = async (name, action) => {
        const before = Date.now();
        try { await action(); const elapsedMs = Date.now() - before; steps.push({ name, elapsedMs }); console.log(`✓ ${name} (${elapsedMs} мс)`); }
        catch (error) { console.error(`✗ ${name}: ${error.message}`); throw error; }
      };
      const sideHas = text => wait(`document.querySelector('#side')?.innerText.includes(${JSON.stringify(text)})`, `карточка: ${text}`);
      const step = async () => {
        const before = await readState();
        await click('#menu summary'); await click('#step-menu');
        const s = await stateUntil(s => s.elapsed === before.elapsed + 5, 'шаг +5 минут');
        const clock = `${String(Math.floor((480+s.elapsed)/60)).padStart(2,'0')}:${String(s.elapsed%60).padStart(2,'0')}`;
        await wait(`document.querySelector('#clock')?.textContent === ${JSON.stringify(clock)}`);
      };
      let problem, vehicleId, repair, stockBefore, decision;
      try {
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await cdp.send('Page.navigate', { url: `${base}/#space/assembly` });
        await wait(`document.querySelector('#play')?.disabled === false`);
        await stage('Два шага, PR-1 на СБ-2, общий вид', async () => {
          await step(); await step(); const s = await readState();
          problem = s.problems.find(p => p.id === 'PR-1'); assert.equal(problem?.postId, 'A2');
          vehicleId = s.posts.find(p => p.id === 'A2').vehicleId; assert.ok(vehicleId);
          await wait(`document.querySelector('#scene')?.textContent.includes('PR-1')`);
          assert.equal(await evaluate('document.documentElement.scrollWidth'), 1280);
          await shot('01-overview');
        });
        await stage('Паспорт автомобиля на СБ-2', async () => {
          await click(`#scene [data-vehicle="${vehicleId}"]`); await sideHas(vehicleId); await shot('02-passport');
          await click(`#side [data-ref-type="problem"][data-ref-id="${problem.id}"]`); await sideHas(problem.id);
        });
        await stage('Подтверждение и результат диагностики', async () => {
          const check = '#side [data-check="pump_check"]';
          await click(check); await wait(visible('#confirm[open]')); assert.equal((await readState()).jobs.length, 0);
          await click('#confirm button[value="cancel"]'); assert.equal((await readState()).jobs.length, 0);
          await click(check); await click('#confirm-ok');
          await stateUntil(s => s.jobs.length === 1, 'работа диагностики');
          await step(); await step(); const s = await readState();
          assert.equal(s.jobs[0].status, 'done'); assert.equal(s.jobs.length, 1);
          await sideHas(s.jobs[0].result.text); await evaluate("document.querySelector('#side .timeline')?.scrollIntoView({block:'start'})"); await shot('03-diagnosis');
        });
        await stage('Сравнение и рекомендованный ремонт', async () => {
          await click(`#side [data-compare="${problem.id}"]`);
          await wait(visible('#side input[value="repair_confirmed"]'));
          await click('#side input[value="repair_confirmed"]');
          await shot('04-comparison');
          await click('#side [data-apply-choice]'); await wait(visible('#confirm[open]'));
          assert.equal((await readState()).decisions.length, 0);
          await click('#confirm button[value="cancel"]'); assert.equal((await readState()).decisions.length, 0);
          await click('#side [data-apply-choice]'); await click('#confirm-ok');
          const s = await stateUntil(s => s.decisions.length === 1, 'DEC-1');
          decision = s.decisions[0]; assert.equal(decision.id, 'DEC-1');
          repair = s.jobs.find(j => j.kind.startsWith('repair_')); assert.equal(repair?.status, 'running');
          stockBefore = s.stock.find(p => p.id === repair.part);
          await sideHas('DEC-1'); await shot('05-decision');
        });
        await stage('Идемпотентность решения: повтор 200, новое намерение 409', async () => {
          const before = await readState();
          const body = { experimentId: decision.experimentId, optionId: decision.optionId, requestId: decision.requestId };
          const repeat = await apiPost('/api/decision', body); assert.equal(repeat.status, 200); assert.equal(repeat.body.duplicate, true);
          assert.equal((await apiPost('/api/decision', { ...body, requestId: randomUUID() })).status, 409);
          const after = await readState();
          for (const key of ['jobs','decisions','stock','events']) assert.deepEqual(after[key], before[key], `повтор не меняет ${key}`);
        });
        await stage('Ремонт, повторная проверка и закрытие PR-1', async () => {
          for (let i=0; i<repair.duration/5; i++) await step();
          let s=await readState(); assert.equal(s.jobs.find(j=>j.kind==='verify')?.status,'running');
          assert.equal(s.problems.find(p=>p.id===problem.id).status,'open');
          await step(); s=await readState();
          assert.equal(s.problems.find(p=>p.id===problem.id).status,'resolved');
          assert.equal(s.jobs.length,3); assert.ok(s.jobs.every(j=>j.status==='done'));
          assert.equal(s.jobs.find(j=>j.kind==='verify').result.restored,true); assert.equal(s.technicians[0].jobId,null);
          const part=s.stock.find(p=>p.id===repair.part);
          assert.equal(stockBefore.reserved,1); assert.equal(part.reserved,0);
          assert.equal(part.used-stockBefore.used,1); assert.equal(stockBefore.onHand-part.onHand,1);
          await sideHas('Закрыта'); await cdp.send('Page.reload'); await sideHas('Закрыта');
        });
        await stage('Мобильный вид 390 px и отсутствие ошибок', async () => {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:false });
          await wait('innerWidth === 390'); assert.equal(await evaluate('document.documentElement.scrollWidth'),390);
          await shot('06-mobile'); assert.deepEqual(errors,[],'Ошибки Runtime/Log/console');
        });
        return { synthetic:true, browser:browserVersion.product, base, steps, errors, elapsedMs:Date.now()-started };
      } catch(error) { await shot('failure').catch(()=>{}); console.error(`Артефакты: ${output}`); throw error; }
    });
    await writeFile(path.join(output,'report.json'),JSON.stringify({ ...report, cleanup: 'passed' },null,2));
    console.log(`✓ E2E PASS: ${path.relative(root,output)}; 6 PNG; ${Date.now()-started} мс`);
  } catch(error) { console.error(`✗ E2E: ${error.message} (${Date.now()-started} мс)`); process.exitCode=1; }
}
