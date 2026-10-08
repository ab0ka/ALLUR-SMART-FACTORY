// ---------- Spaces: isometric scene, object cards, events ribbon ----------
// Every number below comes from the same server snapshot; the scene only draws it.
const SPACES = {
  enterprise: { title: 'Предприятие', short: 'Предприятие', sub: 'Маршрут: сварка → окраска → сборка → контроль → отгрузка; брак уходит на доработку и повторный контроль' },
  assembly: { title: 'Цех «Сборка»', short: 'Сборка', sub: 'Посты СБ-1…СБ-3 с гидроподъёмниками · буферы B2 и B3 · ремонтник ТЕХ-1', scene: true },
  diag: { title: 'Обслуживание оборудования', short: 'Оборудование', sub: 'Подъёмники сборки: отклонения, проверки и ремонт. Диагностика машин — в разделе «Ремонт автомобилей».', scene: true },
  tests: { title: 'Контроль качества', short: 'Контроль', stage: 'quality', note: 'В модели испытания — это пост контроля качества КК-1 и КК-2: результат «принят» или «дефект → доработка». Отдельных испытательных стендов в движке нет.' },
  rework: { title: 'Ремонт автомобилей', short: 'Ремонт автомобилей', stage: 'rework', note: 'Автомобили, не прошедшие контроль: процедура по фактическому дефекту на ДР-1 и повторный контроль. Неисправности подъёмников — в «Обслуживании оборудования».' },
  ship: { title: 'Отгрузка', short: 'Отгрузка', stage: 'shipping', note: 'Принятые автомобили ждут в буфере готовых FG и передаются в отгрузку на посту ОТ-1. Выпуск засчитывается при приёмке.' },
  weld: { title: 'Сварка', short: 'Сварка', stage: 'weld', note: 'Первый участок маршрута: кузова из входного буфера свариваются на постах СВ-1 и СВ-2.' },
  paint: { title: 'Окраска', short: 'Окраска', stage: 'paint', note: 'Сваренные кузова ждут в буфере B1 и окрашиваются на постах ОК-1 и ОК-2.' },
};
const SPACE_KEYS = ['enterprise', 'assembly', 'tests', 'diag', 'rework', 'ship'];
const CHECK_RULES = { pump_check: 'ток выше 13,5 А — износ насоса подтверждён, ниже 12,8 А — исключён', pressure_hold: 'падение больше 7 бар за 5 мин — утечка подтверждена, меньше 5 — исключена' };
let space = 'assembly', scene = null, sceneFailed = false, lastPanelKey = null, enteredSpace = null;
const ui = { selected: null, panel: null, table: false, diag: false, ribbonOpen: false, ribbonOnlySelected: false, choice: {}, cardOpen: {}, vbusy: null, vbusyOp: null, histAll: null };
const narrow = () => matchMedia('(max-width: 760px)').matches;
const ico = (kind, label) => `<span class="st ${kind}"><svg viewBox="0 0 13 13" aria-hidden="true">${sceneIcon(kind, 0, 0)}</svg>${label ? esc(label) : ''}</span>`;
const POST_KIND = p => ({ diagnosis: 'warn', working: 'ok', idle: 'idle', slow: 'warn', blocked: 'warn', fault: 'stop', maintenance: runningJob(p.id)?.type === 'check' ? 'check' : 'stop', shift_over: 'idle' }[p.state] ?? 'idle');
const VEHICLE_KIND = v => ({ processing: 'ok', rework: 'ok', waiting: 'wait', not_started: 'idle', paused: 'stop', blocked: 'warn', ready: 'ok', shipped: 'ok', stopped: 'idle', rework_wait: 'wait' }[v.state] ?? 'idle');
function runningJob(postId) {
  const j = state.jobs.find(x => x.postId === postId && x.status === 'running');
  if (!j) return null;
  const k = state.jobKinds.find(x => x.id === j.kind);
  return { ...j, type: j.kind === 'verify' ? 'check' : k?.type, stopsPost: j.kind === 'verify' ? true : k?.stopsPost };
}

// One scene per space: the assembly shop (scene.js), the other shops (shop-scene.js) and the live enterprise map.
const SHOP_OF_SPACE = { weld: 'weld', paint: 'paint', tests: 'quality', rework: 'rework', ship: 'shipping' };
const sceneKind = id => id === 'enterprise' ? 'enterprise' : SPACES[id]?.scene ? 'assembly' : SHOP_OF_SPACE[id] ? `shop:${id}` : null;
function ensureScene() {
  const want = sceneKind(space);
  if (sceneFailed || !want || scene?.kind === want) return;
  destroyScene();
  try {
    scene = want === 'assembly' ? new AssemblyScene($('scene')) : want === 'enterprise' ? new EnterpriseScene($('scene'), { cards: st => enterpriseSvg(st) + enterpriseCardsSvg() }) : new ShopScene($('scene'), SHOP_LAYOUTS[SHOP_OF_SPACE[space]]);
    scene.kind = want;
    const wrap = $('scene-wrap'), eff = Math.min(wrap.clientWidth / (scene.viewW ?? 1000), wrap.clientHeight / (scene.viewH ?? 660));
    if (want === 'assembly' && eff > 0 && eff < .8) { scene.home(Math.min(2.4, .85 / eff)); scene.focusPost('A2', Math.min(2.4, .85 / eff)); }
    else scene.home();
  } catch { sceneFailed = true; scene = null; }
}
function destroyScene() { scene?.destroy(); scene = null; }

function renderSpace() {
  const meta = SPACES[space] ?? SPACES.assembly, sceneSpace = Boolean(sceneKind(space)), table = ui.table || (sceneSpace && sceneFailed);
  if (enteredSpace !== space) {
    enteredSpace = space; $('space-stage').classList.remove('enter'); void $('space-stage').offsetWidth; $('space-stage').classList.add('enter');
    if (space === 'diag' && !ui.panel) { const p = state.problems.find(x => x.status === 'open') ?? state.problems.at(-1); if (p) { ui.panel = { type: 'problem', id: p.id }; ui.selected = { type: 'post', id: p.postId }; chatContext = { type: 'problem', id: p.id }; } }
  }
  $('crumbs').innerHTML = space === 'enterprise' ? '<b>Предприятие</b>' : `<a href="#space/enterprise">Предприятие</a> › <b>${esc(meta.short)}</b>`;
  text('space-title', meta.title); text('space-sub', meta.sub ?? meta.note ?? '');
  const open = state.problems.filter(p => p.status === 'open'), shopTasks = tasksOfShop(space);
  const busy = ['A1', 'A2', 'A3'].filter(id => post(id).vehicleId).length, b2 = state.stages.find(x => x.id === 'assembly').buffer, b3 = state.stages.find(x => x.id === 'quality').buffer;
  const carChips = space === 'rework' ? shopTasks.filter(t => t.object.type === 'vehicle').map(t => { const v = vehicle(t.object.id); return `<button class="c3-chip" data-vehicle="${esc(v.id)}">${ico('warn', '')}<b class="mono">${esc(v.id)}</b> · ${esc(v.procedure?.defect ?? t.title)} · ${v.procedure?.atPost ? 'ДР-1' : 'в очереди'} — карточка</button>`; }).join('') : '';
  const eqChip = open.length ? ico('warn', `неисправностей оборудования: ${open.length}`) : ico('ok', 'неисправностей оборудования нет');
  $('space-chips').innerHTML = carChips + (space === 'assembly' ? `${ico(b2.vehicleIds.length ? 'wait' : 'idle', `вход ${b2.id}: ${b2.vehicleIds.length} из ${b2.capacity}`)}${ico('ok', `${busy} из 3 постов заняты`)}${eqChip}${ico(shopTasks.length ? 'warn' : 'ok', `задач цеха: ${shopTasks.length}`)}${ico('idle', `выход ${b3.id}: ${b3.vehicleIds.length}`)}`
    : space === 'diag' ? eqChip + ico(shopTasks.length ? 'warn' : 'ok', `задач обслуживания: ${shopTasks.length}`)
    : space === 'enterprise' ? ico(state.forecast.projected >= state.plan.target ? 'ok' : 'warn', `прогноз ${state.forecast.projected} при плане ${state.plan.target}`) + ico(state.tasks.length ? 'warn' : 'ok', `задач смены: ${state.tasks.length}`)
    : ico(shopTasks.length ? 'warn' : 'ok', shopTasks.length ? `задач цеха: ${shopTasks.length}` : 'задач по цеху нет'));
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String((b.dataset.mode === 'table') === table));
  document.querySelector('.hud-row .seg').hidden = false;
  $('diag-toggle-wrap').hidden = !meta.scene || table; $('diag-toggle').checked = ui.diag || space === 'diag'; $('diag-toggle').disabled = space === 'diag';
  // Table and shop cards are regular content: the header card sits above them instead of floating over them.
  $('space-stage').classList.toggle('flat', table);
  $('scene-wrap').hidden = !(sceneSpace && !table);
  $('enterprise-wrap').hidden = true;
  $('stage-card').hidden = !(meta.stage && table);
  $('table-view').hidden = !(table && !meta.stage);
  document.querySelector('.cam').hidden = !(sceneSpace && !table);
  $('scene-hint').hidden = !(sceneSpace && !table) || Boolean(ui.panel);
  if (sceneSpace && !table) { ensureScene(); scene?.update(state, { selected: ui.selected, diag: ui.diag || space === 'diag' }); if (!scene) return renderSpace(); }
  else destroyScene();
  if (meta.stage && table) $('stage-card').innerHTML = stageCard(meta);
  if (table && !meta.stage) $('table-view').innerHTML = objectsTable();
  renderRibbon();
  $('view-space').classList.toggle('with-side', Boolean(ui.panel));
}

function enterpriseCardsSvg() {
  return enterpriseCards(state).map(c => {
    const lines = [...c.lines, ...c.problems.map(p => `${p.id}: ${p.title}`)];
    const h = 34 + lines.length * 18;
    c.live = c.live || Boolean(SHOP_OF_SPACE[c.space]); c.later = false;
    return `<g class="em-card${c.live ? ' live' : ''}" role="button" tabindex="0" data-space="${c.space}" aria-label="${esc(`${c.title}. ${lines.join('. ')}${c.later ? '. Открыть цех: посты, очередь, задачи' : '. Открыть сцену'}`)}" transform="translate(${c.left} ${c.top})">
      <rect width="280" height="${h}" rx="12" class="em-cardbox"/><text x="12" y="22" class="em-card-title">${esc(c.title)}</text>
      <text x="268" y="22" text-anchor="end" class="em-card-tag${c.live ? ' live' : ''}">${c.live ? 'Открыть сцену →' : 'Открыть цех →'}</text>
      ${lines.map((l, i) => `<text x="12" y="${42 + i * 18}" class="em-card-line${i >= c.lines.length ? ' warn' : ''}">${esc(l.length > 44 ? l.slice(0, 43) + '…' : l)}</text>`).join('')}</g>`;
  }).join('');
}

// Tasks of a shop: equipment of its posts and vehicles that are in it (posts or its input buffer).
function tasksOfShop(id) {
  if (id === 'enterprise') return state.tasks;
  if (id === 'diag') return state.tasks.filter(t => ['equipment', 'incident'].includes(t.category) && ['A1', 'A2', 'A3'].includes(t.postId));
  return state.tasks.filter(t => t.object.type === 'vehicle' ? vehicleShop(vehicle(t.object.id)) === id : t.object.type === 'problem' || t.object.type === 'post' ? SHOP_OF_STAGE[post(t.postId ?? t.object.id)?.stage] === id : false);
}
const STAGE_OUT = { weld: ['B1'], paint: ['B2'], assembly: ['B3'], quality: ['FG', 'RWQ'], rework: ['B3'] };
function stageCard(meta) {
  const sid = meta.stage, stage = sid === 'rework' ? { id: 'rework', name: 'Доработка', postIds: ['R1'], buffer: state.rework.buffer } : state.stages.find(s => s.id === sid);
  const q = stage.buffer.vehicleIds, tasks = tasksOfShop(space), busy = stage.postIds.filter(id => post(id).vehicleId).length;
  const buf = id => id === 'RWQ' ? state.rework.buffer : state.stages.find(s => s.buffer.id === id).buffer;
  const outs = (STAGE_OUT[sid] ?? []).map(buf);
  const postCard = id => { const p = post(id), v = p.vehicleId ? vehicle(p.vehicleId) : null, k = POST_KIND(p);
    return `<article class="post-card ${k}"><h4><button class="link" data-post="${esc(id)}">${esc(p.code)}</button>${ico(k, POST_SHORT[p.state])}</h4>${v ? `<p><button class="link mono" data-vehicle="${esc(v.id)}">${esc(v.id)}</button> · ${esc(p.operation ?? '')} <button class="small" data-car3d="${esc(v.id)}">3D</button></p>${p.progress !== null ? `<p>${bar(p.progress, 'wide')} ${Math.round(p.progress * 100)}%</p>` : ''}${v.nextAction && v.nextAction.kind !== 'none' ? `<p><b>Дальше:</b> ${esc(v.nextAction.title)}</p>` : ''}` : ''}${p.reason ? `<p class="fine-print">${esc(p.reason)}</p>` : ''}</article>`; };
  let extra = '';
  if (sid === 'quality') {
    const recent = [...state.inspections].reverse().slice(0, 8);
    extra = `<section class="shop-block"><h3>Последние результаты контроля</h3>${recent.length ? `<ul class="plain">${recent.map(i => `<li><span class="mono">${clock(i.minute)}</span> ${esc(i.postCode)} · <button class="link mono" data-vehicle="${esc(i.vehicleId)}">${esc(i.vehicleId)}</button> — ${i.result === 'pass' ? ico('ok', i.first ? 'принят с первого предъявления' : 'принят после доработки') : ico('warn', `дефект: ${i.defect}`)}</li>`).join('')}</ul>` : '<p class="muted">Проверок ещё не было.</p>'}</section>`;
  }
  if (sid === 'rework') extra = '<p class="fine-print">Процедура зависит от дефекта: «Не запускается» — диагностика узлов и проверка запуска; «Зазор двери» — замер, регулировка и повторный замер; дефекты сварки и окраски устраняются за нормативное время. После любой доработки — повторный контроль. Если машина стоит из-за неисправности подъёмника, это задача <a href="#space/diag">обслуживания оборудования</a>, а не ремонта машины.</p>';
  return `<div class="stage-inner shop-frame"><p class="honest">${esc(meta.note)} Объёмной сцены у этого цеха нет — ниже фактические посты, очередь и задачи из снимка движка.</p>
    <div class="shop-flow" aria-label="Поток цеха"><span>Вход: <b>${esc(stage.buffer.name)}</b> ${q.length}${stage.buffer.capacity !== null ? ` из ${stage.buffer.capacity}` : ''}</span><span class="arrow" aria-hidden="true">→</span><span>Посты: <b>${busy} из ${stage.postIds.length}</b> заняты</span><span class="arrow" aria-hidden="true">→</span><span>Выход: ${sid === 'shipping' ? `<b>отгружено ${state.totals.shipped}</b>` : outs.map(x => `<b>${esc(x.name)}</b> ${x.vehicleIds.length}`).join(' · ')}</span></div>
    <div class="shop-cols"><section class="shop-block"><h3>Посты · ${stage.postIds.length}</h3>${stage.postIds.map(postCard).join('')}</section>
    <section class="shop-block"><h3>Очередь на входе · ${q.length}</h3>${q.length ? `<ol class="queue">${q.slice(0, 10).map(id => `<li><button class="link mono" data-vehicle="${esc(id)}">${esc(id)}</button> <span>${esc(vehicle(id).modelName)} · ${esc(vehicle(id).orderId)}</span></li>`).join('')}${q.length > 10 ? `<li class="muted">и ещё ${q.length - 10}</li>` : ''}</ol>` : '<p class="muted">Очередь пуста.</p>'}</section>
    <section class="shop-block"><h3>Задачи цеха · ${tasks.length}</h3>${tasks.length ? `<ul class="plain">${tasks.map(t => `<li>${ico(TASK_ICON[t.category] ?? 'warn', '')} <button class="link" data-task="${esc(t.id)}">${esc(t.title)}</button><br><span class="fine-print">${esc(t.certaintyText)} · дальше: ${esc(t.next.toLowerCase())}</span></li>`).join('')}</ul>` : '<p class="muted">Задач по цеху нет.</p>'}</section></div>
    ${extra}</div>`;
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

