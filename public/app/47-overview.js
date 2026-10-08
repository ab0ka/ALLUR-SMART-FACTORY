// ---------- Data sources, «Обзор» and «Эффект» ----------
// Three sources are never mixed: the case test data, the synthetic simulation and the external video experiment.
// Every screen belongs to one of them; switching the source drops the other source's selection, filters and explanations.
const SOURCE_LABEL = {
  case: 'Тестовые данные задания. Не подтверждённые реальные показатели Allur',
  sim: 'Синтетическая симуляция',
  video: 'Внешняя запись. Не производство Allur. Воспроизведение результатов анализа',
};
const SOURCE_SHORT = { case: 'Данные кейса', sim: 'Симуляция', video: 'Видеоэксперимент' };
const SOURCE_BADGE = { case: 'Тестовые данные кейса', sim: 'Синтетическая симуляция', video: 'Внешняя запись' };
let dataSource = (() => { try { return localStorage.getItem('allur.source') === 'case' ? 'case' : 'sim'; } catch { return 'sim'; } })();
const sourceOfView = v => v === 'overview' ? dataSource : v === 'case' ? 'case' : v === 'video' ? 'video' : 'sim';
function setSource(next) {
  if (next === dataSource || !['case', 'sim'].includes(next)) return false;
  dataSource = next;
  try { localStorage.setItem('allur.source', next); } catch { /* storage may be unavailable; the choice still applies */ }
  ui.panel = null; ui.selected = null; currentTask = null; taskFilter = 'all'; vehicleFilter = 'all';
  if (cs.data) cs.filter = CA.normalizeFilter(cs.data, {});
  setChatContext(null); chatPrevContext = null;
  if (aiRevision !== null) { aiRevision = null; text('ai-text', 'Источник данных сменился: прежнее объяснение относилось к другому источнику. Запросите новое.'); text('ai-stale', ''); }
  return true;
}
// Top bar: simulation controls and numbers only on simulation screens; the badge names the source of the screen.
function sourceChrome(v = view) {
  const src = sourceOfView(v);
  for (const el of document.querySelectorAll('.topbar .timebox, .topbar #planfact, .topbar #alerts')) el.classList.toggle('case-off', src !== 'sim');
  const badge = document.querySelector('.topbar .synthetic');
  if (badge) { badge.hidden = false; badge.textContent = SOURCE_BADGE[src]; badge.title = SOURCE_LABEL[src]; }
  if ($('summary')) $('summary').hidden = src !== 'sim';
}
const viewOfHash = () => { const p = location.hash.slice(1).split('/')[0]; return VIEWS.includes(p) ? p : p === 'report' ? (dataSource === 'case' ? 'case' : 'handover') : 'space'; };

// ---------- «Обзор» ----------
const SHOP_SPACE_OF_STAGE = { weld: 'weld', paint: 'paint', assembly: 'assembly', quality: 'tests', shipping: 'ship' };
function renderOverview() {
  sourceChrome('overview');
  $('ov-switch').innerHTML = ['case', 'sim'].map(s => `<button data-source="${s}" aria-pressed="${s === dataSource}">${SOURCE_SHORT[s]}</button>`).join('');
  text('ov-label', SOURCE_LABEL[dataSource]);
  if (dataSource === 'case') overviewCase(); else overviewSim();
}
const kpi = (value, label, note = '', cls = '') => `<div class="ov-kpi ${cls}"><b>${value}</b><span>${label}</span>${note ? `<small>${note}</small>` : ''}</div>`;
function overviewCase() {
  if (!cs.data) {
    text('ov-period', cs.error || 'Загрузка набора данных кейса…'); $('ov-body').innerHTML = '';
    caseLoad().then(() => { if (view === 'overview' && dataSource === 'case') renderOverview(); });
    return;
  }
  if ($('ov-body').dataset.src === 'case') return; // the case data do not change with simulation snapshots
  $('ov-body').dataset.src = 'case';
  const d = cs.data, v = CA.applyFilter(d, CA.normalizeFilter(d, {})), dev = CA.deviations(d, v), plan = CA.planCheck(d), o = CA.oee(d);
  const prod = CA.production(d, v).filter(p => p.measured), worstQ = CA.quality(d, v).filter(k => k.measured && k.ratePct != null).sort((a, b) => b.ratePct - a.ratePct)[0];
  const dates = CA.datesOf(d);
  text('ov-period', `Период: ${CA.fmtDate(dates[0])}–${CA.fmtDate(dates.at(-1))} (${dates.length} дн.) · ${d.title}`);
  const max = d.conditions.maxDefectPct;
  $('ov-body').innerHTML = `
    <section class="panel"><h2 class="panel-title">Ключевые показатели</h2><div class="ov-kpis">
      ${prod.map(p => kpi(`${p.fact} / ${p.plan}`, `Выпуск участка «${esc(p.stage)}», ед.`, `${CA.fmtPct(p.completionPct, 1)} плана`, p.completionPct < 100 ? 'warn' : 'ok')).join('')}
      ${worstQ ? kpi(CA.fmtPct(worstQ.ratePct, 2), `Наибольший брак: «${esc(worstQ.stage)}»`, `${worstQ.defects} из ${worstQ.produced} ед.; допустимо ≤ ${CA.fmtPct(max, 0)}`, worstQ.ratePct > max ? 'bad' : 'ok') : ''}
      ${kpi(`${CA.downtimeTotal(v) ?? 0} мин`, 'Зарегистрированные простои', `${v.downtime.length} записи; не простой всего завода`)}
      ${kpi(`${CA.fmtNum(plan.models, 0)} / ${CA.fmtNum(plan.target, 0)}`, 'План месяца: модели / ориентир', `расхождение ${CA.fmtNum(plan.gap, 0)} ед.`, plan.consistent ? 'ok' : 'warn')}
      ${kpi('Недостаточно данных', 'OEE', o.note ?? '', 'muted')}
    </div><p class="fine-print">Выпуск этапов не суммируется в число готовых автомобилей; выпуск сборки — не подтверждённая отгрузка. Доли брака — по суммам количеств.</p></section>
    <section class="panel"><h2 class="panel-title">Карта участков <span class="fine-print">статусы рассчитаны по данным кейса</span></h2><div class="case-route ov-route">${caseRouteHtml(d, v)}</div></section>
    <section class="panel"><h2 class="panel-title">Приоритетные отклонения <span class="tag">${dev.length}</span></h2>${dev.length ? `<ol class="ov-problems">${dev.slice(0, 4).map(c => `<li><button class="ov-problem" data-casedev="${esc(c.id)}"><b>${esc(c.title)}</b><span>${esc(c.value)} · ${esc(c.threshold)}</span><span class="ov-why">Почему важно: ${esc(caseWhy(c))}</span></button></li>`).join('')}</ol>` : '<p class="muted">Отклонений нет.</p>'}</section>
    ${dev[0] ? `<section class="panel ov-next"><h2 class="panel-title">Следующий шаг</h2><p>${esc(dev[0].next)}</p><button class="primary" data-casedev="${esc(dev[0].id)}">Открыть доказательства: ${esc(dev[0].title)}</button></section>` : ''}`;
}
function caseWhy(c) {
  if (c.type === 'quality') return `в ${CA.fmtNum(c.magnitude, 1)} раза выше допустимого уровня брака`;
  if (c.type === 'production') return `недовыпуск ${CA.fmtPct(c.magnitude * 100, 1)} плана участка за период`;
  if (c.type === 'downtime') return 'превышен суточный лимит простоя — если оборудование критическое (не указано)';
  return 'планы не согласованы: неясно, по какому плану оценивать выпуск';
}
function overviewSim() {
  if (!state) return;
  const s = state, k = s.kpi, f = s.forecast, t = k.targets;
  text('ov-period', `Смена 08:00–16:00 · сейчас ${clock(s.elapsed)}${s.running ? ' · идёт' : ' · пауза'} · синтетические автомобили, оборудование и события`);
  const asm = k.stages.find(x => x.id === 'assembly');
  $('ov-body').dataset.src = 'sim';
  $('ov-body').innerHTML = `
    <section class="panel"><h2 class="panel-title">Ключевые показатели</h2><div class="ov-kpis">
      ${kpi(`${s.totals.accepted} / ${s.plan.target}`, 'Принято контролем / план смены', 'факт симуляции')}
      ${kpi(`${f.projected}`, 'Прогноз к 16:00', `${f.low < f.high ? `диапазон ${f.low}–${f.high}; ` : ''}расчёт копией смены, не факт`, f.projected < s.plan.target ? 'warn' : 'ok')}
      ${kpi(pct(asm.oee), 'OEE участка «Сборка»', `цель ≥ ${pct(t.oee)}; A×P×Q по параметрам симуляции`, asm.flags.oee ? 'warn' : 'ok')}
      ${kpi(`${k.criticalDowntime.minutes} мин`, 'Простой подъёмников сборки', `лимит кейса ${t.criticalDowntimePerDay} мин/сутки ≈ ${k.criticalDowntime.perShiftBudget} на смену`, k.criticalDowntime.over ? 'bad' : 'ok')}
      ${kpi(`${s.tasks.length}`, 'Задачи смены', 'оборудование, дефекты, задержки, сроки', s.tasks.length ? 'warn' : 'ok')}
    </div></section>
    <section class="panel"><h2 class="panel-title">Карта участков <span class="fine-print">переход — в объёмную сцену цеха</span></h2><div class="ov-stages">${k.stages.map(x => {
      const cls = x.flags.oee || x.flags.defects ? 'warn' : 'ok';
      return `<button class="ov-stage ${cls}" data-space="${SHOP_SPACE_OF_STAGE[x.id]}"><b>${esc(x.name)}</b><span>загрузка ${pct(x.load)} · OEE ${x.completed ? pct(x.oee) : '—'}</span><span>${x.defectRate === null ? 'брак не образуется' : `брак ${pct(x.defectRate)} (${x.defects} из ${x.completed})`}</span></button>`; }).join('<span class="ov-arrow" aria-hidden="true">→</span>')}</div>
      <p><button class="link" data-space="enterprise">Открыть карту предприятия →</button></p></section>
    <section class="panel"><h2 class="panel-title">Приоритетные проблемы <span class="tag">${s.tasks.length}</span></h2>${s.tasks.length ? `<ol class="ov-problems">${s.tasks.slice(0, 4).map(x => `<li><button class="ov-problem" data-task="${esc(x.id)}"><b>${esc(x.title)}</b><span>${esc(x.categoryName)} · ${esc(x.certaintyText)}</span><span class="ov-why">Почему важно: ${esc(x.impact)}</span></button></li>`).join('')}</ol>` : '<p class="muted">Активных задач нет.</p>'}</section>
    ${s.tasks[0] ? `<section class="panel ov-next"><h2 class="panel-title">Следующий шаг</h2><p>${esc(s.tasks[0].next)}</p><button class="primary" data-task="${esc(s.tasks[0].id)}">Открыть: ${esc(s.tasks[0].title)}</button></section>` : ''}`;
}
// Deviation card of the case data: the same card renderer as the case report (caseCardHtml), opened beside any screen.
function caseDevPanel(id) {
  if (!cs.data) { caseLoad().then(() => { if (ui.panel?.type === 'casedev') renderSide(); }); return sideHead('ОТКЛОНЕНИЕ · ДАННЫЕ КЕЙСА', 'Загрузка…') + '<div class="side-body"></div>'; }
  const d = cs.data, find = f => CA.deviations(d, CA.applyFilter(d, f)).find(x => x.id === id);
  const c = find(cs.filter ?? CA.normalizeFilter(d, {})) ?? find(CA.normalizeFilter(d, {}));
  if (!c) return '';
  return sideHead('ОТКЛОНЕНИЕ · ДАННЫЕ КЕЙСА', esc(c.title), tag(esc(SOURCE_SHORT.case), 'warn') + tag(esc(`${c.stage} · ${c.period}`)))
    + `<div class="side-body">${history.state?.ret ? backLink() : ''}<p class="case-mode" role="note">${esc(SOURCE_LABEL.case)}</p>${caseCardHtml(c)}
      <p class="fine-print">Действия: проверки по журналам завода (следующий шаг выше). Прогноз по двум дням данных кейса не строится; сценарный расчёт с явными допущениями — в «Отчёт → Данные кейса».</p>
      <p><button class="link" data-case-open="${esc(c.id)}">Открыть в отчёте с исходными таблицами →</button></p></div>`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !state || t.closest('dialog')) return;
  const d = t.dataset;
  const stop = () => { e.stopPropagation(); e.preventDefault(); };
  if (d.source) { stop(); if (setSource(d.source)) { $('ov-body').dataset.src = ''; syncHash(); renderNavigation(); render(); } return; }
  if (d.casedev) { stop(); openPanel({ type: 'casedev', id: d.casedev }); return; }
  if (d.space && t.closest('#view-overview')) { stop(); goSpace(d.space); return; }
  if (d.caseOpen) { stop(); navPush('case'); requestAnimationFrame(() => document.getElementById(`case-card-${d.caseOpen}`)?.scrollIntoView({ block: 'start' })); return; }
  // Evidence record outside the case report: open the report and point at the source row.
  if (d.caseRec && !t.closest('#view-case')) { stop(); navPush('case'); requestAnimationFrame(() => { const row = document.getElementById(`case-rec-${d.caseRec}`); if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'center' }); } }); return; }
  if (d.caseStage && t.closest('#view-overview')) { stop(); if (cs.data) cs.filter = CA.normalizeFilter(cs.data, { ...cs.filter, stage: d.caseStage }); navPush('case'); }
}, true);

// ---------- «Эффект»: measured in the simulation vs potential for the plant ----------
function effectInputs() { try { return JSON.parse(localStorage.getItem('allur.effect') || '{}'); } catch { return {}; } }
function renderEffect() {
  sourceChrome('effect');
  if (!lab) { loadLab(); $('effect-body').innerHTML = '<p class="muted">Загрузка результатов симуляции…</p>'; return; }
  const r = lab.policies, inp = effectInputs();
  if (!r) { $('effect-body').innerHTML = '<p>Сравнение стратегий не рассчитано: выполните <code>npm.cmd run policies</code> и перезапустите сервер.</p>'; return; }
  const base = r.policies[0], best = r.policies.find(p => p.id === 'advisor_next') ?? r.policies.at(-1);
  const dCars = best.vsBaseline.meanDelta, dFail = base.failures - best.failures;
  const money = Number(inp.carValue) > 0 && Number(inp.shiftsPerMonth) > 0 ? dCars * Number(inp.shiftsPerMonth) * Number(inp.carValue) : null;
  if (document.activeElement?.closest?.('#effect-form')) return; // do not rebuild the form while typing
  const key = JSON.stringify(inp); if ($('effect-body').dataset.key === key) return; // lab results do not change with snapshots
  $('effect-body').dataset.key = key;
  $('effect-body').innerHTML = `
    <section class="panel"><h2 class="panel-title">Измерено в симуляции <span class="tag">${SOURCE_SHORT.sim}</span></h2>
      <p>${r.shifts} синтетических смен, одинаковых для всех стратегий (seed ${r.generatedFrom.seeds.join('–')}). База — «${esc(base.name)}», сравнение — «${esc(best.name)}».</p>
      <div class="ov-kpis">${kpi(`${dCars > 0 ? '+' : ''}${fmt(dCars, 2)}`, 'Принятых машин за смену, в среднем', `${fmt(base.accepted.mean, 2)} → ${fmt(best.accepted.mean, 2)}`)}
        ${kpi(`${fmt(base.failures, 2)} → ${fmt(best.failures, 2)}`, 'Отказов подъёмника за смену', `−${fmt(dFail, 2)}`)}
        ${kpi(`${base.shiftsCarried} → ${best.shiftsCarried}`, `Смен из ${r.shifts}, где подъёмник неисправен к концу смены`)}</div>
      <p class="fine-print">${esc(r.method)}</p></section>
    <section class="panel"><h2 class="panel-title">Потенциальный эффект для предприятия <span class="fine-print">только по введённой вами стоимости</span></h2>
      <form id="effect-form" class="effect-form"><label>Ценность одного дополнительного годного автомобиля, ₸ <input id="ef-car" type="number" min="0" step="1000" inputmode="numeric" value="${esc(inp.carValue ?? '')}"></label>
        <label>Смен в месяц <input id="ef-shifts" type="number" min="0" step="1" inputmode="numeric" value="${esc(inp.shiftsPerMonth ?? '')}" placeholder="например 2 × рабочие дни"></label><button class="primary" type="submit">Рассчитать</button></form>
      <p>${money === null ? 'Деньги не рассчитываются, пока не заданы стоимость и число смен.' : `Оценка: ${fmt(dCars, 2)} авт./смену × ${fmt(Number(inp.shiftsPerMonth), 0)} смен × ${fmt(Number(inp.carValue), 0)} ₸ = <b>${fmt(money, 0)} ₸ в месяц</b>.`}</p>
      <p class="fine-print">Формула: прирост принятых машин за смену в симуляции × смен в месяц × ваша ценность одной машины. Это сценарная оценка на синтетической симуляции с одним видом отказа оборудования, а не достигнутая или подтверждённая экономия Allur. Для оценки на заводе нужен пилот на реальных данных.</p></section>`;
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'effect-form') return;
  e.preventDefault();
  try { localStorage.setItem('allur.effect', JSON.stringify({ carValue: $('ef-car').value, shiftsPerMonth: $('ef-shifts').value })); } catch { /* per-viewer convenience only */ }
  $('ef-car').blur(); renderEffect();
});
