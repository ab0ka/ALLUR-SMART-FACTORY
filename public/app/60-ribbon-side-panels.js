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
  if (eq) body += `<h3>Измерения</h3><p class="fine-print">Синтетические замеры каждые 5 мин. Последние 150 мин.</p><div class="problem-charts">${['pressure', 'temperature', 'cycle'].map(c => sparkline(eq, c, pr.latest?.[c]?.nominal ?? { pressure: 180, temperature: 45, cycle: 42 }[c], { pressure: 'бар', temperature: '°C', cycle: 'с' }[c], pr.detectedAt)).join('')}</div><p class="chart-key"><span class="key-reading">Измерение</span><span class="key-nominal">Норма</span><span class="key-detected">Обнаружено ${clock(pr.detectedAt)}</span></p>${pr.detectedAt < Math.max(0, state.elapsed - 150) ? '<p class="fine-print">Момент обнаружения раньше показанного окна.</p>' : ''}`;
  body += `<h3>Гипотезы</h3><p class="fine-print">Оценка по измерениям, а не установленная причина</p><ul class="hyp">${pr.hypotheses.map(h => `<li><span class="hyp-row"><b>${esc(h.title)}</b><span class="mono">${h.probability !== null ? pct(h.probability) : '—'}</span></span>${h.probability !== null ? bar(h.probability, 'wide blue') : ''}<span class="fine-print">${esc(HYP_STATUS[h.status])}</span></li>`).join('')}</ul>`;
  if (pr.status === 'open' && pr.availableChecks?.length) {
    const t = state.technicians[0];
    body += `<h3>Доступные проверки · ТЕХ-1 ${t.jobId ? `занят ${esc(t.jobId)}` : 'свободен'}</h3><div class="checks">${pr.availableChecks.map(c => `<div class="check-card${c.done ? ' done' : ''}"><div class="cc-head"><b>${esc(c.title)}</b><span>${c.duration} мин</span></div><p>${c.stopsPost ? '<b class="stop-text">Пост останавливается</b>' : 'Пост работает'} · ${esc(CHECK_RULES[c.kind] ?? '')}</p>${c.done ? `<p>${ico('ok', 'Выполнена')}</p>` : `<button class="${c.stopsPost ? '' : 'primary'}" data-check="${esc(c.kind)}" data-post-id="${esc(pr.postId)}" ${c.ok ? '' : 'disabled'}>Запустить проверку…</button>${c.ok ? '' : `<p class="why">${esc(c.reason)}</p>`}`}</div>`).join('')}</div>
      <p class="fine-print">Склад: ${state.stock.map(s => `${esc(s.name.toLowerCase())} — ${s.available}`).join(', ')}</p>`;
  }
  const foot = pr.status === 'open' && !state.finished ? `<button class="primary" data-compare="${esc(pr.id)}">Сравнить решения</button>` : '';
  return sideHead(`ПРОБЛЕМА · ${pr.kind === 'equipment' ? 'ОБОРУДОВАНИЕ' : 'РУЧНОЙ СЦЕНАРИЙ'}`, `<span class="mono">${esc(pr.id)}</span> · ${esc(pr.title)}`, statusTag + tag(`Затронуты: ${pr.vehicleIds.map(id => `<button class="link mono" data-vehicle="${esc(id)}">${esc(id)}</button>`).join(', ') || '—'}`), chatBtn('problem', pr.id))
    + `<div class="side-body">${body}${lockNote}<p><button class="link" data-legacy="dispatcher" data-legacy-id="${esc(pr.id)}">Журнал решений в диспетчере →</button></p></div>${foot ? `<div class="side-foot">${foot}<button class="secondary" data-open-chat="1" data-ctx-type="problem" data-ctx-id="${esc(pr.id)}">Обсудить в чате</button></div>` : ''}`;
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

// These patterns only order existing local questions; the server still resolves intent.
function sideChatQuestions(question = '') {
  const selected = chatContext;
  const selectedProblem = selected?.type === 'problem' ? problem(selected.id) : null;
  const selectedVehicle = selected?.type === 'vehicle' ? vehicle(selected.id) : null;
  const selectedPost = selected?.type === 'post' ? post(selected.id) : selectedProblem ? post(selectedProblem.postId) : selectedVehicle?.location.type === 'post' ? post(selectedVehicle.location.id) : null;
  const relatedProblem = selectedProblem ?? (selectedPost ? state.problems.find(p => p.postId === selectedPost.id && p.status === 'open') ?? state.problems.findLast(p => p.postId === selectedPost.id) : !selected ? state.problems.find(p => p.status === 'open') : null);
  const relatedVehicle = selectedVehicle ?? (selectedPost?.vehicleId ? vehicle(selectedPost.vehicleId) : null);
  const matches = {
    delay: /авто|машин|жд|стоит|пауз|задерж|двига|ехать|очеред/i,
    basis: /причин|слом|неисправ|давлен|температур|насос|масл|оборуд|проблем/i,
    check: /проверк|провер|диагност|замер|измер/i,
    compare: /решен|ремонт|выбор|вариант|лучше|сравн/i,
    transfer: /перев|сосед|параллель|друг.*пост/i,
    threat: /план|выпуск|смен|срок|риск|произв/i,
    difference: /прогноз|факт|результат|отлич|разниц/i,
  };
  const questions = [], add = (kind, text) => questions.push({ text, rank: matches[kind].test(question) ? 1 : 0 });
  if (relatedVehicle && selected?.type === 'vehicle') add('delay', `Почему задерживается ${relatedVehicle.id}?`);
  if (relatedProblem) {
    add('basis', `На чём основана гипотеза неисправности ${relatedProblem.id}?`);
    if (relatedProblem.status === 'open') {
      if (relatedProblem.kind === 'equipment') add('check', `Какую проверку выполнить для ${relatedProblem.id}?`);
      add('compare', `Сравни ремонт сейчас и продолжение работы для ${relatedProblem.id}`);
      if (relatedVehicle) add('transfer', `Что даст перевод на другой пост для ${relatedProblem.id}?`);
    }
  }
  if (relatedVehicle && selected?.type !== 'vehicle') add('delay', `Почему задерживается ${relatedVehicle.id}?`);
  add('threat', SUGGESTED[0]);
  add('difference', SUGGESTED[6]);
  return questions.sort((a, b) => b.rank - a.rank).slice(0, 4).map(q => q.text);
}

function chatPanelShell() {
  return `<div class="side-head"><div class="side-top"><span class="eyebrow">ЧАТ ПО СМЕНЕ</span><span class="side-tools"><button class="icon-btn small" data-close-panel="1" aria-label="Закрыть чат">✕</button></span></div><h2>Чат</h2><div class="chipline" id="side-chat-context"></div><p class="fine-print" id="side-chat-mode"></p></div>
  <div class="side-body chat-body"><ol id="side-chat-log" class="chat-log" aria-live="polite"></ol></div>
  <div class="side-foot chat-foot"><div class="chips small" id="side-chat-suggest" role="group" aria-label="Предложенные вопросы"></div>
  <form id="side-chat-form" class="chat-form"><p class="fine-print" id="side-chat-hint"></p><label for="side-chat-input" class="sr-only">Вопрос о выбранном объекте</label><textarea id="side-chat-input" rows="2" maxlength="500" aria-describedby="side-chat-hint side-chat-mode" placeholder="Вопрос о посте, автомобиле, событии…"></textarea><div class="chat-send"><span id="side-chat-count" class="fine-print">0/500</span><button class="primary" type="submit" id="side-chat-send">Спросить</button></div></form></div>`;
}
function updateSideChat() {
  const ai = state.ai, latest = state.chat.at(-1);
  const unsupported = latest?.role === 'assistant' && latest.source === 'local' && latest.intent === 'unknown';
  const question = unsupported ? state.chat.findLast(m => m.role === 'user')?.text ?? '' : '';
  const localQuestions = !ai.configured || unsupported;
  $('side-chat-mode').textContent = ai.configured ? 'Модель формулирует ответ только из фактов движка; числа проверяет сервер. Чат ничего не меняет сам.' : 'Модель не подключена: работают локальные ответы на типовые вопросы. Чат ничего не меняет сам.';
  $('side-chat-context').innerHTML = chatContext ? `${tag(`Контекст: ${esc(contextLabel(chatContext))}`, 'blue')}<button class="link small-link" data-chat-clear="1">убрать</button>` : tag('без контекста');
  const suggestions = $('side-chat-suggest');
  suggestions.setAttribute('aria-label', unsupported ? 'Ближайшие типовые вопросы' : 'Предложенные вопросы');
  suggestions.innerHTML = (localQuestions ? sideChatQuestions(question) : SUGGESTED.slice(0, 4)).map(q => `<button data-ask="${esc(q)}" data-ask-side="1">${esc(q)}</button>`).join('');
  const hint = $('side-chat-hint');
  hint.hidden = !localQuestions;
  hint.textContent = unsupported ? 'Свободный вопрос не удалось обработать. Локальные правила отвечают на типовые вопросы — попробуйте ближайшую подсказку выше.' : !ai.configured ? 'Без AI доступны типовые вопросы о смене. Выберите подсказку выше или спросите о задержке автомобиля по его ID.' : '';
  // Snapshot refreshes update help and messages without replacing the textarea or its draft.
  $('side-chat-input').placeholder = localQuestions ? 'Типовой вопрос или ID автомобиля…' : 'Вопрос о посте, автомобиле, событии…';
  const log = $('side-chat-log'), host = log.parentElement, atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
  log.innerHTML = state.chat.map(m => `<li class="msg ${m.role}"><div class="msg-meta">${m.role === 'user' ? 'Вы' : m.source === 'local' ? 'Локальная логика' : m.source === 'openai' ? 'OpenAI' : 'NVIDIA'} · ${clock(m.minute)}${m.context ? ` · ${esc(contextLabel(m.context))}` : ''}</div><div class="msg-text">${esc(m.text)}</div>
    ${m.refs?.length ? `<div class="refs">${m.refs.map(r => `<button class="ref" data-ref-type="${esc(r.type)}" data-ref-id="${esc(r.id)}">${esc(r.label)}</button>`).join('')}</div>` : ''}
    ${m.proposal ? `<div class="proposal"><span>Предложение: ${esc(m.proposal.title)}</span><button class="primary" data-proposal="${esc(m.id)}" ${state.finished ? 'disabled' : ''}>Подтвердить…</button></div>` : ''}</li>`).join('') || '<li class="muted">Спросите о выбранном объекте. Ссылки в ответах ведут к автомобилю, посту, событию или сравнению.</li>';
  if (atBottom) host.scrollTop = host.scrollHeight;
}
