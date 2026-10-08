// ---------- «Данные кейса»: deviations by stage from the case test data (not the simulation) ----------
// All figures, charts, the CSV and the printed report come from case-analysis.js with one shared filter.
import * as CA from './case-analysis.js';
const cs = { data: null, filter: null, error: '', loading: false, flash: null };
const STATUS_CLASS = { ok: 'ok', warn: 'warn', problem: 'problem', nodata: 'nodata' };
const KIND_CLASS = { fact: 'fact', calc: 'calc', hypothesis: 'hyp', scenario: 'scen' };

async function caseLoad() {
  if (cs.data || cs.loading) return;
  cs.loading = true;
  try {
    const r = await fetch('/case-dataset.json', { signal: AbortSignal.timeout(8000) }), v = CA.validateDataset(await r.json());
    if (!v.data) throw new Error(v.errors.join('; '));
    cs.data = v.data; cs.filter = CA.normalizeFilter(cs.data, {}); cs.error = '';
  } catch (e) { cs.error = `Не удалось загрузить набор данных кейса: ${e.message}`; }
  finally { cs.loading = false; }
  if (view === 'case') renderCase();
}
// Simulation figures and the «Синтетические данные» badge describe another source: hidden on the case and video screens.
// Uses the address, not `view`: on hashchange this runs before the router has switched the view.
function caseChrome() {
  const page = location.hash.slice(1).split('/')[0];
  $('summary').hidden = page === 'case' || page === 'video';
  for (const el of document.querySelectorAll('.topbar .timebox, .topbar #planfact, .topbar #alerts')) if (page === 'case') el.classList.add('case-off'); else el.classList.remove('case-off');
  const badge = document.querySelector('.topbar .synthetic');
  if (badge && page === 'case') badge.hidden = true;
  else if (badge && page !== 'video') badge.hidden = false;
}
window.addEventListener('hashchange', caseChrome);

function renderCase() {
  caseChrome();
  if (!cs.data) { $('case-source').textContent = cs.error || 'Загрузка набора данных…'; $('case-body').innerHTML = cs.error ? `<div class="va-errors" role="alert">${esc(cs.error)}</div>` : ''; caseLoad(); return; }
  if ($('case-body').dataset.rendered === caseKey()) return; // render() runs on every simulation snapshot; this screen does not depend on it
  caseRenderAll();
}
const caseKey = () => JSON.stringify(cs.filter);
function caseFilterControls() {
  const d = cs.data, dates = CA.datesOf(d), f = cs.filter;
  const opts = (list, sel, label = x => x) => list.map(x => `<option value="${esc(x)}"${x === sel ? ' selected' : ''}>${esc(label(x))}</option>`).join('');
  $('case-from').innerHTML = opts(dates, f.from, CA.fmtDate); $('case-to').innerHTML = opts(dates, f.to, CA.fmtDate);
  $('case-stage').innerHTML = `<option value="all"${f.stage === 'all' ? ' selected' : ''}>Все участки</option>` + opts(d.route, f.stage);
  $('case-source').innerHTML = `<b>Источник:</b> ${esc(d.title)} · ${esc(d.source.document ?? '')}<br><span class="fine-print">${esc(d.source.note ?? '')}</span>`;
}
function caseSetFilter(next) { cs.filter = CA.normalizeFilter(cs.data, { ...cs.filter, ...next }); caseRenderAll(); }
$('case-from').addEventListener('change', e => caseSetFilter({ from: e.target.value }));
$('case-to').addEventListener('change', e => caseSetFilter({ to: e.target.value }));
$('case-stage').addEventListener('change', e => caseSetFilter({ stage: e.target.value }));
$('case-reset').addEventListener('click', () => { if (cs.data) { cs.filter = CA.normalizeFilter(cs.data, {}); caseRenderAll(); } });

// ----- pieces shared by the screen and the report -----
const caseStageLabel = f => f.stage === 'all' ? 'все участки' : f.stage;
const casePeriod = f => f.from ? (f.from === f.to ? CA.fmtDate(f.from) : `${CA.fmtDate(f.from)}–${CA.fmtDate(f.to)}`) : 'нет дат';
function caseSummaryHtml(d, v) {
  const s = CA.summary(d, v), m = s.main;
  if (!m) return `<p><b>В выбранном фильтре отклонений от условий задания не найдено</b> (${esc(s.period)}, ${esc(s.stage)}). Это не означает отсутствие проблем: см. ограничения источника.</p>`;
  return `<p class="case-main"><span class="case-tag calc">${CA.KINDS.calc}</span> <b>Главное отклонение: ${esc(m.title)}.</b> ${esc(m.stage)}, ${esc(m.period)}: ${esc(m.value)}; ${esc(m.threshold)}.</p>
    <p>Подтверждается записями источника: ${m.evidence.map(id => caseRecBtn(id)).join(' ')}</p>
    ${s.others.length ? `<p>Также: ${s.others.map(o => `${esc(o.title)} — ${esc(o.value)}`).join('; ')}.</p>` : ''}`;
}
const caseRecBtn = id => `<button type="button" class="case-rec" data-case-rec="${esc(id)}" aria-label="Показать исходную запись ${esc(id)}">${esc(id)}</button>`;
function caseRouteHtml(d, v) {
  const st = Object.fromEntries(CA.stageStatuses(d, CA.applyFilter(d, { ...v.filter, stage: 'all' })).map(s => [s.stage, s]));
  return d.route.map((stage, i) => { const s = st[stage], sel = v.filter.stage === stage;
    return `${i ? '<span class="case-arrow" aria-hidden="true">→</span>' : ''}<button type="button" class="case-stage ${STATUS_CLASS[s.status]}${sel ? ' selected' : ''}" data-case-stage="${esc(stage)}" aria-pressed="${sel}"><b>${esc(stage)}</b><span>${esc(s.label)}</span>${s.notes.length ? `<small>${esc(s.notes.join(' · '))}</small>` : ''}</button>`; }).join('');
}
function caseCardHtml(c) {
  const list = (kind, items) => items.length ? `<div class="case-sec"><span class="case-tag ${KIND_CLASS[kind]}">${CA.KINDS[kind]}</span><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<article class="case-card ${c.type}" id="case-card-${esc(c.id)}">
    <h3>${esc(c.title)}</h3>
    <dl class="case-kv"><dt>Участок и период</dt><dd>${esc(c.stage)} · ${esc(c.period)}</dd><dt>Фактическое значение</dt><dd>${esc(c.value)}</dd><dt>Порог / план</dt><dd>${esc(c.threshold)}</dd>
    <dt>Исходные записи</dt><dd>${c.evidence.map(caseRecBtn).join(' ')}</dd>${c.context.length ? `<dt>Связанные записи</dt><dd>${c.context.map(caseRecBtn).join(' ')} <span class="fine-print">только для гипотезы, не подтверждают вывод</span></dd>` : ''}</dl>
    ${list('fact', c.facts)}${list('calc', c.calc)}${list('hypothesis', c.hypotheses)}
    <div class="case-sec"><b>Что известно:</b> ${esc(c.known.join('; '))}.</div>
    <div class="case-sec"><b>Что пока неизвестно:</b> ${esc(c.unknown.join('; '))}.</div>
    <div class="case-sec case-next"><b>Следующий шаг проверки:</b> ${esc(c.next)}</div>
  </article>`;
}
// Charts: plain SVG with classes from styles.css. Missing measurements are not drawn as zero bars.
function caseChartPlanFact(d, v) {
  const rows = CA.production(d, v).filter(p => p.measured);
  if (!rows.length) return '<p class="fine-print">Нет данных о плане и факте в выбранном фильтре.</p>';
  const W = 460, H = 220, x0 = 46, y0 = 180, top = 18, max = Math.max(...rows.flatMap(p => [p.plan, p.fact])) * 1.1, Y = n => y0 - (y0 - top) * n / max, gw = (W - x0 - 10) / rows.length, bw = Math.min(34, gw / 3);
  let out = `<line x1="${x0}" x2="${W - 6}" y1="${y0}" y2="${y0}" class="case-axis"/>`;
  rows.forEach((p, i) => { const cx = x0 + gw * i + gw / 2;
    out += `<rect x="${(cx - bw - 2).toFixed(1)}" y="${Y(p.plan).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y0 - Y(p.plan)).toFixed(1)}" class="case-bar plan"/><rect x="${(cx + 2).toFixed(1)}" y="${Y(p.fact).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y0 - Y(p.fact)).toFixed(1)}" class="case-bar fact${p.completionPct < 100 ? ' low' : ''}"/>
      <text x="${(cx - bw / 2 - 2).toFixed(1)}" y="${(Y(p.plan) - 4).toFixed(1)}" class="case-val">${p.plan}</text><text x="${(cx + bw / 2 + 2).toFixed(1)}" y="${(Y(p.fact) - 4).toFixed(1)}" class="case-val">${p.fact}</text>
      <text x="${cx.toFixed(1)}" y="${y0 + 16}" class="case-lbl">${esc(p.stage)}</text><text x="${cx.toFixed(1)}" y="${y0 + 32}" class="case-lbl sub">${CA.fmtPct(p.completionPct)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H + 16}" class="case-chart" role="img" aria-label="План и факт по участкам, ед.">${out}</svg><p class="chart-legend"><span class="k-plan-case">■ План</span> <span class="k-fact-case">■ Факт</span> · ед. за период; выпуски участков не суммируются</p>`;
}
function caseChartDefects(d, v) {
  const rows = CA.quality(d, v).filter(q => q.measured), lim = d.conditions.maxDefectPct;
  if (!rows.length) return '<p class="fine-print">Нет данных о браке в выбранном фильтре.</p>';
  const W = 460, H = 220, x0 = 46, y0 = 180, top = 18, max = Math.max(lim * 1.5, ...rows.map(q => q.ratePct ?? 0)) * 1.1, Y = n => y0 - (y0 - top) * n / max, gw = (W - x0 - 10) / rows.length, bw = Math.min(46, gw / 2);
  let out = `<line x1="${x0}" x2="${W - 6}" y1="${y0}" y2="${y0}" class="case-axis"/>`;
  rows.forEach((q, i) => { const cx = x0 + gw * i + gw / 2;
    out += q.ratePct == null ? `<text x="${cx}" y="${y0 - 8}" class="case-lbl">нет данных</text>` : `<rect x="${(cx - bw / 2).toFixed(1)}" y="${Y(q.ratePct).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y0 - Y(q.ratePct)).toFixed(1)}" class="case-bar defect${q.ratePct > lim ? ' over' : ''}"/><text x="${cx.toFixed(1)}" y="${(Y(q.ratePct) - 4).toFixed(1)}" class="case-val mid">${CA.fmtPct(q.ratePct, 2)}</text>`;
    out += `<text x="${cx.toFixed(1)}" y="${y0 + 16}" class="case-lbl">${esc(q.stage)}</text><text x="${cx.toFixed(1)}" y="${y0 + 32}" class="case-lbl sub">${q.defects} из ${q.produced} ед.</text>`; });
  out += `<line x1="${x0}" x2="${W - 6}" y1="${Y(lim).toFixed(1)}" y2="${Y(lim).toFixed(1)}" class="case-limit"/><text x="${W - 8}" y="${(Y(lim) - 5).toFixed(1)}" class="case-val end">порог ${CA.fmtPct(lim, 0)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H + 16}" class="case-chart" role="img" aria-label="Процент брака по участкам с порогом ${lim} %">${out}</svg><p class="chart-legend">Брак = сумма брака / сумма выпущенного за период</p>`;
}
function caseChartDowntime(d, v) {
  const rows = CA.downtimeByEquipment(v);
  if (!rows.length) return '<p class="fine-print">Нет зарегистрированных простоев в выбранном фильтре.</p>';
  const W = 460, rowH = 30, x0 = 150, H = rows.length * rowH + 30, max = Math.max(...rows.map(r => r.minutes)) * 1.15, X = n => x0 + (W - x0 - 50) * n / max;
  let out = '';
  rows.forEach((r, i) => { const y = 12 + i * rowH;
    out += `<text x="${x0 - 8}" y="${y + 15}" class="case-lbl end">${esc(r.equipment)} · ${esc(r.stage)}</text><rect x="${x0}" y="${y + 3}" width="${(X(r.minutes) - x0).toFixed(1)}" height="16" class="case-bar down"/><text x="${(X(r.minutes) + 5).toFixed(1)}" y="${y + 15}" class="case-val start">${r.minutes} мин</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="case-chart" role="img" aria-label="Длительность зарегистрированных простоев по оборудованию">${out}</svg><p class="chart-legend">${esc(CA.DOWNTIME_TOTAL_NAME)}: ${CA.fmtNum(CA.downtimeTotal(v), 0)} мин. Записи могут относиться к разному оборудованию и пересекаться во времени.</p>`;
}
function caseTablesHtml(d, v, anchors = true) {
  const u = d.unit, tr = (id, cells) => `<tr${anchors ? ` id="case-rec-${esc(id)}"` : ''} data-rec="${esc(id)}"><td>${esc(id)}</td>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  const t = (title, head, rows, empty) => `<h3 class="case-th">${esc(title)}</h3><div class="table-scroll" tabindex="0" role="region" aria-label="${esc(title)}"><table class="case-table"><thead><tr><th>Запись</th>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length + 1}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  return t('Работа линий', ['Дата', 'Линия', 'Участок', `План, ${u}`, `Факт, ${u}`, 'Выполнение', `Отклонение, ${u}`, 'Время работы, ч', 'Загрузка, % (источник)'],
      v.lines.map(CA.lineRow).map(r => tr(r.id, [CA.fmtDate(r.date), esc(r.line), esc(r.stage), r.plan, r.fact, CA.fmtPct(r.completionPct, 2), r.deviation > 0 ? `+${r.deviation}` : String(r.deviation).replace('-', '−'), CA.fmtNum(r.hours), CA.fmtNum(r.loadPct, 0)])), 'Нет записей в фильтре')
    + t('Качество', ['Дата', 'Участок', `Выпущено, ${u}`, `Брак, ${u}`, 'Брак, % (расчёт)', 'Брак, % (источник)'],
      v.quality.map(r => tr(r.id, [CA.fmtDate(r.date), esc(r.stage), r.produced, r.defects, CA.fmtPct(CA.ratioPct(r.defects, r.produced), 2), r.sourceDefectPct == null ? '—' : CA.fmtPct(r.sourceDefectPct)])), 'Нет записей в фильтре')
    + t('Простои', ['Дата', 'Участок', 'Оборудование', 'Зарегистрированная причина', 'Длительность, мин'],
      v.downtime.map(r => tr(r.id, [CA.fmtDate(r.date), esc(r.stage), esc(r.equipment), esc(r.reason), r.minutes])), 'Нет записей в фильтре')
    + t('Месячный план по моделям (фильтр по дате не применяется)', ['Модель', `План, ${u}`], d.modelPlan.map(r => tr(r.id, [esc(r.model), CA.fmtNum(r.plan, 0)])), 'Нет записей');
}
function caseQualityHtml(d) {
  const o = CA.oee(d);
  return `<ul class="case-dq">${CA.dataQuality(d).map(q => `<li><span class="case-tag ${q.kind === 'calc' ? 'calc' : 'limit'}">${q.kind === 'calc' ? CA.KINDS.calc : 'Ограничение источника'}</span> <b>${esc(q.title)}.</b> ${esc(q.text)}</li>`).join('')}</ul>
    <div class="case-oee"><b>OEE: ${esc(o.label)}.</b> Не хватает: ${esc(o.missing.join('; '))}. Цель задания: OEE ≥ ${o.targetPct} %. ${esc(o.note)}</div>
    <p class="fine-print">Прогноз поломок и ML-модель на шести агрегированных строках не строятся. Диагностика подъёмников в разделах «Сборка» и «Диагностика» — синтетическая симуляция и с этими данными не связана; видеоанализ не сопоставлен с оборудованием кейса.</p>`;
}
function caseRenderAll() {
  const d = cs.data, v = CA.applyFilter(d, cs.filter), dev = CA.deviations(d, v);
  caseFilterControls();
  $('case-body').innerHTML = `
    <section class="panel"><h2 class="panel-title">Краткий итог · ${esc(casePeriod(v.filter))} · ${esc(caseStageLabel(v.filter))}</h2>${caseSummaryHtml(d, v)}</section>
    <section class="panel"><h2 class="panel-title">Маршрут и рассчитанные статусы участков</h2><div class="case-route">${caseRouteHtml(d, v)}</div><p class="fine-print">Статус по выбранным датам: брак выше ${CA.fmtPct(d.conditions.maxDefectPct, 0)} или выпуск ниже плана. Для складов и контроля качества измерений нет. Нажмите на участок, чтобы отфильтровать.</p></section>
    <div class="case-grid">
      <section class="panel"><h2 class="panel-title">Отклонения <span class="tag">${dev.length}</span></h2>${dev.length ? dev.map(caseCardHtml).join('') : '<p>Отклонений в выбранном фильтре нет.</p>'}</section>
      <section class="panel"><h2 class="panel-title">Качество данных и ограничения</h2>${caseQualityHtml(d)}</section>
    </div>
    <section class="panel"><h2 class="panel-title">Графики</h2><div class="case-charts"><figure><figcaption>План и факт по участкам</figcaption>${caseChartPlanFact(d, v)}</figure><figure><figcaption>Процент брака и порог</figcaption>${caseChartDefects(d, v)}</figure><figure><figcaption>Простои по оборудованию</figcaption>${caseChartDowntime(d, v)}</figure></div></section>
    <section class="panel"><h2 class="panel-title">Исходные таблицы</h2>${caseTablesHtml(d, v)}</section>
    <section class="panel no-print"><h2 class="panel-title">${CA.KINDS.scenario}</h2>
      <form id="case-scenario" class="case-scenario"><label>Оставшиеся рабочие дни <input id="cs-days" type="number" min="0" step="1" inputmode="numeric"></label><label>Накопленный выпуск сборки с начала месяца, ед. <input id="cs-acc" type="number" min="0" step="1" inputmode="numeric"></label><label>Дневной темп, ед./день <input id="cs-rate" type="number" min="0" step="1" inputmode="decimal"></label><label class="case-check"><input id="cs-ok" type="checkbox"> Подтверждаю допущение: темп сохранится на все оставшиеся дни</label><button type="submit">Рассчитать сценарий</button></form>
      <p id="cs-result" class="case-scen-result" aria-live="polite"></p>
      <p class="fine-print">Накопленный выпуск вводится вручную: из двух дней источника его вывести нельзя. Результат — сценарий при ваших допущениях, не прогноз и не ML-модель.</p></section>`;
  $('case-body').dataset.rendered = caseKey();
}
document.addEventListener('click', e => {
  const st = e.target.closest('#view-case [data-case-stage]');
  if (st) { caseSetFilter({ stage: cs.filter.stage === st.dataset.caseStage ? 'all' : st.dataset.caseStage }); return; }
  const rec = e.target.closest('#view-case [data-case-rec]');
  if (rec) {
    const row = document.getElementById(`case-rec-${rec.dataset.caseRec}`);
    if (!row) return;
    for (const r of document.querySelectorAll('#view-case tr.flash')) r.classList.remove('flash');
    row.classList.add('flash'); row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'case-scenario') return;
  e.preventDefault();
  const r = CA.scenario(cs.data, { remainingDays: $('cs-days').value, accumulated: $('cs-acc').value, dailyRate: $('cs-rate').value, confirmed: $('cs-ok').checked });
  $('cs-result').textContent = r.ok ? `${r.text} Относительно ориентира ${CA.fmtNum(r.target, 0)} ед.: ${r.vsTarget >= 0 ? '+' : '−'}${CA.fmtNum(Math.abs(r.vsTarget), 0)} ед.${r.models != null ? `; относительно суммы планов моделей ${CA.fmtNum(r.models, 0)} ед.: ${r.vsModels >= 0 ? '+' : '−'}${CA.fmtNum(Math.abs(r.vsModels), 0)} ед.` : ''}` : r.reason;
});

// ----- export: the same functions and the same filter -----
$('case-csv').addEventListener('click', () => {
  if (!cs.data) return;
  const v = CA.applyFilter(cs.data, cs.filter), blob = new Blob([CA.toCsv(cs.data, v)], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `case-report-${v.filter.from ?? 'all'}_${v.filter.to ?? 'all'}_${v.filter.stage === 'all' ? 'all' : 'stage'}.csv`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
function caseReportHtml() {
  const d = cs.data, v = CA.applyFilter(d, cs.filter), dev = CA.deviations(d, v), prod = CA.production(d, v).filter(p => p.measured), q = CA.quality(d, v).filter(k => k.measured), o = CA.oee(d), plan = CA.planCheck(d);
  return `<h1>Отчёт: анализ данных кейса</h1>
    <p class="case-mode">${esc(d.label)}</p>
    <p><b>Источник:</b> ${esc(d.title)} (${esc(d.source.document ?? '')}). ${esc(d.source.note ?? '')}</p>
    <p><b>Период:</b> ${esc(casePeriod(v.filter))} · <b>Участок:</b> ${esc(caseStageLabel(v.filter))} · сформирован ${esc(new Date().toLocaleString('ru-RU'))}</p>
    <h2>Краткий итог</h2>${caseSummaryHtml(d, v)}
    <h2>Рассчитанные показатели</h2><ul>${prod.map(p => `<li>${esc(p.stage)}: выпуск участка ${p.fact} из ${p.plan} ${esc(d.unit)}, выполнение ${CA.fmtPct(p.completionPct, 2)}, отклонение ${p.deviation} ${esc(d.unit)}</li>`).join('')}${q.map(k => `<li>${esc(k.stage)}: брак ${k.defects} из ${k.produced} ${esc(d.unit)} = ${CA.fmtPct(k.ratePct, 2)}</li>`).join('')}
      <li>${esc(CA.DOWNTIME_TOTAL_NAME)}: ${v.downtime.length ? `${CA.downtimeTotal(v)} мин` : 'нет записей'}</li><li>Сумма месячных планов моделей: ${CA.fmtNum(plan.models, 0)} ед.; ориентир ${CA.fmtNum(plan.target, 0)} ед.; расхождение ${CA.fmtNum(plan.gap, 0)} ед.</li><li>OEE: ${esc(o.label)} (цель ≥ ${o.targetPct} %).</li></ul>
    <h2>Графики</h2><div class="case-charts">${caseChartPlanFact(d, v)}${caseChartDefects(d, v)}${caseChartDowntime(d, v)}</div>
    <h2>Отклонения</h2>${dev.length ? dev.map(caseCardHtml).join('') : '<p>Отклонений в выбранном фильтре нет.</p>'}
    <h2>Исходные таблицы</h2>${caseTablesHtml(d, v, false)}
    <h2>Качество данных и ограничения</h2>${caseQualityHtml(d)}`;
}
$('case-print').addEventListener('click', () => {
  if (!cs.data) return;
  let rep = $('case-report');
  if (!rep) { rep = document.createElement('section'); rep.id = 'case-report'; rep.className = 'case-report'; $('view-case').append(rep); }
  rep.innerHTML = caseReportHtml();
  document.body.classList.add('case-printing'); window.print();
});
window.addEventListener('afterprint', () => document.body.classList.remove('case-printing'));
