// Allur workshop client. The server owns all production state; this file only renders snapshots and sends commands.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(n);
const pct = n => `${fmt(n * 100)}%`;
const clock = m => `${String(Math.floor((480 + m) / 60)).padStart(2, '0')}:${String((480 + m) % 60).padStart(2, '0')}`;
const POST_STATES = { idle: 'Свободен', working: 'Выполняет операцию', slow: 'Сниженный темп', blocked: 'Блокирован следующим буфером', fault: 'Неисправность', shift_over: 'Смена завершена' };
const POST_SHORT = { idle: 'Свободен', working: 'Выполняет', slow: 'Снижен темп', blocked: 'Блокирован', fault: 'Неисправность', shift_over: 'Конец смены' };
const VEHICLE_STATES = { not_started: 'Не начат', waiting: 'Ожидает', processing: 'В работе', paused: 'Пауза', blocked: 'Ждёт буфер', stopped: 'Остановлен концом смены', ready: 'Принят', shipped: 'Отгружен' };
const ORDER_STATES = { released: 'Выпущено', in_progress: 'В работе', completed: 'Выполнено' };
const PRIORITY = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' };
const FILTERS = [['all', 'Все'], ['active', 'В работе'], ['queued', 'В очередях'], ['problem', 'Пауза и блокировки'], ['done', 'Приняты и отгружены']];
const filterOf = { all: () => true, active: v => v.state === 'processing', queued: v => ['not_started', 'waiting'].includes(v.state), problem: v => ['paused', 'blocked', 'stopped'].includes(v.state), done: v => v.accepted };
let state = null, view = 'workshop', selectedPost = 'A1', selectedVehicle = null, vehicleFilter = 'all', updating = false, fetching = false, aiRevision = null, aiBusy = false;
const text = (id, value) => { $(id).textContent = value; };
function error(message) { $('error').hidden = !message; text('error', message || ''); }

async function api(path, body) {
  const options = body === undefined ? { signal: AbortSignal.timeout(5000) } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state?.csrf || '' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) };
  const response = await fetch(path, options), data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}
async function action(body) {
  if (updating || !state) return false;
  updating = true;
  try { state = await api('/api/action', body); error(''); if (body.action === 'reset') resetAi(); render(); return true; }
  catch (e) { error(e.message); return false; }
  finally { updating = false; }
}
function resetAi() { aiRevision = null; text('ai-text', 'Смена сброшена. Запросите объяснение нового снимка.'); text('ai-source', 'Локальный режим доступен без ключа'); }

const post = id => state.posts.find(p => p.id === id);
const vehicle = id => state.vehicles.find(v => v.id === id);
const order = id => state.orders.find(o => o.id === id);
const bar = (value, cls = '') => `<span class="bar ${cls}" aria-hidden="true"><svg viewBox="0 0 100 6" preserveAspectRatio="none"><rect class="bar-bg" width="100" height="6" rx="3"/><rect class="bar-fill" width="${Math.max(0, Math.min(100, value * 100))}" height="6" rx="3"/></svg></span>`;
const vehicleLink = id => `<button class="link" data-vehicle="${esc(id)}">${esc(id)}</button>`;
const postLink = id => `<button class="link" data-post-link="${esc(id)}">${esc(post(id).code)}</button>`;

// ---------- Summary and toolbar ----------
function renderChrome() {
  const t = state.totals, f = state.forecast;
  text('clock', clock(state.elapsed));
  text('run-status', state.finished ? 'Смена завершена' : state.running ? '● Идёт смена' : 'Ⅱ Пауза');
  text('play', state.running ? 'Ⅱ Пауза' : '▶ Запустить'); $('play').disabled = state.finished; $('step').disabled = state.finished;
  $('speed').value = String(state.speed); text('shift-progress', `${state.elapsed} / ${state.shift} мин`);
  text('nav-vehicles', t.created); text('nav-orders', state.orders.length);
  const delta = t.accepted - state.plan.now;
  $('summary').innerHTML = [
    ['Принято контролем', `${t.accepted} <small>из плана ${state.plan.total}</small>`],
    ['План к этому времени', `${state.plan.now} <small class="${delta >= 0 ? 'positive' : 'negative'}">${delta >= 0 ? '+' : ''}${delta}</small>`],
    ['В работе', t.inProcess], ['Не начаты', t.notStarted], ['Отгружено', t.shipped],
    ['Прогноз к 16:00', `${f.projected}${f.low < f.projected ? ` <small>мин. ${f.low}</small>` : ''}`],
    ['Ограничивает', f.limiting ? esc(f.limiting.name) : '—'],
  ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}

// ---------- Workshop map ----------
const LAYOUT = {
  zones: [
    { stage: 'weld', x: 186, y: 30, w: 236 }, { stage: 'paint', x: 558, y: 30, w: 236 },
    { stage: 'assembly', x: 830, y: 300, w: 346 }, { stage: 'quality', x: 462, y: 300, w: 236 }, { stage: 'shipping', x: 200, y: 300, w: 126 },
  ],
  buffers: { BACKLOG: { x: 16, y: 30, w: 150, slots: 6 }, B1: { x: 442, y: 30, w: 96 }, B2: { x: 814, y: 30, w: 96 }, B3: { x: 714, y: 300, w: 96 }, FG: { x: 346, y: 300, w: 100 } },
  shipped: { x: 16, y: 300, w: 166 },
};
const ZONE_H = 220, POST_W = 100, POST_H = 128;
function renderMap() {
  const svg = $('workshop-map');
  const stageName = Object.fromEntries(state.stages.map(s => [s.id, s]));
  let out = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrow-head"/></marker><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" class="grid-line"/></pattern></defs><rect width="1200" height="560" fill="url(#grid)"/>';
  out += '<path class="flow" d="M166 140H186M422 140H442M538 140H558M794 140H814" marker-end="url(#arrow)"/><path class="flow" d="M862 250V300" marker-end="url(#arrow)"/><path class="flow" d="M830 410H810M714 410H698M462 410H446M346 410H326M200 410H182" marker-end="url(#arrow)"/>';
  for (const z of LAYOUT.zones) {
    const s = stageName[z.stage];
    out += `<rect class="zone" x="${z.x}" y="${z.y}" width="${z.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${z.x + 12}" y="${z.y + 22}">${esc(s.name.toUpperCase())} · ${s.postIds.length} ${s.postIds.length === 1 ? 'пост' : 'поста'}</text>`;
    s.postIds.forEach((id, i) => { out += postNode(post(id), z.x + 10 + i * (POST_W + 10), z.y + 50); });
  }
  for (const s of state.stages) {
    const b = s.buffer, l = LAYOUT.buffers[b.id], slots = l.slots ?? b.capacity, ids = b.vehicleIds;
    out += `<rect class="zone buffer${b.capacity !== null && ids.length >= b.capacity ? ' full' : ''}" x="${l.x}" y="${l.y}" width="${l.w}" height="${ZONE_H}" rx="10"/>`;
    out += `<text class="zone-label buffer-label" x="${l.x + 10}" y="${l.y + 22}">${esc(b.id === 'BACKLOG' ? 'ВХОД' : b.id === 'FG' ? 'ГОТОВЫЕ' : b.id)}</text><text class="zone-count" x="${l.x + l.w - 10}" y="${l.y + 22}" text-anchor="end">${ids.length}${b.capacity !== null ? `/${b.capacity}` : ''}</text>`;
    for (let i = 0; i < slots; i++) {
      const y = l.y + 36 + i * 28, id = ids[i];
      if (b.id === 'BACKLOG' && i === slots - 1 && ids.length > slots) { out += `<text class="more" x="${l.x + l.w / 2}" y="${y + 17}" text-anchor="middle">+${ids.length - slots + 1} в очереди</text>`; break; }
      out += id ? vehicleChip(vehicle(id), l.x + 8, y, l.w - 16) : `<rect class="slot-empty" x="${l.x + 8}" y="${y}" width="${l.w - 16}" height="24" rx="5"/>`;
    }
    out += `<text class="buffer-name" x="${l.x + l.w / 2}" y="${l.y + ZONE_H - 10}" text-anchor="middle">${esc(shortBuffer(b))}</text>`;
  }
  const sh = LAYOUT.shipped, shipped = state.vehicles.filter(v => v.shipped).sort((a, b) => b.shippedAt - a.shippedAt);
  out += `<rect class="zone done" x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${sh.x + 10}" y="${sh.y + 22}">ОТГРУЖЕНО</text><text class="zone-big" x="${sh.x + sh.w / 2}" y="${sh.y + 92}" text-anchor="middle">${shipped.length}</text>`;
  shipped.slice(0, 3).forEach((v, i) => { out += vehicleChip(v, sh.x + 10, sh.y + 116 + i * 28, sh.w - 20); });
  out += `<text class="map-caption" x="930" y="60">УСЛОВНАЯ СХЕМА · СИНТЕТИЧЕСКАЯ</text><text class="map-caption" x="930" y="80">ПЛАНИРОВКА, НЕ CAD ALLUR</text><text class="map-caption" x="930" y="110">Принято: ${state.totals.accepted}</text><text class="map-caption" x="930" y="130">В работе: ${state.totals.inProcess}</text>`;
  svg.innerHTML = out;
}
const shortBuffer = b => ({ BACKLOG: 'кузова к сварке', B1: 'к окраске', B2: 'к сборке', B3: 'к контролю', FG: 'к отгрузке' }[b.id]);
function vehicleChip(v, x, y, w) {
  return `<g class="chip ${esc(v.state)}" role="button" tabindex="0" data-key="v-${esc(v.id)}" data-vehicle="${esc(v.id)}" aria-label="${esc(`${v.id}, ${v.modelName}, ${v.status}`)}"><rect x="${x}" y="${y}" width="${w}" height="24" rx="5"/><text x="${x + 7}" y="${y + 16}">${esc(v.id.replace('DEMO-', '#'))}</text><text class="chip-model" x="${x + w - 7}" y="${y + 16}" text-anchor="end">${esc(v.modelId)}${v.priority === 'high' ? ' ↑' : ''}</text></g>`;
}
function postNode(p, x, y) {
  const v = p.vehicleId ? vehicle(p.vehicleId) : null, sel = selectedPost === p.id;
  const label = `${p.code}: ${POST_STATES[p.state]}${v ? `, ${v.id}, ${p.operation}, ${Math.round(p.progress * 100)}%` : ''}`;
  let inner = `<rect class="post-box" x="${x}" y="${y}" width="${POST_W}" height="${POST_H}" rx="8"/><text class="post-code" x="${x + 8}" y="${y + 19}">${esc(p.code)}</text><circle class="post-dot" cx="${x + POST_W - 12}" cy="${y + 14}" r="5"/><text class="post-state" x="${x + 8}" y="${y + 37}">${esc(POST_SHORT[p.state])}</text>`;
  if (v) inner += `<text class="post-vehicle" x="${x + 8}" y="${y + 64}">${esc(v.id)}</text><text class="post-model" x="${x + 8}" y="${y + 81}">${esc(v.modelName)}${v.priority === 'high' ? ' · ↑' : ''}</text><rect class="pbar-bg" x="${x + 8}" y="${y + 92}" width="${POST_W - 16}" height="6" rx="3"/><rect class="pbar" x="${x + 8}" y="${y + 92}" width="${(POST_W - 16) * p.progress}" height="6" rx="3"/><text class="post-progress" x="${x + 8}" y="${y + 116}">${Math.round(p.progress * 100)}% · ${p.progress >= 1 ? 'готово' : `${fmt(p.remaining)} мин`}</text>`;
  else inner += `<text class="post-empty" x="${x + POST_W / 2}" y="${y + 84}" text-anchor="middle">нет автомобиля</text>`;
  return `<g class="post ${esc(p.state)}${sel ? ' selected' : ''}" role="button" tabindex="0" data-key="p-${esc(p.id)}" data-post="${esc(p.id)}" aria-pressed="${sel}" aria-label="${esc(label)}">${inner}</g>`;
}

// ---------- Post detail and board ----------
function renderPostDetail() {
  const p = post(selectedPost), v = p.vehicleId ? vehicle(p.vehicleId) : null, stage = state.stages.find(s => s.id === p.stage);
  const incident = p.incidentId ? state.incidents.find(i => i.id === p.incidentId) : null;
  const siblings = state.posts.filter(q => q.stage === p.stage && q.id !== p.id);
  const free = siblings.filter(q => !q.vehicleId && q.state !== 'fault' && q.state !== 'shift_over');
  const queue = stage.buffer.vehicleIds;
  let html = `<div class="detail-head"><div><span class="eyebrow">ПОСТ · ${esc(stage.name.toUpperCase())}</span><h2>${esc(p.code)}</h2></div><span class="status-pill ${esc(p.state)}">${esc(POST_STATES[p.state])}</span></div>`;
  if (p.reason) html += `<p class="reason">${esc(p.reason)}</p>`;
  html += '<div class="dcol">';
  if (v) {
    const op = v.currentOperation;
    html += `<dl class="facts"><div><dt>Автомобиль</dt><dd>${vehicleLink(v.id)} · ${esc(v.modelName)} · ${esc(v.orderId)}</dd></div><div><dt>Операция</dt><dd>${esc(op.operation)}</dd></div><div><dt>Прогресс</dt><dd>${bar(op.progress)} ${Math.round(op.progress * 100)}% · ${op.completedAt !== null ? `завершена в ${clock(op.completedAt)}` : `осталось ${fmt(op.remaining)} мин из ${op.work}`}</dd></div><div><dt>Норматив / факт</dt><dd>${op.norm} мин / ${op.work} мин (синтетика)</dd></div><div><dt>Начало</dt><dd>${clock(op.startedAt)}${op.posts.length > 1 ? ` · переводы: ${op.posts.map(x => `${esc(x.postCode)} с ${clock(x.from)}`).join(' → ')}` : ''}</dd></div></dl>`;
  } else html += '<p class="muted">Автомобиля на посту нет.</p>';
  let queueHtml = `<h3>Очередь участка · ${esc(stage.buffer.name)} ${queue.length}${stage.buffer.capacity !== null ? `/${stage.buffer.capacity}` : ''}</h3>`;
  queueHtml += queue.length ? `<ol class="queue">${queue.slice(0, 8).map(id => { const q = vehicle(id); return `<li>${vehicleLink(id)} <span>${esc(q.modelName)} · ${esc(q.orderId)} · ${PRIORITY[q.priority].toLowerCase()}</span></li>`; }).join('')}${queue.length > 8 ? `<li class="muted">и ещё ${queue.length - 8}</li>` : ''}</ol><p class="fine-print">Порядок: приоритет задания → время прихода в буфер. Начатые операции не прерываются.</p>` : '<p class="muted">Очередь пуста.</p>';
  if (!state.finished) {
    const actions = [];
    if (incident) actions.push(`<button data-resolve="${incident.id}" class="primary">Устранить: ${esc(incident.title)}</button>`);
    else actions.push(`<button data-fault="${esc(p.id)}" data-kind="breakdown">Вызвать неисправность</button>`, `<button data-fault="${esc(p.id)}" data-kind="slowdown">Снизить темп</button>`);
    if (p.state === 'fault' && v && v.currentOperation && v.currentOperation.completedAt === null) for (const q of free) actions.push(`<button data-transfer="${esc(v.id)}" data-to="${esc(q.id)}">Перевести ${esc(v.id)} на ${esc(q.code)}</button>`);
    html += `<h3>Действия</h3><div class="actions">${actions.join('')}</div>`;
    if (p.state === 'fault' && v && !free.length && siblings.length) html += '<p class="fine-print">Параллельные посты заняты или неисправны — перевод сейчас невозможен.</p>';
  }
  html += `</div><div class="dcol">${queueHtml}</div>`;
  const m = p.metrics;
  html += `<p class="post-metrics">A ${pct(m.availability)} · P ${pct(m.performance)} · OEE ${pct(m.oee)} · неисправность ${p.stats.fault} мин · нет входа ${p.stats.starved} мин · блокировка ${p.stats.blocked} мин</p>`;
  $('post-detail').innerHTML = html;
}
function renderPostBoard() {
  $('post-board').innerHTML = state.stages.map(s => `<div class="board-stage"><h3>${esc(s.name)}</h3>${s.postIds.map(id => { const p = post(id); return `<button class="board-post ${esc(p.state)}${selectedPost === id ? ' selected' : ''}" data-post-link="${esc(id)}" aria-pressed="${selectedPost === id}"><b>${esc(p.code)}</b><span>${esc(POST_STATES[p.state])}</span><span>${p.vehicleId ? `${esc(p.vehicleId)} · ${Math.round(p.progress * 100)}%` : '—'}</span></button>`; }).join('')}<span class="board-queue">${esc(s.buffer.name)}: ${s.buffer.vehicleIds.length}${s.buffer.capacity !== null ? `/${s.buffer.capacity}` : ''}</span></div>`).join('');
}
function renderActiveIncidents() {
  const active = state.incidents.filter(i => i.status !== 'resolved');
  $('active-incidents').innerHTML = active.map(i => `<div class="incident-banner ${esc(i.severity)}"><strong>${esc(i.title)}</strong><span>${i.status === 'unresolved' ? 'Не устранён к концу смены' : `до ${clock(i.expires)}`} · ${esc(i.cause)}</span><span class="banner-actions">${postLink(i.postId)}${i.status === 'active' ? `<button data-resolve="${i.id}">Устранить</button>` : ''}</span></div>`).join('');
}

// ---------- Vehicles ----------
function renderVehicles() {
  $('vehicle-filters').innerHTML = FILTERS.map(([id, name]) => `<button data-filter="${id}" aria-pressed="${vehicleFilter === id}">${name} <span>${state.vehicles.filter(filterOf[id]).length}</span></button>`).join('');
  const list = state.vehicles.filter(filterOf[vehicleFilter]);
  if (!selectedVehicle || !vehicle(selectedVehicle)) selectedVehicle = list[0]?.id ?? state.vehicles[0]?.id;
  $('vehicle-list').innerHTML = list.length ? `<div class="vrow vhead" aria-hidden="true"><span>ID</span><span>Модель · задание</span><span>Статус</span><span>Операция</span></div>` + list.map(v => `<button class="vrow ${esc(v.state)}${selectedVehicle === v.id ? ' selected' : ''}" data-vehicle-select="${esc(v.id)}" aria-pressed="${selectedVehicle === v.id}"><span class="vid">${esc(v.id)}</span><span>${esc(v.modelName)} · ${esc(v.orderId)}${v.priority === 'high' ? ' · ↑' : ''}</span><span class="vstate">${esc(VEHICLE_STATES[v.state])}</span><span>${v.currentOperation && v.currentOperation.completedAt === null ? `${bar(v.currentOperation.progress)} ${Math.round(v.currentOperation.progress * 100)}%` : esc(v.accepted ? `принят ${clock(v.acceptedAt)}` : '—')}</span></button>`).join('') : '<p class="muted pad">Нет автомобилей с таким статусом.</p>';
  renderPassport();
}
function renderPassport() {
  const v = vehicle(selectedVehicle);
  if (!v) { $('vehicle-passport').innerHTML = '<p class="muted pad">Выберите автомобиль.</p>'; return; }
  const events = state.events.filter(e => e.vehicleId === v.id).reverse();
  $('vehicle-passport').innerHTML = `<div class="detail-head"><div><span class="eyebrow">ПАСПОРТ · СИНТЕТИЧЕСКИЙ ID, НЕ VIN</span><h2>${esc(v.id)}</h2></div><span class="status-pill ${esc(v.state)}">${esc(VEHICLE_STATES[v.state])}</span></div>
  <p class="reason">${esc(v.status)}</p>
  <dl class="facts"><div><dt>Модель</dt><dd>${esc(v.modelName)} (условная)</dd></div><div><dt>Задание</dt><dd><button class="link" data-order-link="${esc(v.orderId)}">${esc(v.orderId)}</button> · приоритет ${PRIORITY[v.priority].toLowerCase()}</dd></div><div><dt>Маршрут</dt><dd>${esc(v.routeVersion)} · создан ${clock(v.createdAt)}${v.startedAt !== null ? ` · запущен ${clock(v.startedAt)}` : ''}</dd></div><div><dt>Приёмка</dt><dd>${v.accepted ? `принят контролем в ${clock(v.acceptedAt)}${v.shipped ? ` · отгружен ${clock(v.shippedAt)}` : ''}` : 'не принят'}</dd></div></dl>
  <h3>Маршрут операций</h3>
  <ol class="route">${v.route.map(r => `<li class="${r.status}"><span class="route-dot" aria-hidden="true"></span><div><strong>${esc(r.operation)}</strong><span>${r.status === 'done' ? `выполнено на ${esc(r.postCode)} · ${clock(r.startedAt)}–${clock(r.completedAt)} · ${r.completedAt - r.startedAt} мин` : r.status === 'current' ? `${esc(r.postCode)} · начато ${clock(r.startedAt)} · ${Math.round(r.progress * 100)}%${v.state === 'paused' ? ' · пауза' : ''}` : `ожидает · норматив ${r.norm} мин`}</span></div></li>`).join('')}</ol>
  <h3>История событий</h3>
  <ol class="history">${events.map(e => `<li><time>${clock(e.minute)}</time><span>${esc(e.text)}</span>${e.actor === 'operator' ? '<em>оператор</em>' : ''}</li>`).join('')}</ol>`;
}

// ---------- Orders ----------
function renderOrders() {
  const left = state.maxVehicles - state.totals.created;
  text('release-note', state.finished ? 'Смена завершена — новые задания недоступны.' : `Можно создать ещё ${left} автомобил${left === 1 ? 'ь' : left > 1 && left < 5 ? 'я' : 'ей'} (лимит демо ${state.maxVehicles} на смену, партия до ${state.maxOrderQuantity}). Новые машины встают во входной буфер; приоритет влияет только на ещё не начатые операции.`);
  $('release-form').querySelector('button[type=submit]').disabled = state.finished || left < 1;
  $('release-quantity').max = String(Math.max(1, Math.min(state.maxOrderQuantity, left)));
  $('order-list').innerHTML = [...state.orders].reverse().map(o => {
    const counts = [['не начаты', o.notStarted], ['в работе', o.inProcess], ['приняты', o.accepted], ['из них отгружены', o.shipped]];
    return `<article class="panel order ${esc(o.state)}" id="order-${esc(o.id)}"><div class="order-head"><div><span class="eyebrow">${esc(ORDER_STATES[o.state].toUpperCase())}${o.overdue ? ' · <b class="negative">СРОК ПРОШЁЛ</b>' : ''}</span><h2>${esc(o.id)} · ${esc(state.models.find(m => m.id === o.modelId).name)} × ${o.quantity}</h2></div><span class="order-due">срок ${o.dueMinute > 480 ? 'следующая смена' : clock(o.dueMinute)}<br>выпущено ${clock(o.releasedAt)}</span></div>
    <div class="order-progress">${bar(o.accepted / o.quantity, 'wide')}<strong>${o.accepted}/${o.quantity}</strong> принято</div>
    <p class="order-counts">${counts.map(([k, n]) => `${k}: <b>${n}</b>`).join(' · ')}</p>
    <div class="segmented-buttons" role="group" aria-label="Приоритет ${esc(o.id)}"><span>Приоритет</span>${Object.entries(PRIORITY).map(([id, name]) => `<button data-priority="${id}" data-order="${esc(o.id)}" aria-pressed="${o.priority === id}" ${o.state === 'completed' || state.finished ? 'disabled' : ''}>${name}</button>`).join('')}</div>
    <div class="order-vehicles">${o.vehicleIds.map(id => { const v = vehicle(id); return `<button class="mini ${esc(v.state)}" data-vehicle="${esc(id)}" title="${esc(v.status)}">${esc(id.replace('DEMO-', '#'))} <span>${esc(VEHICLE_STATES[v.state])}</span></button>`; }).join('')}</div></article>`;
  }).join('');
}

// ---------- Shift and analytics ----------
function renderShift() {
  const t = state.totals, f = state.forecast, max = Math.max(state.plan.total, t.created, 4);
  const x = m => 50 + m / 480 * 690, y = v => 230 - v / max * 205;
  const line = pts => pts.map(p => `${x(p.minute).toFixed(1)},${y(p.accepted).toFixed(1)}`).join(' ');
  const ticks = [0, Math.round(max / 2), max];
  const hist = [...state.history]; if (hist.at(-1).minute !== state.elapsed) hist.push({ minute: state.elapsed, accepted: t.accepted });
  $('shift-chart').innerHTML = ticks.map(v => `<line class="chart-grid" x1="50" x2="740" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="40" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('') +
    [0, 120, 240, 360, 480].map(m => `<text class="chart-axis" x="${x(m)}" y="255" text-anchor="middle">${clock(m)}</text>`).join('') +
    `<line class="chart-now" x1="${x(state.elapsed)}" x2="${x(state.elapsed)}" y1="20" y2="230"/>` +
    `<polyline class="chart-plan" points="${line(state.plan.profile)}"/><polyline class="chart-forecast" points="${line(f.trajectory)}"/><polyline class="chart-fact" points="${line(hist)}"/>` +
    `<circle cx="${x(state.elapsed)}" cy="${y(t.accepted)}" r="4" class="chart-dot"/><text class="chart-label" x="736" y="${y(state.plan.total) - 6}" text-anchor="end">план ${state.plan.total}</text>`;
  const delta = t.accepted - state.plan.now;
  $('shift-numbers').innerHTML = [
    ['Принято контролем', t.accepted], ['План смены', state.plan.total], ['План к этому времени', state.plan.now], ['Отклонение сейчас', `${delta >= 0 ? '+' : ''}${delta}`],
    ['В работе (WIP)', t.inProcess], ['Не начаты', t.notStarted], ['Готовы к отгрузке', t.ready], ['Отгружено', t.shipped],
    ['Создано всего', `${t.created} ${t.balanced ? '✓ баланс сходится' : '✗ баланс нарушен'}`], ['Среднее время прохождения', state.leadTime ? `${fmt(state.leadTime.average)} мин (${state.leadTime.count} авт.)` : '—'],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('forecast-box').innerHTML = `<p class="forecast-big"><strong>${f.projected}</strong> <span>принятых к 16:00${f.low < f.projected ? ` · сценарный диапазон ${f.low}–${f.high}` : ''} · ${f.gap >= 0 ? 'запас' : 'дефицит'} ${Math.abs(f.gap)} к плану</span></p>
    <ul class="scenarios">${f.scenarios.map(s => `<li>${esc(s.name)}: <b>${s.accepted}</b></li>`).join('')}</ul>
    ${f.limiting ? `<p>Ограничивающий участок до конца смены: <b>${esc(f.limiting.name)}</b>, загрузка ${pct(f.limiting.utilization)}.</p>` : '<p>Смена завершена — прогноз равен факту.</p>'}
    ${f.constraints.length ? `<p class="negative">Ограничения: ${f.constraints.map(esc).join('; ')}</p>` : ''}
    <p class="fine-print">${esc(f.method)} ${esc(f.assumption)} Незавершённых к 16:00 по прогнозу: ${f.openAtEnd}.</p>`;
  const cols = ['Пост', 'Участок', 'Состояние', 'A', 'P', 'Q', 'OEE', 'Работа', 'Неиспр.', 'Нет входа', 'Блок.', 'Операций'];
  $('oee-table').innerHTML = `<thead><tr>${cols.map(c => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${state.posts.map(p => `<tr><th scope="row"><button class="link" data-post-link="${esc(p.id)}">${esc(p.code)}</button></th><td>${esc(p.stageName)}</td><td>${esc(POST_SHORT[p.state])}</td><td>${pct(p.metrics.availability)}</td><td>${pct(p.metrics.performance)}</td><td>${pct(p.metrics.quality)}</td><td><b>${pct(p.metrics.oee)}</b></td><td>${p.stats.run}</td><td>${p.stats.fault}</td><td>${p.stats.starved}</td><td>${p.stats.blocked}</td><td>${p.stats.completed}</td></tr>`).join('')}</tbody>`;
  $('incident-log').innerHTML = state.incidents.length ? state.incidents.map(i => `<article class="incident ${esc(i.status)}"><div class="incident-head"><strong>${i.severity === 'critical' ? '●' : '◇'} ${esc(i.title)}</strong><span>${clock(i.start)} → ${i.end !== null ? clock(i.end) : i.status === 'unresolved' ? 'не устранён' : '…'}</span></div><dl class="incident-meta"><div><dt>Пост / участок</dt><dd>${postLink(i.postId)} · ${esc(i.stageName)}${i.vehicleId ? ` · на посту был ${vehicleLink(i.vehicleId)}` : ''}</dd></div><div><dt>Причина (гипотеза)</dt><dd>${esc(i.cause)}</dd></div><div><dt>Рекомендация</dt><dd>${esc(i.advice)}</dd></div><div><dt>Действие устранения</dt><dd>${esc(i.status === 'resolved' ? `${i.resolution}. ${i.remedy}` : `Кнопка «Устранить»: ${i.remedy}`)}</dd></div></dl><div class="incident-bottom"><span>${esc(i.status === 'active' ? `Активен · расчётное восстановление ${clock(i.expires)}${i.expires > 480 ? ' (после конца смены)' : ''}` : i.status === 'unresolved' ? `Не устранён к концу смены · расчётное восстановление ${clock(i.expires)}` : i.resolution)}</span>${i.status === 'active' ? `<button data-resolve="${i.id}">Устранить</button>` : ''}</div></article>`).join('') : '<p class="muted">Инцидентов нет. Вызовите неисправность из карточки поста.</p>';
  const events = state.events.slice(-80).reverse();
  text('event-count', `последние ${events.length}`);
  $('event-log').innerHTML = events.map(e => `<li class="${esc(e.type)}"><time>${clock(e.minute)}</time><span>${esc(e.text)}</span>${e.actor === 'operator' ? '<em>оператор</em>' : ''}</li>`).join('');
  text('ai-stale', aiRevision === null ? '' : aiRevision !== state.revision ? 'Состояние изменилось после объяснения. Обновите его для текущего снимка.' : 'Объяснение относится к текущему снимку синтетических данных.');
}

// ---------- Routing and render ----------
function setView(next) {
  view = ['workshop', 'vehicles', 'orders', 'shift'].includes(next) ? next : 'workshop';
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== `view-${view}`;
  for (const a of document.querySelectorAll('[data-nav]')) { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  render();
}
// Re-rendering replaces elements; restore keyboard focus to the element with the same data attributes.
function focusKey(el) {
  if (!el || el === document.body || !el.closest('main')) return null;
  const attrs = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}
function render() {
  if (!state) return;
  const key = focusKey(document.activeElement);
  renderAll();
  if (key && !document.activeElement?.closest('main')) document.querySelector(key)?.focus({ preventScroll: true });
}
function renderAll() {
  renderChrome();
  if (view === 'workshop') { renderActiveIncidents(); renderMap(); renderPostDetail(); renderPostBoard(); }
  else if (view === 'vehicles') renderVehicles();
  else if (view === 'orders') renderOrders();
  else renderShift();
}
function openVehicle(id) { selectedVehicle = id; if (!filterOf[vehicleFilter](vehicle(id))) vehicleFilter = 'all'; location.hash = 'vehicles'; if (view === 'vehicles') render(); requestAnimationFrame(() => $('vehicle-passport').scrollIntoView({ block: 'nearest' })); }
function openPost(id) { selectedPost = id; if (location.hash !== '#workshop') location.hash = 'workshop'; else render(); requestAnimationFrame(() => { if (matchMedia('(max-width: 1099px)').matches) $('post-detail').scrollIntoView({ block: 'nearest' }); }); }

window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
$('play').addEventListener('click', () => action({ action: state.running ? 'pause' : 'play' }));
$('step').addEventListener('click', () => action({ action: 'step' }));
$('reset').addEventListener('click', () => action({ action: 'reset' }));
$('speed').addEventListener('change', e => action({ action: 'speed', value: Number(e.target.value) }));
$('release-form').addEventListener('submit', async e => {
  e.preventDefault();
  const quantity = Number($('release-quantity').value), priority = new FormData(e.target).get('release-priority');
  if (await action({ action: 'release', model: $('release-model').value, quantity, priority })) text('release-note', `Задание ${state.orders.at(-1).id} выпущено: ${quantity} авт. во входном буфере. ${$('release-note').textContent}`);
});
document.addEventListener('click', e => {
  const t = e.target.closest('button, [role=button]'); if (!t || !state) return;
  if (t.dataset.post) { selectedPost = t.dataset.post; render(); return; }
  if (t.dataset.postLink) { openPost(t.dataset.postLink); return; }
  if (t.dataset.vehicle) { openVehicle(t.dataset.vehicle); return; }
  if (t.dataset.vehicleSelect) { selectedVehicle = t.dataset.vehicleSelect; renderVehicles(); if (matchMedia('(max-width: 1099px)').matches) $('vehicle-passport').scrollIntoView({ block: 'start' }); return; }
  if (t.dataset.filter) { vehicleFilter = t.dataset.filter; selectedVehicle = null; renderVehicles(); return; }
  if (t.dataset.orderLink) { location.hash = 'orders'; requestAnimationFrame(() => document.getElementById(`order-${t.dataset.orderLink}`)?.scrollIntoView({ block: 'start' })); return; }
  if (t.dataset.fault) { action({ action: 'fault', postId: t.dataset.fault, kind: t.dataset.kind }); return; }
  if (t.dataset.resolve) { action({ action: 'resolve', id: Number(t.dataset.resolve) }); return; }
  if (t.dataset.transfer) { action({ action: 'transfer', vehicleId: t.dataset.transfer, postId: t.dataset.to }); return; }
  if (t.dataset.priority) action({ action: 'priority', orderId: t.dataset.order, priority: t.dataset.priority });
});
$('workshop-map').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[role=button]')) { e.preventDefault(); e.target.closest('[role=button]').dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
$('explain').addEventListener('click', async () => {
  if (!state || aiBusy) return;
  aiBusy = true; $('explain').disabled = true; text('explain', 'Объясняю…');
  try { const r = await api('/api/explain', {}); text('ai-text', r.text); text('ai-source', `${r.source === 'nvidia' ? 'NVIDIA AI' : 'Локальное объяснение'} · ${r.message} · ${clock(r.minute)}`); aiRevision = r.revision; error(''); render(); }
  catch (e) { error(`Не удалось получить объяснение: ${e.message}. Расчётные показатели доступны выше.`); }
  finally { aiBusy = false; $('explain').disabled = false; text('explain', 'Объяснить ↗'); }
});
async function refresh() {
  if (updating || fetching) return;
  fetching = true;
  try {
    const next = await api('/api/state');
    if (!updating) { const changed = !state || state.revision !== next.revision || state.running !== next.running || state.speed !== next.speed || state.csrf !== next.csrf; state = next; if (changed) render(); error(''); }
  } catch { error('Нет связи с локальным сервером. Проверьте, что npm start продолжает работать. Повторяем подключение…'); }
  finally { fetching = false; }
}
await refresh(); setView(location.hash.slice(1)); setInterval(refresh, 1200);
