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
  const from = Math.max(0, state.elapsed - 150), shown = eq.readings.filter(r => Number.isFinite(r.minute) && r.minute >= from && r.minute <= state.elapsed);
  const rs = shown.filter(r => Number.isFinite(r[channel]));
  const W = 300, H = 92, pad = 26;
  const names = { pressure: 'Давление', temperature: 'Температура масла', cycle: 'Время цикла' };
  if (!rs.length) return `<figure class="spark"><figcaption>${names[channel]}, ${esc(unit)} <span>норма ${nominal}</span></figcaption><p class="muted">Нет измерений в показанном окне.</p></figure>`;
  const vals = rs.map(r => r[channel]), lo = Math.min(...vals, nominal) - 2, hi = Math.max(...vals, nominal) + 2;
  const x = m => pad + (m - from) / Math.max(1, state.elapsed - from) * (W - pad - 6), y = v => 8 + (hi - v) / (hi - lo) * (H - 26);
  const segments = []; let segment = [];
  for (const r of shown) {
    if (Number.isFinite(r[channel])) segment.push(r);
    else if (segment.length) { segments.push(segment); segment = []; }
  }
  if (segment.length) segments.push(segment);
  return `<figure class="spark"><figcaption>${names[channel]}, ${esc(unit)} <span>норма ${nominal}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${names[channel]}: последнее ${vals.at(-1)} ${esc(unit)}, норма ${nominal}">
    <line class="spark-nominal" x1="${pad}" x2="${W - 6}" y1="${y(nominal)}" y2="${y(nominal)}"/>
    ${Number.isFinite(detectedAt) && detectedAt >= from && detectedAt <= state.elapsed ? `<line class="spark-mark" x1="${x(detectedAt)}" x2="${x(detectedAt)}" y1="4" y2="${H - 18}"/>` : ''}
    ${segments.map(s => s.length === 1 ? `<circle class="spark-point" cx="${x(s[0].minute)}" cy="${y(s[0][channel])}" r="2.5"/>` : `<polyline class="spark-line" points="${s.map(r => `${x(r.minute).toFixed(1)},${y(r[channel]).toFixed(1)}`).join(' ')}"/>`).join('')}
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
  const input = $(src.input), draft = input?.value, context = chatContext ? { ...chatContext } : null;
  const busy = on => { const b = $(src.send); if (b) { b.disabled = on; b.textContent = on ? 'Думаю…' : 'Спросить'; } };
  busy(true);
  try { const r = await api('/api/chat', { message: message.trim(), context: context ?? undefined }); state = r.state;
    // A delayed reply must not clear a new draft or a newly opened object's composer.
    if (input && $(src.input) === input && input.value === draft && chatContext?.type === context?.type && chatContext?.id === context?.id) { input.value = ''; if ($(src.count)) $(src.count).textContent = '0/500'; } error(''); render(); }
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
