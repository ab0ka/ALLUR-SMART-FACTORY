// ---------- Spaces: isometric scene, object cards, events ribbon ----------
// Every number below comes from the same server snapshot; the scene only draws it.
const SPACES = {
  enterprise: { title: 'Предприятие', short: 'Предприятие', sub: 'Маршрут: сварка → окраска → сборка → контроль → отгрузка; брак уходит на доработку и повторный контроль' },
  assembly: { title: 'Цех «Сборка»', short: 'Сборка', sub: 'Посты СБ-1…СБ-3 с гидроподъёмниками · буферы B2 и B3 · ремонтник ТЕХ-1', scene: true },
  diag: { title: 'Диагностика', short: 'Диагностика', sub: 'Слой поверх цеха «Сборка»: отклонения подъёмников, проверки, ремонт и склад запчастей', scene: true },
  tests: { title: 'Испытания · контроль качества', short: 'Испытания', stage: 'quality', note: 'В модели испытания — это пост контроля качества КК-1 и КК-2: результат «принят» или «дефект → доработка». Отдельных испытательных стендов в движке нет.' },
  rework: { title: 'Доработка', short: 'Доработка', stage: 'rework', note: 'Автомобили, не прошедшие контроль, ждут в очереди RWQ, доработку выполняет пост ДР-1, затем повторный контроль.' },
  ship: { title: 'Отгрузка', short: 'Отгрузка', stage: 'shipping', note: 'Принятые автомобили ждут в буфере готовых FG и передаются в отгрузку на посту ОТ-1. Выпуск засчитывается при приёмке.' },
  weld: { title: 'Сварка', short: 'Сварка', stage: 'weld', note: 'Первый участок маршрута: кузова из входного буфера свариваются на постах СВ-1 и СВ-2.' },
  paint: { title: 'Окраска', short: 'Окраска', stage: 'paint', note: 'Сваренные кузова ждут в буфере B1 и окрашиваются на постах ОК-1 и ОК-2.' },
};
const SPACE_KEYS = ['enterprise', 'assembly', 'tests', 'diag', 'rework', 'ship'];
const CHECK_RULES = { pump_check: 'ток выше 13,5 А — износ насоса подтверждён, ниже 12,8 А — исключён', pressure_hold: 'падение больше 7 бар за 5 мин — утечка подтверждена, меньше 5 — исключена' };
let space = 'assembly', scene = null, sceneFailed = false, lastPanelKey = null, enteredSpace = null;
const ui = { selected: null, panel: null, table: false, diag: false, ribbonOpen: !matchMedia('(max-width: 760px)').matches, ribbonOnlySelected: false, choice: {} };
const narrow = () => matchMedia('(max-width: 760px)').matches;
const ico = (kind, label) => `<span class="st ${kind}"><svg viewBox="0 0 13 13" aria-hidden="true">${sceneIcon(kind, 0, 0)}</svg>${label ? esc(label) : ''}</span>`;
const POST_KIND = p => ({ working: 'ok', idle: 'idle', slow: 'warn', blocked: 'warn', fault: 'stop', maintenance: runningJob(p.id)?.type === 'check' ? 'check' : 'stop', shift_over: 'idle' }[p.state] ?? 'idle');
const VEHICLE_KIND = v => ({ processing: 'ok', rework: 'ok', waiting: 'wait', not_started: 'idle', paused: 'stop', blocked: 'warn', ready: 'ok', shipped: 'ok', stopped: 'idle', rework_wait: 'wait' }[v.state] ?? 'idle');
function runningJob(postId) {
  const j = state.jobs.find(x => x.postId === postId && x.status === 'running');
  if (!j) return null;
  const k = state.jobKinds.find(x => x.id === j.kind);
  return { ...j, type: j.kind === 'verify' ? 'check' : k?.type, stopsPost: j.kind === 'verify' ? true : k?.stopsPost };
}

function ensureScene() {
  if (scene || sceneFailed) return;
  try {
    scene = new AssemblyScene($('scene'));
    const wrap = $('scene-wrap'), eff = Math.min(wrap.clientWidth / 1000, wrap.clientHeight / 660);
    if (eff > 0 && eff < .8) { scene.home(Math.min(2.4, .85 / eff)); scene.focusPost('A2', Math.min(2.4, .85 / eff)); }
  } catch { sceneFailed = true; scene = null; }
}
function destroyScene() { scene?.destroy(); scene = null; }

function renderSpace() {
  if (SPACES[space]?.scene && sceneFailed && !ui.table) { ui.table = true; syncHash(); }
  const meta = SPACES[space] ?? SPACES.assembly, sceneSpace = Boolean(meta.scene), table = ui.table || (sceneSpace && sceneFailed);
  if (enteredSpace !== space) {
    enteredSpace = space; $('space-stage').classList.remove('enter'); void $('space-stage').offsetWidth; $('space-stage').classList.add('enter');
    if (space === 'diag' && !ui.panel) { const p = state.problems.find(x => x.status === 'open') ?? state.problems.at(-1); if (p) { ui.panel = { type: 'problem', id: p.id }; ui.selected = { type: 'post', id: p.postId }; chatContext = { type: 'problem', id: p.id }; } }
  }
  $('crumbs').innerHTML = space === 'enterprise' ? '<b>Предприятие</b>' : `<a href="${spaceHash({ space: 'enterprise', table: ui.table })}">Предприятие</a> › <b>${esc(meta.short)}</b>`;
  for (const link of document.querySelectorAll('[data-space-link]')) link.href = spaceHash({ space: link.dataset.spaceLink, table: ui.table });
  document.querySelector('.brand').href = spaceHash({ space: 'assembly', table: ui.table });
  $('alerts').href = spaceHash({ space: 'diag', table: ui.table });
  text('space-title', meta.title); text('space-sub', meta.sub ?? meta.note ?? '');
  const open = state.problems.filter(p => p.status === 'open');
  const busy = ['A1', 'A2', 'A3'].filter(id => post(id).vehicleId).length;
  $('space-chips').innerHTML = sceneSpace ? `${ico('ok', `${busy} из 3 постов заняты`)}${open.length ? ico('warn', `${open.length} ${open.length === 1 ? 'проблема' : 'проблемы'}`) : ico('ok', 'проблем нет')}` : space === 'enterprise' ? ico(state.forecast.projected >= state.plan.target ? 'ok' : 'warn', `прогноз ${state.forecast.projected} при плане ${state.plan.target}`) : ico('idle', 'объёмная сцена — следующий этап');
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String((b.dataset.mode === 'table') === table));
  document.querySelector('.hud-row .seg').hidden = Boolean(meta.stage);
  $('diag-toggle-wrap').hidden = !sceneSpace || table; $('diag-toggle').checked = ui.diag || space === 'diag'; $('diag-toggle').disabled = space === 'diag';
  $('scene-wrap').hidden = !(sceneSpace && !table);
  $('enterprise-wrap').hidden = !(space === 'enterprise' && !table);
  $('stage-card').hidden = !meta.stage;
  $('table-view').hidden = !(table && !meta.stage);
  document.querySelector('.cam').hidden = !(sceneSpace && !table);
  $('scene-hint').hidden = !(sceneSpace && !table) || Boolean(ui.panel);
  if (sceneSpace && !table) { ensureScene(); scene?.update(state, { selected: ui.selected, diag: ui.diag || space === 'diag' }); if (!scene) return renderSpace(); }
  else destroyScene();
  if (space === 'enterprise' && !table) $('enterprise').innerHTML = enterpriseSvg(state) + enterpriseCardsSvg();
  if (meta.stage) $('stage-card').innerHTML = stageCard(meta);
  if (table && !meta.stage) $('table-view').innerHTML = objectsTable();
  renderRibbon(); renderSide();
  $('view-space').classList.toggle('with-side', Boolean(ui.panel));
}

function enterpriseCardsSvg() {
  return enterpriseCards(state).map(c => {
    const lines = [...c.lines, ...c.problems.map(p => `${p.id}: ${p.title}`)];
    const h = 34 + lines.length * 18;
    return `<g class="em-card${c.live ? ' live' : ''}" role="button" tabindex="0" data-space="${c.space}" aria-label="${esc(`${c.title}. ${lines.join('. ')}${c.later ? '. Подробная сцена в разработке' : '. Открыть сцену'}`)}" transform="translate(${c.left} ${c.top})">
      <rect width="280" height="${h}" rx="12" class="em-cardbox"/><text x="12" y="22" class="em-card-title">${esc(c.title)}</text>
      <text x="268" y="22" text-anchor="end" class="em-card-tag${c.live ? ' live' : ''}">${c.live ? 'Открыть сцену →' : 'сцена позже'}</text>
      ${lines.map((l, i) => `<text x="12" y="${42 + i * 18}" class="em-card-line${i >= c.lines.length ? ' warn' : ''}">${esc(l.length > 44 ? l.slice(0, 43) + '…' : l)}</text>`).join('')}</g>`;
  }).join('');
}

function stageCard(meta) {
  const sid = meta.stage, stage = sid === 'rework' ? { id: 'rework', name: 'Доработка', postIds: ['R1'], buffer: state.rework.buffer } : state.stages.find(s => s.id === sid);
  const rows = stage.postIds.map(id => { const p = post(id), v = p.vehicleId; return `<tr><th scope="row"><button class="link" data-post="${esc(id)}">${esc(p.code)}</button></th><td>${ico(POST_KIND(p), POST_SHORT[p.state])}</td><td>${v ? `<button class="link mono" data-vehicle="${esc(v)}">${esc(v)}</button>` : '—'}</td><td>${p.operation ? esc(p.operation) : '—'}</td><td>${p.progress !== null ? `${bar(p.progress)} ${Math.round(p.progress * 100)}%` : '—'}</td><td class="wrap">${esc(p.reason ?? '')}</td></tr>`; }).join('');
  const q = stage.buffer.vehicleIds;
  let extra = '';
  if (sid === 'quality') {
    const recent = [...state.inspections].reverse().slice(0, 8);
    extra = `<h3>Последние результаты контроля</h3>${recent.length ? `<ul class="plain">${recent.map(i => `<li><span class="mono">${clock(i.minute)}</span> ${esc(i.postCode)} · <button class="link mono" data-vehicle="${esc(i.vehicleId)}">${esc(i.vehicleId)}</button> — ${i.result === 'pass' ? ico('ok', i.first ? 'принят с первого предъявления' : 'принят после доработки') : ico('warn', `дефект: ${i.defect}`)}</li>`).join('')}</ul>` : '<p class="muted">Проверок ещё не было.</p>'}`;
  }
  if (sid === 'shipping') extra = `<p>Отгружено за смену: <b>${state.totals.shipped}</b> · принято: <b>${state.totals.accepted}</b></p>`;
  if (sid === 'weld') extra = `<p class="fine-print">Входной буфер не ограничен: ${q.length} кузовов ждут сварки.</p>`;
  return `<div class="stage-inner"><div class="later-note">${ico('idle', '')}<div><b>Подробная объёмная сцена этого цеха ещё не сделана.</b><p>${esc(meta.note)} Ниже — фактические посты и очередь из снимка движка, без условных автомобилей.</p></div></div>
    <div class="table-scroll"><table class="obj-table"><caption class="sr-only">Посты участка ${esc(stage.name)}</caption><thead><tr><th scope="col">Пост</th><th scope="col">Состояние</th><th scope="col">Автомобиль</th><th scope="col">Операция</th><th scope="col">Ход</th><th scope="col">Причина</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>${esc(stage.buffer.name)} · ${q.length}${stage.buffer.capacity !== null ? ` из ${stage.buffer.capacity}` : ''}</h3>
    ${q.length ? `<ol class="queue">${q.slice(0, 10).map(id => `<li><button class="link mono" data-vehicle="${esc(id)}">${esc(id)}</button> <span>${esc(vehicle(id).modelName)} · ${esc(vehicle(id).orderId)}</span></li>`).join('')}${q.length > 10 ? `<li class="muted">и ещё ${q.length - 10}</li>` : ''}</ol>` : '<p class="muted">Очередь пуста.</p>'}${extra}</div>`;
}

function objectsTable() {
  const ids = space === 'enterprise' ? state.posts.map(p => p.id) : ['A1', 'A2', 'A3'];
  const row = (head, type, kind, label, veh, op, prog, reason, data) => `<tr${ui.selected && data.includes(`"${ui.selected.id}"`) ? ' class="selected"' : ''}><th scope="row">${esc(head)}</th><td>${esc(type)}</td><td>${ico(kind, label)}</td><td>${veh ? `<button class="link mono" data-vehicle="${esc(veh)}">${esc(veh)}</button>` : '—'}</td><td>${esc(op ?? '—')}</td><td>${esc(prog ?? '—')}</td><td class="wrap">${reason ?? ''}</td><td>${data ? `<button class="small" ${data}>Карточка</button>` : ''}</td></tr>`;
  let rows = ids.map(id => { const p = post(id); return row(p.code, `Пост · ${p.stageName}`, POST_KIND(p), POST_SHORT[p.state], p.vehicleId, p.operation, p.progress !== null ? `${Math.round(p.progress * 100)}%` : null, p.problemId ? `<button class="link" data-problem="${esc(p.problemId)}">${esc(p.problemId)}</button>: ${esc(problem(p.problemId)?.title ?? '')}` : esc(p.reason ?? ''), `data-post="${esc(id)}"`); }).join('');
  if (space !== 'enterprise') {
    for (const [sid, name] of [['assembly', 'Буфер перед сборкой'], ['quality', 'Буфер перед контролем']]) {
      const b = state.stages.find(s => s.id === sid).buffer;
      rows += row(b.id, name, b.vehicleIds.length ? 'wait' : 'idle', b.vehicleIds.length ? 'Ожидание' : 'Пусто', b.vehicleIds[0], null, `${b.vehicleIds.length} из ${b.capacity}`, b.vehicleIds.length > 1 ? `ещё: ${esc(b.vehicleIds.slice(1).join(', '))}` : '', b.vehicleIds[0] ? `data-vehicle="${esc(b.vehicleIds[0])}"` : '');
    }
    for (const e of state.equipment) {
      // The deviation index uses a 30-minute window, so right after a verified repair it can still include old readings.
      const open = state.problems.find(p => p.postId === e.postId && p.status === 'open');
      const fixed = !open && state.problems.find(p => p.postId === e.postId && p.status === 'resolved' && state.elapsed - p.resolvedAt <= 30);
      const [k, label, note] = e.failed ? ['stop', 'Отказ', ''] : open ? ['warn', 'Отклонение', ''] : fixed && e.anomalyScore >= 4.5 ? ['ok', 'Восстановлен', `проверка после ремонта в норме; окно 30 мин ещё содержит замеры до ремонта`] : e.anomalyScore >= 4.5 ? ['warn', 'Выше порога', ''] : ['ok', 'В норме', ''];
      const pid = open?.id ?? fixed?.id;
      rows += row(e.name.replace('Гидроподъёмник', 'Подъёмник'), 'Оборудование', k, label, null, null, `${fmt(e.anomalyScore)} / порог 4,5`, `${pid ? `<button class="link" data-problem="${esc(pid)}">${esc(pid)}</button> ` : ''}${esc(note)}`, pid ? `data-problem="${esc(pid)}"` : '');
    }
    const t = state.technicians[0], j = t.jobId ? state.jobs.find(x => x.id === t.jobId) : null;
    rows += row('ТЕХ-1', 'Ремонтник', j ? 'check' : 'ok', j ? `Занят ${j.id}` : 'Свободен', null, j?.title, j ? `${j.duration - j.remaining} из ${j.duration} мин` : `занят ${t.busyMinutes} мин за смену`, '', j?.problemId ? `data-problem="${esc(j.problemId)}"` : '');
    rows += row('Склад', 'Запчасти', 'idle', 'Запас', null, null, state.stock.map(s => `${s.name.split(' ')[0].toLowerCase()} ${s.available}`).join(' · '), '', '');
  }
  return `<div class="table-inner">${sceneFailed ? '<p class="note">Объёмная сцена недоступна в этом браузере — включён табличный режим. Данные и действия те же.</p>' : '<p class="note">Табличный режим: те же объекты, что на сцене. Если объёмная сцена не может быть показана, этот вид включается автоматически.</p>'}
    <div class="table-scroll"><table class="obj-table"><caption class="sr-only">Объекты пространства «${esc(SPACES[space].short)}» на ${clock(state.elapsed)}</caption><thead><tr><th scope="col">Объект</th><th scope="col">Тип</th><th scope="col">Состояние</th><th scope="col">Автомобиль</th><th scope="col">Операция</th><th scope="col">Ход / заполнение</th><th scope="col">Причина</th><th scope="col"><span class="sr-only">Действие</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="keys"><b>Клавиатура:</b> <kbd>Tab</kbd> объекты · <kbd>Enter</kbd> карточка · <kbd>Esc</kbd> закрыть · <kbd>1</kbd>–<kbd>6</kbd> пространства · <kbd>0</kbd> общий вид · <kbd>T</kbd> сцена ↔ таблица</p></div>`;
}
