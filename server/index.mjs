import http from 'node:http';
import { createHandover } from './handover.mjs';
import { formatHandover } from './handover-export.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Workshop, SHIFT } from './simulation.mjs';
import { explain, fallback } from './ai.mjs';
import { aiOptionsFromEnv } from './ai-config.mjs';
import { compareOptions, applyOption, decisionReport } from './decisions.mjs';
import { saveState, loadState } from './store.mjs';
import { answerChat, CHAT_LIMITS } from './chat.mjs';
import { loadRiskModel, assessRisk, labSummary, loadPolicyReport } from './risk-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/scene.js': ['scene.js', 'text/javascript; charset=utf-8'], '/viewer3d.js': ['viewer3d.js', 'text/javascript; charset=utf-8'], '/three.module.js': ['three.module.js', 'text/javascript; charset=utf-8'], '/three-orbit-controls.js': ['three-orbit-controls.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/car-kia-a-done.webp': ['car-kia-a-done.webp', 'image/webp'], '/car-kia-a-body.webp': ['car-kia-a-body.webp', 'image/webp'], '/car-kia-b-done.webp': ['car-kia-b-done.webp', 'image/webp'], '/car-kia-b-body.webp': ['car-kia-b-body.webp', 'image/webp'], '/car-kia-c-done.webp': ['car-kia-c-done.webp', 'image/webp'], '/car-kia-c-body.webp': ['car-kia-c-body.webp', 'image/webp'] };
// Optional exterior model downloaded by the user (CC BY 4.0, see docs/ASSETS.md). It is not in Git or dist: exactly two
// files are served from assets-src/kia-sportage if they exist; nothing else in that folder is reachable.
const MODEL_FILES = { '/models/kia-sportage/scene.gltf': ['scene.gltf', 'model/gltf+json'], '/models/kia-sportage/scene.bin': ['scene.bin', 'application/octet-stream'] };
const safeEqual = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Expected client errors carry `expose`; anything else is an unexpected server error (500, generic message).
const clientError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
const POST_ROUTES = ['/api/action', '/api/explain', '/api/compare', '/api/decision', '/api/chat'];
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw clientError('Ожидается application/json', 415);
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw clientError('Слишком большой запрос', 413); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); return body; }
  catch { throw clientError('Некорректный JSON'); }
}
// One snapshot for every screen: engine state + decision reports + model risk + AI status. No keys, no headers.
export function fullState(sim, { aiOptions = {}, riskModel = null } = {}) {
  const s = sim.snapshot();
  s.decisions = s.decisions.map(d => ({ ...d, report: decisionReport(sim, sim.decisions.find(x => x.id === d.id)) }));
  s.risk = assessRisk(sim, riskModel);
  s.ai = { provider: aiOptions.provider || 'nvidia', configured: aiOptions.provider !== 'local' && Boolean(aiOptions.key?.trim()), chatLimits: CHAT_LIMITS };
  return s;
}
export function createApp({ simulation = new Workshop(), aiOptions = {}, tickMs = 1200, publicDir = path.join(root, 'dist'), modelDir = path.join(root, 'assets-src', 'kia-sportage'), storePath = null, riskModel = null, policyReport = null, chatMinIntervalMs = 1000 } = {}) {
  let sim = simulation;
  const token = randomBytes(32).toString('hex'), llm = { busy: false, last: 0 };
  let lastChat = 0, ticksSinceSave = 0;
  const persist = () => {
    if (!storePath) return;
    try { saveState(storePath, sim, [aiOptions.key]); ticksSinceSave = 0; }
    catch { console.error('Не удалось сохранить состояние смены (подробности скрыты).'); }
  };
  const state = () => ({ ...fullState(sim, { aiOptions, riskModel }), csrf: token });
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const port = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host)) return send(403, { error: 'Недопустимый Host' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return send(403, { error: 'Недопустимый Origin' });
    try {
      let url;
      try { url = new URL(req.url, `http://${req.headers.host}`); } catch { throw clientError('Некорректный адрес запроса'); }
      // A plain top-level link from another site may open the page itself; API and assets stay same-origin only.
      const pageNavigation = req.method === 'GET' && url.pathname === '/' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      if (req.headers['sec-fetch-site'] === 'cross-site' && !pageNavigation) return send(403, { error: 'Внешние запросы запрещены' });
      if (req.method === 'GET' && url.pathname === '/api/handover') {
        const format = url.searchParams.get('format');
        if (format !== null && format !== 'json' && format !== 'csv') throw clientError('Неизвестный формат передачи смены');
        const output = formatHandover(createHandover(sim.snapshot()), format);
        res.writeHead(200, output.headers); return res.end(output.body);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, state());
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, synthetic: true, aiProvider: aiOptions.provider || 'nvidia', aiConfigured: aiOptions.provider !== 'local' && Boolean(aiOptions.key?.trim()) });
      if (req.method === 'GET' && url.pathname === '/api/lab') return send(200, { ...labSummary(riskModel), policies: policyReport });
      if (req.method === 'POST' && POST_ROUTES.includes(url.pathname)) {
        if (!safeEqual(req.headers['x-csrf-token'], token)) return send(403, { error: 'Обновите страницу: неверный токен запроса' });
        const body = await jsonBody(req);
        if (url.pathname === '/api/explain') {
          if (Object.keys(body).length) return send(400, { error: 'Тело AI-запроса должно быть пустым объектом' });
          const snapshot = sim.snapshot();
          // Offline explanations never call a vendor and are not rate limited.
          if (aiOptions.provider === 'local' || !aiOptions.key?.trim()) return send(200, await explain(snapshot, aiOptions));
          if (llm.busy || Date.now() - llm.last < 10000) return send(200, fallback(snapshot, 'busy', aiOptions.provider));
          llm.last = Date.now(); llm.busy = true;
          try { return send(200, await explain(snapshot, aiOptions)); } finally { llm.busy = false; }
        }
        if (url.pathname === '/api/compare') {
          const experiment = compareOptions(sim, body.problemId); persist();
          return send(200, { experiment, state: state() });
        }
        if (url.pathname === '/api/decision') {
          const result = applyOption(sim, { experimentId: body.experimentId, optionId: body.optionId, requestId: body.requestId }); persist();
          return send(200, { ...result, state: state() });
        }
        if (url.pathname === '/api/chat') {
          if (Date.now() - lastChat < chatMinIntervalMs) return send(429, { error: 'Слишком часто: подождите секунду перед следующим вопросом' });
          lastChat = Date.now();
          const reply = await answerChat(sim, body, { aiOptions, llm, riskModel }); persist();
          return send(200, { reply, state: state() });
        }
        switch (body.action) {
          case 'play': if (sim.minute < SHIFT) sim.running = true; break;
          case 'pause': sim.running = false; break;
          case 'step': sim.advance(5); break;
          case 'speed': if (![1, 5, 15].includes(body.value)) throw clientError('Неизвестная скорость'); sim.speed = body.value; break;
          case 'reset': sim.reset(42); break;
          default: { const r = sim.command(body, 'operator'); if (r.duplicate) { const s = state(); return send(200, { ...s, duplicate: true }); } }
        }
        persist();
        return send(200, state());
      }
      if (req.method === 'GET' && assets[url.pathname]) {
        const [name, type] = assets[url.pathname];
        let content;
        try { content = await readFile(path.join(publicDir, name)); }
        catch (error) { if (error.code === 'ENOENT') return send(503, { error: 'Сначала выполните npm run build' }); throw error; }
        res.writeHead(200, { 'Content-Type': type }); return res.end(content);
      }
      if (req.method === 'GET' && MODEL_FILES[url.pathname]) {
        const [name, type] = MODEL_FILES[url.pathname];
        let content;
        try { content = await readFile(path.join(modelDir, name)); }
        catch (error) { if (error.code === 'ENOENT') return send(404, { error: 'Модель Kia Sportage не найдена в assets-src/kia-sportage' }); throw error; }
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' }); return res.end(content);
      }
      return send(404, { error: 'Не найдено' });
    } catch (error) {
      if (error?.expose && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) return send(error.status, { error: error.message, ...(error.code === 'stale' ? { code: 'stale' } : {}) });
      console.error('Внутренняя ошибка сервера:', error?.name || 'Error');
      if (res.headersSent) return res.destroy();
      return send(500, { error: 'Внутренняя ошибка сервера. Обновите страницу или перезапустите демо.' });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  const interval = setInterval(() => {
    if (!sim.running) return;
    sim.advance(sim.speed);
    if (++ticksSinceSave >= 5 || sim.finished) persist();
  }, tickMs);
  interval.unref(); server.on('close', () => { clearInterval(interval); persist(); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть целым числом от 1 до 65535');
  const storePath = path.join(root, 'data', process.env.ALLUR_STATE_FILE?.match(/^[A-Za-z0-9_-]{1,40}\.json$/)?.[0] || 'shift-state.json');
  const loaded = loadState(storePath);
  if (loaded.workshop) console.log(`Состояние смены восстановлено из data/ (сохранено ${loaded.savedAt}); проверка целостности пройдена.`);
  else if (loaded.error !== 'missing') console.log(`Сохранённое состояние не принято (${loaded.error}); файл отложен в сторону, начата новая смена.`);
  const simulation = loaded.workshop || new Workshop();
  simulation.running = false;
  const riskModel = loadRiskModel(path.join(root, 'models', 'lift-risk-v1.json'));
  const policyReport = loadPolicyReport(path.join(root, 'reports', 'policy-comparison.json'));
  const server = createApp({ simulation, aiOptions: aiOptionsFromEnv(), storePath, riskModel, policyReport });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Задайте другой PORT.` : 'Не удалось запустить локальный сервер.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Allur Smart Factory · диспетчер смены · synthetic demo · http://127.0.0.1:${port}${riskModel ? '' : ' · модель риска не обучена (npm.cmd run train)'}`));
}
