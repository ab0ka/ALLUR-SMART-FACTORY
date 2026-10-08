import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Workshop, SHIFT } from './simulation.mjs';
import { explain, fallback } from './ai.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const safeEqual = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Expected client errors carry `expose`; anything else is an unexpected server error (500, generic message).
const clientError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw clientError('Ожидается application/json', 415);
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw clientError('Слишком большой запрос', 413); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); return body; }
  catch { throw clientError('Некорректный JSON'); }
}
export function createApp({ simulation = new Workshop(), aiOptions = {}, tickMs = 1200, publicDir = path.join(root, 'dist') } = {}) {
  const token = randomBytes(32).toString('hex'); let lastAI = 0, busy = false;
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
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, { ...simulation.snapshot(), csrf: token });
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, synthetic: true, aiConfigured: Boolean(aiOptions.key?.trim()) });
      if (req.method === 'POST' && ['/api/action', '/api/explain'].includes(url.pathname)) {
        if (!safeEqual(req.headers['x-csrf-token'], token)) return send(403, { error: 'Обновите страницу: неверный токен запроса' });
        const body = await jsonBody(req);
        if (url.pathname === '/api/explain') {
          if (Object.keys(body).length) return send(400, { error: 'Тело AI-запроса должно быть пустым объектом' });
          const snapshot = simulation.snapshot();
          // Without a key no NVIDIA call happens, so the local explanation is not rate limited.
          if (!aiOptions.key?.trim()) return send(200, await explain(snapshot, aiOptions));
          if (busy || Date.now() - lastAI < 10000) return send(200, fallback(snapshot, 'busy'));
          lastAI = Date.now(); busy = true;
          try { return send(200, await explain(snapshot, aiOptions)); } finally { busy = false; }
        }
        switch (body.action) {
          case 'play': if (simulation.minute < SHIFT) simulation.running = true; break;
          case 'pause': simulation.running = false; break;
          case 'step': simulation.advance(5); break;
          case 'speed': if (![1, 5, 15].includes(body.value)) throw clientError('Неизвестная скорость'); simulation.speed = body.value; break;
          case 'release': simulation.releaseOrder({ modelId: body.model, quantity: body.quantity, priority: body.priority }); break;
          case 'priority': simulation.setPriority(body.orderId, body.priority); break;
          case 'fault': simulation.injectIncident(body.postId, body.kind); break;
          case 'resolve': if (!Number.isInteger(body.id)) throw clientError('Некорректный инцидент'); simulation.resolveIncident(body.id); break;
          case 'transfer': simulation.transfer(body.vehicleId, body.postId); break;
          case 'reset': simulation.reset(42); break;
          default: throw clientError('Неизвестное действие');
        }
        return send(200, { ...simulation.snapshot(), csrf: token });
      }
      if (req.method === 'GET' && assets[url.pathname]) {
        const [name, type] = assets[url.pathname];
        let content;
        try { content = await readFile(path.join(publicDir, name)); }
        catch (error) { if (error.code === 'ENOENT') return send(503, { error: 'Сначала выполните npm run build' }); throw error; }
        res.writeHead(200, { 'Content-Type': type }); return res.end(content);
      }
      return send(404, { error: 'Не найдено' });
    } catch (error) {
      if (error?.expose && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) return send(error.status, { error: error.message });
      console.error('Внутренняя ошибка сервера:', error?.name || 'Error');
      if (res.headersSent) return res.destroy();
      return send(500, { error: 'Внутренняя ошибка сервера. Обновите страницу или перезапустите демо.' });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const interval = setInterval(() => { if (simulation.running) simulation.advance(simulation.speed); }, tickMs);
  interval.unref(); server.on('close', () => clearInterval(interval));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть целым числом от 1 до 65535');
  const server = createApp({ aiOptions: { key: process.env.NVIDIA_API_KEY || '', model: process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct' } });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Задайте другой PORT.` : 'Не удалось запустить локальный сервер.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Allur Smart Factory · synthetic demo · http://127.0.0.1:${port}`));
}
