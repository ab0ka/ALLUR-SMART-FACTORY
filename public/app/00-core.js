// Allur client. The server owns all production state and every number; this file renders snapshots (the isometric
// scene and the detailed views), asks for confirmation and sends commands with a request id.
// Both imports stay on one line: tests strip the client import line before running parts in a VM.
import { AssemblyScene, enterpriseSvg, enterpriseCards, icon as sceneIcon } from './scene.js'; import { ShopScene, EnterpriseScene, SHOP_LAYOUTS } from './shop-scene.js';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(n);
const pct = n => `${fmt(n * 100)}%`;
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;
const clock = m => `${String(Math.floor((480 + m) / 60)).padStart(2, '0')}:${String((480 + m) % 60).padStart(2, '0')}`;
const requestId = () => (crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
const POST_STATES = { diagnosis: 'Ожидает диагностики узлов', idle: 'Свободен', working: 'Выполняет операцию', slow: 'Снижен темп / отклонение', blocked: 'Блокирован следующим буфером', fault: 'Неисправность', maintenance: 'Работы техника', shift_over: 'Смена завершена' };
const POST_SHORT = { diagnosis: 'Диагностика', idle: 'Свободен', working: 'Выполняет', slow: 'Отклонение', blocked: 'Блокирован', fault: 'Неисправность', maintenance: 'Ремонт/ТО', shift_over: 'Конец смены' };
const VEHICLE_STATES = { not_started: 'Не начат', waiting: 'Ожидает', processing: 'В работе', rework: 'Доработка', rework_wait: 'Ждёт доработки', paused: 'Пауза', blocked: 'Ждёт буфер', stopped: 'Остановлен концом смены', ready: 'Принят', shipped: 'Отгружен' };
const ORDER_STATES = { released: 'Выпущено', in_progress: 'В работе', completed: 'Выполнено' };
const PRIORITY = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' };
const HYP_STATUS = { confirmed: 'подтверждена проверкой', rejected: 'исключена', supported: 'поддерживается наблюдениями', open: 'не проверена' };
const JOB_STATUS = { queued: 'в очереди техника', running: 'выполняется', done: 'выполнена' };
const FILTERS = [['all', 'Все'], ['active', 'В работе'], ['queued', 'В очередях'], ['problem', 'Пауза, блокировки, доработка'], ['done', 'Приняты и отгружены']];
const filterOf = { all: () => true, active: v => ['processing', 'rework'].includes(v.state), queued: v => ['not_started', 'waiting'].includes(v.state), problem: v => ['paused', 'blocked', 'stopped', 'rework_wait', 'rework'].includes(v.state), done: v => v.accepted };
const SUGGESTED = ['Что сейчас угрожает плану?', 'Что делать с этой машиной?', 'Почему задерживается этот автомобиль?', 'На чём основана гипотеза неисправности?', 'Какую проверку выполнить?', 'Сравни ремонт сейчас и продолжение работы', 'Что даст перевод на другой пост?', 'Почему результат отличается от прогноза?'];
const VIEWS = ['overview', 'dispatcher', 'workshop', 'vehicles', 'orders', 'shift', 'handover', 'effect', 'lab', 'video', 'case'];
let state = null, view = 'space', selectedPost = 'A2', selectedVehicle = null, selectedProblem = null, vehicleFilter = 'all', chatContext = null;
let updating = false, fetching = false, aiRevision = null, aiBusy = false, chatBusy = false, lab = null;
const text = (id, value) => { $(id).textContent = value; };
function error(message) { $('error').hidden = !message; text('error', message || ''); }

async function api(path, body) {
  const options = body === undefined ? { signal: AbortSignal.timeout(8000) } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state?.csrf || '' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) };
  const response = await fetch(path, options), data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Ошибка запроса'), { code: data.code });
  return data;
}
async function action(body) {
  if (updating || !state) return false;
  updating = true;
  const production = !['play', 'pause', 'step', 'speed'].includes(body.action);
  if (production) setProductionPending(true);
  try {
    state = await api('/api/action', body); error(''); if (body.action === 'reset') { resetAi(); if (typeof invalidateHandover === 'function') invalidateHandover(); }
    // Restore the temporary lock before the new snapshot calculates availability.
    if (production) setProductionPending(false);
    render(); return true;
  }
  catch (e) { error(e.message); return false; }
  finally { updating = false; if (production) setProductionPending(false); }
}

// Keep existing availability flags when locking rendered production controls.
const PRODUCTION_CONTROLS = '#release-form button[type=submit], #plan-form button[type=submit], [data-check], [data-job], [data-fault], [data-transfer], [data-hold], [data-priority], [data-apply], [data-apply-choice], [data-proposal]';
let productionPending = false;
const productionButtonState = new Map();
function renderProductionBusy() {
  if (!productionPending) return;
  for (const b of document.querySelectorAll(PRODUCTION_CONTROLS)) {
    if (!productionButtonState.has(b)) productionButtonState.set(b, { disabled: b.disabled, text: b.textContent });
    b.disabled = true; if (b.textContent !== 'Выполняется…') b.textContent = 'Выполняется…';
  }
}
const productionObserver = new MutationObserver(renderProductionBusy);
function setProductionPending(on) {
  productionPending = on;
  if (on) { renderProductionBusy(); productionObserver.observe(document.body, { childList: true, subtree: true }); }
  else {
    productionObserver.disconnect();
    for (const [b, before] of productionButtonState) { b.disabled = before.disabled; b.textContent = before.text; }
    productionButtonState.clear();
  }
}
const rejectedComparisons = new Set();

function resetAi() { rejectedComparisons.clear(); aiRevision = null; text('ai-text', 'Смена сброшена. Запросите объяснение нового снимка.'); text('ai-source', 'Локальный режим доступен без ключа'); }
// Every shift-changing action from the dispatcher, chat or proposals goes through this confirmation.
function confirmAction(title, bodyHtml) {
  const d = $('confirm');
  // Reject competing intents before changing the visible consequences or adding listeners.
  if (d.open || updating) return Promise.resolve(false);
  return new Promise(resolve => {
    text('confirm-title', title); $('confirm-body').innerHTML = bodyHtml;
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      d.removeEventListener('click', onClick);
      d.removeEventListener('close', onClose);
      d.removeEventListener('cancel', onCancel);
      resolve(ok);
    };
    // The button click decides synchronously; the close event (Esc, backdrop) is the fallback.
    const onClick = e => { const b = e.target.closest('button'); if (b) finish(b.value === 'ok'); };
    // A delayed close from the previous dialog must not cancel a newly opened one.
    const onClose = () => { if (!d.open) finish(false); };
    const onCancel = () => finish(false);
    d.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
    d.addEventListener('cancel', onCancel);
    d.returnValue = 'cancel'; d.showModal(); $('confirm-ok').focus();
  });
}

const post = id => state.posts.find(p => p.id === id);
const vehicle = id => state.vehicles.find(v => v.id === id);
const order = id => state.orders.find(o => o.id === id);
const problem = id => state.problems.find(p => p.id === id);
const bar = (value, cls = '') => `<span class="bar ${cls}" aria-hidden="true"><svg viewBox="0 0 100 6" preserveAspectRatio="none"><rect class="bar-bg" width="100" height="6" rx="3"/><rect class="bar-fill" width="${Math.max(0, Math.min(100, value * 100))}" height="6" rx="3"/></svg></span>`;
const vehicleLink = id => `<button class="link" data-vehicle="${esc(id)}">${esc(id)}</button>`;
const postLink = id => `<button class="link" data-post-link="${esc(id)}">${esc(post(id)?.code ?? id)}</button>`;
const orderLink = id => `<button class="link" data-order-link="${esc(id)}">${esc(id)}</button>`;
const problemLink = id => `<button class="link" data-problem="${esc(id)}">${esc(id)}</button>`;

// ---------- Summary and toolbar ----------
function renderChrome() {
  const t = state.totals, f = state.forecast;
  text('clock', clock(state.elapsed));
  text('run-status', state.finished ? 'смена завершена' : state.running ? 'идёт смена' : 'пауза');
  const play = $('play'); play.disabled = state.finished; play.classList.toggle('running', state.running); play.setAttribute('aria-label', state.running ? 'Пауза' : 'Запустить'); $('step').disabled = state.finished;
  for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === state.speed));
  text('pf-accepted', t.accepted); text('pf-plan', state.plan.target); text('pf-forecast', `прогноз ${f.projected}`);
  $('pf-forecast').className = f.projected < state.plan.target ? 'warn-text' : 'ok-text';
  $('pf-fill').setAttribute('width', String(Math.min(100, t.accepted / state.plan.target * 100)));
  $('pf-mark').setAttribute('x', String(Math.min(98.5, f.projected / state.plan.target * 100)));
  $('planfact').setAttribute('aria-label', `План-факт: принято ${t.accepted} из ${state.plan.target}, прогноз к 16:00 — ${f.projected}`);
  // The counter is the length of the server task list shown in «Задачи и решения» — never a separate calculation.
  const open = state.tasks.length, eq = state.tasks.filter(x => ['equipment', 'incident'].includes(x.category)).length;
  $('alerts').hidden = !open; text('alerts-count', open); $('alerts').setAttribute('aria-label', `Задачи смены: ${open} (оборудование ${eq}, автомобили и сроки ${open - eq})`);
  $('alerts').href = '#dispatcher';
  $('diag-count').hidden = !open; text('diag-count', open);
  text('nav-vehicles', t.created); text('nav-orders', state.orders.length); text('nav-problems', open ? `${open}` : '');
  if (view === 'space') return;
  $('summary').innerHTML = [
    ['Факт: принято', `${t.accepted}`],
    ['План смены (задан)', `${state.plan.target}`],
    ['Эталонная мощность', `${state.plan.reference?.total ?? '—'} <small>к сейчас ${state.plan.reference?.now ?? '—'}</small>`],
    ['Прогноз к 16:00', `${f.projected}${f.low < f.high ? ` <small>${f.low}–${f.high}</small>` : ''} <small class="${f.gap >= 0 ? 'positive' : 'negative'}">${f.gap >= 0 ? '+' : ''}${f.gap} к плану</small>`],
    ['В работе', `${t.inProcess}${t.rework ? ` <small>доработка ${t.rework}</small>` : ''}`], ['Не начаты', t.notStarted],
    ['Ограничивает', f.limiting ? esc(f.limiting.name) : '—'],
  ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}
