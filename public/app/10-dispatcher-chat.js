// ---------- Management: one task list from the server ----------
// Equipment, vehicle defects and diagnosis, flow blocks and deadline risks come from state.tasks with stable ids.
// The header counter is the length of the same list, so they always agree.
const TASK_ICON = { equipment: 'stop', incident: 'stop', diagnosis: 'warn', defect: 'warn', delay: 'wait', risk: 'check' };
const TASK_GROUPS = [['Оборудование', ['equipment', 'incident']], ['Автомобили: дефекты и диагностика', ['diagnosis', 'defect']], ['Задержки потока', ['delay']], ['Риски сроков', ['risk']]];
const TASK_FILTERS = [['all', 'Все'], ['confirmed', 'Подтверждено'], ['hypothesis', 'Гипотезы'], ['forecast', 'Прогноз']];
let taskFilter = 'all', currentTask = null;
function renderThreat() {
  const f = state.forecast, eq = state.tasks.filter(t => ['equipment', 'incident'].includes(t.category)), cars = state.tasks.filter(t => t.object.type === 'vehicle');
  const due = state.orders.filter(o => o.dueMinute <= state.shift);
  $('threat').innerHTML = `<div class="threat-row">
    <div class="big-number ${f.gap < 0 ? 'negative' : 'positive'}"><strong>${f.projected}</strong><span>прогноз к 16:00 без новых вмешательств${f.low < f.high ? ` · по гипотезам ${f.low}–${f.high}` : ''}</span></div>
    <div class="big-number"><strong>${state.plan.target}</strong><span>план смены (задан оператором)</span></div>
    <div class="big-number"><strong>${state.totals.accepted}</strong><span>факт: принято сейчас</span></div>
    <div class="big-number ${state.tasks.length ? 'negative' : 'positive'}"><strong>${state.tasks.length}</strong><span>задач: оборудование ${eq.length} · автомобили ${cars.length}</span></div></div>
    <h3>Сроки заданий в этой смене</h3>
    <ul class="due-list">${due.map(o => { const late = f.lateOrders.includes(o.id); return `<li class="${late ? 'negative' : ''}">${orderLink(o.id)} — ${esc(state.models.find(m => m.id === o.modelId).name)} × ${o.quantity}, срок ${clock(o.dueMinute)}, принято ${o.accepted}/${o.quantity} · ${late ? 'по прогнозу опоздает' : 'по прогнозу успевает'}</li>`; }).join('') || '<li class="muted">Нет заданий со сроком в смене</li>'}</ul>
    ${!state.tasks.length && f.gap < 0 ? '<p class="fine-print">Дефицит к плану без открытых задач вызван мощностью и браком — сравните с эталонной мощностью в «Результатах смены».</p>' : ''}`;
}
function taskCard(t) {
  return `<article class="task ${esc(t.category)} ${esc(t.certainty)}${currentTask === t.id ? ' current' : ''}" id="task-${esc(t.id)}"><div>
    <div class="task-title">${ico(TASK_ICON[t.category] ?? 'warn', '')} ${esc(t.title)}</div>
    <div class="task-meta">${tag(esc(t.categoryName))}${tag(esc(t.certaintyText), t.certainty === 'confirmed' ? 'warn' : 'blue')}${tag(`с ${clock(t.since)} · ${esc(t.status)}`)}<span class="mono fine-print">${esc(t.id)}</span></div>
    <p>${esc(t.reason)}</p><p>Влияние: ${esc(t.impact)}</p><p class="task-next">Дальше: ${esc(t.next)}</p></div>
    <div class="task-actions"><button class="primary" data-task="${esc(t.id)}">Открыть ${t.object.type === 'vehicle' ? esc(t.object.id) : t.object.type === 'problem' ? esc(t.object.id) : t.object.type === 'order' ? `задание ${esc(t.object.id)}` : `пост ${esc(post(t.object.id)?.code ?? '')}`}</button>${t.object.type === 'vehicle' ? `<button class="secondary" data-car3d="${esc(t.object.id)}">3D-осмотр</button>` : ''}<button class="link" data-open-chat="1" data-ctx-type="${t.object.type === 'order' ? 'order' : esc(t.object.type)}" data-ctx-id="${esc(t.object.id)}">Спросить в чате</button></div></article>`;
}
function renderTasks() {
  const all = state.tasks, list = all.filter(t => taskFilter === 'all' || t.certainty === taskFilter);
  text('tasks-count', `${all.length}`);
  $('task-filters').innerHTML = TASK_FILTERS.map(([id, name]) => `<button data-task-filter="${id}" aria-pressed="${taskFilter === id}">${name} <span>${id === 'all' ? all.length : all.filter(t => t.certainty === id).length}</span></button>`).join('');
  const groups = TASK_GROUPS.map(([name, cats]) => [name, list.filter(t => cats.includes(t.category))]).filter(([, l]) => l.length);
  $('task-list').innerHTML = groups.length ? groups.map(([name, l]) => `<section class="task-group"><h3>${esc(name)} · ${l.length}</h3>${l.map(taskCard).join('')}</section>`).join('')
    : all.length ? '<p class="muted">Нет задач с такой достоверностью.</p>' : '<p class="muted">Активных задач нет: оборудование без отклонений, машин на доработке нет, блокировок и рисков сроков по прогнозу нет.</p>';
}
function openTask(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  currentTask = t.id;
  const { type, id: oid } = t.object;
  if (type === 'order') return openOrder(oid);
  openCard(type, oid);
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
  }).join('') : '<p class="muted">Решений ещё не принималось. Решение принимается из карточки неисправности оборудования («Сравнить решения»); после применения здесь появится сравнение прогноза с наблюдаемым результатом.</p>';
}
// ---------- Chat (one mechanism: the side panel on any screen) ----------
function contextLabel(c) {
  if (!c) return 'без контекста';
  return ({ post: () => `пост ${post(c.id)?.code ?? c.id}`, vehicle: () => `автомобиль ${c.id}`, order: () => `задание ${c.id}`, problem: () => `проблема ${c.id}` }[c.type] ?? (() => c.id))();
}
const SIDE_CHAT = { input: 'side-chat-input', send: 'side-chat-send', count: 'side-chat-count' };
async function ask(message, src = SIDE_CHAT) {
  if (chatBusy || !message?.trim()) return;
  chatBusy = true;
  const busy = on => { const b = $(src.send); if (b) { b.disabled = on; b.textContent = on ? 'Думаю…' : 'Спросить'; } };
  busy(true);
  try { const r = await api('/api/chat', { message: message.trim(), context: chatContext ?? undefined }); state = r.state; chatDraft = ''; chatPrevContext = null; if ($(src.input)) $(src.input).value = ''; if ($(src.count)) $(src.count).textContent = '0/500'; error(''); render(); }
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
  try { const r = await api('/api/decision', { experimentId, optionId, requestId: requestId() }); state = r.state; error(''); ui.panel = { type: 'problem', id: exp.problemId }; syncHash(); render(); }
  catch (e) { error(e.code === 'stale' ? `${e.message}` : `Не удалось применить: ${e.message}`); }
  finally { updating = false; }
}
async function compare(problemId) {
  if (updating) return;
  if (state.running && !await action({ action: 'pause' })) return;
  updating = true;
  try { const r = await api('/api/compare', { problemId }); state = r.state; error(''); ui.panel = { type: 'compare', id: problemId }; syncHash(); render(); }
  catch (e) { error(e.message); }
  finally { updating = false; }
}
