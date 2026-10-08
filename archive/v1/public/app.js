const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const pct = n => fmt(n * 100);
const clock = m => `${String(8 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const labels = { normal: 'Работает', stop: 'Остановка', warning: 'Отклонение', waiting: 'Ожидание' };
let state, selected = 'assembly', updating = false, fetching = false, aiSnapshot = null, aiBusy = false;
const text = (id, value) => { $(id).textContent = value; };
const bar = (value, fillClass = '') => `<div class="bar-track"><svg viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-fill ${fillClass}" width="${Math.max(0, Math.min(100, value))}" height="5" rx="2"/></svg></div>`;
function error(message) { $('error').hidden = !message; text('error', message || ''); }
async function api(path, body) {
  const response = await fetch(path, body === undefined ? { signal: AbortSignal.timeout(5000) } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state?.csrf || '' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Ошибка запроса'); return data;
}
async function action(body) {
  if (updating || !state) return;
  updating = true;
  try { state = await api('/api/action', body); error(''); if (body.action === 'reset') { aiSnapshot = null; text('ai-text', 'Демо сброшено. Запросите объяснение нового снимка.'); text('ai-source', 'Локальный режим доступен без ключа'); } render(); }
  catch (e) { error(e.message); } finally { updating = false; }
}
function renderMap() {
  const focused = document.activeElement?.getAttribute('data-station');
  const focusSurface = document.activeElement?.closest('#station-tabs') ? '#station-tabs' : '#station-nodes';
  const icons = [
    '<path d="M-23 2h14l7-13 13 8-6 10h16M-3-11l4-8 11 6-1 10M-23 2v12h10V2M10 14h14"/>',
    '<path d="M-22 15v-32h44v32M-15-11h30M-12 11h24l-3-10h-18zM-8-6v3M0-6v3M8-6v3"/>',
    '<path d="M-25 11h50M-19 9V0l6-11h25L19 0v9M-15 0h30M-9-11v11M9-11v11"/><circle cx="-13" cy="11" r="4"/><circle cx="13" cy="11" r="4"/>',
    '<path d="M-14-18h22v31h-22zM-8-22h10v8h-10M-6 2l5 5L10-6"/>',
    '<path d="M-25-10h30v23h-30zM5-4h12l8 10v7H5M-19-5h17M10 0v7h12"/><circle cx="-15" cy="14" r="4"/><circle cx="16" cy="14" r="4"/>',
  ];
  $('station-nodes').innerHTML = state.stations.map((s, i) => `<g class="station-node ${selected === s.id ? 'selected' : ''} ${state.bottleneck === s.id ? 'bottleneck' : ''}" transform="translate(${24 + i * 167},65)" role="button" tabindex="0" data-station="${s.id}" aria-label="${s.name}: ${labels[s.state]}${state.bottleneck === s.id ? ', узкое место линии' : ''}" aria-pressed="${selected === s.id}">${state.bottleneck === s.id ? '<rect class="bottleneck-ring" x="-6" y="-6" width="155" height="162" rx="13"/><g class="bottleneck-tag"><rect x="16" y="-36" width="111" height="22" rx="5"/><text x="71" y="-21" text-anchor="middle">УЗКОЕ МЕСТО</text></g>' : ''}<rect class="node-box" width="143" height="150" rx="9"/><text class="node-number" x="14" y="23">УЧАСТОК ${s.code}</text><circle class="status-${s.state}" cx="127" cy="18" r="4"/><g class="node-icon" transform="translate(71,62)">${icons[i]}</g><text class="node-name" x="71" y="109" text-anchor="middle">${s.id === 'quality' ? 'Контроль' : s.name}</text><text class="node-status" x="71" y="132" text-anchor="middle">${labels[s.state]}</text></g>`).join('');
  $('station-tabs').innerHTML = state.stations.map(s => `<button data-station="${s.id}" aria-pressed="${selected === s.id}">${s.code} ${s.name}</button>`).join('');
  if (focused) document.querySelector(`${focusSurface} [data-station="${focused}"]`)?.focus({ preventScroll: true });
  $('flow').classList.toggle('paused', !state.running || state.stations.some(s => s.state === 'stop'));
}
function renderStation() {
  const s = state.stations.find(s => s.id === selected);
  text('station-name', s.name); text('station-code', s.code); text('station-detail', s.detail);
  text('station-status', labels[s.state]); $('station-status').dataset.state = s.state;
  text('bottleneck-note', state.bottleneck === s.id ? '↘ Узкое место линии сейчас' : 'Участок общего производственного потока');
  text('station-rate', `${fmt(s.effectiveRate * 60)} шт./ч${s.state === 'stop' || s.state === 'waiting' ? ' · поток 0' : ''}`);
  $('oee-bars').innerHTML = [['Доступность · A', s.metrics.availability], ['Производительность · P', s.metrics.performance], ['Качество · Q', s.metrics.quality], ['OEE участка', s.metrics.oee]].map(([name, value]) => `<div class="bar-row"><div class="bar-label"><span>${name}</span><strong>${pct(value)}%</strong></div>${bar(value * 100)}</div>`).join('');
}
function renderChart() {
  const x = m => 48 + m / 480 * 688, y = v => 183 - v / 480 * 159;
  const history = [...state.history]; if (history.at(-1).minute !== state.elapsed) history.push({ minute: state.elapsed, good: state.good });
  const points = history.map(h => `${x(h.minute)},${y(h.good)}`).join(' ');
  $('production-chart').innerHTML = [0, 100, 200, 300, 400].map(v => `<line class="chart-grid" x1="48" y1="${y(v)}" x2="736" y2="${y(v)}"/><text class="chart-axis" x="36" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('') +
    [0, 120, 240, 360, 480].map(m => `<text class="chart-axis" x="${x(m)}" y="211" text-anchor="middle">${clock(m)}</text>`).join('') +
    `<path class="chart-plan" d="M48 183 L736 ${y(400)}"/><polygon class="chart-area" points="48,183 ${points} ${x(state.elapsed)},183"/><polyline class="chart-fact" points="${points}"/><circle cx="${x(state.elapsed)}" cy="${y(state.good)}" r="4" fill="#c7f36b"/>`;
}
function renderIncidents() {
  const focusedId = document.activeElement?.dataset.resolve;
  const active = state.incidents.filter(i => i.status === 'active'), open = state.incidents.filter(i => i.status === 'unresolved');
  text('incident-count', `${active.length} активных${open.length ? ` · ${open.length} не устранено` : ''}`);
  if (!state.incidents.length) { $('incidents').innerHTML = '<div class="empty-state"><span>✓</span><strong>Линия работает штатно</strong><p>Запустите сценарий на карте — событие появится здесь.</p></div>'; return; }
  const recovery = i => `расчётное восстановление ${clock(i.expires)}${i.expires > state.shift ? ' (после окончания смены)' : ''}`;
  const status = i => i.status === 'active' ? `Активен · ${recovery(i)}` : i.status === 'unresolved' ? `Не устранён к концу смены · ${recovery(i)}` : i.resolution;
  const remedy = i => i.status === 'resolved' ? `${i.resolution}. ${i.remedy}` : i.status === 'unresolved' ? `Не выполнено до конца смены. При устранении: ${i.remedy}` : `Кнопка «Устранить»: ${i.remedy}`;
  // Only fixed server scenario strings and validated numeric fields are used in templates.
  $('incidents').innerHTML = state.incidents.map(i => `<article class="incident ${i.status}"><div class="incident-head"><strong>${i.severity === 'critical' ? '●' : '◇'} ${i.title}</strong><span class="incident-time">${clock(i.start)} → ${i.end !== null ? clock(i.end) : i.status === 'unresolved' ? 'не устранён' : '…'}</span></div><dl class="incident-meta"><div><dt>Участок</dt><dd>${i.stationName}</dd></div><div><dt>Причина (гипотеза)</dt><dd>${i.cause}</dd></div><div><dt>Рекомендация</dt><dd>${i.advice}</dd></div><div><dt>Действие устранения</dt><dd>${remedy(i)}</dd></div></dl><div class="incident-bottom"><span>${status(i)}</span>${i.status === 'active' ? `<button data-resolve="${i.id}">Устранить</button>` : ''}</div></article>`).join('');
  if (focusedId) document.querySelector(`[data-resolve="${focusedId}"]`)?.focus({ preventScroll: true });
}
function render() {
  if (!state) return;
  text('clock', clock(state.elapsed)); text('run-status', state.finished ? 'Смена завершена' : state.running ? '● Симуляция запущена' : 'Ⅱ Симуляция на паузе');
  text('play', state.running ? 'Ⅱ Пауза' : '▶ Запустить'); $('play').disabled = state.finished; $('step').disabled = state.finished; $('speed').value = String(state.speed);
  text('shift-progress', `${state.elapsed} / ${state.shift} мин`); text('good', state.good); text('plan-now', `/ ${fmt(state.planNow)}`);
  text('delta', `${state.delta >= 0 ? '+' : ''}${fmt(state.delta)} шт. к плану сейчас`); $('delta').className = `kpi-foot ${state.delta >= 0 ? 'positive' : 'negative'}`;
  text('oee', pct(state.metrics.oee)); text('oee-foot', `A ${pct(state.metrics.availability)} · P ${pct(state.metrics.performance)} · Q ${pct(state.metrics.quality)}`);
  text('yield', pct(state.metrics.quality)); text('reject-foot', `Брак: ${state.rejects} из ${state.total} шт.`);
  text('projected', state.forecast.projected); text('forecast-foot', `${state.forecast.gap >= 0 ? 'Запас' : 'Дефицит'} ${Math.abs(state.forecast.gap)} шт. к плану смены`);
  $('forecast-foot').className = `kpi-foot ${state.forecast.gap >= 0 ? 'positive' : 'negative'}`;
  renderMap(); renderStation(); renderChart(); renderIncidents();
  document.querySelectorAll('[data-scenario]').forEach(b => { b.disabled = state.finished || state.incidents.some(i => i.type === b.dataset.scenario && i.status === 'active'); });
  text('total', `${state.total} шт.`); text('downtime', `${state.downtime} мин`); text('reject-count', `${state.rejects} шт.`);
  $('defect-bars').innerHTML = Object.entries(state.defects).map(([name, value]) => `<div class="bar-row"><div class="bar-label"><span>${name}</span><strong>${value} шт.</strong></div>${bar(state.rejects ? value / state.rejects * 100 : 0)}</div>`).join('');
  text('forecast-big', state.forecast.projected); text('forecast-range', `Сценарный диапазон ${state.forecast.low}–${state.forecast.high} шт. · эвристика`);
  $('forecast-factors').innerHTML = [['Простой', state.forecast.factors.stop], ['Темп', state.forecast.factors.slowdown], ['Качество', state.forecast.factors.quality]].map(([name, n]) => `<div class="factor"><span>Будущие потери · ${name}</span><strong>−${fmt(n)} шт.</strong></div>`).join('');
  text('formula', state.forecast.formula); text('assumption', state.forecast.assumption);
  text('ai-stale', aiSnapshot === null ? '' : aiSnapshot !== state.revision ? 'Состояние изменилось после объяснения. Обновите его для текущего прогноза.' : 'Объяснение относится к текущему снимку синтетических данных.');
}
$('play').addEventListener('click', () => action({ action: state.running ? 'pause' : 'play' }));
$('step').addEventListener('click', () => action({ action: 'step' }));
$('reset').addEventListener('click', () => action({ action: 'reset' }));
$('speed').addEventListener('change', e => action({ action: 'speed', value: Number(e.target.value) }));
document.addEventListener('click', e => {
  const station = e.target.closest('[data-station]'); if (station && state) { selected = station.dataset.station; renderMap(); renderStation(); }
  const scenario = e.target.closest('[data-scenario]'); if (scenario) action({ action: 'scenario', type: scenario.dataset.scenario });
  const resolve = e.target.closest('[data-resolve]'); if (resolve) action({ action: 'resolve', id: Number(resolve.dataset.resolve) });
});
$('factory-map').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-station]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
$('explain').addEventListener('click', async () => {
  if (!state || aiBusy) return;
  aiBusy = true; $('explain').disabled = true; text('explain', 'Объясняю…');
  try { const result = await api('/api/explain', {}); text('ai-text', result.text); text('ai-source', `${result.source === 'nvidia' ? 'NVIDIA AI' : 'Локальное объяснение'} · ${result.message} · ${clock(result.minute)}`); aiSnapshot = result.revision; error(''); render(); }
  catch (e) { error(`Не удалось получить объяснение: ${e.message}. Расчётный прогноз доступен выше.`); }
  finally { aiBusy = false; $('explain').disabled = false; text('explain', 'Объяснить прогноз ↗'); }
});
async function refresh() {
  if (updating || fetching) return;
  fetching = true;
  try {
    const next = await api('/api/state');
    if (!updating) {
      const changed = !state || state.revision !== next.revision || state.running !== next.running || state.speed !== next.speed || state.csrf !== next.csrf;
      state = next; if (changed) render(); error('');
    }
  }
  catch { error('Нет связи с локальным сервером. Проверьте, что npm start продолжает работать. Повторяем подключение…'); }
  finally { fetching = false; }
}
await refresh(); setInterval(refresh, 1200);
