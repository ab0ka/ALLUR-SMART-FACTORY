// Allur client. The server owns all production state and every number; this file renders snapshots (the isometric
// scene and the detailed views), asks for confirmation and sends commands with a request id.
import { AssemblyScene, enterpriseSvg, enterpriseCards, icon as sceneIcon } from './scene.js';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(n);
const pct = n => `${fmt(n * 100)}%`;
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;
const clock = m => `${String(Math.floor((480 + m) / 60)).padStart(2, '0')}:${String((480 + m) % 60).padStart(2, '0')}`;
const requestId = () => (crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
const POST_STATES = { idle: 'Свободен', working: 'Выполняет операцию', slow: 'Снижен темп / отклонение', blocked: 'Блокирован следующим буфером', fault: 'Неисправность', maintenance: 'Работы техника', shift_over: 'Смена завершена' };
const POST_SHORT = { idle: 'Свободен', working: 'Выполняет', slow: 'Отклонение', blocked: 'Блокирован', fault: 'Неисправность', maintenance: 'Ремонт/ТО', shift_over: 'Конец смены' };
const VEHICLE_STATES = { not_started: 'Не начат', waiting: 'Ожидает', processing: 'В работе', rework: 'Доработка', rework_wait: 'Ждёт доработки', paused: 'Пауза', blocked: 'Ждёт буфер', stopped: 'Остановлен концом смены', ready: 'Принят', shipped: 'Отгружен' };
const ORDER_STATES = { released: 'Выпущено', in_progress: 'В работе', completed: 'Выполнено' };
const PRIORITY = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' };
const HYP_STATUS = { confirmed: 'подтверждена проверкой', rejected: 'исключена', supported: 'поддерживается наблюдениями', open: 'не проверена' };
const JOB_STATUS = { queued: 'в очереди техника', running: 'выполняется', done: 'выполнена' };
const FILTERS = [['all', 'Все'], ['active', 'В работе'], ['queued', 'В очередях'], ['problem', 'Пауза, блокировки, доработка'], ['done', 'Приняты и отгружены']];
const filterOf = { all: () => true, active: v => ['processing', 'rework'].includes(v.state), queued: v => ['not_started', 'waiting'].includes(v.state), problem: v => ['paused', 'blocked', 'stopped', 'rework_wait', 'rework'].includes(v.state), done: v => v.accepted };
const SUGGESTED = ['Что сейчас угрожает плану?', 'Почему задерживается этот автомобиль?', 'На чём основана гипотеза неисправности?', 'Какую проверку выполнить?', 'Сравни ремонт сейчас и продолжение работы', 'Что даст перевод на другой пост?', 'Почему результат отличается от прогноза?'];
const VIEWS = ['dispatcher', 'workshop', 'vehicles', 'orders', 'shift', 'lab'];
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
  try { state = await api('/api/action', body); error(''); if (body.action === 'reset') resetAi(); render(); return true; }
  catch (e) { error(e.message); return false; }
  finally { updating = false; }
}
function resetAi() { aiRevision = null; selectedProblem = null; text('ai-text', 'Смена сброшена. Запросите объяснение нового снимка.'); text('ai-source', 'Локальный режим доступен без ключа'); }
// Every shift-changing action from the dispatcher, chat or proposals goes through this confirmation.
function confirmAction(title, bodyHtml) {
  return new Promise(resolve => {
    const d = $('confirm'); text('confirm-title', title); $('confirm-body').innerHTML = bodyHtml;
    let done = false;
    const finish = ok => { if (done) return; done = true; d.removeEventListener('click', onClick); resolve(ok); };
    // The button click decides synchronously; the close event (Esc, backdrop) is the fallback.
    const onClick = e => { const b = e.target.closest('button'); if (b) finish(b.value === 'ok'); };
    d.addEventListener('click', onClick);
    d.addEventListener('close', () => finish(d.returnValue === 'ok'), { once: true });
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
  const open = state.problems.filter(p => p.status === 'open').length;
  $('alerts').hidden = !open; text('alerts-count', open); $('alerts').setAttribute('aria-label', `Открытых проблем: ${open}`);
  $('diag-count').hidden = !open; text('diag-count', open);
  text('nav-vehicles', t.created); text('nav-orders', state.orders.length); text('nav-problems', open ? `${open} откр.` : '');
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

// ---------- Dispatcher ----------
function currentProblem() {
  if (selectedProblem && problem(selectedProblem)) return problem(selectedProblem);
  return state.problems.find(p => p.status === 'open') ?? state.problems[0] ?? null;
}
function renderThreat() {
  const f = state.forecast, open = state.problems.filter(p => p.status === 'open');
  const due = state.orders.filter(o => o.dueMinute <= state.shift);
  $('threat').innerHTML = `<div class="threat-row">
    <div class="big-number ${f.gap < 0 ? 'negative' : 'positive'}"><strong>${f.projected}</strong><span>прогноз к 16:00 без новых вмешательств${f.low < f.high ? ` · по гипотезам ${f.low}–${f.high}` : ''}</span></div>
    <div class="big-number"><strong>${state.plan.target}</strong><span>план смены (задан оператором)</span></div>
    <div class="big-number muted-number"><strong>${state.plan.reference?.total ?? '—'}</strong><span>эталонная мощность симуляции</span></div>
    <div class="big-number"><strong>${state.totals.accepted}</strong><span>факт: принято сейчас</span></div></div>
    <h3>Сроки заданий в этой смене</h3>
    <ul class="due-list">${due.map(o => { const late = f.lateOrders.includes(o.id); return `<li class="${late ? 'negative' : ''}">${orderLink(o.id)} — ${esc(state.models.find(m => m.id === o.modelId).name)} × ${o.quantity}, срок ${clock(o.dueMinute)}, принято ${o.accepted}/${o.quantity} · ${late ? 'по прогнозу опоздает' : 'по прогнозу успевает'}</li>`; }).join('') || '<li class="muted">Нет заданий со сроком в смене</li>'}</ul>
    <h3>Проблемы</h3>
    ${state.problems.length ? `<div class="problem-list">${state.problems.map(p => `<button class="problem-item ${esc(p.status)}${currentProblem()?.id === p.id ? ' selected' : ''}" data-problem="${esc(p.id)}" aria-pressed="${currentProblem()?.id === p.id}"><b>${esc(p.id)}</b><span>${esc(p.title)}</span><span>${p.status === 'open' ? `обнаружена ${clock(p.detectedAt)}` : p.status === 'resolved' ? `закрыта ${clock(p.resolvedAt)}` : 'не устранена к концу смены'}</span></button>`).join('')}</div>` : '<p class="muted">Проблем не обнаружено. Отклонения подъёмников сборки отслеживаются по измерениям; ручной сценарий неисправности можно вызвать из карточки поста в «Цехе».</p>'}
    ${!open.length && f.gap < 0 ? '<p class="fine-print">Дефицит к плану без открытых проблем вызван мощностью и браком — сравните с эталонной мощностью.</p>' : ''}`;
}
function sparkline(eq, channel, nominal, unit, detectedAt) {
  const from = Math.max(0, state.elapsed - 150), rs = eq.readings.filter(r => r.minute >= from && r[channel] !== null);
  const W = 300, H = 92, pad = 26;
  if (rs.length < 2) return `<div class="spark"><span>${esc(channel)}</span><p class="muted">мало данных</p></div>`;
  const vals = rs.map(r => r[channel]), lo = Math.min(...vals, nominal) - 2, hi = Math.max(...vals, nominal) + 2;
  const x = m => pad + (m - from) / Math.max(1, state.elapsed - from) * (W - pad - 6), y = v => 8 + (hi - v) / (hi - lo) * (H - 26);
  const names = { pressure: 'Давление', temperature: 'Температура масла', cycle: 'Время цикла' };
  return `<figure class="spark"><figcaption>${names[channel]}, ${esc(unit)} <span>норма ${nominal}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${names[channel]}: последнее ${vals.at(-1)} ${esc(unit)}, норма ${nominal}">
    <line class="spark-nominal" x1="${pad}" x2="${W - 6}" y1="${y(nominal)}" y2="${y(nominal)}"/>
    ${detectedAt !== null && detectedAt >= from ? `<line class="spark-mark" x1="${x(detectedAt)}" x2="${x(detectedAt)}" y1="4" y2="${H - 18}"/>` : ''}
    <polyline class="spark-line" points="${rs.map(r => `${x(r.minute).toFixed(1)},${y(r[channel]).toFixed(1)}`).join(' ')}"/>
    <text class="chart-axis" x="${pad}" y="${H - 4}">${clock(from)}</text><text class="chart-axis" x="${W - 6}" y="${H - 4}" text-anchor="end">${clock(state.elapsed)}</text>
    <text class="chart-axis" x="${pad - 4}" y="${y(hi - 2) + 4}" text-anchor="end">${fmt(hi - 2, 0)}</text><text class="chart-axis" x="${pad - 4}" y="${y(lo + 2) + 4}" text-anchor="end">${fmt(lo + 2, 0)}</text></svg></figure>`;
}
function renderProblemCard() {
  const p = currentProblem(), card = $('problem-card');
  if (!p) { card.innerHTML = '<h2 class="panel-title">Проблема</h2><p class="muted">Нет обнаруженных проблем. Запустите смену или сделайте шаг времени: отклонения оборудования обнаруживаются по измерениям.</p>'; return; }
  const eq = p.equipmentId ? state.equipment.find(e => e.id === p.equipmentId) : null;
  const risk = state.risk?.items?.find(r => r.postId === p.postId);
  let html = `<div class="detail-head"><div><span class="eyebrow">ПРОБЛЕМА · ${p.kind === 'equipment' ? 'ОБОРУДОВАНИЕ' : 'РУЧНОЙ СЦЕНАРИЙ'}</span><h2>${esc(p.id)} · ${esc(p.title)}</h2></div><span class="status-pill ${p.status === 'open' ? 'fault' : p.status === 'resolved' ? 'ready' : 'stopped'}">${p.status === 'open' ? 'Открыта' : p.status === 'resolved' ? 'Закрыта' : 'Не устранена'}</span></div>`;
  html += `<dl class="facts"><div><dt>Обнаружена</dt><dd>${clock(p.detectedAt)}${p.resolvedAt !== null ? ` · закрыта ${clock(p.resolvedAt)}: ${esc(p.resolution)}` : ''}</dd></div><div><dt>Пост</dt><dd>${postLink(p.postId)} · ${esc(p.stageName)}${p.hold ? ' · снят с загрузки' : ''}</dd></div><div><dt>Автомобили</dt><dd>${p.vehicleIds.map(vehicleLink).join(', ') || '—'}</dd></div><div><dt>Задания</dt><dd>${p.orderIds.map(orderLink).join(', ') || '—'}</dd></div></dl>`;
  if (eq) html += `<h3>Измерения ${esc(eq.name)} (синтетические, каждые 5 мин)</h3><div class="sparks">${['pressure', 'temperature', 'cycle'].map(c => sparkline(eq, c, p.latest?.[c]?.nominal ?? { pressure: 180, temperature: 45, cycle: 42 }[c], { pressure: 'бар', temperature: '°C', cycle: 'с' }[c], p.detectedAt)).join('')}</div>`;
  if (p.latest) html += `<p class="fine-print">Средние за 30 мин: ${Object.values(p.latest).map(c => `${esc(c.name.toLowerCase())} ${fmt(c.mean)} ${esc(c.unit)} (норма ${c.nominal}, тренд ${signed(c.slopePerHour)} в час)`).join('; ')}. Индекс отклонения z = ${fmt(p.anomalyScore)} (порог обнаружения 4,5).</p>`;
  if (risk) html += `<p class="risk-line">${risk.failed ? esc(risk.text) : risk.probability === null || risk.probability === undefined ? esc(risk.text) : `Риск отказа в ближайшие 30 мин: <b>${pct(risk.probability)}</b> (модель ${esc(state.risk.modelVersion)}) · правило-baseline: ${risk.baselineAlarm ? 'тревога' : 'норма'} · рабочий вариант: ${state.risk.selected === 'model' ? 'модель' : 'baseline'}`} <button class="link" data-nav-to="lab">как обучена</button></p>`;
  else if (state.risk && !state.risk.available) html += `<p class="fine-print">${esc(state.risk.reason)}</p>`;
  html += `<h3>Гипотезы причин</h3><ul class="hypotheses">${p.hypotheses.map(h => `<li class="${esc(h.status)}"><div class="hyp-head"><b>${esc(h.title)}</b><span>${h.probability !== null ? pct(h.probability) : '—'} · ${esc(HYP_STATUS[h.status])}</span></div>${h.probability !== null ? bar(h.probability, 'wide') : ''}<p class="fine-print">${esc(h.basis)}</p></li>`).join('')}</ul>`;
  if (p.kind === 'equipment') html += '<p class="fine-print">Вес гипотезы — согласие измерений с моделью причины, а не диагноз. Скрытая причина генератора не показывается; её устанавливает проверка.</p>';
  html += `<h3>Наблюдения и проверки</h3><ol class="history">${p.observations.map(o => `<li><time>${clock(o.minute)}</time><span>${esc(o.text)}</span></li>`).join('')}</ol>`;
  if (p.availableChecks?.length && p.status === 'open') html += `<div class="actions inline">${p.availableChecks.map(c => `<button data-check="${esc(c.kind)}" data-post-id="${esc(p.postId)}" ${c.ok ? '' : 'disabled'} title="${esc(c.ok ? '' : c.reason)}">${esc(c.title)} · ${c.duration} мин${c.stopsPost ? ' · пост стоит' : ''}${c.done ? ' · выполнена' : ''}</button>`).join('')}</div><p class="fine-print">Проверка занимает техника ТЕХ-1 и модельное время; результат появится в наблюдениях после выполнения.</p>`;
  if (p.jobs.length) html += `<h3>Работы техника</h3><ul class="jobs">${p.jobs.map(j => `<li><b>${esc(j.id)}</b> ${esc(j.title)} — ${esc(JOB_STATUS[j.status])}${j.status === 'running' ? `, осталось ${j.remaining} мин` : ''}${j.result ? ` · ${esc(j.result.text)}` : ''}</li>`).join('')}</ul>`;
  card.innerHTML = html;
}
function optionCard(o, exp, decided) {
  if (!o.available) return `<article class="option unavailable"><h3>${esc(o.title)}</h3><p class="negative">Недоступно: ${esc(o.reason)}</p></article>`;
  const e = o.expected, late = Object.entries(e.lateOrderRisk);
  const stale = exp.baseRevision !== state.revision;
  return `<article class="option${o.id === 'continue' ? ' baseline' : ''}"><h3>${esc(o.title)}${o.id === 'continue' ? ' <span class="tag">базовый</span>' : ''}</h3><p class="fine-print">${esc(o.description)}</p>
    <dl class="option-metrics">
      <div><dt>Годный выпуск к 16:00</dt><dd><b>${fmt(e.accepted)}</b>${o.id !== 'continue' ? ` <span class="${o.delta.accepted > 0 ? 'positive' : o.delta.accepted < 0 ? 'negative' : ''}">${signed(o.delta.accepted)}</span>` : ''} <small>диапазон ${o.range.accepted[0]}–${o.range.accepted[1]}</small></dd></div>
      <div><dt>Сроки заданий</dt><dd>${late.length ? late.map(([id, p]) => `${esc(id)}: риск опоздания ${pct(p)}`).join(', ') : `все ${e.ordersDue} в срок`}</dd></div>
      <div><dt>Простой постов</dt><dd>${fmt(e.downtime)} мин${o.id !== 'continue' ? ` (${signed(o.delta.downtime)})` : ''}</dd></div>
      <div><dt>Незавершено к 16:00</dt><dd>${fmt(e.wip)} в работе · ${fmt(e.notStarted)} не начаты</dd></div>
      <div><dt>Ресурсы</dt><dd>техник ${fmt(e.techMinutes)} мин${Object.entries(e.parts).filter(([, n]) => n > 0).map(([k, n]) => ` · ${esc(state.stock.find(s => s.id === k)?.name ?? k)} ${fmt(n, 2)}`).join('')}</dd></div>
      <div><dt>Стоимость действия</dt><dd>${fmt(e.cost, 0)} ${esc(state.tariffs.currency)} <small>синтетические тарифы</small></dd></div>
    </dl>
    <details><summary>По сценариям причин</summary><ul class="scenarios">${o.perScenario.map(s => `<li>${esc(s.label)}: выпуск ${s.accepted}, простой ${s.downtime} мин${s.lateOrders.length ? `, опоздают ${esc(s.lateOrders.join(', '))}` : ''}</li>`).join('')}</ul></details>
    ${decided || state.finished ? '' : `<button class="${o.id === 'continue' ? '' : 'primary'}" data-apply="${esc(o.id)}" data-exp="${esc(exp.id)}" ${stale ? 'disabled' : ''}>Применить этот вариант</button>`}</article>`;
}
function renderComparison() {
  const p = currentProblem(), box = $('comparison');
  if (!p) { box.innerHTML = '<h2 id="h-compare" class="panel-title">Сравнение решений</h2><p class="muted">Появится, когда будет обнаружена проблема.</p>'; return; }
  const exp = [...state.experiments].reverse().find(e => e.problemId === p.id);
  const decided = exp && state.decisions.some(d => d.experimentId === exp.id);
  let html = `<div class="detail-head"><h2 id="h-compare" class="panel-title">Сравнение решений для ${esc(p.id)}</h2>${p.status === 'open' && !state.finished ? `<button class="primary" data-compare="${esc(p.id)}">${exp ? 'Пересчитать варианты' : 'Сравнить варианты'}</button>` : ''}</div>`;
  if (!exp) html += `<p class="muted">${p.status === 'open' ? 'Нажмите «Сравнить варианты»: смена будет поставлена на паузу, сервер прогонит каждый вариант на отдельной копии текущего снимка до 16:00.' : 'Проблема закрыта.'}</p>`;
  else {
    const stale = exp.baseRevision !== state.revision;
    html += `<p class="fine-print">${esc(exp.id)} · снимок ${clock(exp.minute)} · сценарии причин: ${exp.scenarios.map(s => `${esc(s.label)}`).join('; ')}. ${esc(exp.method)}</p>`;
    if (stale && !decided && p.status === 'open') html += `<p class="stale">Снимок устарел: смена изменилась после расчёта. Пересчитайте варианты перед применением.</p>`;
    if (decided) html += `<p class="positive">По этому сравнению принято решение — см. журнал решений ниже.</p>`;
    html += `<div class="options">${exp.options.map(o => optionCard(o, exp, decided)).join('')}</div>`;
  }
  box.innerHTML = html;
}
function renderDecisions() {
  $('decision-log').innerHTML = state.decisions.length ? [...state.decisions].reverse().map(d => {
    const r = d.report, o = r.observed;
    return `<article class="decision"><div class="detail-head"><h3>${esc(d.id)} · ${esc(d.title)}</h3><span class="tag">${clock(d.appliedAt)} · ${problemLink(d.problemId)}</span></div>
    <div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">Ветка</th><th scope="col">Тип</th><th scope="col">Выпуск к 16:00</th><th scope="col">Простой, мин</th><th scope="col">Техник, мин</th><th scope="col">Затраты</th></tr></thead><tbody>
      <tr class="observed"><th scope="row">Выбранная</th><td>${esc(o.label)}</td><td><b>${o.accepted}</b>${o.final ? '' : ' (пока)'}</td><td>${o.downtime}</td><td>${o.techMinutes}</td><td>${fmt(o.cost, 0)}</td></tr>
      <tr><th scope="row">Выбранная</th><td>${esc(r.expectedLabel)}</td><td>${fmt(d.expected.accepted)} <small>${d.range.accepted[0]}–${d.range.accepted[1]}</small></td><td>${fmt(d.expected.downtime)}</td><td>${fmt(d.expected.techMinutes)}</td><td>${fmt(d.expected.cost, 0)}</td></tr>
      ${d.alternatives.map(a => `<tr class="simulated"><th scope="row">${esc(a.title)}</th><td>Альтернатива — симуляция на ${clock(d.appliedAt)}, не факт</td><td>${fmt(a.expected.accepted)} <small>${a.range.accepted[0]}–${a.range.accepted[1]}</small></td><td>${fmt(a.expected.downtime)}</td><td>${fmt(a.expected.techMinutes)}</td><td>${fmt(a.expected.cost, 0)}</td></tr>`).join('')}
    </tbody></table></div>
    <ul class="notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></article>`;
  }).join('') : '<p class="muted">Решений ещё не принималось. После применения варианта здесь появится сравнение прогноза с наблюдаемым результатом; альтернативы останутся помеченными как симуляция.</p>';
}
// ---------- Chat ----------
function contextLabel(c) {
  if (!c) return 'без контекста';
  return { post: () => `пост ${post(c.id)?.code ?? c.id}`, vehicle: () => `автомобиль ${c.id}`, order: () => `задание ${c.id}`, problem: () => `проблема ${c.id}` }[c.type]();
}
function setChatContext(type, id) { chatContext = { type, id }; if (view === 'dispatcher') renderChat(); }
function renderChat() {
  const ai = state.ai;
  text('chat-mode', ai.configured ? `Модель: ${ai.provider === 'openai' ? 'OpenAI' : 'NVIDIA'} формулирует ответ только из рассчитанных фактов; при сбое — локальная логика. Числа проверяются сервером.` : 'Модель не подключена: работают локальные ответы на предложенные вопросы. Свободные вопросы без модели недоступны.');
  $('chat-context').innerHTML = `Контекст: <b>${esc(contextLabel(chatContext))}</b>${chatContext ? ' <button class="link" data-chat-clear="1">сбросить</button>' : ''}`;
  $('chat-suggest').innerHTML = SUGGESTED.map(q => `<button data-ask="${esc(q)}">${esc(q)}</button>`).join('');
  const log = $('chat-log'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.innerHTML = state.chat.map(m => `<li class="msg ${m.role}"><div class="msg-meta">${m.role === 'user' ? 'Диспетчер' : m.source === 'local' ? 'Локальная логика' : m.source === 'openai' ? 'OpenAI' : 'NVIDIA'} · ${clock(m.minute)}${m.context ? ` · ${esc(contextLabel(m.context))}` : ''}</div><div class="msg-text">${esc(m.text)}</div>
    ${m.note ? `<p class="fine-print">${esc(m.note)}</p>` : ''}
    ${m.refs?.length ? `<div class="refs">${m.refs.map(r => `<button class="ref" data-ref-type="${esc(r.type)}" data-ref-id="${esc(r.id)}">${esc(r.label)}</button>`).join('')}</div>` : ''}
    ${m.proposal ? `<div class="proposal"><span>Предложение: ${esc(m.proposal.title)}</span><button class="primary" data-proposal="${esc(m.id)}" ${state.finished ? 'disabled' : ''}>Подтвердить…</button></div>` : ''}
    ${m.tools?.length ? `<p class="fine-print">Серверные функции: ${esc(m.tools.join(', '))}</p>` : ''}</li>`).join('') || '<li class="muted">Задайте вопрос или выберите предложенный. Ответы ссылаются на конкретные посты, автомобили, задания и события.</li>';
  if (atBottom) log.scrollTop = log.scrollHeight;
}
const LEGACY_CHAT = { input: 'chat-input', send: 'chat-send', count: 'chat-count' };
async function ask(message, src = LEGACY_CHAT) {
  if (chatBusy || !message?.trim()) return;
  chatBusy = true;
  const busy = on => { const b = $(src.send); if (b) { b.disabled = on; b.textContent = on ? 'Думаю…' : 'Спросить'; } };
  busy(true);
  try { const r = await api('/api/chat', { message: message.trim(), context: chatContext ?? undefined }); state = r.state; if ($(src.input)) $(src.input).value = ''; if ($(src.count)) $(src.count).textContent = '0/500'; error(''); render(); }
  catch (e) { error(`Чат: ${e.message}`); }
  finally { chatBusy = false; busy(false); }
}
async function applyProposal(msgId) {
  const m = state.chat.find(x => x.id === msgId); if (!m?.proposal) return;
  const p = m.proposal;
  if (!await confirmAction(p.title, `<p>${esc(p.consequences)}</p>`)) return;
  if (p.kind === 'decision') await applyDecision(p.experimentId, p.optionId, true);
  else await action({ ...p.command, requestId: requestId() });
}
async function applyDecision(experimentId, optionId, confirmed = false) {
  const exp = state.experiments.find(e => e.id === experimentId), o = exp?.options.find(x => x.id === optionId);
  if (!o) return;
  const jobs = o.commands.filter(c => c.action === 'job').map(c => state.jobKinds.find(k => k.id === c.kind)).filter(Boolean);
  const stops = jobs.filter(k => k.stopsPost), parts = Object.entries(o.expected.parts ?? {}).filter(([, n]) => n > 0);
  const pc = post(problem(exp.problemId)?.postId)?.code ?? '';
  if (!confirmed && !await confirmAction(`Применить: ${o.title}`, `<p>${esc(o.description)}</p>${jobs.length ? `<p>Работы ТЕХ-1: ${jobs.map(k => `${esc(k.title.toLowerCase())} — ${k.duration} мин`).join('; ')}${jobs.some(k => k.type === 'repair' && k.id.startsWith('repair_') && k.id !== 'repair_generic') ? ', затем автоматическая проверка после ремонта' : ''}.</p>` : ''}${stops.length ? `<p><b>Пост ${esc(pc)} будет остановлен</b> на время работ; автомобиль на посту встанет на паузу.</p>` : ''}${parts.length ? `<p>Запчасти: ${parts.map(([id, n]) => `${esc(state.stock.find(s => s.id === id)?.name ?? id)} × ${fmt(n, 2)}`).join(', ')} (на складе: ${parts.map(([id]) => state.stock.find(s => s.id === id)?.available ?? '—').join(', ')}).</p>` : ''}<p>Ожидаемый годный выпуск к 16:00: <b>${fmt(o.expected.accepted)}</b> (диапазон ${o.range.accepted[0]}–${o.range.accepted[1]}); без вмешательства — ${fmt(exp.options[0].expected.accepted)}. Это расчёт на копиях снимка ${clock(exp.minute)}, не гарантия.</p><p>Ресурсы: техник ${fmt(o.expected.techMinutes)} мин, затраты ${fmt(o.expected.cost, 0)} ${esc(state.tariffs.currency)}</p><p class="fine-print">Если смена изменилась после расчёта, сервер отклонит применение. Повторное нажатие не создаст второе решение.</p>`)) return;
  if (updating) return;
  updating = true;
  try { const r = await api('/api/decision', { experimentId, optionId, requestId: requestId() }); state = r.state; error(''); if (view === 'space') { ui.panel = { type: 'problem', id: exp.problemId }; syncHash(); render(); } else { render(); $('decision-log').scrollIntoView({ block: 'nearest' }); } }
  catch (e) { error(e.code === 'stale' ? `${e.message}` : `Не удалось применить: ${e.message}`); }
  finally { updating = false; }
}
async function compare(problemId) {
  if (updating) return;
  if (state.running && !await action({ action: 'pause' })) return;
  updating = true;
  try { const r = await api('/api/compare', { problemId }); state = r.state; error(''); if (view === 'space') { ui.panel = { type: 'compare', id: problemId }; syncHash(); render(); } else { render(); $('comparison').scrollIntoView({ block: 'start' }); } }
  catch (e) { error(e.message); }
  finally { updating = false; }
}

// ---------- Workshop map ----------
const LAYOUT = {
  zones: [
    { stage: 'weld', x: 186, y: 30, w: 236 }, { stage: 'paint', x: 558, y: 30, w: 236 },
    { stage: 'assembly', x: 830, y: 300, w: 346 }, { stage: 'quality', x: 462, y: 300, w: 236 }, { stage: 'shipping', x: 200, y: 300, w: 126 },
  ],
  buffers: { BACKLOG: { x: 16, y: 30, w: 150, slots: 6 }, B1: { x: 442, y: 30, w: 96 }, B2: { x: 814, y: 30, w: 96 }, B3: { x: 714, y: 300, w: 96 }, FG: { x: 346, y: 300, w: 100 }, RWQ: { x: 930, y: 30, w: 100, slots: 4 } },
  rework: { x: 1040, y: 30, w: 136 }, shipped: { x: 16, y: 300, w: 166 },
};
const ZONE_H = 220, POST_W = 100, POST_H = 128;
function bufferZone(b, id) {
  const l = LAYOUT.buffers[id], slots = l.slots ?? b.capacity, ids = b.vehicleIds;
  let out = `<rect class="zone buffer${b.capacity !== null && ids.length >= b.capacity ? ' full' : ''}" x="${l.x}" y="${l.y}" width="${l.w}" height="${ZONE_H}" rx="10"/>`;
  out += `<text class="zone-label buffer-label" x="${l.x + 10}" y="${l.y + 22}">${esc({ BACKLOG: 'ВХОД', FG: 'ГОТОВЫЕ', RWQ: 'К ДОРАБ.' }[id] ?? id)}</text><text class="zone-count" x="${l.x + l.w - 10}" y="${l.y + 22}" text-anchor="end">${ids.length}${b.capacity !== null ? `/${b.capacity}` : ''}</text>`;
  for (let i = 0; i < slots; i++) {
    const y = l.y + 36 + i * 28, vid = ids[i];
    if (i === slots - 1 && ids.length > slots) { out += `<text class="more" x="${l.x + l.w / 2}" y="${y + 17}" text-anchor="middle">+${ids.length - slots + 1} в очереди</text>`; break; }
    out += vid ? vehicleChip(vehicle(vid), l.x + 8, y, l.w - 16) : `<rect class="slot-empty" x="${l.x + 8}" y="${y}" width="${l.w - 16}" height="24" rx="5"/>`;
  }
  return out + `<text class="buffer-name" x="${l.x + l.w / 2}" y="${l.y + ZONE_H - 10}" text-anchor="middle">${esc({ BACKLOG: 'кузова к сварке', B1: 'к окраске', B2: 'к сборке', B3: 'к контролю', FG: 'к отгрузке', RWQ: 'не прошли контроль' }[id])}</text>`;
}
function renderMap() {
  const stageName = Object.fromEntries(state.stages.map(s => [s.id, s]));
  let out = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrow-head"/></marker><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" class="grid-line"/></pattern></defs><rect width="1200" height="560" fill="url(#grid)"/>';
  out += '<path class="flow" d="M166 140H186M422 140H442M538 140H558M794 140H814" marker-end="url(#arrow)"/><path class="flow" d="M862 250V300" marker-end="url(#arrow)"/><path class="flow" d="M830 410H810M714 410H698M462 410H446M346 410H326M200 410H182" marker-end="url(#arrow)"/><path class="flow rework-flow" d="M640 300V270H980V250" marker-end="url(#arrow)"/><path class="flow rework-flow" d="M1108 250V280H762V300" marker-end="url(#arrow)"/>';
  for (const z of LAYOUT.zones) {
    const s = stageName[z.stage];
    out += `<rect class="zone" x="${z.x}" y="${z.y}" width="${z.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${z.x + 12}" y="${z.y + 22}">${esc(s.name.toUpperCase())} · ${s.postIds.length} ${s.postIds.length === 1 ? 'пост' : 'поста'}</text>`;
    s.postIds.forEach((id, i) => { out += postNode(post(id), z.x + 10 + i * (POST_W + 10), z.y + 50); });
  }
  for (const s of state.stages) out += bufferZone(s.buffer, s.buffer.id);
  out += bufferZone(state.rework.buffer, 'RWQ');
  const r = LAYOUT.rework; out += `<rect class="zone" x="${r.x}" y="${r.y}" width="${r.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${r.x + 12}" y="${r.y + 22}">ДОРАБОТКА</text>${postNode(post('R1'), r.x + 18, r.y + 50)}`;
  const sh = LAYOUT.shipped, shipped = state.vehicles.filter(v => v.shipped).sort((a, b) => b.shippedAt - a.shippedAt);
  out += `<rect class="zone done" x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${sh.x + 10}" y="${sh.y + 22}">ОТГРУЖЕНО</text><text class="zone-big" x="${sh.x + sh.w / 2}" y="${sh.y + 92}" text-anchor="middle">${shipped.length}</text>`;
  shipped.slice(0, 3).forEach((v, i) => { out += vehicleChip(v, sh.x + 10, sh.y + 116 + i * 28, sh.w - 20); });
  out += `<text class="map-caption" x="16" y="548">УСЛОВНАЯ СХЕМА · СИНТЕТИЧЕСКАЯ ПЛАНИРОВКА, НЕ CAD ALLUR · принято ${state.totals.accepted} · в работе ${state.totals.inProcess}</text>`;
  $('workshop-map').innerHTML = out;
}
function vehicleChip(v, x, y, w) {
  return `<g class="chip ${esc(v.state)}" role="button" tabindex="0" data-vehicle="${esc(v.id)}" aria-label="${esc(`${v.id}, ${v.modelName}, ${v.status}`)}"><rect x="${x}" y="${y}" width="${w}" height="24" rx="5"/><text x="${x + 7}" y="${y + 16}">${esc(v.id.replace('DEMO-', '#'))}</text><text class="chip-model" x="${x + w - 7}" y="${y + 16}" text-anchor="end">${esc(v.modelId)}${v.priority === 'high' ? ' ↑' : ''}${v.reworked ? ' ↺' : ''}</text></g>`;
}
function postNode(p, x, y) {
  const v = p.vehicleId ? vehicle(p.vehicleId) : null, sel = selectedPost === p.id;
  const label = `${p.code}: ${POST_STATES[p.state]}${v ? `, ${v.id}, ${p.operation}, ${Math.round(p.progress * 100)}%` : ''}${p.problemId ? `, проблема ${p.problemId}` : ''}`;
  let inner = `<rect class="post-box" x="${x}" y="${y}" width="${POST_W}" height="${POST_H}" rx="8"/><text class="post-code" x="${x + 8}" y="${y + 19}">${esc(p.code)}</text><circle class="post-dot" cx="${x + POST_W - 12}" cy="${y + 14}" r="5"/><text class="post-state" x="${x + 8}" y="${y + 37}">${esc(POST_SHORT[p.state])}${p.hold ? ' · стоп-загр.' : ''}</text>`;
  if (v) inner += `<text class="post-vehicle" x="${x + 8}" y="${y + 64}">${esc(v.id)}</text><text class="post-model" x="${x + 8}" y="${y + 81}">${esc(v.modelName)}${v.priority === 'high' ? ' · ↑' : ''}</text><rect class="pbar-bg" x="${x + 8}" y="${y + 92}" width="${POST_W - 16}" height="6" rx="3"/><rect class="pbar" x="${x + 8}" y="${y + 92}" width="${(POST_W - 16) * p.progress}" height="6" rx="3"/><text class="post-progress" x="${x + 8}" y="${y + 116}">${Math.round(p.progress * 100)}% · ${p.progress >= 1 ? 'готово' : `${fmt(p.remaining)} мин`}</text>`;
  else inner += `<text class="post-empty" x="${x + POST_W / 2}" y="${y + 84}" text-anchor="middle">нет автомобиля</text>`;
  if (p.problemId) inner += `<text class="post-problem" x="${x + POST_W - 8}" y="${y + 37}" text-anchor="end">${esc(p.problemId)}</text>`;
  return `<g class="post ${esc(p.state)}${sel ? ' selected' : ''}" role="button" tabindex="0" data-post="${esc(p.id)}" aria-pressed="${sel}" aria-label="${esc(label)}">${inner}</g>`;
}
// ---------- Post detail and board ----------
function renderPostDetail() {
  const p = post(selectedPost), v = p.vehicleId ? vehicle(p.vehicleId) : null;
  const stage = p.stage === 'rework' ? { name: 'Доработка', buffer: state.rework.buffer } : state.stages.find(s => s.id === p.stage);
  const incident = p.incidentId ? state.incidents.find(i => i.id === p.incidentId) : null;
  const siblings = state.posts.filter(q => q.stage === p.stage && q.id !== p.id);
  const free = siblings.filter(q => !q.vehicleId && !['fault', 'maintenance', 'shift_over'].includes(q.state) && !q.problemId && !q.hold);
  const queue = stage.buffer.vehicleIds;
  let html = `<div class="detail-head"><div><span class="eyebrow">ПОСТ · ${esc(stage.name.toUpperCase())}</span><h2>${esc(p.code)}</h2></div><span class="status-pill ${esc(p.state)}">${esc(POST_STATES[p.state])}</span></div>`;
  if (p.reason) html += `<p class="reason">${esc(p.reason)}</p>`;
  if (p.problemId) html += `<p>Связанная проблема: ${problemLink(p.problemId)} — диагностика и сравнение решений в «Диспетчере смены».</p>`;
  html += '<div class="dcol">';
  if (v) {
    const op = v.currentOperation;
    html += `<dl class="facts"><div><dt>Автомобиль</dt><dd>${vehicleLink(v.id)} · ${esc(v.modelName)} · ${esc(v.orderId)}</dd></div><div><dt>Операция</dt><dd>${esc(op.operation)}</dd></div><div><dt>Прогресс</dt><dd>${bar(op.progress)} ${Math.round(op.progress * 100)}% · ${op.completedAt !== null ? `завершена в ${clock(op.completedAt)}` : `осталось ${fmt(op.remaining)} мин из ${op.work}`}</dd></div><div><dt>Норматив / факт</dt><dd>${op.norm} мин / ${op.work} мин (синтетика)</dd></div><div><dt>Начало</dt><dd>${clock(op.startedAt)}${op.posts.length > 1 ? ` · переводы: ${op.posts.map(x => `${esc(x.postCode)} с ${clock(x.from)}`).join(' → ')}` : ''}</dd></div></dl>`;
  } else html += '<p class="muted">Автомобиля на посту нет.</p>';
  if (!state.finished) {
    const actions = [];
    if (incident?.kind === 'breakdown') actions.push(`<button class="primary" data-job="repair_generic" data-post-id="${esc(p.id)}">Аварийный ремонт · 30 мин, техник</button>`);
    else if (incident?.kind === 'slowdown') actions.push(`<button class="primary" data-job="adjust" data-post-id="${esc(p.id)}">Наладка · 10 мин, техник</button>`);
    if (!incident) actions.push(`<button data-fault="${esc(p.id)}" data-kind="breakdown">Ручной сценарий: неисправность</button>`, `<button data-fault="${esc(p.id)}" data-kind="slowdown">Ручной сценарий: снижение темпа</button>`);
    if (['fault', 'maintenance', 'slow'].includes(p.state) && v?.currentOperation && v.currentOperation.completedAt === null) for (const q of free) actions.push(`<button data-transfer="${esc(v.id)}" data-to="${esc(q.id)}">Перевести ${esc(v.id)} на ${esc(q.code)}</button>`);
    if (siblings.length) actions.push(`<button data-hold="${esc(p.id)}" data-on="${p.hold ? '0' : '1'}">${p.hold ? 'Вернуть пост в загрузку' : 'Не загружать пост новыми автомобилями'}</button>`);
    html += `<h3>Действия</h3><div class="actions">${actions.join('')}</div><p class="fine-print">Ремонт занимает модельное время и единственного техника; без ремонта неисправность не исчезает.</p>`;
  }
  let queueHtml = `<h3>Очередь · ${esc(stage.buffer.name)} ${queue.length}${stage.buffer.capacity !== null ? `/${stage.buffer.capacity}` : ''}</h3>`;
  queueHtml += queue.length ? `<ol class="queue">${queue.slice(0, 8).map(id => { const q = vehicle(id); return `<li>${vehicleLink(id)} <span>${esc(q.modelName)} · ${esc(q.orderId)} · ${PRIORITY[q.priority].toLowerCase()}${q.reworked ? ' · после доработки' : ''}</span></li>`; }).join('')}${queue.length > 8 ? `<li class="muted">и ещё ${queue.length - 8}</li>` : ''}</ol><p class="fine-print">Порядок: приоритет задания → время прихода в буфер. Начатые операции не прерываются.</p>` : '<p class="muted">Очередь пуста.</p>';
  html += `</div><div class="dcol">${queueHtml}</div>`;
  const m = p.metrics;
  html += `<p class="post-metrics">A ${pct(m.availability)} · P ${pct(m.performance)} · Q ${pct(m.quality)} · OEE ${pct(m.oee)} · неисправность ${p.stats.fault} · работы техника ${p.stats.maintenance} · нет входа ${p.stats.starved} · блокировка ${p.stats.blocked} мин</p>`;
  $('post-detail').innerHTML = html;
}
function renderPostBoard() {
  const groups = [...state.stages, { id: 'rework', name: 'Доработка', postIds: ['R1'], buffer: state.rework.buffer }];
  $('post-board').innerHTML = groups.map(s => `<div class="board-stage"><h3>${esc(s.name)}</h3>${s.postIds.map(id => { const p = post(id); return `<button class="board-post ${esc(p.state)}${selectedPost === id ? ' selected' : ''}" data-post-link="${esc(id)}" aria-pressed="${selectedPost === id}"><b>${esc(p.code)}</b><span>${esc(POST_STATES[p.state])}</span><span>${p.vehicleId ? `${esc(p.vehicleId)} · ${Math.round(p.progress * 100)}%` : '—'}</span></button>`; }).join('')}<span class="board-queue">${esc(s.buffer.name)}: ${s.buffer.vehicleIds.length}${s.buffer.capacity !== null ? `/${s.buffer.capacity}` : ''}</span></div>`).join('');
}
function renderActiveProblems() {
  const open = state.problems.filter(p => p.status !== 'resolved');
  $('active-problems').innerHTML = open.map(p => `<div class="incident-banner ${p.kind === 'equipment' ? 'warning' : 'critical'}"><strong>${esc(p.id)} · ${esc(p.title)}</strong><span>${p.status === 'unresolved' ? 'Не устранена к концу смены' : `обнаружена ${clock(p.detectedAt)}`}</span><span class="banner-actions">${postLink(p.postId)}<button data-problem="${esc(p.id)}">Открыть в диспетчере</button></span></div>`).join('');
}
// ---------- Vehicles ----------
function renderVehicles() {
  $('vehicle-filters').innerHTML = FILTERS.map(([id, name]) => `<button data-filter="${id}" aria-pressed="${vehicleFilter === id}">${name} <span>${state.vehicles.filter(filterOf[id]).length}</span></button>`).join('');
  const list = state.vehicles.filter(filterOf[vehicleFilter]);
  if (!selectedVehicle || !vehicle(selectedVehicle)) selectedVehicle = list[0]?.id ?? state.vehicles[0]?.id;
  $('vehicle-list').innerHTML = list.length ? `<div class="vrow vhead" aria-hidden="true"><span>ID</span><span>Модель · задание</span><span>Статус</span><span>Операция</span></div>` + list.map(v => `<button class="vrow ${esc(v.state)}${selectedVehicle === v.id ? ' selected' : ''}" data-vehicle-select="${esc(v.id)}" aria-pressed="${selectedVehicle === v.id}"><span class="vid">${esc(v.id)}</span><span>${esc(v.modelName)} · ${esc(v.orderId)}${v.priority === 'high' ? ' · ↑' : ''}${v.reworked ? ' · ↺' : ''}</span><span class="vstate">${esc(VEHICLE_STATES[v.state])}</span><span>${v.currentOperation && v.currentOperation.completedAt === null ? `${bar(v.currentOperation.progress)} ${Math.round(v.currentOperation.progress * 100)}%` : esc(v.accepted ? `принят ${clock(v.acceptedAt)}` : '—')}</span></button>`).join('') : '<p class="muted pad">Нет автомобилей с таким статусом.</p>';
  renderPassport();
}
function renderPassport() {
  const v = vehicle(selectedVehicle);
  if (!v) { $('vehicle-passport').innerHTML = '<p class="muted pad">Выберите автомобиль.</p>'; return; }
  const events = state.events.filter(e => e.vehicleId === v.id).reverse();
  $('vehicle-passport').innerHTML = `<div class="detail-head"><div><span class="eyebrow">ПАСПОРТ · СИНТЕТИЧЕСКИЙ ID, НЕ VIN</span><h2>${esc(v.id)}</h2></div><span class="status-pill ${esc(v.state)}">${esc(VEHICLE_STATES[v.state])}</span></div>
  <p class="reason">${esc(v.status)}</p>
  <dl class="facts"><div><dt>Модель</dt><dd>${esc(v.modelName)} (условная)</dd></div><div><dt>Задание</dt><dd>${orderLink(v.orderId)} · приоритет ${PRIORITY[v.priority].toLowerCase()}</dd></div><div><dt>Маршрут</dt><dd>${esc(v.routeVersion)} · создан ${clock(v.createdAt)}${v.startedAt !== null ? ` · запущен ${clock(v.startedAt)}` : ''}</dd></div><div><dt>Контроль</dt><dd>${v.inspections.length ? v.inspections.map(i => `${clock(i.minute)} ${esc(i.postCode)}: ${i.result === 'pass' ? 'принят' : `не пройден — ${esc(i.defect)}`}`).join('; ') : 'ещё не проверялся'}</dd></div><div><dt>Приёмка</dt><dd>${v.accepted ? `принят в ${clock(v.acceptedAt)}${v.reworked ? ' после доработки' : ' с первого предъявления'}${v.shipped ? ` · отгружен ${clock(v.shippedAt)}` : ''}` : 'не принят'}</dd></div></dl>
  <p><button class="link" data-chat-about="vehicle" data-chat-id="${esc(v.id)}">Спросить диспетчера об этом автомобиле</button></p>
  <h3>Маршрут операций</h3>
  <ol class="route">${v.route.map(r => `<li class="${r.status}${r.result === 'fail' ? ' failed' : ''}"><span class="route-dot" aria-hidden="true"></span><div><strong>${esc(r.operation)}</strong><span>${r.status === 'done' ? `выполнено на ${esc(r.postCode)} · ${clock(r.startedAt)}–${clock(r.completedAt)} · ${r.completedAt - r.startedAt} мин${r.result === 'fail' ? ` · не пройден: ${esc(r.defect)}` : r.result === 'pass' ? ' · пройден' : ''}` : r.status === 'current' ? `${esc(r.postCode)} · начато ${clock(r.startedAt)} · ${Math.round(r.progress * 100)}%${v.state === 'paused' ? ' · пауза' : ''}` : `ожидает · норматив ${r.norm} мин`}</span></div></li>`).join('')}</ol>
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
    const late = state.forecast.lateOrders.includes(o.id);
    return `<article class="panel order ${esc(o.state)}" id="order-${esc(o.id)}"><div class="order-head"><div><span class="eyebrow">${esc(ORDER_STATES[o.state].toUpperCase())}${o.overdue ? ' · <b class="negative">СРОК ПРОШЁЛ</b>' : late ? ' · <b class="negative">ПО ПРОГНОЗУ ОПОЗДАЕТ</b>' : ''}</span><h2>${esc(o.id)} · ${esc(state.models.find(m => m.id === o.modelId).name)} × ${o.quantity}</h2></div><span class="order-due">срок ${o.dueMinute > 480 ? 'следующая смена' : clock(o.dueMinute)}<br>выпущено ${clock(o.releasedAt)}</span></div>
    <div class="order-progress">${bar(o.accepted / o.quantity, 'wide')}<strong>${o.accepted}/${o.quantity}</strong> принято</div>
    <p class="order-counts">${counts.map(([k, n]) => `${k}: <b>${n}</b>`).join(' · ')}</p>
    <div class="segmented-buttons" role="group" aria-label="Приоритет ${esc(o.id)}"><span>Приоритет</span>${Object.entries(PRIORITY).map(([id, name]) => `<button data-priority="${id}" data-order="${esc(o.id)}" aria-pressed="${o.priority === id}" ${o.state === 'completed' || state.finished ? 'disabled' : ''}>${name}</button>`).join('')}</div>
    <div class="order-vehicles">${o.vehicleIds.map(id => { const v = vehicle(id); return `<button class="mini ${esc(v.state)}" data-vehicle="${esc(id)}" title="${esc(v.status)}">${esc(id.replace('DEMO-', '#'))} <span>${esc(VEHICLE_STATES[v.state])}</span></button>`; }).join('')}</div></article>`;
  }).join('');
}
// ---------- Shift and analytics ----------
function renderShift() {
  const t = state.totals, f = state.forecast, ref = state.plan.reference, max = Math.max(state.plan.target, ref?.total ?? 0, t.created, 4);
  const x = m => 50 + m / 480 * 690, y = v => 230 - v / max * 205;
  const line = pts => pts.map(p => `${x(p.minute).toFixed(1)},${y(p.accepted).toFixed(1)}`).join(' ');
  const ticks = [0, Math.round(max / 2), max];
  const hist = [...state.history]; if (hist.at(-1).minute !== state.elapsed) hist.push({ minute: state.elapsed, accepted: t.accepted });
  $('shift-chart').innerHTML = ticks.map(v => `<line class="chart-grid" x1="50" x2="740" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="40" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('') +
    [0, 120, 240, 360, 480].map(m => `<text class="chart-axis" x="${x(m)}" y="255" text-anchor="middle">${clock(m)}</text>`).join('') +
    `<line class="chart-now" x1="${x(state.elapsed)}" x2="${x(state.elapsed)}" y1="20" y2="230"/><line class="chart-target" x1="50" x2="740" y1="${y(state.plan.target)}" y2="${y(state.plan.target)}"/>` +
    (ref ? `<polyline class="chart-plan" points="${line(ref.profile)}"/>` : '') + `<polyline class="chart-forecast" points="${line(f.trajectory)}"/><polyline class="chart-fact" points="${line(hist)}"/>` +
    `<circle cx="${x(state.elapsed)}" cy="${y(t.accepted)}" r="4" class="chart-dot"/><text class="chart-label" x="736" y="${y(state.plan.target) - 6}" text-anchor="end">план ${state.plan.target}</text>`;
  if (document.activeElement !== $('plan-target')) $('plan-target').value = String(state.plan.target);
  $('plan-form').querySelector('button').disabled = false;
  $('shift-numbers').innerHTML = [
    ['Факт: принято', t.accepted], ['План смены (задан)', state.plan.target], ['Эталонная мощность', ref ? `${ref.total} (к сейчас ${ref.now})` : '—'], ['Прогноз к 16:00', `${f.projected}${f.low < f.high ? ` (${f.low}–${f.high})` : ''}`],
    ['В работе (WIP)', t.inProcess], ['Из них на доработке', t.rework], ['Не начаты', t.notStarted], ['Готовы к отгрузке', t.ready], ['Отгружено', t.shipped],
    ['Создано всего', `${t.created} ${t.balanced ? '✓ баланс сходится' : '✗ баланс нарушен'}`], ['Среднее время прохождения', state.leadTime ? `${fmt(state.leadTime.average)} мин (${state.leadTime.count} авт.)` : '—'],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('forecast-box').innerHTML = `<p class="forecast-big"><strong>${f.projected}</strong> <span>принятых к 16:00 без новых вмешательств · ${f.gap >= 0 ? 'запас' : 'дефицит'} ${Math.abs(f.gap)} к плану ${state.plan.target}</span></p>
    <ul class="scenarios">${f.scenarios.map(s => `<li>${esc(s.label)}: <b>${s.accepted}</b>${s.lateOrders.length ? ` · опоздают ${esc(s.lateOrders.join(', '))}` : ''}</li>`).join('')}</ul>
    ${f.limiting ? `<p>Ограничивающий участок до конца смены: <b>${esc(f.limiting.name)}</b>, загрузка ${pct(f.limiting.utilization)}.</p>` : '<p>Смена завершена — прогноз равен факту.</p>'}
    <p class="fine-print">${esc(f.method)} ${esc(f.assumption)}</p>`;
  const q = state.quality;
  $('quality-box').innerHTML = `<h3>Качество (из проверок контроля)</h3><dl class="numbers"><div><dt>С первого предъявления</dt><dd>${q.firstPassYield === null ? '—' : `${pct(q.firstPassYield)} (${q.firstPass}/${q.firstInspections})`}</dd></div><div><dt>Не прошли контроль</dt><dd>${q.failed}</dd></div><div><dt>Приняты после доработки</dt><dd>${q.reworkedAccepted}</dd></div><div><dt>Сейчас в доработке</dt><dd>${q.inRework}</dd></div></dl><p class="fine-print">Каждый автомобиль засчитывается в годный выпуск один раз — после успешного контроля. Дефекты синтетические (~15%).</p>`;
  const cols = ['Пост', 'Участок', 'Состояние', 'A', 'P', 'Q', 'OEE', 'Работа', 'Неиспр.', 'Техник', 'Нет входа', 'Блок.', 'Операций'];
  $('oee-table').innerHTML = `<thead><tr>${cols.map(c => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${state.posts.map(p => `<tr><th scope="row"><button class="link" data-post-link="${esc(p.id)}">${esc(p.code)}</button></th><td>${esc(p.stageName)}</td><td>${esc(POST_SHORT[p.state])}</td><td>${pct(p.metrics.availability)}</td><td>${pct(p.metrics.performance)}</td><td>${pct(p.metrics.quality)}</td><td><b>${pct(p.metrics.oee)}</b></td><td>${p.stats.run}</td><td>${p.stats.fault}</td><td>${p.stats.maintenance}</td><td>${p.stats.starved}</td><td>${p.stats.blocked}</td><td>${p.stats.completed}</td></tr>`).join('')}</tbody>`;
  const jobs = state.jobs.map(j => `<article class="incident ${j.status === 'done' ? 'resolved' : 'active'}"><div class="incident-head"><strong>${esc(j.id)} · ${esc(j.title)}</strong><span>${postLink(j.postId)} · ${clock(j.createdAt)}${j.completedAt !== null ? ` → ${clock(j.completedAt)}` : ''}</span></div><p class="fine-print">${esc(JOB_STATUS[j.status])}${j.status === 'running' ? `, осталось ${j.remaining} мин` : ''}${j.part ? ` · запчасть: ${esc(state.stock.find(s => s.id === j.part)?.name)}` : ''}${j.decisionId ? ` · по решению ${esc(j.decisionId)}` : ''}${j.result ? ` · ${esc(j.result.text)}` : ''}</p></article>`).join('');
  const incidents = state.incidents.map(i => `<article class="incident ${esc(i.status)}"><div class="incident-head"><strong>${i.severity === 'critical' ? '●' : '◇'} ${esc(i.title)}</strong><span>${clock(i.start)} → ${i.end !== null ? clock(i.end) : i.status === 'unresolved' ? 'не устранён' : '…'}</span></div><p class="fine-print">${postLink(i.postId)} · ${esc(i.cause)} · ${esc(i.status === 'active' ? 'активен — нужен ремонт' : i.resolution)}</p></article>`).join('');
  $('incident-log').innerHTML = (incidents + jobs) || '<p class="muted">Инцидентов и работ нет.</p>';
  const stockLine = state.stock.map(s => `${esc(s.name)}: на складе ${s.onHand}, резерв ${s.reserved}, израсходовано ${s.used}`).join(' · ');
  $('incident-log').insertAdjacentHTML('afterbegin', `<p class="fine-print">Техник: ${state.technicians.map(t => `${esc(t.name)} — ${t.jobId ? `занят ${esc(t.jobId)}` : 'свободен'}, отработал ${t.busyMinutes} мин`).join('; ')}. Склад: ${stockLine}.</p>`);
  const events = state.events.slice(-100).reverse();
  text('event-count', `последние ${events.length}`);
  $('event-log').innerHTML = events.map(e => `<li class="${esc(e.type)}" id="ev-${e.seq}"><time>${clock(e.minute)}</time><span>${esc(e.text)}</span>${e.actor === 'operator' ? '<em>оператор</em>' : ''}</li>`).join('');
  text('ai-stale', aiRevision === null ? '' : aiRevision !== state.revision ? 'Состояние изменилось после объяснения. Обновите его для текущего снимка.' : 'Объяснение относится к текущему снимку синтетических данных.');
}
// ---------- Lab ----------
async function loadLab() { try { lab = await api('/api/lab'); } catch (e) { lab = { available: false, reason: e.message }; } if (view === 'lab') renderLab(); }
function metricRow(name, m) { return `<tr><th scope="row">${esc(name)}</th><td>${fmt(m.precision * 100)}%</td><td>${fmt(m.recall * 100)}%</td><td>${fmt(m.f1 * 100)}%</td><td>${fmt(m.prAuc, 3)}</td><td>${fmt(m.falseAlarmsPerShift, 2)}</td><td>${m.leadTime.median === null ? '—' : `${fmt(m.leadTime.median, 0)} мин`} <small>(${m.leadTime.warned}/${m.leadTime.failures})</small></td><td>${m.brier === null ? '—' : fmt(m.brier, 4)}</td></tr>`; }
function renderPolicies(r) {
  if (!r) return '<p class="muted">Сравнение политик ещё не выполнялось: <code>npm.cmd run policies</code>.</p>';
  const base = r.policies[0];
  return `<p class="fine-print">${esc(r.method)}</p><div class="table-scroll"><table><thead><tr><th scope="col">Политика</th><th scope="col">Выпуск, среднее</th><th scope="col">Медиана</th><th scope="col">P10–P90</th><th scope="col">Простой, мин</th><th scope="col">Затраты</th><th scope="col">Δ к «${esc(base.name)}»: лучше / так же / хуже</th></tr></thead><tbody>${r.policies.map(p => `<tr><th scope="row">${esc(p.name)}</th><td>${fmt(p.accepted.mean, 2)}</td><td>${fmt(p.accepted.median)}</td><td>${fmt(p.accepted.p10)}–${fmt(p.accepted.p90)}</td><td>${fmt(p.downtime.mean, 0)}</td><td>${fmt(p.cost.mean, 0)}</td><td>${p.vsBaseline ? `${p.vsBaseline.better} / ${p.vsBaseline.same} / ${p.vsBaseline.worse} · средняя Δ ${signed(p.vsBaseline.meanDelta)}` : '—'}</td></tr>`).join('')}</tbody></table></div>
  ${r.policies.slice(1).map(p => `<figure class="hist"><figcaption>${esc(p.name)}: распределение Δ выпуска к «${esc(base.name)}» по ${r.shifts} сменам</figcaption>${Object.entries(p.vsBaseline.histogram).map(([d, n]) => `<div class="hist-row"><span>${Number(d) > 0 ? '+' : ''}${d}</span>${bar(n / r.shifts, 'wide')}<span>${n}</span></div>`).join('')}</figure>`).join('')}`;
}
function renderLab() {
  const box = $('lab');
  if (!lab) { box.innerHTML = '<p class="muted">Загрузка…</p>'; return; }
  if (!lab.available) { box.innerHTML = `<div class="panel"><p>${esc(lab.reason)}</p></div>${lab.policies !== undefined ? `<div class="panel"><h2 class="panel-title">Сравнение политик</h2>${renderPolicies(lab.policies)}</div>` : ''}`; return; }
  const m = lab.metrics;
  box.innerHTML = `<div class="panel"><h2 class="panel-title">Задача</h2><dl class="facts">
    <div><dt>Задача</dt><dd>${esc(lab.task)}</dd></div><div><dt>Горизонт</dt><dd>${lab.horizon} модельных минут</dd></div>
    <div><dt>Генератор данных</dt><dd>${esc(lab.generatorVersion)} · seed обучения ${lab.trainingSeed}</dd></div><div><dt>Модель</dt><dd>${esc(lab.modelVersion)} — ${esc(lab.modelType)}</dd></div>
    <div><dt>Смены</dt><dd>${lab.data.shifts.total}: обучение ${lab.data.shifts.train}, настройка ${lab.data.shifts.validation}, финальный тест ${lab.data.shifts.test} (разделение по целым сменам)</dd></div>
    <div><dt>Примеры</dt><dd>${lab.data.samples.total} окон по 5 мин: обучение ${lab.data.samples.train}, настройка ${lab.data.samples.validation}, тест ${lab.data.samples.test}</dd></div>
    <div><dt>Доля отказов</dt><dd>${pct(lab.data.positiveRate)} окон с отказом в ближайшие ${lab.horizon} мин; отказов в тестовых сменах: ${m.test.model.leadTime.failures}</dd></div>
    <div><dt>Признаки</dt><dd>${lab.features.map(esc).join(', ')} — только измерения до момента прогноза за ${lab.featureWindow} мин</dd></div>
    <div><dt>Рабочий вариант</dt><dd><b>${lab.selected === 'model' ? 'модель' : 'baseline-правило'}</b> — ${esc(lab.selectionReason)}</dd></div></dl></div>
  <div class="panel"><h2 class="panel-title">Качество на отложенных сменах</h2><div class="table-scroll"><table><thead><tr><th scope="col">Вариант</th><th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">F1</th><th scope="col">PR-AUC</th><th scope="col">Ложных тревог на смену</th><th scope="col">Предупреждение до отказа (медиана)</th><th scope="col">Brier</th></tr></thead><tbody>
    ${metricRow(`Baseline: ${lab.baseline.feature} ≥ ${fmt(lab.baseline.threshold, 2)} — тест`, m.test.baseline)}${metricRow(`Модель, порог ${fmt(lab.threshold, 3)} — тест`, m.test.model)}${metricRow('Baseline — настройка', m.validation.baseline)}${metricRow('Модель — настройка', m.validation.model)}</tbody></table></div>
    <p class="fine-print">Ложные тревоги — 5-минутные окна с тревогой без отказа в ближайшие ${lab.horizon} мин, в среднем на смену. Предупреждение — сколько минут до отказа длилась непрерывная тревога (успели/всего отказов). Порог и правило подобраны на сменах настройки, тест использован один раз.</p></div>
  <div class="panel"><h2 class="panel-title">Калибровка вероятностей (тест)</h2><div class="table-scroll"><table><thead><tr><th scope="col">Интервал вероятности</th><th scope="col">Окон</th><th scope="col">Средний прогноз</th><th scope="col">Наблюдаемая доля отказов</th></tr></thead><tbody>${lab.calibration.map(b => `<tr><td>${fmt(b.from, 2)}–${fmt(b.to, 2)}</td><td>${b.count}</td><td>${b.count ? pct(b.meanPredicted) : '—'}</td><td>${b.count ? pct(b.observedRate) : '—'}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="panel"><h2 class="panel-title">Коэффициенты (стандартизованные признаки)</h2><div class="table-scroll"><table><thead><tr><th scope="col">Признак</th><th scope="col">Вес</th><th scope="col">Среднее (обучение)</th><th scope="col">Ст. откл.</th></tr></thead><tbody>${lab.coefficients.map(c => `<tr><th scope="row">${esc(c.feature)}</th><td>${fmt(c.weight, 3)}</td><td>${fmt(c.mean, 3)}</td><td>${fmt(c.std, 3)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="panel"><h2 class="panel-title">Сравнение политик на одинаковых сменах</h2>${renderPolicies(lab.policies)}</div>
  <div class="panel"><h2 class="panel-title">Ограничения</h2><ul class="notes">${lab.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="fine-print">Обучение и проверка — на синтетических сменах генератора ${esc(lab.generatorVersion)}. Пригодность для реального оборудования Allur не утверждается.</p></div>`;
}
// ---------- Spaces: isometric scene, object cards, events ribbon ----------
// Every number below comes from the same server snapshot; the scene only draws it.
const SPACES = {
  enterprise: { title: 'Предприятие', short: 'Предприятие', sub: 'Маршрут: сварка → окраска → сборка → контроль → отгрузка; брак уходит на доработку и повторный контроль' },
  assembly: { title: 'Цех «Сборка»', short: 'Сборка', sub: 'Посты СБ-1…СБ-3 с гидроподъёмниками · буферы B2 и B3 · ремонтник ТЕХ-1', scene: true },
  diag: { title: 'Диагностика', short: 'Диагностика', sub: 'Слой поверх цеха «Сборка»: отклонения подъёмников, проверки, ремонт и склад запчастей', scene: true },
  tests: { title: 'Испытания · контроль качества', short: 'Испытания', stage: 'quality', note: 'В модели испытания — это пост контроля качества КК-1 и КК-2: результат «принят» или «дефект → доработка». Отдельных испытательных стендов в движке нет.' },
  rework: { title: 'Доработка', short: 'Доработка', stage: 'rework', note: 'Автомобили, не прошедшие контроль, ждут в очереди RWQ, доработку выполняет пост ДР-1, затем повторный контроль.' },
  ship: { title: 'Отгрузка', short: 'Отгрузка', stage: 'shipping', note: 'Принятые автомобили ждут в буфере готовых FG и передаются в отгрузку на посту ОТ-1. Выпуск засчитывается при приёмке.' },
  weld: { title: 'Сварка', short: 'Сварка', stage: 'weld', note: 'Первый участок маршрута: кузова из входного буфера свариваются на постах СВ-1 и СВ-2.' },
  paint: { title: 'Окраска', short: 'Окраска', stage: 'paint', note: 'Сваренные кузова ждут в буфере B1 и окрашиваются на постах ОК-1 и ОК-2.' },
};
const SPACE_KEYS = ['enterprise', 'assembly', 'tests', 'diag', 'rework', 'ship'];
const CHECK_RULES = { pump_check: 'ток выше 13,5 А — износ насоса подтверждён, ниже 12,8 А — исключён', pressure_hold: 'падение больше 7 бар за 5 мин — утечка подтверждена, меньше 5 — исключена' };
let space = 'assembly', scene = null, sceneFailed = false, lastPanelKey = null, enteredSpace = null;
const ui = { selected: null, panel: null, table: false, diag: false, ribbonOpen: !matchMedia('(max-width: 760px)').matches, ribbonOnlySelected: false, choice: {} };
const narrow = () => matchMedia('(max-width: 760px)').matches;
const ico = (kind, label) => `<span class="st ${kind}"><svg viewBox="0 0 13 13" aria-hidden="true">${sceneIcon(kind, 0, 0)}</svg>${label ? esc(label) : ''}</span>`;
const POST_KIND = p => ({ working: 'ok', idle: 'idle', slow: 'warn', blocked: 'warn', fault: 'stop', maintenance: runningJob(p.id)?.type === 'check' ? 'check' : 'stop', shift_over: 'idle' }[p.state] ?? 'idle');
const VEHICLE_KIND = v => ({ processing: 'ok', rework: 'ok', waiting: 'wait', not_started: 'idle', paused: 'stop', blocked: 'warn', ready: 'ok', shipped: 'ok', stopped: 'idle', rework_wait: 'wait' }[v.state] ?? 'idle');
function runningJob(postId) {
  const j = state.jobs.find(x => x.postId === postId && x.status === 'running');
  if (!j) return null;
  const k = state.jobKinds.find(x => x.id === j.kind);
  return { ...j, type: j.kind === 'verify' ? 'check' : k?.type, stopsPost: j.kind === 'verify' ? true : k?.stopsPost };
}

function ensureScene() {
  if (scene || sceneFailed) return;
  try {
    scene = new AssemblyScene($('scene'));
    const wrap = $('scene-wrap'), eff = Math.min(wrap.clientWidth / 1000, wrap.clientHeight / 660);
    if (eff > 0 && eff < .8) { scene.home(Math.min(2.4, .85 / eff)); scene.focusPost('A2', Math.min(2.4, .85 / eff)); }
  } catch { sceneFailed = true; scene = null; }
}
function destroyScene() { scene?.destroy(); scene = null; }

function renderSpace() {
  const meta = SPACES[space] ?? SPACES.assembly, sceneSpace = Boolean(meta.scene), table = ui.table || (sceneSpace && sceneFailed);
  if (enteredSpace !== space) {
    enteredSpace = space; $('space-stage').classList.remove('enter'); void $('space-stage').offsetWidth; $('space-stage').classList.add('enter');
    if (space === 'diag' && !ui.panel) { const p = state.problems.find(x => x.status === 'open') ?? state.problems.at(-1); if (p) { ui.panel = { type: 'problem', id: p.id }; ui.selected = { type: 'post', id: p.postId }; chatContext = { type: 'problem', id: p.id }; } }
  }
  $('crumbs').innerHTML = space === 'enterprise' ? '<b>Предприятие</b>' : `<a href="#space/enterprise">Предприятие</a> › <b>${esc(meta.short)}</b>`;
  text('space-title', meta.title); text('space-sub', meta.sub ?? meta.note ?? '');
  const open = state.problems.filter(p => p.status === 'open');
  const busy = ['A1', 'A2', 'A3'].filter(id => post(id).vehicleId).length;
  $('space-chips').innerHTML = sceneSpace ? `${ico('ok', `${busy} из 3 постов заняты`)}${open.length ? ico('warn', `${open.length} ${open.length === 1 ? 'проблема' : 'проблемы'}`) : ico('ok', 'проблем нет')}` : space === 'enterprise' ? ico(state.forecast.projected >= state.plan.target ? 'ok' : 'warn', `прогноз ${state.forecast.projected} при плане ${state.plan.target}`) : ico('idle', 'объёмная сцена — следующий этап');
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String((b.dataset.mode === 'table') === table));
  document.querySelector('.hud-row .seg').hidden = Boolean(meta.stage);
  $('diag-toggle-wrap').hidden = !sceneSpace || table; $('diag-toggle').checked = ui.diag || space === 'diag'; $('diag-toggle').disabled = space === 'diag';
  $('scene-wrap').hidden = !(sceneSpace && !table);
  $('enterprise-wrap').hidden = !(space === 'enterprise' && !table);
  $('stage-card').hidden = !meta.stage;
  $('table-view').hidden = !(table && !meta.stage);
  document.querySelector('.cam').hidden = !(sceneSpace && !table);
  $('scene-hint').hidden = !(sceneSpace && !table) || Boolean(ui.panel);
  if (sceneSpace && !table) { ensureScene(); scene?.update(state, { selected: ui.selected, diag: ui.diag || space === 'diag' }); if (!scene) return renderSpace(); }
  else destroyScene();
  if (space === 'enterprise' && !table) $('enterprise').innerHTML = enterpriseSvg(state) + enterpriseCardsSvg();
  if (meta.stage) $('stage-card').innerHTML = stageCard(meta);
  if (table && !meta.stage) $('table-view').innerHTML = objectsTable();
  renderRibbon(); renderSide();
  $('view-space').classList.toggle('with-side', Boolean(ui.panel));
}

function enterpriseCardsSvg() {
  return enterpriseCards(state).map(c => {
    const lines = [...c.lines, ...c.problems.map(p => `${p.id}: ${p.title}`)];
    const h = 34 + lines.length * 18;
    return `<g class="em-card${c.live ? ' live' : ''}" role="button" tabindex="0" data-space="${c.space}" aria-label="${esc(`${c.title}. ${lines.join('. ')}${c.later ? '. Подробная сцена в разработке' : '. Открыть сцену'}`)}" transform="translate(${c.left} ${c.top})">
      <rect width="280" height="${h}" rx="12" class="em-cardbox"/><text x="12" y="22" class="em-card-title">${esc(c.title)}</text>
      <text x="268" y="22" text-anchor="end" class="em-card-tag${c.live ? ' live' : ''}">${c.live ? 'Открыть сцену →' : 'сцена позже'}</text>
      ${lines.map((l, i) => `<text x="12" y="${42 + i * 18}" class="em-card-line${i >= c.lines.length ? ' warn' : ''}">${esc(l.length > 44 ? l.slice(0, 43) + '…' : l)}</text>`).join('')}</g>`;
  }).join('');
}

function stageCard(meta) {
  const sid = meta.stage, stage = sid === 'rework' ? { id: 'rework', name: 'Доработка', postIds: ['R1'], buffer: state.rework.buffer } : state.stages.find(s => s.id === sid);
  const rows = stage.postIds.map(id => { const p = post(id), v = p.vehicleId; return `<tr><th scope="row"><button class="link" data-post="${esc(id)}">${esc(p.code)}</button></th><td>${ico(POST_KIND(p), POST_SHORT[p.state])}</td><td>${v ? `<button class="link mono" data-vehicle="${esc(v)}">${esc(v)}</button>` : '—'}</td><td>${p.operation ? esc(p.operation) : '—'}</td><td>${p.progress !== null ? `${bar(p.progress)} ${Math.round(p.progress * 100)}%` : '—'}</td><td class="wrap">${esc(p.reason ?? '')}</td></tr>`; }).join('');
  const q = stage.buffer.vehicleIds;
  let extra = '';
  if (sid === 'quality') {
    const recent = [...state.inspections].reverse().slice(0, 8);
    extra = `<h3>Последние результаты контроля</h3>${recent.length ? `<ul class="plain">${recent.map(i => `<li><span class="mono">${clock(i.minute)}</span> ${esc(i.postCode)} · <button class="link mono" data-vehicle="${esc(i.vehicleId)}">${esc(i.vehicleId)}</button> — ${i.result === 'pass' ? ico('ok', i.first ? 'принят с первого предъявления' : 'принят после доработки') : ico('warn', `дефект: ${i.defect}`)}</li>`).join('')}</ul>` : '<p class="muted">Проверок ещё не было.</p>'}`;
  }
  if (sid === 'shipping') extra = `<p>Отгружено за смену: <b>${state.totals.shipped}</b> · принято: <b>${state.totals.accepted}</b></p>`;
  if (sid === 'weld') extra = `<p class="fine-print">Входной буфер не ограничен: ${q.length} кузовов ждут сварки.</p>`;
  return `<div class="stage-inner"><div class="later-note">${ico('idle', '')}<div><b>Подробная объёмная сцена этого цеха ещё не сделана.</b><p>${esc(meta.note)} Ниже — фактические посты и очередь из снимка движка, без условных автомобилей.</p></div></div>
    <div class="table-scroll"><table class="obj-table"><caption class="sr-only">Посты участка ${esc(stage.name)}</caption><thead><tr><th scope="col">Пост</th><th scope="col">Состояние</th><th scope="col">Автомобиль</th><th scope="col">Операция</th><th scope="col">Ход</th><th scope="col">Причина</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>${esc(stage.buffer.name)} · ${q.length}${stage.buffer.capacity !== null ? ` из ${stage.buffer.capacity}` : ''}</h3>
    ${q.length ? `<ol class="queue">${q.slice(0, 10).map(id => `<li><button class="link mono" data-vehicle="${esc(id)}">${esc(id)}</button> <span>${esc(vehicle(id).modelName)} · ${esc(vehicle(id).orderId)}</span></li>`).join('')}${q.length > 10 ? `<li class="muted">и ещё ${q.length - 10}</li>` : ''}</ol>` : '<p class="muted">Очередь пуста.</p>'}${extra}</div>`;
}

function objectsTable() {
  const ids = space === 'enterprise' ? state.posts.map(p => p.id) : ['A1', 'A2', 'A3'];
  const row = (head, type, kind, label, veh, op, prog, reason, data) => `<tr${ui.selected && data.includes(`"${ui.selected.id}"`) ? ' class="selected"' : ''}><th scope="row">${esc(head)}</th><td>${esc(type)}</td><td>${ico(kind, label)}</td><td>${veh ? `<button class="link mono" data-vehicle="${esc(veh)}">${esc(veh)}</button>` : '—'}</td><td>${esc(op ?? '—')}</td><td>${esc(prog ?? '—')}</td><td class="wrap">${reason ?? ''}</td><td>${data ? `<button class="small" ${data}>Карточка</button>` : ''}</td></tr>`;
  let rows = ids.map(id => { const p = post(id); return row(p.code, `Пост · ${p.stageName}`, POST_KIND(p), POST_SHORT[p.state], p.vehicleId, p.operation, p.progress !== null ? `${Math.round(p.progress * 100)}%` : null, p.problemId ? `<button class="link" data-problem="${esc(p.problemId)}">${esc(p.problemId)}</button>: ${esc(problem(p.problemId)?.title ?? '')}` : esc(p.reason ?? ''), `data-post="${esc(id)}"`); }).join('');
  if (space !== 'enterprise') {
    for (const [sid, name] of [['assembly', 'Буфер перед сборкой'], ['quality', 'Буфер перед контролем']]) {
      const b = state.stages.find(s => s.id === sid).buffer;
      rows += row(b.id, name, b.vehicleIds.length ? 'wait' : 'idle', b.vehicleIds.length ? 'Ожидание' : 'Пусто', b.vehicleIds[0], null, `${b.vehicleIds.length} из ${b.capacity}`, b.vehicleIds.length > 1 ? `ещё: ${esc(b.vehicleIds.slice(1).join(', '))}` : '', b.vehicleIds[0] ? `data-vehicle="${esc(b.vehicleIds[0])}"` : '');
    }
    for (const e of state.equipment) {
      // The deviation index uses a 30-minute window, so right after a verified repair it can still include old readings.
      const open = state.problems.find(p => p.postId === e.postId && p.status === 'open');
      const fixed = !open && state.problems.find(p => p.postId === e.postId && p.status === 'resolved' && state.elapsed - p.resolvedAt <= 30);
      const [k, label, note] = e.failed ? ['stop', 'Отказ', ''] : open ? ['warn', 'Отклонение', ''] : fixed && e.anomalyScore >= 4.5 ? ['ok', 'Восстановлен', `проверка после ремонта в норме; окно 30 мин ещё содержит замеры до ремонта`] : e.anomalyScore >= 4.5 ? ['warn', 'Выше порога', ''] : ['ok', 'В норме', ''];
      const pid = open?.id ?? fixed?.id;
      rows += row(e.name.replace('Гидроподъёмник', 'Подъёмник'), 'Оборудование', k, label, null, null, `${fmt(e.anomalyScore)} / порог 4,5`, `${pid ? `<button class="link" data-problem="${esc(pid)}">${esc(pid)}</button> ` : ''}${esc(note)}`, pid ? `data-problem="${esc(pid)}"` : '');
    }
    const t = state.technicians[0], j = t.jobId ? state.jobs.find(x => x.id === t.jobId) : null;
    rows += row('ТЕХ-1', 'Ремонтник', j ? 'check' : 'ok', j ? `Занят ${j.id}` : 'Свободен', null, j?.title, j ? `${j.duration - j.remaining} из ${j.duration} мин` : `занят ${t.busyMinutes} мин за смену`, '', j?.problemId ? `data-problem="${esc(j.problemId)}"` : '');
    rows += row('Склад', 'Запчасти', 'idle', 'Запас', null, null, state.stock.map(s => `${s.name.split(' ')[0].toLowerCase()} ${s.available}`).join(' · '), '', '');
  }
  return `<div class="table-inner">${sceneFailed ? '<p class="note">Объёмная сцена недоступна в этом браузере — включён табличный режим. Данные и действия те же.</p>' : '<p class="note">Табличный режим: те же объекты, что на сцене. Если объёмная сцена не может быть показана, этот вид включается автоматически.</p>'}
    <div class="table-scroll"><table class="obj-table"><caption class="sr-only">Объекты пространства «${esc(SPACES[space].short)}» на ${clock(state.elapsed)}</caption><thead><tr><th scope="col">Объект</th><th scope="col">Тип</th><th scope="col">Состояние</th><th scope="col">Автомобиль</th><th scope="col">Операция</th><th scope="col">Ход / заполнение</th><th scope="col">Причина</th><th scope="col"><span class="sr-only">Действие</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="keys"><b>Клавиатура:</b> <kbd>Tab</kbd> объекты · <kbd>Enter</kbd> карточка · <kbd>Esc</kbd> закрыть · <kbd>1</kbd>–<kbd>6</kbd> пространства · <kbd>0</kbd> общий вид · <kbd>T</kbd> сцена ↔ таблица</p></div>`;
}

// ---------- Ribbon ----------
const EVENT_KIND = { problem_detected: 'warn', incident_started: 'stop', inspection_failed: 'warn', job_started: 'check', check_completed: 'check', repair_completed: 'ok', verify_completed: 'ok', problem_resolved: 'ok', vehicle_accepted: 'ok', vehicle_shipped: 'ok', decision_applied: 'check', operation_started: 'ok', vehicle_moved: 'wait', follow_up_skipped: 'warn', incident_resolved: 'ok' };
function eventMatches(e, sel) {
  if (!sel) return true;
  if (sel.type === 'vehicle') return e.vehicleId === sel.id;
  if (sel.type === 'post') return e.postId === sel.id;
  if (sel.type === 'problem') { const p = problem(sel.id); return e.problemId === sel.id || (p && e.postId === p.postId && e.minute >= p.detectedAt); }
  return true;
}
function renderRibbon() {
  const box = $('ribbon'), sel = ui.selected, only = ui.ribbonOnlySelected && sel;
  const events = state.events.filter(e => !only || eventMatches(e, sel)).slice(-16).reverse();
  const card = e => { const k = EVENT_KIND[e.type] ?? 'idle'; const where = e.postId ? post(e.postId)?.code ?? '' : e.problemId ?? ''; return `<li><button class="ev ${k}${e.type === 'problem_detected' ? ' strong' : ''}" data-event="${e.seq}"><span class="ev-meta"><span class="mono">${clock(e.minute)}</span>${where ? `<span class="ev-where">${esc(where)}</span>` : ''}${e.actor === 'operator' ? '<span class="ev-op">оператор</span>' : ''}</span><span class="ev-text">${ico(k, '')}<span>${esc(e.text)}</span></span></button></li>`; };
  if (!ui.ribbonOpen) {
    const e = events[0];
    box.className = 'ribbon collapsed';
    box.innerHTML = `<b>События</b>${e ? `<span class="ev-last"><span class="mono">${clock(e.minute)}</span> ${esc(e.text)}</span>` : '<span class="muted">пока нет</span>'}<button class="link" data-ribbon="open">Развернуть</button>`;
    return;
  }
  box.className = 'ribbon';
  const label = sel ? (sel.type === 'vehicle' ? sel.id : sel.type === 'post' ? post(sel.id)?.code : sel.id) : null;
  box.innerHTML = `<div class="ribbon-head"><b>События</b>${label ? `<button class="chip-btn" data-ribbon="only" aria-pressed="${Boolean(only)}">${only ? `Только ${esc(label)} ×` : `Только ${esc(label)}`}</button>` : '<span class="muted">все цеха · новые слева</span>'}<button class="link" data-ribbon="close">Свернуть</button></div>
    <ol class="ribbon-list">${events.map(card).join('') || '<li class="muted">Событий пока нет.</li>'}</ol>`;
}

// ---------- Side panel ----------
function renderSide() {
  const side = $('side'), p = ui.panel;
  if (!p) { side.hidden = true; side.innerHTML = ''; lastPanelKey = null; return; }
  side.hidden = false;
  const key = `${p.type}:${p.id ?? ''}`;
  if (p.type === 'chat') { if (lastPanelKey !== key) side.innerHTML = chatPanelShell(); lastPanelKey = key; updateSideChat(); return; }
  const body = side.querySelector('.side-body'), scroll = body && lastPanelKey === key ? body.scrollTop : 0;
  let html = '';
  if (p.type === 'vehicle') html = vehicle(p.id) ? panelVehicle(vehicle(p.id)) : '';
  else if (p.type === 'post') html = post(p.id) ? panelPost(post(p.id)) : '';
  else if (p.type === 'problem') html = problem(p.id) ? panelProblem(problem(p.id)) : '';
  else if (p.type === 'compare') html = problem(p.id) ? panelCompare(problem(p.id)) : '';
  if (!html) { ui.panel = null; side.hidden = true; lastPanelKey = null; return; }
  side.innerHTML = html; lastPanelKey = key;
  if (scroll) side.querySelector('.side-body').scrollTop = scroll;
}
const sideHead = (eyebrow, title, chips = '', extra = '') => `<div class="side-head"><div class="side-top"><span class="eyebrow">${eyebrow}</span><span class="side-tools">${extra}<button class="icon-btn small" data-close-panel="1" aria-label="Закрыть карточку">✕</button></span></div><h2>${title}</h2>${chips ? `<div class="chipline">${chips}</div>` : ''}</div>`;
const tag = (t, cls = '') => `<span class="tagchip ${cls}">${t}</span>`;
const chatBtn = (type, id) => `<button class="icon-btn small" data-open-chat="1" data-ctx-type="${type}" data-ctx-id="${esc(id)}" aria-label="Спросить в чате об этом объекте"><svg viewBox="0 0 20 20" aria-hidden="true"><path class="ico-chat" d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V13a2.5 2.5 0 0 1-2-2.5z"/></svg></button>`;
const lockNote = '<p class="lock">Проверки, ремонт, перевод и снятие поста с загрузки меняют производство — каждое такое действие запросит подтверждение.</p>';

function panelVehicle(v) {
  const op = v.currentOperation && v.currentOperation.completedAt === null ? v.currentOperation : null;
  const p = v.location.type === 'post' ? post(v.location.id) : null, order = state.orders.find(o => o.id === v.orderId);
  let kind = VEHICLE_KIND(v); if (p?.state === 'slow') kind = 'warn';
  const head = { ok: 'СЕЙЧАС · В РАБОТЕ', warn: 'СЕЙЧАС · ТЕМП СНИЖЕН', stop: 'СЕЙЧАС · ПАУЗА', wait: 'СЕЙЧАС · ОЖИДАЕТ', idle: 'СЕЙЧАС' }[kind];
  let now = `<section class="now ${kind}"><div class="now-head">${ico(kind, head)}</div><div class="now-title">${esc(op ? `${op.operation} · ${op.postCode}` : v.status)}</div>`;
  if (op) now += `${bar(op.progress, `wide ${kind}`)}<div class="now-line">${Math.round(op.progress * 100)}% · начата в ${clock(op.startedAt)} · норматив ${op.norm} мин${v.state === 'paused' && op.pauseReason ? ` · пауза: ${esc(op.pauseReason.toLowerCase())}` : ''}</div>`;
  if (p?.problemId) now += `<p>Причина: проблема <b>${esc(p.problemId)}</b> на посту — ${esc(problem(p.problemId)?.title ?? '')}. Дефектов у самого автомобиля это не означает.</p>`;
  else if (op && v.state !== 'processing') now += `<p>${esc(v.status)}</p>`;
  now += '</section>';
  const route = `<ol class="vroute">${v.route.map(r => `<li class="${r.status}${r.result === 'fail' ? ' failed' : ''}">${r.status === 'done' ? ico(r.result === 'fail' ? 'warn' : 'ok', '') : r.status === 'current' ? ico(kind === 'ok' ? 'check' : kind, '') : '<span class="pend" aria-hidden="true"></span>'}<span class="vr-name">${esc(r.stageName)}${r.postCode ? ` · ${esc(r.postCode)}` : ''}${r.status === 'current' ? ' — сейчас' : ''}</span><span class="vr-time mono">${r.status === 'done' ? `${clock(r.startedAt)}–${clock(r.completedAt)}` : r.status === 'current' ? `с ${clock(r.startedAt)}` : `норматив ${r.norm} мин`}</span></li>`).join('')}</ol>`;
  const insp = v.inspections, fails = insp.filter(i => i.result === 'fail');
  const probs = state.problems.filter(x => x.vehicleIds.includes(v.id));
  const diagRows = probs.length ? probs.map(x => `<button class="link" data-problem="${esc(x.id)}">${esc(x.id)}</button> на ${esc(x.postCode)} — ${x.status === 'open' ? 'открыта' : x.status === 'resolved' ? `закрыта ${clock(x.resolvedAt)}` : 'не устранена'}${x.jobs.length ? `: ${x.jobs.map(j => `${esc(j.title.toLowerCase())}${j.result ? ` (${esc(j.result.text)})` : j.status === 'running' ? ' (идёт)' : ''}`).join('; ')}` : ''}`).join('<br>') : 'нет записей';
  const checks = `<dl class="kv"><div><dt>Контроль</dt><dd>${insp.length ? insp.map(i => `${clock(i.minute)} ${esc(i.postCode)}: ${i.result === 'pass' ? 'принят' : 'не пройден'}`).join('; ') : 'ещё не предъявлялся'}</dd></div><div><dt>Дефекты</dt><dd>${fails.length ? fails.map(i => esc(i.defect)).join('; ') + (v.reworked ? ' · доработан' : '') : 'нет записей'}</dd></div><div><dt>Диагностика и ремонт</dt><dd>${diagRows}</dd></div></dl>`;
  let actions = '';
  if (p?.problemId) actions += `<button class="primary wide" data-problem="${esc(p.problemId)}">Диагностика поста ${esc(p.code)} (${esc(p.problemId)})</button>`;
  actions += `<button class="secondary wide" data-open-chat="1" data-ctx-type="vehicle" data-ctx-id="${esc(v.id)}">Спросить в чате: «Почему ${esc(v.id)} задерживается?»</button>`;
  if (p && op && !state.finished) {
    const sib = state.posts.filter(q => q.stage === p.stage && q.id !== p.id);
    const free = sib.filter(q => !q.vehicleId && !['fault', 'maintenance', 'shift_over'].includes(q.state) && !q.problemId && !q.hold);
    if (['fault', 'maintenance', 'slow'].includes(p.state) && free.length) actions += free.map(q => `<button class="wide" data-transfer="${esc(v.id)}" data-to="${esc(q.id)}">Перевести на ${esc(q.code)}…</button>`).join('');
    else if (sib.length) actions += `<button class="wide" disabled aria-describedby="why-transfer">Перевести на параллельный пост</button><p id="why-transfer" class="why">Недоступно: ${['fault', 'maintenance', 'slow'].includes(p.state) ? sib.map(q => q.vehicleId ? `${esc(q.code)} занят ${esc(q.vehicleId)} (${Math.round((q.progress ?? 0) * 100)}%)` : `${esc(q.code)} — ${esc(POST_SHORT[q.state].toLowerCase())}${q.problemId ? `, ${esc(q.problemId)}` : ''}`).join('; ') : 'пост работает без отклонений'}.</p>`;
  }
  actions += `<button class="link" data-legacy="vehicles" data-legacy-id="${esc(v.id)}">Полный паспорт и история событий →</button>`;
  return sideHead('АВТОМОБИЛЬ · ПАСПОРТ', `<span class="mono">${esc(v.id)}</span>`, tag(esc(v.modelName), 'blue') + tag(`Задание ${esc(v.orderId)}${order ? ` · срок ${order.dueMinute > state.shift ? 'после смены' : clock(order.dueMinute)}` : ''}`) + tag(`Приоритет ${PRIORITY[v.priority].toLowerCase()}`), chatBtn('vehicle', v.id))
    + `<div class="side-body">${now}<h3>Пройденный маршрут</h3>${route}<h3>Проверки и ремонт</h3>${checks}<h3>Доступные действия</h3><div class="actions-col">${actions}</div>${lockNote}</div>`;
}

function panelPost(p) {
  const kind = POST_KIND(p), v = p.vehicleId ? vehicle(p.vehicleId) : null, job = runningJob(p.id);
  const stage = p.stage === 'rework' ? { name: 'Доработка', buffer: state.rework.buffer } : state.stages.find(s => s.id === p.stage);
  const incident = p.incidentId ? state.incidents.find(i => i.id === p.incidentId) : null;
  let body = `<section class="now ${kind}"><div class="now-head">${ico(kind, POST_STATES[p.state])}</div>${p.reason ? `<p>${esc(p.reason)}</p>` : ''}${v ? `<div class="now-title"><button class="link mono" data-vehicle="${esc(v.id)}">${esc(v.id)}</button> · ${esc(p.operation ?? '')}</div>${bar(p.progress ?? 0, `wide ${kind}`)}<div class="now-line">${Math.round((p.progress ?? 0) * 100)}% · осталось ${fmt(p.remaining ?? 0)} мин работы</div>` : ''}</section>`;
  if (job) body += `<p>${ico(job.type === 'check' ? 'check' : 'stop', `${job.id}: ${job.title}`)} · ${job.duration - job.remaining} из ${job.duration} мин${job.stopsPost ? ' · пост остановлен' : ''}</p>`;
  if (p.problemId) body += `<p><button class="primary wide" data-problem="${esc(p.problemId)}">Открыть ${esc(p.problemId)}: диагностика и решения</button></p>`;
  const q = stage.buffer.vehicleIds;
  body += `<h3>Очередь · ${esc(stage.buffer.name)} ${q.length}${stage.buffer.capacity !== null ? ` из ${stage.buffer.capacity}` : ''}</h3>${q.length ? `<ol class="queue">${q.slice(0, 6).map(id => `<li><button class="link mono" data-vehicle="${esc(id)}">${esc(id)}</button> <span>${esc(vehicle(id).modelName)} · ${esc(vehicle(id).orderId)}</span></li>`).join('')}</ol>` : '<p class="muted">Очередь пуста.</p>'}`;
  const actions = [];
  if (!state.finished) {
    if (incident?.kind === 'breakdown') actions.push(`<button class="primary wide" data-job="repair_generic" data-post-id="${esc(p.id)}">Аварийный ремонт · 30 мин…</button>`);
    else if (incident?.kind === 'slowdown') actions.push(`<button class="primary wide" data-job="adjust" data-post-id="${esc(p.id)}">Наладка · 10 мин…</button>`);
    if (state.posts.some(x => x.stage === p.stage && x.id !== p.id)) actions.push(`<button class="wide" data-hold="${esc(p.id)}" data-on="${p.hold ? '0' : '1'}">${p.hold ? 'Вернуть пост в загрузку…' : 'Не загружать пост новыми автомобилями…'}</button>`);
    if (!incident && !p.problemId) actions.push(`<details class="demo"><summary>Учебный сценарий неисправности</summary><button class="wide" data-fault="${esc(p.id)}" data-kind="breakdown">Создать неисправность…</button><button class="wide" data-fault="${esc(p.id)}" data-kind="slowdown">Создать снижение темпа…</button></details>`);
  }
  const m = p.metrics;
  body += `<h3>Действия</h3><div class="actions-col">${actions.join('') || '<p class="muted">Действий нет.</p>'}</div>${lockNote}<p class="fine-print">A ${pct(m.availability)} · P ${pct(m.performance)} · Q ${pct(m.quality)} · OEE ${pct(m.oee)} · работа ${p.stats.run} мин · простой без входа ${p.stats.starved} мин</p>`;
  return sideHead(`ПОСТ · ${esc(p.stageName.toUpperCase())}`, esc(p.code), p.equipmentId ? tag(esc(state.equipment.find(e => e.id === p.equipmentId)?.name ?? '')) : '', chatBtn('post', p.id)) + `<div class="side-body">${body}</div>`;
}

function panelProblem(pr) {
  const eq = pr.equipmentId ? state.equipment.find(e => e.id === pr.equipmentId) : null, last = eq?.readings.at(-1);
  const statusTag = pr.status === 'open' ? tag(`${ico('warn', '')}Открыта · с ${clock(pr.detectedAt)}`, 'warn') : pr.status === 'resolved' ? tag(`${ico('ok', '')}Закрыта ${clock(pr.resolvedAt)}`, 'ok') : tag('Не устранена к концу смены', 'stop');
  let body = '';
  const jobs = pr.jobs, decisions = state.decisions.filter(d => d.problemId === pr.id);
  if (jobs.length || decisions.length) {
    const items = [[pr.detectedAt, -1, `<li class="done">${ico('ok', '')}<span><span class="mono t">${clock(pr.detectedAt)}</span>Обнаружено отклонение</span></li>`]];
    for (const d of decisions) items.push([d.appliedAt, 0, `<li class="done">${ico('ok', '')}<span><span class="mono t">${clock(d.appliedAt)} · ${esc(d.id)}</span>Решение: ${esc(d.title)} · ожидание: приёмка ${fmt(d.expected.accepted)}</span></li>`]);
    for (const j of jobs) {
      const k = state.jobKinds.find(x => x.id === state.jobs.find(y => y.id === j.id)?.kind);
      const jk = j.status === 'done' ? 'ok' : j.status === 'running' ? ((k?.type === 'check' || /Проверка/.test(j.title)) ? 'check' : 'stop') : 'idle';
      const full = state.jobs.find(y => y.id === j.id);
      items.push([j.startedAt ?? j.createdAt ?? 1e9, 1, `<li class="${j.status} ${jk}">${ico(jk, '')}<span><span class="mono t">${j.startedAt !== null ? clock(j.startedAt) : 'в очереди'}${j.completedAt !== null ? `–${clock(j.completedAt)}` : ''} · ${esc(j.id)}</span>${esc(j.title)}${j.status === 'running' ? ` — ${full.duration - j.remaining} из ${full.duration} мин` : ''}${j.result ? `<br><b>${esc(j.result.text)}</b>` : ''}${j.status === 'running' ? bar((full.duration - j.remaining) / full.duration, `wide ${jk}`) : ''}</span></li>`]);
    }
    body += `<h3>Ход работ</h3><ol class="timeline">${items.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[2]).join('')}</ol>`;
    if (pr.status === 'open' && jobs.some(j => j.status !== 'done')) body += '<p class="fine-print">Работы идут в модельном времени; ускорение меняет только темп показа. После ремонта проверка запускается автоматически.</p>';
  }
  if (pr.latest) {
    body += `<h3>Симптом</h3><p>Отклонение ${fmt(pr.anomalyScore)} при пороге 4,5${pr.status === 'open' ? '' : ' (на момент закрытия)'}. Средние за 30 мин против нормы:</p>
      <table class="mini-table"><thead><tr><th scope="col">Параметр</th><th scope="col">30 мин</th><th scope="col">Норма</th><th scope="col">${last ? clock(last.minute) : 'последнее'}</th></tr></thead><tbody>${Object.entries(pr.latest).map(([c, x]) => { const dev = Math.abs(x.mean - x.nominal) >= (c === 'pressure' ? 2 : 1.5); return `<tr><th scope="row">${esc(x.name)}, ${esc(x.unit)}</th><td class="${dev ? 'warn-text' : ''}">${dev ? (x.mean > x.nominal ? '↑ ' : '↓ ') : ''}${fmt(x.mean)}</td><td>${x.nominal}</td><td>${last?.[c] !== undefined && last?.[c] !== null ? fmt(last[c]) : '—'}</td></tr>`; }).join('')}</tbody></table>`;
  } else if (pr.observations.length) body += `<h3>Наблюдения</h3><p>${esc(pr.observations[0].text)}</p>`;
  body += `<h3>Гипотезы</h3><p class="fine-print">Оценка по измерениям, а не установленная причина</p><ul class="hyp">${pr.hypotheses.map(h => `<li><span class="hyp-row"><b>${esc(h.title)}</b><span class="mono">${h.probability !== null ? pct(h.probability) : '—'}</span></span>${h.probability !== null ? bar(h.probability, 'wide blue') : ''}<span class="fine-print">${esc(HYP_STATUS[h.status])}</span></li>`).join('')}</ul>`;
  if (pr.status === 'open' && pr.availableChecks?.length) {
    const t = state.technicians[0];
    body += `<h3>Доступные проверки · ТЕХ-1 ${t.jobId ? `занят ${esc(t.jobId)}` : 'свободен'}</h3><div class="checks">${pr.availableChecks.map(c => `<div class="check-card${c.done ? ' done' : ''}"><div class="cc-head"><b>${esc(c.title)}</b><span>${c.duration} мин</span></div><p>${c.stopsPost ? '<b class="stop-text">Пост останавливается</b>' : 'Пост работает'} · ${esc(CHECK_RULES[c.kind] ?? '')}</p>${c.done ? `<p>${ico('ok', 'Выполнена')}</p>` : `<button class="${c.stopsPost ? '' : 'primary'}" data-check="${esc(c.kind)}" data-post-id="${esc(pr.postId)}" ${c.ok ? '' : 'disabled'}>Запустить проверку…</button>${c.ok ? '' : `<p class="why">${esc(c.reason)}</p>`}`}</div>`).join('')}</div>
      <p class="fine-print">Склад: ${state.stock.map(s => `${esc(s.name.toLowerCase())} — ${s.available}`).join(', ')}</p>`;
  }
  const foot = pr.status === 'open' && !state.finished ? `<button class="primary" data-compare="${esc(pr.id)}">Сравнить решения</button>` : '';
  return sideHead(`ПРОБЛЕМА · ${pr.kind === 'equipment' ? 'ОБОРУДОВАНИЕ' : 'РУЧНОЙ СЦЕНАРИЙ'}`, `<span class="mono">${esc(pr.id)}</span> · ${esc(pr.title)}`, statusTag + tag(`Затронуты: ${pr.vehicleIds.map(id => `<button class="link mono" data-vehicle="${esc(id)}">${esc(id)}</button>`).join(', ') || '—'}`), chatBtn('problem', pr.id))
    + `<div class="side-body">${body}${lockNote}<p><button class="link" data-legacy="dispatcher" data-legacy-id="${esc(pr.id)}">Графики измерений и журнал решений в диспетчере →</button></p></div>${foot ? `<div class="side-foot">${foot}<button class="secondary" data-open-chat="1" data-ctx-type="problem" data-ctx-id="${esc(pr.id)}">Обсудить в чате</button></div>` : ''}`;
}

function panelCompare(pr) {
  const exp = [...state.experiments].reverse().find(e => e.problemId === pr.id);
  const head = sideHead(`РЕШЕНИЯ · ${esc(pr.id)} · ${esc(pr.postCode)}`, 'Сравнение решений', '', `<button class="link small-link" data-problem="${esc(pr.id)}">← к диагностике</button>`);
  if (!exp) return head + `<div class="side-body"><p class="muted">Сравнение ещё не рассчитано. Модель будет поставлена на паузу, каждый вариант прогоняется на отдельной копии текущего снимка до 16:00.</p></div><div class="side-foot"><button class="primary" data-compare="${esc(pr.id)}">Рассчитать варианты</button></div>`;
  const stale = exp.baseRevision !== state.revision, decided = state.decisions.some(d => d.experimentId === exp.id);
  const choice = ui.choice[exp.id] ?? exp.options.filter(o => o.available).sort((a, b) => (b.expected?.accepted ?? 0) - (a.expected?.accepted ?? 0))[0]?.id;
  ui.choice[exp.id] = choice;
  const check = pr.checks?.at(-1);
  let body = check ? `<section class="result"><div class="eyebrow">${esc(check.jobId)} · ${esc(check.title.toUpperCase())} · ${clock(check.minute)}</div><div class="result-value mono">${fmt(check.value)} ${esc(check.unit)}</div><p><b>${esc(check.text)}</b></p></section>` : '';
  body += `<p class="fine-print">${esc(exp.id)} · снимок ${clock(exp.minute)}. Ожидаемые значения — расчёт на копиях модели до 16:00, а не факт. План — ${state.plan.target} принятых.</p>`;
  if (stale && !decided) body += `<p class="stale">Смена изменилась после расчёта — пересчитайте варианты перед применением.</p>`;
  if (decided) body += `<p class="ok-text">По этому сравнению решение уже принято — ход работ в карточке проблемы.</p>`;
  body += `<fieldset class="options-list"><legend class="sr-only">Варианты решения</legend>${exp.options.map(o => {
    if (!o.available) return `<div class="opt off"><b>${esc(o.title)} — недоступно</b><p>${esc(o.reason)}</p></div>`;
    const e = o.expected, late = Object.entries(e.lateOrderRisk);
    return `<label class="opt${choice === o.id ? ' chosen' : ''}"><span class="opt-head"><input type="radio" name="opt-${esc(exp.id)}" value="${esc(o.id)}" data-choice="${esc(exp.id)}" ${choice === o.id ? 'checked' : ''} ${decided ? 'disabled' : ''}><b>${esc(o.title)}</b>${o.id === 'continue' ? '<span class="tagchip">базовый</span>' : ''}</span>
      <span class="opt-grid"><span><i>Приёмка</i><b class="${e.accepted >= state.plan.target ? 'ok-text' : 'warn-text'}">${fmt(e.accepted)}</b></span><span><i>Простой</i><b>${fmt(e.downtime, 0)} мин</b></span><span><i>Затраты</i><b>${fmt(e.cost, 0)}</b></span><span><i>Сроки</i><b class="${late.length ? 'stop-text' : 'ok-text'}">${late.length ? late.map(([id, p]) => `${esc(id)} ${pct(p)}`).join(', ') : 'в срок'}</b></span></span></label>`;
  }).join('')}</fieldset>`;
  const foot = decided || state.finished ? '' : stale ? `<button class="primary" data-compare="${esc(pr.id)}">Пересчитать варианты</button>` : `<button class="primary" data-apply-choice="${esc(exp.id)}">Применить выбранное…</button>`;
  return head + `<div class="side-body">${body}</div><div class="side-foot">${foot}<button class="secondary" data-open-chat="1" data-ctx-type="problem" data-ctx-id="${esc(pr.id)}">Обсудить в чате</button></div>`;
}

function chatPanelShell() {
  return `<div class="side-head"><div class="side-top"><span class="eyebrow">ЧАТ ПО СМЕНЕ</span><span class="side-tools"><button class="icon-btn small" data-close-panel="1" aria-label="Закрыть чат">✕</button></span></div><h2>Чат</h2><div class="chipline" id="side-chat-context"></div><p class="fine-print" id="side-chat-mode"></p></div>
  <div class="side-body chat-body"><ol id="side-chat-log" class="chat-log" aria-live="polite"></ol></div>
  <div class="side-foot chat-foot"><div class="chips small" id="side-chat-suggest" role="group" aria-label="Предложенные вопросы"></div>
  <form id="side-chat-form" class="chat-form"><label for="side-chat-input" class="sr-only">Вопрос о выбранном объекте</label><textarea id="side-chat-input" rows="2" maxlength="500" placeholder="Вопрос о посте, автомобиле, событии…"></textarea><div class="chat-send"><span id="side-chat-count" class="fine-print">0/500</span><button class="primary" type="submit" id="side-chat-send">Спросить</button></div></form></div>`;
}
function updateSideChat() {
  const ai = state.ai;
  $('side-chat-mode').textContent = ai.configured ? 'Модель формулирует ответ только из фактов движка; числа проверяет сервер. Чат ничего не меняет сам.' : 'Модель не подключена: работают локальные ответы на типовые вопросы. Чат ничего не меняет сам.';
  $('side-chat-context').innerHTML = chatContext ? `${tag(`Контекст: ${esc(contextLabel(chatContext))}`, 'blue')}<button class="link small-link" data-chat-clear="1">убрать</button>` : tag('без контекста');
  $('side-chat-suggest').innerHTML = SUGGESTED.slice(0, 4).map(q => `<button data-ask="${esc(q)}" data-ask-side="1">${esc(q)}</button>`).join('');
  const log = $('side-chat-log'), host = log.parentElement, atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
  log.innerHTML = state.chat.map(m => `<li class="msg ${m.role}"><div class="msg-meta">${m.role === 'user' ? 'Вы' : m.source === 'local' ? 'Локальная логика' : m.source === 'openai' ? 'OpenAI' : 'NVIDIA'} · ${clock(m.minute)}${m.context ? ` · ${esc(contextLabel(m.context))}` : ''}</div><div class="msg-text">${esc(m.text)}</div>
    ${m.refs?.length ? `<div class="refs">${m.refs.map(r => `<button class="ref" data-ref-type="${esc(r.type)}" data-ref-id="${esc(r.id)}">${esc(r.label)}</button>`).join('')}</div>` : ''}
    ${m.proposal ? `<div class="proposal"><span>Предложение: ${esc(m.proposal.title)}</span><button class="primary" data-proposal="${esc(m.id)}" ${state.finished ? 'disabled' : ''}>Подтвердить…</button></div>` : ''}</li>`).join('') || '<li class="muted">Спросите о выбранном объекте. Ссылки в ответах ведут к автомобилю, посту, событию или сравнению.</li>';
  if (atBottom) host.scrollTop = host.scrollHeight;
}

// ---------- Selection and navigation inside spaces ----------
function openPanel(panel, selected, ctx) {
  ui.panel = panel; if (selected !== undefined) ui.selected = selected; if (ctx) chatContext = ctx;
  if (view !== 'space') { location.hash = `space/${['assembly', 'diag'].includes(space) ? space : 'assembly'}`; return; }
  syncHash(); render();
  if (narrow() && scene && ui.selected) { if (ui.selected.type === 'vehicle') scene.focusVehicle(ui.selected.id, 1.6); else if (ui.selected.type === 'post') scene.focusPost(ui.selected.id, 1.6); }
  requestAnimationFrame(() => $('side').querySelector('h2')?.focus?.());
}
const selectVehicle = id => openPanel({ type: 'vehicle', id }, { type: 'vehicle', id }, { type: 'vehicle', id });
const selectPost = id => openPanel({ type: 'post', id }, { type: 'post', id }, { type: 'post', id });
const selectProblem = id => { const p = problem(id); openPanel({ type: 'problem', id }, p ? { type: 'post', id: p.postId } : null, { type: 'problem', id }); };
function closePanel() { ui.panel = null; ui.selected = null; ui.ribbonOnlySelected = false; syncHash(); render(); }
// The address bar follows the open card, so a link can be shared or opened again; replaceState does not fire hashchange.
function syncHash() { if (view !== 'space') return; const p = ui.panel; history.replaceState(null, '', `#space/${space}${p ? `/${p.type}${p.id ? `/${encodeURIComponent(p.id)}` : ''}` : ''}`); }
function goSpace(id) { location.hash = `space/${id}`; }
function openRefSpace(type, id) {
  if (type === 'vehicle') return selectVehicle(id);
  if (type === 'post') return selectPost(id);
  if (type === 'problem') return selectProblem(id);
  if (type === 'order') return openOrder(id);
  if (type === 'experiment') { const e = state.experiments.find(x => x.id === id); if (e) return openPanel({ type: 'compare', id: e.problemId }); return; }
  if (type === 'decision') { const d = state.decisions.find(x => x.id === id); if (d) return selectProblem(d.problemId); return; }
  if (type === 'job') { const j = state.jobs.find(x => x.id === id); if (j?.problemId) return selectProblem(j.problemId); if (j) return selectPost(j.postId); return; }
  if (type === 'event') { const e = state.events.find(x => String(x.seq) === String(id)); if (e) return openEvent(e); }
}
function openEvent(e) {
  if (e.problemId && ['problem_detected', 'problem_resolved', 'decision_applied', 'check_completed', 'verify_completed'].includes(e.type)) return selectProblem(e.problemId);
  if (e.vehicleId) return selectVehicle(e.vehicleId);
  if (e.problemId) return selectProblem(e.problemId);
  if (e.postId) return selectPost(e.postId);
}
// Returns true when the click was handled by the space UI.
async function spaceClick(t, d) {
  if (d.closePanel) { closePanel(); return true; }
  if (d.mode) { ui.table = d.mode === 'table'; render(); return true; }
  if (d.cam) { if (scene) { if (d.cam === 'home') scene.home(); else scene.zoom(d.cam === 'in' ? 1.2 : 1 / 1.2); } return true; }
  if (d.space) { goSpace(d.space); return true; }
  if (d.ribbon) { if (d.ribbon === 'open') ui.ribbonOpen = true; else if (d.ribbon === 'close') ui.ribbonOpen = false; else ui.ribbonOnlySelected = !ui.ribbonOnlySelected; renderRibbon(); return true; }
  if (d.event) { const e = state.events.find(x => String(x.seq) === d.event); if (e) openEvent(e); return true; }
  if (d.vehicle || d.vehicleSelect) { selectVehicle(d.vehicle || d.vehicleSelect); return true; }
  if (d.post || d.postLink) { selectPost(d.post || d.postLink); return true; }
  if (d.problem) { selectProblem(d.problem); return true; }
  if (d.table) { ui.table = true; render(); return true; }
  if (d.openChat) { if (d.ctxType) chatContext = { type: d.ctxType, id: d.ctxId }; else if (ui.selected) chatContext = ui.selected.type === 'vehicle' ? { type: 'vehicle', id: ui.selected.id } : ui.panel?.type === 'problem' ? { type: 'problem', id: ui.panel.id } : { type: 'post', id: ui.selected.id }; ui.panel = { type: 'chat' }; syncHash(); render(); requestAnimationFrame(() => $('side-chat-input')?.focus()); return true; }
  if (d.refType) { openRefSpace(d.refType, d.refId); return true; }
  if (d.ask) { const input = $('side-chat-input'); if (input) input.value = d.ask; ask(d.ask, SIDE_CHAT); return true; }
  if (d.chatClear) { chatContext = null; updateSideChat(); return true; }
  if (d.applyChoice) { const id = ui.choice[d.applyChoice]; if (id) await applyDecision(d.applyChoice, id); return true; }
  if (d.legacy) { if (d.legacy === 'vehicles') openVehicle(d.legacyId); else if (d.legacy === 'dispatcher') openProblem(d.legacyId); return true; }
  return false;
}
const SIDE_CHAT = { input: 'side-chat-input', send: 'side-chat-send', count: 'side-chat-count' };

// Camera: drag to pan, wheel to zoom, keyboard activation of scene objects.
let drag = null, suppressClick = false;
$('scene-wrap').addEventListener('pointerdown', e => { if (e.button !== 0 || !scene) return; drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; });
$('scene-wrap').addEventListener('pointermove', e => {
  if (!drag || !scene) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) { drag.moved = true; $('scene-wrap').setPointerCapture(drag.id); $('scene-wrap').classList.add('dragging'); }
  const k = 1000 / Math.max(1, $('scene').clientWidth);
  scene.pan(dx * k, dy * k); drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = () => { if (drag?.moved) suppressClick = true; drag = null; $('scene-wrap').classList.remove('dragging'); };
$('scene-wrap').addEventListener('pointerup', endDrag); $('scene-wrap').addEventListener('pointercancel', endDrag);
$('scene-wrap').addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
$('scene-wrap').addEventListener('wheel', e => { if (!scene) return; e.preventDefault(); scene.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
for (const id of ['scene', 'enterprise']) $(id).addEventListener('keydown', e => { const t = e.target.closest?.('[role=button]'); if ((e.key === 'Enter' || e.key === ' ') && t) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
$('diag-toggle').addEventListener('change', e => { ui.diag = e.target.checked; render(); });
document.addEventListener('change', e => { const c = e.target.dataset?.choice; if (c) { ui.choice[c] = e.target.value; renderSide(); } });
document.addEventListener('submit', e => { if (e.target.id === 'side-chat-form') { e.preventDefault(); ask($('side-chat-input').value, SIDE_CHAT); } });
document.addEventListener('input', e => { if (e.target.id === 'side-chat-input') text('side-chat-count', `${e.target.value.length}/500`); });
document.addEventListener('keydown', e => {
  if (e.target.id === 'side-chat-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value, SIDE_CHAT); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || $('confirm').open || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Escape') { if ($('menu').open) { $('menu').open = false; return; } if (view === 'space' && ui.panel) { closePanel(); } return; }
  if (view !== 'space') return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= 6) { goSpace(SPACE_KEYS[n - 1]); return; }
  if (e.key === '0') { scene?.home(); return; }
  if (e.key === '+' || e.key === '=') { scene?.zoom(1.2); return; }
  if (e.key === '-') { scene?.zoom(1 / 1.2); return; }
  if (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'е') { ui.table = !ui.table; render(); }
});

// ---------- Routing and render ----------
function setView(hash) {
  const [name, arg, type, id] = hash.split('/');
  if (VIEWS.includes(name)) view = name;
  else {
    view = 'space'; space = SPACES[arg] ? arg : 'assembly';
    // Deep links: #space/<space>/<vehicle|post|problem|compare|chat>/<id> open the same card as a click.
    if (['vehicle', 'post', 'problem', 'compare', 'chat'].includes(type)) {
      const objId = id ? decodeURIComponent(id) : undefined;
      ui.panel = { type, id: objId };
      if (type === 'vehicle' || type === 'post') ui.selected = { type, id: objId };
      if (type !== 'chat' && objId) chatContext = { type: type === 'compare' ? 'problem' : type, id: objId };
    }
  }
  $('view-space').hidden = view !== 'space'; $('legacy').hidden = view === 'space';
  for (const s of document.querySelectorAll('#legacy .view')) s.hidden = s.id !== `view-${view}`;
  for (const a of document.querySelectorAll('[data-nav]')) { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  for (const a of document.querySelectorAll('[data-space-link]')) { if (view === 'space' && a.dataset.spaceLink === space) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  $('menu').open = false;
  if (view !== 'space') destroyScene();
  if (view === 'lab' && !lab) loadLab();
  render();
}
function focusKey(el) {
  if (!el || el === document.body || !el.closest('main')) return null;
  const attrs = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}
function render() {
  if (!state) return;
  const key = focusKey(document.activeElement);
  renderChrome();
  if (view === 'space') renderSpace();
  else if (view === 'dispatcher') { renderThreat(); renderProblemCard(); renderComparison(); renderDecisions(); renderChat(); }
  else if (view === 'workshop') { renderActiveProblems(); renderMap(); renderPostDetail(); renderPostBoard(); }
  else if (view === 'vehicles') renderVehicles();
  else if (view === 'orders') renderOrders();
  else if (view === 'shift') renderShift();
  else renderLab();
  if (key && !document.activeElement?.closest('main')) document.querySelector(key)?.focus({ preventScroll: true });
}
function openVehicle(id) { selectedVehicle = id; chatContext = { type: 'vehicle', id }; if (!filterOf[vehicleFilter](vehicle(id))) vehicleFilter = 'all'; if (location.hash !== '#vehicles') location.hash = 'vehicles'; else render(); requestAnimationFrame(() => $('vehicle-passport').scrollIntoView({ block: 'nearest' })); }
function openPost(id) { selectedPost = id; chatContext = { type: 'post', id }; if (location.hash !== '#workshop') location.hash = 'workshop'; else render(); requestAnimationFrame(() => { if (matchMedia('(max-width: 1499px)').matches) $('post-detail').scrollIntoView({ block: 'nearest' }); }); }
function openProblem(id) { selectedProblem = id; chatContext = { type: 'problem', id }; if (location.hash !== '#dispatcher') location.hash = 'dispatcher'; else render(); requestAnimationFrame(() => $('problem-card').scrollIntoView({ block: 'start' })); }
function openOrder(id) { chatContext = { type: 'order', id }; if (location.hash !== '#orders') location.hash = 'orders'; else render(); requestAnimationFrame(() => document.getElementById(`order-${id}`)?.scrollIntoView({ block: 'start' })); }
function openRef(type, id) {
  if (type === 'vehicle') return openVehicle(id);
  if (type === 'post') return openPost(id);
  if (type === 'order') return openOrder(id);
  if (type === 'problem') return openProblem(id);
  if (type === 'experiment') { const e = state.experiments.find(x => x.id === id); if (e) selectedProblem = e.problemId; if (location.hash !== '#dispatcher') location.hash = 'dispatcher'; else render(); return requestAnimationFrame(() => $('comparison').scrollIntoView({ block: 'start' })); }
  if (type === 'decision') { if (location.hash !== '#dispatcher') location.hash = 'dispatcher'; return requestAnimationFrame(() => $('decision-log').scrollIntoView({ block: 'start' })); }
  if (type === 'job') { const j = state.jobs.find(x => x.id === id); if (j?.problemId) return openProblem(j.problemId); return openPost(j?.postId ?? selectedPost); }
  if (type === 'event') { location.hash = 'shift'; requestAnimationFrame(() => { const el = document.getElementById(`ev-${id}`); if (el) { el.classList.add('highlight'); el.scrollIntoView({ block: 'center' }); } }); }
}

window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
$('play').addEventListener('click', () => action({ action: state.running ? 'pause' : 'play' }));
$('step').addEventListener('click', () => action({ action: 'step' }));
$('step-menu').addEventListener('click', () => { $('menu').open = false; action({ action: 'step' }); });
$('menu').addEventListener('click', e => { if (e.target.closest('a, button')) $('menu').open = false; });
$('reset').addEventListener('click', async () => { if (await confirmAction('Сбросить смену?', '<p>Смена начнётся заново в 11:00 с тем же seed. Решения, проверки, сравнения и история чата текущей смены будут удалены из сохранённого состояния.</p>')) action({ action: 'reset' }); });
$('release-form').addEventListener('submit', async e => {
  e.preventDefault();
  const quantity = Number($('release-quantity').value), priority = new FormData(e.target).get('release-priority');
  if (await action({ action: 'release', model: $('release-model').value, quantity, priority, requestId: requestId() })) text('release-note', `Задание ${state.orders.at(-1).id} выпущено: ${quantity} авт. во входном буфере. ${$('release-note').textContent}`);
});
$('plan-form').addEventListener('submit', async e => { e.preventDefault(); const target = Number($('plan-target').value); if (await confirmAction(`Задать план смены: ${target}`, `<p>План — обязательство смены, его задаёт оператор. Сейчас: ${state.plan.target}. Прогноз и факт от этого не меняются.</p>`)) action({ action: 'plan', target }); });
$('chat-form').addEventListener('submit', e => { e.preventDefault(); ask($('chat-input').value); });
$('chat-input').addEventListener('input', e => text('chat-count', `${e.target.value.length}/500`));
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); } });
document.addEventListener('click', async e => {
  const t = e.target.closest('button, [role=button]'); if (!t || !state || t.closest('dialog')) return;
  const d = t.dataset;
  if (d.speed) { action({ action: 'speed', value: Number(d.speed) }); return; }
  if (view === 'space' && await spaceClick(t, d)) return;
  if (d.openChat) { location.hash = 'dispatcher'; requestAnimationFrame(() => $('chat-input').focus()); return; }
  if (d.post) { selectedPost = d.post; chatContext = { type: 'post', id: d.post }; render(); return; }
  if (d.postLink) return openPost(d.postLink);
  if (d.vehicle) return openVehicle(d.vehicle);
  if (d.vehicleSelect) { selectedVehicle = d.vehicleSelect; chatContext = { type: 'vehicle', id: d.vehicleSelect }; renderVehicles(); if (matchMedia('(max-width: 1099px)').matches) $('vehicle-passport').scrollIntoView({ block: 'start' }); return; }
  if (d.filter) { vehicleFilter = d.filter; selectedVehicle = null; renderVehicles(); return; }
  if (d.orderLink) return openOrder(d.orderLink);
  if (d.problem) return openProblem(d.problem);
  if (d.navTo) { location.hash = d.navTo; return; }
  if (d.refType) return openRef(d.refType, d.refId);
  if (d.ask) { $('chat-input').value = d.ask; return ask(d.ask); }
  if (d.chatClear) { chatContext = null; renderChat(); return; }
  if (d.chatAbout) { chatContext = { type: d.chatAbout, id: d.chatId }; location.hash = 'dispatcher'; requestAnimationFrame(() => $('chat-input').focus()); return; }
  if (d.proposal) return applyProposal(d.proposal);
  if (d.compare) return compare(d.compare);
  if (d.apply) return applyDecision(d.exp, d.apply);
  if (d.check) { const p = post(d.postId), job = state.jobKinds.find(j => j.id === d.check); if (await confirmAction(`${job.title} на ${p.code}`, `<p>Техник ТЕХ-1 будет занят ${job.duration} мин${job.stopsPost ? `, ${esc(p.code)} остановится на это время` : ', пост продолжит работу'}. Результат проверки появится в наблюдениях проблемы. Ремонт этим действием не назначается.</p>`)) action({ action: 'job', postId: d.postId, kind: d.check, requestId: requestId() }); return; }
  if (d.job) { const p = post(d.postId), job = state.jobKinds.find(j => j.id === d.job); if (await confirmAction(`${job.title} на ${p.code}`, `<p>Техник ТЕХ-1 будет занят ${job.duration} мин${job.stopsPost ? `, пост остановлен на время работ` : ''}. Если техник занят, работа встанет в очередь.</p>`)) action({ action: 'job', postId: d.postId, kind: d.job, requestId: requestId() }); return; }
  if (d.fault) { if (await confirmAction(`Ручной сценарий на ${post(d.fault).code}`, `<p>Будет создан демонстрационный инцидент «${d.kind === 'breakdown' ? 'неисправность' : 'снижение темпа'}». Неисправность не исчезнет сама: потребуется ремонт.</p>`)) action({ action: 'fault', postId: d.fault, kind: d.kind, requestId: requestId() }); return; }
  if (d.transfer) { if (await confirmAction(`Перевести ${d.transfer} на ${post(d.to).code}`, '<p>Автомобиль переедет на параллельный пост; остаток операции сохранится. Сервер проверит, что пост свободен и исправен.</p>')) action({ action: 'transfer', vehicleId: d.transfer, postId: d.to, requestId: requestId() }); return; }
  if (d.hold) { const on = d.on === '1'; if (await confirmAction(on ? `Не загружать ${post(d.hold).code} новыми автомобилями` : `Вернуть ${post(d.hold).code} в загрузку`, `<p>${on ? 'Следующие автомобили из очереди пойдут на параллельные посты. Текущая операция на посту продолжится.' : 'Пост снова будет получать автомобили из очереди.'}</p>`)) action({ action: 'hold', postId: d.hold, on }); return; }
  if (d.priority) action({ action: 'priority', orderId: d.order, priority: d.priority });
});
$('workshop-map').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[role=button]')) { e.preventDefault(); e.target.closest('[role=button]').dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
$('explain').addEventListener('click', async () => {
  if (!state || aiBusy) return;
  aiBusy = true; $('explain').disabled = true; text('explain', 'Объясняю…');
  try { const r = await api('/api/explain', {}); text('ai-text', r.text); text('ai-source', `${r.source === 'openai' ? 'OpenAI' : r.source === 'nvidia' ? 'NVIDIA AI' : 'Локальное объяснение'} · ${r.message} · ${clock(r.minute)}`); aiRevision = r.revision; error(''); render(); }
  catch (e) { error(`Не удалось получить объяснение: ${e.message}. Расчётные показатели доступны выше.`); }
  finally { aiBusy = false; $('explain').disabled = false; text('explain', 'Объяснить ↗'); }
});
async function refresh() {
  if (updating || fetching || chatBusy) return;
  fetching = true;
  try {
    const next = await api('/api/state');
    if (!updating) { const changed = !state || state.revision !== next.revision || state.recordVersion !== next.recordVersion || state.running !== next.running || state.speed !== next.speed || state.csrf !== next.csrf; state = next; if (changed && !$('confirm').open) render(); error(''); }
  } catch { error('Нет связи с локальным сервером. Проверьте, что npm start продолжает работать. Повторяем подключение…'); }
  finally { fetching = false; }
}
await refresh(); setView(location.hash.slice(1)); setInterval(refresh, 1200);
