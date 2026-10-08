// ---------- Shift and analytics ----------
// Engine defaults for empty denominators are not observed measurements.
function shiftOeeValue(p, metric) {
  const qualityDefined = ['quality', 'rework', 'shipping'].includes(p.stage) || p.stats.completed > 0;
  const available = {
    availability: state.elapsed > 0,
    performance: p.stats.run > 0,
    quality: qualityDefined,
    oee: state.elapsed > 0 && p.stats.run > 0 && qualityDefined,
  };
  return available[metric] ? pct(p.metrics[metric]) : '<span title="Нет данных для расчёта" aria-label="Нет данных для расчёта">—</span>';
}
function renderShift() {
  const t = state.totals, f = state.forecast, ref = state.plan.reference, max = Math.max(state.plan.target, ref?.total ?? 0, t.created, 4);
  const summary = [
    ['target', 'План смены', state.plan.target, 'Задан оператором · к 16:00'],
    ['reference', 'Эталонная мощность', ref?.total ?? '—', ref ? `Без отклонений оборудования · к сейчас ${ref.now}` : 'Эталон недоступен'],
    ['forecast', 'Прогноз', f.projected, `К 16:00 без новых вмешательств${f.low < f.high ? ` · диапазон ${f.low}–${f.high}` : ''}`],
    ['fact', 'Факт', t.accepted, `Принято к ${clock(state.elapsed)} · каждый автомобиль один раз`],
  ];
  $('shift-summary').innerHTML = summary.map(([kind, label, value, note]) => `<div class="shift-metric metric-${kind}"><dt>${esc(label)}</dt><dd>${esc(value)} <span>авт.</span><small>${esc(note)}</small></dd></div>`).join('');
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
    ['В работе (WIP)', t.inProcess], ['Из них на доработке', t.rework], ['Не начаты', t.notStarted], ['Готовы к отгрузке', t.ready], ['Отгружено', t.shipped],
    ['Создано всего', `${t.created} ${t.balanced ? '✓ баланс сходится' : '✗ баланс нарушен'}`], ['Среднее время прохождения', state.leadTime ? `${fmt(state.leadTime.average)} мин (${state.leadTime.count} авт.)` : '—'],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('forecast-box').innerHTML = `<p class="forecast-big"><strong>${f.projected}</strong> <span>принятых к 16:00 без новых вмешательств · ${f.gap >= 0 ? 'запас' : 'дефицит'} ${Math.abs(f.gap)} к плану ${state.plan.target}</span></p>
    <ul class="scenarios">${f.scenarios.map(s => `<li>${esc(s.label)}: <b>${s.accepted}</b>${s.lateOrders.length ? ` · опоздают ${esc(s.lateOrders.join(', '))}` : ''}</li>`).join('')}</ul>
    ${f.limiting ? `<p>Ограничивающий участок до конца смены: <b>${esc(f.limiting.name)}</b>, загрузка ${pct(f.limiting.utilization)}.</p>` : '<p>Смена завершена — прогноз равен факту.</p>'}
    <p class="fine-print">${esc(f.method)} ${esc(f.assumption)}</p>`;
  const q = state.quality;
  $('quality-box').innerHTML = `<h3>Качество (из проверок контроля)</h3><dl class="numbers"><div><dt>С первого предъявления</dt><dd>${q.firstPassYield === null ? '—' : `${pct(q.firstPassYield)} (${q.firstPass}/${q.firstInspections})`}</dd></div><div><dt>Не прошли контроль</dt><dd>${q.failed}</dd></div><div><dt>Приняты после доработки</dt><dd>${q.reworkedAccepted}</dd></div><div><dt>Сейчас в доработке</dt><dd>${q.inRework}</dd></div></dl><p class="fine-print">Каждый автомобиль засчитывается в годный выпуск один раз — после успешного контроля. Дефекты синтетические (~15%).</p>`;
  const cols = ['Пост', 'Участок', 'Состояние', 'A', 'P', 'Q', 'OEE', 'Работа, мин', 'Неисправность, мин', 'Техник, мин', 'Нет входа, мин', 'Блокировка, мин', 'Операций'];
  $('oee-table').innerHTML = `<caption>Показатели каждого поста к ${clock(state.elapsed)} · синтетические данные</caption><thead><tr>${cols.map(c => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${state.posts.map(p => `<tr><th scope="row"><button class="link" data-post-link="${esc(p.id)}">${esc(p.code)}</button></th><td>${esc(p.stageName)}</td><td>${esc(POST_SHORT[p.state])}</td><td>${shiftOeeValue(p, 'availability')}</td><td>${shiftOeeValue(p, 'performance')}</td><td>${shiftOeeValue(p, 'quality')}</td><td><b>${shiftOeeValue(p, 'oee')}</b></td><td>${p.stats.run}</td><td>${p.stats.fault}</td><td>${p.stats.maintenance}</td><td>${p.stats.starved}</td><td>${p.stats.blocked}</td><td>${p.stats.completed}</td></tr>`).join('')}</tbody>`;
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
