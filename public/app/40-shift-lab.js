// ---------- Shift and analytics ----------
// First screen of analytics: plan and fact, forecast, the main reason of the deviation, tasks and decision results.
function mainDeviation() {
  const f = state.forecast, gap = f.projected - state.plan.target;
  const eq = state.tasks.find(t => ['equipment', 'incident'].includes(t.category)), car = state.tasks.find(t => t.object.type === 'vehicle'), risk = state.tasks.find(t => t.category === 'risk');
  if (eq) return { text: `${eq.title}: ${eq.impact}`, basis: eq.certaintyText, ref: ['problem', eq.object.id] };
  if (gap < 0 && car) return { text: `${car.title} — машина ждёт доработки и не засчитана в выпуск`, basis: car.certaintyText, ref: ['vehicle', car.object.id] };
  if (gap < 0 && f.limiting) return { text: `Мощность: ограничивает участок «${f.limiting.name}», загрузка ${pct(f.limiting.utilization)}`, basis: 'расчёт симуляции до 16:00' };
  if (risk) return { text: risk.title, basis: risk.certaintyText, ref: ['order', risk.object.id] };
  return { text: gap >= 0 ? 'Отклонения нет: прогноз не ниже плана' : 'Дефицит без явной причины в задачах — сравните с эталонной мощностью ниже', basis: 'по снимку движка' };
}
function renderShiftFirst() {
  const t = state.totals, f = state.forecast, gap = f.projected - state.plan.target, main = mainDeviation(), d = state.decisions.at(-1);
  const riskItem = state.risk?.available ? [...state.risk.items].filter(r => r.probability !== null && r.probability !== undefined).sort((a, b) => b.probability - a.probability)[0] : null;
  $('shift-first').innerHTML = `<div class="kpis">
    <div class="kpi"><b>${t.accepted}</b><span>факт: принято к ${clock(state.elapsed)}</span></div>
    <div class="kpi"><b>${state.plan.target}</b><span>план смены</span></div>
    <div class="kpi"><b class="${gap < 0 ? 'warn-text' : 'ok-text'}">${f.projected}</b><span>прогноз к 16:00${f.low < f.high ? ` (${f.low}–${f.high})` : ''} · симуляция, не факт</span></div>
    <div class="kpi"><b class="${gap < 0 ? 'warn-text' : 'ok-text'}">${gap > 0 ? '+' : ''}${gap}</b><span>прогноз к плану</span></div></div>
    <h3>${gap < 0 ? 'Главная причина отклонения' : 'Главный риск для плана'}</h3><p>${esc(main.text)} <span class="fine-print">· ${esc(main.basis)}</span>${main.ref ? ` <button class="link" data-ref-type="${main.ref[0]}" data-ref-id="${esc(main.ref[1])}">открыть</button>` : ''}</p>
    <h3>Задачи</h3><p>${state.tasks.length ? `${state.tasks.length}: ${TASK_GROUPS.map(([n, cats]) => [n, state.tasks.filter(x => cats.includes(x.category)).length]).filter(([, n]) => n).map(([n, k]) => `${n.toLowerCase()} — ${k}`).join('; ')}` : 'активных задач нет'} · <a href="#dispatcher">к списку задач</a></p>
    <h3>Результат решений</h3><p>${d ? `${esc(d.id)} «${esc(d.title)}»: ожидали ${fmt(d.expected.accepted)} принятых к 16:00, сейчас наблюдается ${d.report.observed.accepted}${d.report.observed.final ? '' : ' (смена идёт)'}.` : 'Решений в этой смене ещё не принималось.'}${state.decisions.length > 1 ? ` Всего решений: ${state.decisions.length}.` : ''}</p>
    <h3>Риск отказа подъёмников</h3><p>${riskItem ? `Наибольший: ${esc(post(riskItem.postId)?.code ?? riskItem.postId)} — ${pct(riskItem.probability)} на ${state.risk.horizon} мин (модель ${esc(state.risk.modelVersion)}, синтетическое обучение; рабочий вариант — ${state.risk.selected === 'model' ? 'модель' : 'правило'}). <a href="#lab">как обучена</a>` : esc(state.risk?.reason ?? 'Модель риска не подключена; прогноз выпуска рассчитывается симуляцией.')}</p>`;
}
function renderShift() {
  renderShiftFirst();
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
// "A shift without the system vs with it" on many synthetic shifts (scripts/compare-policies.mjs).
function renderPolicies(r) {
  if (!r) return '<p class="muted">Сравнение стратегий ещё не рассчитано. Выполните <code>npm.cmd run policies</code> (≈30 с) и перезапустите сервер. Решения для текущей смены сравниваются на копиях модели: карточка неисправности → «Сравнить решения».</p>';
  const base = r.policies[0], d = x => `${x > 0 ? '+' : ''}${fmt(x, 2)}`;
  return `<p class="fine-print">${esc(r.method)}</p><div class="table-scroll"><table><thead><tr><th scope="col">Стратегия</th><th scope="col">Принято, среднее</th><th scope="col">P10–P90</th><th scope="col">Отказов подъёмника на смену</th><th scope="col">Подъёмник неисправен к концу смены</th><th scope="col">Простой, мин</th><th scope="col">Затраты</th><th scope="col">К «без системы»: лучше / так же / хуже · Δ машин</th></tr></thead><tbody>${r.policies.map(p => `<tr><th scope="row">${esc(p.name)}</th><td><b>${fmt(p.accepted.mean, 2)}</b></td><td>${fmt(p.accepted.p10)}–${fmt(p.accepted.p90)}</td><td>${fmt(p.failures, 2)}</td><td>${p.shiftsCarried ?? '—'} из ${r.shifts}</td><td>${fmt(p.downtime.mean, 0)}</td><td>${fmt(p.cost.mean, 0)}</td><td>${p.vsBaseline ? `${p.vsBaseline.better} / ${p.vsBaseline.same} / ${p.vsBaseline.worse} · <b>${d(p.vsBaseline.meanDelta)}</b> (в сменах с деградацией ${d(p.vsBaseline.meanDeltaWithEpisode)})` : 'база'}</td></tr>`).join('')}</tbody></table></div>
  <ul class="notes">${r.policies.map(p => `<li><b>${esc(p.name)}.</b> ${esc(p.description)}</li>`).join('')}</ul>
  ${r.policies.slice(1).map(p => `<figure class="hist"><figcaption>${esc(p.name)}: Δ принятых машин к «${esc(base.name)}» по ${r.shifts} сменам</figcaption>${Object.entries(p.vsBaseline.histogram).map(([k, n]) => `<div class="hist-row"><span>${Number(k) > 0 ? '+' : ''}${k}</span>${bar(n / r.shifts, 'wide')}<span>${n}</span></div>`).join('')}</figure>`).join('')}
  <p class="fine-print">Повторить: <code>npm.cmd run policies</code>; отчёт — <code>reports/policy-comparison.md</code>. Синтетические смены и тарифы; не результаты завода Allur.</p>`;
}
function renderLab() {
  const box = $('lab');
  if (!lab) { box.innerHTML = '<p class="muted">Загрузка…</p>'; return; }
  if (!lab.available) { box.innerHTML = `<div class="panel"><h2 class="panel-title">Статус</h2><p>${esc(lab.reason)}</p></div><div class="panel"><h2 class="panel-title">Смена без системы и с системой: одинаковые смены</h2>${renderPolicies(lab.policies)}</div>`; return; }
  const m = lab.metrics;
  box.innerHTML = `<div class="panel"><h2 class="panel-title">Модель риска отказа подъёмника</h2><dl class="facts">
    <div><dt>Задача</dt><dd>${esc(lab.task)}</dd></div><div><dt>Горизонт</dt><dd>${lab.horizon} модельных минут</dd></div>
    <div><dt>Генератор данных</dt><dd>${esc(lab.generatorVersion)} · seed обучения ${lab.trainingSeed}</dd></div><div><dt>Модель</dt><dd>${esc(lab.modelVersion)} — ${esc(lab.modelType)}</dd></div>
    <div><dt>Смены</dt><dd>${lab.data.shifts.total}: обучение ${lab.data.shifts.train}, настройка ${lab.data.shifts.validation}, финальный тест ${lab.data.shifts.test} (разделение по целым сменам${lab.data.shiftSeeds ? `; seed ${lab.data.shiftSeeds.train.join('–')} / ${lab.data.shiftSeeds.validation.join('–')} / ${lab.data.shiftSeeds.test.join('–')}` : ''}; демо-смена не используется)</dd></div><div><dt>Воспроизвести</dt><dd><code>npm.cmd run train</code> — тот же seed даёт тот же артефакт; отчёт <code>reports/lift-risk-v1.md</code></dd></div>
    <div><dt>Примеры</dt><dd>${lab.data.samples.total} окон по 5 мин: обучение ${lab.data.samples.train}, настройка ${lab.data.samples.validation}, тест ${lab.data.samples.test}</dd></div>
    <div><dt>Доля отказов</dt><dd>${pct(lab.data.positiveRate)} окон с отказом в ближайшие ${lab.horizon} мин; отказов в тестовых сменах: ${m.test.model.leadTime.failures}</dd></div>
    <div><dt>Признаки</dt><dd>${lab.features.map(esc).join(', ')} — только измерения до момента прогноза за ${lab.featureWindow} мин</dd></div>
    <div><dt>Рабочий вариант</dt><dd><b>${lab.selected === 'model' ? 'модель' : 'baseline-правило'}</b> — ${esc(lab.selectionReason)}</dd></div></dl></div>
  <div class="panel"><h2 class="panel-title">Качество на отложенных сменах</h2><div class="table-scroll"><table><thead><tr><th scope="col">Вариант</th><th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">F1</th><th scope="col">PR-AUC</th><th scope="col">Ложных тревог на смену</th><th scope="col">Предупреждение до отказа (медиана)</th><th scope="col">Brier</th></tr></thead><tbody>
    ${metricRow(`Baseline: ${lab.baseline.feature} ≥ ${fmt(lab.baseline.threshold, 2)} — тест`, m.test.baseline)}${metricRow(`Модель, порог ${fmt(lab.threshold, 3)} — тест`, m.test.model)}${metricRow('Baseline — настройка', m.validation.baseline)}${metricRow('Модель — настройка', m.validation.model)}</tbody></table></div>
    <p class="fine-print">Ложные тревоги — 5-минутные окна с тревогой без отказа в ближайшие ${lab.horizon} мин, в среднем на смену. Предупреждение — сколько минут до отказа длилась непрерывная тревога (успели/всего отказов). Порог и правило подобраны на сменах настройки, тест использован один раз.</p></div>
  <div class="panel"><h2 class="panel-title">Калибровка вероятностей (тест)</h2><div class="table-scroll"><table><thead><tr><th scope="col">Интервал вероятности</th><th scope="col">Окон</th><th scope="col">Средний прогноз</th><th scope="col">Наблюдаемая доля отказов</th></tr></thead><tbody>${lab.calibration.map(b => `<tr><td>${fmt(b.from, 2)}–${fmt(b.to, 2)}</td><td>${b.count}</td><td>${b.count ? pct(b.meanPredicted) : '—'}</td><td>${b.count ? pct(b.observedRate) : '—'}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="panel"><h2 class="panel-title">Коэффициенты (стандартизованные признаки)</h2><div class="table-scroll"><table><thead><tr><th scope="col">Признак</th><th scope="col">Вес</th><th scope="col">Среднее (обучение)</th><th scope="col">Ст. откл.</th></tr></thead><tbody>${lab.coefficients.map(c => `<tr><th scope="row">${esc(c.feature)}</th><td>${fmt(c.weight, 3)}</td><td>${fmt(c.mean, 3)}</td><td>${fmt(c.std, 3)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="panel"><h2 class="panel-title">Смена без системы и с системой: одинаковые смены</h2>${renderPolicies(lab.policies)}</div>
  <div class="panel"><h2 class="panel-title">Ограничения</h2><ul class="notes">${lab.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="fine-print">Обучение и проверка — на синтетических сменах генератора ${esc(lab.generatorVersion)}. Пригодность для реального оборудования Allur не утверждается.</p></div>`;
}
