// ---------- Ribbon ----------
const EVENT_KIND = { component_checked: 'check', component_removed: 'wait', component_installed: 'ok', start_test: 'check', problem_detected: 'warn', incident_started: 'stop', inspection_failed: 'warn', job_started: 'check', check_completed: 'check', repair_completed: 'ok', verify_completed: 'ok', problem_resolved: 'ok', vehicle_accepted: 'ok', vehicle_shipped: 'ok', decision_applied: 'check', operation_started: 'ok', vehicle_moved: 'wait', follow_up_skipped: 'warn', incident_resolved: 'ok' };
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
  const highlighted = ui.routeRef?.type === 'event' ? state.events.find(e => String(e.seq) === ui.routeRef.id) : null;
  if (highlighted && !events.includes(highlighted)) events.push(highlighted);
  const card = e => { const k = EVENT_KIND[e.type] ?? 'idle'; const where = e.postId ? post(e.postId)?.code ?? '' : e.problemId ?? ''; return `<li><button id="ribbon-event-${e.seq}" class="ev ${k}${highlighted === e ? ' ref-highlight' : ''}${e.type === 'problem_detected' ? ' strong' : ''}" data-event="${e.seq}"${highlighted === e ? ' aria-current="true"' : ''}><span class="ev-meta">${highlighted === e ? '<span>Выбранное событие</span>' : ''}<span class="mono">${clock(e.minute)}</span>${where ? `<span class="ev-where">${esc(where)}</span>` : ''}${e.actor === 'operator' ? '<span class="ev-op">оператор</span>' : ''}</span><span class="ev-text">${ico(k, '')}<span>${esc(e.text)}</span></span></button></li>`; };
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
  if (!p) { side.hidden = true; side.innerHTML = ''; lastPanelKey = null; resetSheet(); return; }
  side.hidden = false;
  const key = `${p.type}:${p.id ?? ''}`;
  if (p.type === 'chat') { if (lastPanelKey !== key) side.innerHTML = chatPanelShell(); lastPanelKey = key; updateSideChat(); finishSheet(key); return; }
  const body = side.querySelector('.side-body'), scroll = body && lastPanelKey === key ? body.scrollTop : 0;
  const sheetScroll = lastPanelKey === key ? side.querySelector('.sheet-content')?.scrollTop ?? 0 : 0;
  let html = '';
  if (p.type === 'vehicle') html = vehicle(p.id) ? vehiclePanel(vehicle(p.id)) : '';
  else if (p.type === 'post') html = post(p.id) ? panelPost(post(p.id)) : '';
  else if (p.type === 'problem') html = problem(p.id) ? panelProblem(problem(p.id)) : '';
  else if (p.type === 'compare') html = problem(p.id) ? panelCompare(problem(p.id)) : '';
  if (!html) { ui.panel = null; side.hidden = true; lastPanelKey = null; resetSheet(); return; }
  side.innerHTML = html; lastPanelKey = key;
  if (scroll) side.querySelector('.side-body').scrollTop = scroll;
  finishSheet(key, sheetScroll);
}
const sideHead = (eyebrow, title, chips = '', extra = '') => `<div class="side-head"><div class="side-top"><span class="eyebrow">${eyebrow}</span><span class="side-tools">${extra}<button class="icon-btn small" data-close-panel="1" aria-label="Закрыть карточку">✕</button></span></div><h2>${title}</h2>${chips ? `<div class="chipline">${chips}</div>` : ''}</div>`;
const tag = (t, cls = '') => `<span class="tagchip ${cls}">${t}</span>`;
const chatBtn = (type, id) => `<button class="icon-btn small" data-open-chat="1" data-ctx-type="${type}" data-ctx-id="${esc(id)}" aria-label="Спросить в чате об этом объекте"><svg viewBox="0 0 20 20" aria-hidden="true"><path class="ico-chat" d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V13a2.5 2.5 0 0 1-2-2.5z"/></svg></button>`;
const lockNote = '<p class="lock">Проверки, ремонт, перевод и снятие поста с загрузки меняют производство — каждое такое действие запросит подтверждение.</p>';

// Tasks of this post: equipment problems of the post and vehicles that wait on it, from the same server list.
function postTasks(p) {
  const list = state.tasks.filter(t => t.postId === p.id || (t.object.type === 'post' && t.object.id === p.id));
  const rel = p.stage === 'rework' ? '<p class="fine-print">Пост ремонта автомобилей. Обслуживание подъёмников сборки — отдельный раздел «Обслуживание оборудования».</p>' : p.equipmentId ? '<p class="fine-print">Неисправность подъёмника — задача обслуживания оборудования, а не дефект автомобиля на посту.</p>' : '';
  return (list.length ? `<h3>Задачи поста · ${list.length}</h3><ul class="plain">${list.map(t => `<li>${ico(TASK_ICON[t.category] ?? 'warn', '')} <button class="link" data-task="${esc(t.id)}">${esc(t.title)}</button> <span class="fine-print">${esc(t.certaintyText)}</span></li>`).join('')}</ul>` : '') + rel;
}
// Stable action attributes are shared with the production confirmation/busy handlers.
function postActionButtons(p, context, kind = null) {
  return (p.actions ?? []).filter(a => !kind || a.kind === kind).map((a, i) => {
    const payload = a.payload, reasonId = `${context}-action-${p.id}-${i}`;
    const attrs = a.kind === 'job' ? `data-job="${esc(payload.kind)}" data-post-id="${esc(payload.postId)}"`
      : a.kind === 'transfer' ? `data-transfer="${esc(payload.vehicleId)}" data-to="${esc(payload.postId)}"`
      : `data-hold="${esc(payload.postId)}" data-on="${payload.on ? '1' : '0'}"`;
    return `<div class="post-action"><button class="wide" ${a.ok ? attrs : `disabled aria-describedby="${esc(reasonId)}"`}>${esc(a.label)}</button>${a.ok ? '' : `<p id="${esc(reasonId)}" class="why">Недоступно: ${esc(a.reason)}</p>`}</div>`;
  }).join('');
}
function postResources(p) {
  const technicians = state.technicians.map(t => {
    const job = state.jobs.find(j => j.id === t.jobId);
    return `<li>${esc(t.name)} — ${job ? `занят: ${esc(job.id)} · ${esc(job.title)} на ${esc(post(job.postId)?.code ?? job.postId)}, осталось ${fmt(job.remaining)} мин` : 'свободен'}</li>`;
  }).join('');
  const queue = state.jobs.filter(j => j.postId === p.id && j.status === 'queued');
  return `<h3>Техник</h3><ul class="plain">${technicians}</ul><h3>Очередь работ на ${esc(p.code)}</h3>${queue.length ? `<ol class="queue">${queue.map(j => `<li>${esc(j.id)} · ${esc(j.title)} · ${fmt(j.remaining)} мин</li>`).join('')}</ol>` : '<p class="muted">Очередь работ пуста.</p>'}${p.equipmentId ? `<h3>Склад</h3><ul class="plain">${state.stock.filter(s => ['seal_kit', 'pump'].includes(s.id)).map(s => `<li>${esc(s.name)}: доступно ${s.available}, резерв ${s.reserved}, на складе ${s.onHand}</li>`).join('')}</ul>` : ''}`;
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
  const actions = [postActionButtons(p, 'post')];
  if (!state.finished) {
    if (!incident && !p.problemId) actions.push(`<details class="demo"><summary>Учебный сценарий неисправности</summary><button class="wide" data-fault="${esc(p.id)}" data-kind="breakdown">Создать неисправность…</button><button class="wide" data-fault="${esc(p.id)}" data-kind="slowdown">Создать снижение темпа…</button></details>`);
  }
  body += postResources(p);
  const m = p.metrics;
  body += `<h3>Действия</h3><div class="actions-col">${actions.join('') || '<p class="muted">Действий нет.</p>'}</div>${lockNote}<p class="fine-print">A ${pct(m.availability)} · P ${pct(m.performance)} · Q ${pct(m.quality)} · OEE ${pct(m.oee)} · работа ${p.stats.run} мин · простой без входа ${p.stats.starved} мин</p>`;
  return sideHead(`ПОСТ · ${esc(p.stageName.toUpperCase())}`, esc(p.code), p.equipmentId ? tag(esc(state.equipment.find(e => e.id === p.equipmentId)?.name ?? '')) : '', chatBtn('post', p.id)) + `<div class="side-body">${history.state?.ret ? backLink() : ''}${postTasks(p)}${body}</div>`;
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
  if (eq) body += `<h3>Измерения</h3><p class="fine-print">Синтетические замеры каждые 5 мин. Последние 150 мин.</p><div class="problem-charts">${['pressure', 'temperature', 'cycle'].map(c => sparkline(eq, c, pr.latest?.[c]?.nominal ?? { pressure: 180, temperature: 45, cycle: 42 }[c], { pressure: 'бар', temperature: '°C', cycle: 'с' }[c], pr.detectedAt)).join('')}</div><p class="chart-key"><span class="key-reading">Измерение</span><span class="key-nominal">Норма</span><span class="key-detected">Обнаружено ${clock(pr.detectedAt)}</span></p>${pr.detectedAt < Math.max(0, state.elapsed - 150) ? '<p class="fine-print">Момент обнаружения раньше показанного окна.</p>' : ''}`;
  body += `<h3>Гипотезы</h3><p class="fine-print">Оценка по измерениям, а не установленная причина</p><ul class="hyp">${pr.hypotheses.map(h => `<li><span class="hyp-row"><b>${esc(h.title)}</b><span class="mono">${h.probability !== null ? pct(h.probability) : '—'}</span></span>${h.probability !== null ? bar(h.probability, 'wide blue') : ''}<span class="fine-print">${esc(HYP_STATUS[h.status])}</span></li>`).join('')}</ul>`;
  if (pr.status === 'open' && pr.availableChecks?.length) {
    const t = state.technicians[0];
    body += `<h3>Доступные проверки · ТЕХ-1 ${t.jobId ? `занят ${esc(t.jobId)}` : 'свободен'}</h3><div class="checks">${pr.availableChecks.map(c => `<div class="check-card${c.done ? ' done' : ''}"><div class="cc-head"><b>${esc(c.title)}</b><span>${c.duration} мин</span></div><p>${c.stopsPost ? '<b class="stop-text">Пост останавливается</b>' : 'Пост работает'} · ${esc(CHECK_RULES[c.kind] ?? '')}</p>${c.done ? `<p>${ico('ok', 'Выполнена')}</p>` : `<button class="${c.stopsPost ? '' : 'primary'}" data-check="${esc(c.kind)}" data-post-id="${esc(pr.postId)}" ${c.ok ? '' : 'disabled'}>Запустить проверку…</button>${c.ok ? '' : `<p class="why">${esc(c.reason)}</p>`}`}</div>`).join('')}</div>
      <p class="fine-print">Склад: ${state.stock.map(s => `${esc(s.name.toLowerCase())} — ${s.available}`).join(', ')}</p>`;
  }
  const foot = pr.status === 'open' && !state.finished ? `<button class="primary" data-compare="${esc(pr.id)}">Сравнить решения</button>` : '';
  return sideHead(`ПРОБЛЕМА · ${pr.kind === 'equipment' ? 'ОБОРУДОВАНИЕ' : 'РУЧНОЙ СЦЕНАРИЙ'}`, `<span class="mono">${esc(pr.id)}</span> · ${esc(pr.title)}`, statusTag + tag(`Затронуты: ${pr.vehicleIds.map(id => `<button class="link mono" data-vehicle="${esc(id)}">${esc(id)}</button>`).join(', ') || '—'}`), chatBtn('problem', pr.id))
    + `<div class="side-body">${history.state?.ret ? backLink() : ''}${body}${lockNote}<p class="fine-print">Это неисправность оборудования (пост ${esc(pr.postCode)}), а не дефект автомобиля. Ремонт машин — в цехе «Ремонт автомобилей».</p></div>${foot ? `<div class="side-foot">${foot}<button class="secondary" data-open-chat="1" data-ctx-type="problem" data-ctx-id="${esc(pr.id)}">Обсудить в чате</button></div>` : ''}`;
}

function panelCompare(pr) {
  const exp = [...state.experiments].reverse().find(e => e.problemId === pr.id);
  const head = sideHead(`РЕШЕНИЯ · ${esc(pr.id)} · ${esc(pr.postCode)}`, 'Сравнение решений', '', `<button class="link small-link" data-problem="${esc(pr.id)}">← к диагностике</button>`);
  if (!exp) return head + `<div class="side-body"><p class="muted">Сравнение ещё не рассчитано. Модель будет поставлена на паузу, каждый вариант прогоняется на отдельной копии текущего снимка до 16:00.</p></div><div class="side-foot"><button class="primary" data-compare="${esc(pr.id)}">Рассчитать варианты</button></div>`;
  const stale = rejectedComparisons.has(exp.id) || exp.baseRevision !== state.revision, decided = state.decisions.some(d => d.experimentId === exp.id);
  const choice = ui.choice[exp.id] ?? exp.options.filter(o => o.available).sort((a, b) => (b.expected?.accepted ?? 0) - (a.expected?.accepted ?? 0))[0]?.id;
  ui.choice[exp.id] = choice;
  const check = pr.checks?.at(-1);
  let body = check ? `<section class="result"><div class="eyebrow">${esc(check.jobId)} · ${esc(check.title.toUpperCase())} · ${clock(check.minute)}</div><div class="result-value mono">${fmt(check.value)} ${esc(check.unit)}</div><p><b>${esc(check.text)}</b></p></section>` : '';
  body += `<p class="fine-print">${esc(exp.id)} · снимок ${clock(exp.minute)}. Ожидаемые значения — расчёт на копиях модели до 16:00, а не факт. План — ${state.plan.target} принятых.</p>`;
  if (stale && !decided) body += `<p class="stale">Снимок устарел — пересчитайте варианты перед применением.</p>`;
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

// One chat: the visible context can be reset; a change of object is announced, the unsent draft is kept.
let chatDraft = '', chatPrevContext = null, chatDraftVersion = 0;
const sameCtx = (a, b) => (a?.type ?? null) === (b?.type ?? null) && (a?.id ?? null) === (b?.id ?? null);
function setChatContext(ctx) {
  const resolved = ctx ? validChatContext(ctx.type, ctx.id) : null;
  ui.chatMissing = Boolean(ctx && !resolved);
  ctx = resolved;
  if (sameCtx(ctx, chatContext)) return;
  if (chatContext && (chatDraft.trim() || state?.chat.length)) chatPrevContext = chatContext;
  chatContext = ctx;
}
function chatPanelShell() {
  return `<div class="side-head"><div class="side-top"><span class="eyebrow">ЧАТ ПО СМЕНЕ</span><span class="side-tools"><button class="icon-btn small" data-close-panel="1" aria-label="Закрыть чат">✕</button></span></div><h2>Чат</h2><div class="chipline" id="side-chat-context"></div><div id="side-chat-switch"></div><p class="fine-print" id="side-chat-mode"></p></div>
  <div class="side-body chat-body"><ol id="side-chat-log" class="chat-log" aria-live="polite"></ol></div>
  <div class="side-foot chat-foot"><div class="chips small" id="side-chat-suggest" role="group" aria-label="Предложенные вопросы"></div>
  <form id="side-chat-form" class="chat-form"><label for="side-chat-input" class="sr-only">Вопрос о выбранном объекте</label><textarea id="side-chat-input" rows="2" maxlength="500" placeholder="Вопрос о посте, автомобиле, задаче…"></textarea><div class="chat-send"><span id="side-chat-count" class="fine-print">0/500</span><button class="primary" type="submit" id="side-chat-send">Спросить</button></div></form></div>`;
}
function updateSideChat() {
  const ai = state.ai, input = $('side-chat-input');
  $('side-chat-send').disabled = chatBusy;
  text('side-chat-send', chatBusy ? 'Думаю…' : 'Спросить');
  if (input && input.value !== chatDraft && document.activeElement !== input) { input.value = chatDraft; text('side-chat-count', `${chatDraft.length}/500`); }
  $('side-chat-mode').textContent = ai.configured ? 'Модель формулирует ответ только из фактов движка; числа проверяет сервер. Чат ничего не меняет сам.' : 'Модель не подключена: работают локальные ответы на типовые вопросы. Чат ничего не меняет сам.';
  $('side-chat-context').innerHTML = chatContext ? `${tag(`Контекст: ${esc(contextLabel(chatContext))}`, 'blue')}<button class="link small-link" data-chat-clear="1">сбросить</button>` : tag(ui.chatMissing ? 'Объект не найден · без контекста' : 'без контекста — вопросы о смене в целом');
  $('side-chat-switch').innerHTML = chatPrevContext && !sameCtx(chatPrevContext, chatContext) ? `<p class="chat-switch">${ico('warn', '')} Контекст сменился: было «${esc(contextLabel(chatPrevContext))}», теперь «${esc(contextLabel(chatContext))}». Новые вопросы — о новом объекте.<button class="link small-link" data-chat-restore="1">Вернуть прежний</button><button class="link small-link" data-chat-ok="1">Понятно</button></p>` : '';
  $('side-chat-suggest').innerHTML = (chatContext?.type === 'vehicle' ? ['Что делать с этой машиной?', 'Почему задерживается этот автомобиль?'] : chatContext?.type === 'problem' ? ['На чём основана гипотеза неисправности?', 'Какую проверку выполнить?', 'Сравни ремонт сейчас и продолжение работы'] : ['Что сейчас угрожает плану?', 'Что делать дальше?', 'Почему результат отличается от прогноза?']).map(q => `<button data-ask="${esc(q)}">${esc(q)}</button>`).join('');
  const log = $('side-chat-log'), host = log.parentElement, atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
  log.innerHTML = state.chat.map(m => `<li class="msg ${m.role}"><div class="msg-meta">${m.role === 'user' ? 'Вы' : m.source === 'local' ? 'Локальная логика' : m.source === 'openai' ? 'OpenAI' : 'NVIDIA'} · ${clock(m.minute)}${m.context ? ` · ${esc(contextLabel(m.context))}` : ''}</div><div class="msg-text">${esc(m.text)}</div>
    ${m.note ? `<p class="fine-print">${esc(m.note)}</p>` : ''}
    ${m.refs?.length ? `<div class="refs">${m.refs.map(r => `<button class="ref" data-ref-type="${esc(r.type)}" data-ref-id="${esc(r.id)}">${esc(r.label)}</button>`).join('')}</div>` : ''}
    ${m.proposal ? `<div class="proposal"><span>Предложение: ${esc(m.proposal.title)}</span><button class="primary" data-proposal="${esc(m.id)}" ${state.finished ? 'disabled' : ''}>Подтвердить…</button></div>` : ''}</li>`).join('') || '<li class="muted">Спросите о выбранном объекте. Ссылки в ответах ведут к автомобилю, посту, задаче или сравнению.</li>';
  if (atBottom) host.scrollTop = host.scrollHeight;
}
