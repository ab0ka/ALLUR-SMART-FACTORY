// A handover is an explicit, read-only snapshot; production polling never reloads it.
const handover = { active: false, controller: null, generation: 0, report: null, observed: null, status: 'idle' };
function handoverStop() {
  handover.controller?.abort(); handover.controller = null; handover.generation++;
}
function handoverObserve() {
  const previous = handover.observed;
  const next = state && { csrf: state.csrf, seed: state.seed, elapsed: state.elapsed, revision: state.revision };
  handover.observed = next;
  return previous && next && (previous.csrf !== next.csrf || previous.seed !== next.seed || next.elapsed < previous.elapsed || next.revision < previous.revision);
}
function handoverRoute() {
  if (view !== 'handover') { handoverStop(); handover.active = false; return; }
  if (handover.active) return;
  handover.active = true; handover.observed = null; handoverObserve();
  loadHandover();
}
function handoverNumber(value, percent = false) {
  return typeof value === 'number' && Number.isFinite(value) ? esc(percent ? pct(value) : fmt(value)) : '—';
}
function handoverTime(report) {
  if (!Number.isFinite(report.shiftStart) || !Number.isFinite(report.elapsed)) return 'Время не указано';
  const minute = Math.floor(report.shiftStart + report.elapsed);
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
function renderHandover() {
  if (view !== 'handover') return;
  if (handoverObserve()) {
    handoverStop(); handover.report = null; handover.status = 'stale';
    $('handover-content').innerHTML = '';
    $('handover-status').textContent = 'Смена изменилась. Обновите срез перед передачей.';
    $('handover-refresh').disabled = false;
    $('handover-refresh').textContent = 'Обновить срез';
    $('handover-content').setAttribute('aria-busy', 'false');
  }
}
function handoverPaint(report) {
  const metrics = report.metrics;
  const cards = [
    ['План смены', metrics.planTarget, 'Обязательство оператора'],
    ['Эталон', metrics.referenceTotal, 'Эталонная мощность смены'],
    ['Прогноз', metrics.forecast, `Диапазон: ${handoverNumber(metrics.forecastLow)}–${handoverNumber(metrics.forecastHigh)}`],
    ['Факт: принято', metrics.accepted, 'Пройден контроль качества'],
    ['Отгружено', metrics.shipped, 'Покинуло производство'],
    ['В работе · WIP', metrics.wip, 'Незавершённое производство'],
    ['Качество · FPY', metrics.firstPassYield, 'Контроль с первого раза', true],
  ];
  const empty = ['problems', 'jobs', 'tasks', 'orders'].every(key => Array.isArray(report[key]) && report[key].length === 0);
  $('handover-content').innerHTML = `<div class="handover-meta"><strong>Срез на ${esc(handoverTime(report))}</strong><span>Ревизия ${esc(report.revision ?? '—')}</span><span>${report.finished ? 'Смена завершена' : 'Смена не завершена'}</span></div>
    <dl class="handover-metrics">${cards.map(([label, value, note, percent]) => `<div class="handover-metric"><dt>${label}</dt><dd>${handoverNumber(value, percent)}</dd><p>${note}</p></div>`).join('')}</dl>
    ${empty ? '<p class="handover-empty">Открытых проблем, работ, задач и незавершённых заданий в этом срезе нет.</p>' : ''}
    <div id="handover-items">${typeof renderHandoverItems === 'function' ? renderHandoverItems(report) : '<p class="handover-empty">Подробные списки станут доступны после подключения модуля передачи смены.</p>'}</div>`;
}
async function loadHandover() {
  if (view !== 'handover') return;
  const focused = document.activeElement?.closest('#view-handover [data-focus-key]');
  const focusKey = focused?.dataset.focusKey;
  handoverStop(); handoverObserve();
  const generation = handover.generation;
  const controller = new AbortController(); handover.controller = controller;
  handover.status = 'loading'; handover.report = null;
  $('handover-content').innerHTML = '';
  $('handover-content').setAttribute('aria-busy', 'true');
  $('handover-status').textContent = 'Загружаем срез смены…';
  $('handover-refresh').disabled = true; $('handover-refresh').textContent = 'Загрузка…';
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/handover', { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('handover unavailable');
    const report = await response.json();
    if (generation !== handover.generation || view !== 'handover') return;
    if (handoverObserve()) { renderHandover(); throw new Error('shift changed'); }
    if (report?.schemaVersion !== 1 || report.synthetic !== true || !report.metrics || typeof report.metrics !== 'object') throw new Error('invalid handover');
    handover.report = report; handover.status = 'ready'; handoverPaint(report);
    if (focusKey && (document.activeElement === document.body || document.activeElement === focused)) {
      const target = [...$('view-handover').querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === focusKey);
      target?.focus({ preventScroll: true });
    }
    $('handover-status').textContent = 'Срез получен. Для актуальных данных нажмите «Обновить срез».';
  } catch {
    if (generation !== handover.generation || view !== 'handover') return;
    handover.status = 'error';
    $('handover-status').textContent = 'Не удалось получить срез. Проверьте подключение и повторите запрос.';
  } finally {
    clearTimeout(timeout);
    if (generation === handover.generation && view === 'handover') {
      handover.controller = null;
      $('handover-content').setAttribute('aria-busy', 'false');
      $('handover-refresh').disabled = false;
      $('handover-refresh').textContent = handover.status === 'error' ? 'Повторить запрос' : 'Обновить срез';
    }
  }
}
$('handover-refresh').addEventListener('click', loadHandover);
