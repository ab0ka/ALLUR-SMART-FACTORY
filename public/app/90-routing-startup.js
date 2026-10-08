// ---------- Routing and render ----------
function setView(hash) {
  const parts = hash.split('/');
  // A route owns its selection and context, including a return through browser history.
  ui.panel = null; ui.selected = null; ui.car3d = null; ui.ribbonOnlySelected = false; ui.routeRef = null;
  let tail;
  if (VIEWS.includes(parts[0])) { view = parts[0]; tail = parts.slice(1); }
  else if (parts[0] === 'report') { view = typeof dataSource !== 'undefined' && dataSource === 'case' ? 'case' : 'handover'; tail = []; }
  else { view = 'space'; space = Object.hasOwn(SPACES, parts[1]) ? parts[1] : 'assembly'; tail = parts.slice(2); }
  // The screen decides the data source; a change of source drops the other source's selection and explanation.
  if (typeof setSource === 'function') { if (view === 'case') setSource('case'); else if (!['overview', 'video'].includes(view)) setSource('sim'); }
  // Keep published ID-only order links readable; new links follow the screen/type/id convention.
  if (view === 'orders' && tail.length === 1 && tail[0] && tail[0] !== 'chat') tail = ['order', tail[0]];
  const [type, rawId] = tail, objId = decodeRoutePart(rawId);
  let ctx = null, missing = false;
  if (type === 'chat') {
    ui.panel = { type: 'chat' };
    const resolved = chatRouteContext(tail.slice(1)); ctx = resolved.context; missing = resolved.missing;
    if (ctx && ['vehicle', 'post'].includes(ctx.type)) ui.selected = { ...ctx };
  } else if (tail.length === 2) {
    if (type === 'car3d' && (ctx = validChatContext('vehicle', objId))) {
      ui.car3d = ctx.id; if (view === 'vehicles') selectedVehicle = ctx.id;
    } else if (type === 'vehicle' && view === 'vehicles') {
      ctx = validChatContext('vehicle', objId); selectedVehicle = ctx?.id ?? null;
    } else if (['vehicle', 'post', 'problem', 'compare'].includes(type)) {
      ctx = validChatContext(type === 'compare' ? 'problem' : type, objId);
      if (ctx) { ui.panel = { type, id: ctx.id }; if (['vehicle', 'post'].includes(type)) ui.selected = { ...ctx }; }
    } else if (type === 'order' && view === 'orders') {
      ctx = validChatContext('order', objId); if (ctx) ui.routeRef = { ...ctx };
    } else if (type === 'decision' && view === 'dispatcher') {
      const item = state.decisions.find(x => x.id === objId);
      if (item) { ui.routeRef = { type, id: item.id }; ctx = recordChatContext(item); }
    } else if (type === 'casedev' && ['overview', 'case'].includes(view) && objId) {
      ui.panel = { type, id: objId };
    } else if (type === 'event' && view === 'space') {
      const item = state.events.find(x => String(x.seq) === objId);
      if (item) { ui.routeRef = { type, id: String(item.seq) }; ui.ribbonOpen = true; ctx = recordChatContext(item); }
    }
  }
  setChatContext(ctx); ui.chatMissing = missing;
  $('view-space').hidden = view !== 'space'; $('legacy').hidden = view === 'space';
  for (const s of document.querySelectorAll('#legacy .view')) s.hidden = s.id !== `view-${view}`;
  for (const a of document.querySelectorAll('[data-nav]')) { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  for (const a of document.querySelectorAll('[data-space-link]')) { if (view === 'space' && a.dataset.spaceLink === space) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  $('menu').open = false;
  renderNavigation();
  if (view !== 'space') destroyScene();
  if (view === 'lab' && !lab) loadLab();
  if (typeof sourceChrome === 'function') sourceChrome(view);
  if (['handover', 'overview', 'effect'].includes(view)) $('summary').hidden = true;
  if (typeof handoverRoute === 'function') handoverRoute();
  render(); revealRouteReference();
}
function revealRouteReference() {
  const ref = ui.routeRef;
  if (!ref) return;
  requestAnimationFrame(() => {
    if (ui.routeRef?.type !== ref.type || ui.routeRef?.id !== ref.id) return;
    const id = ref.type === 'event' ? `ribbon-event-${ref.id}` : `${ref.type}-${ref.id}`;
    const box = document.getElementById(id), target = ref.type === 'order' ? box?.querySelector('h2') : box;
    if (target) { target.tabIndex = -1; target.scrollIntoView({ block: 'center', inline: 'center' }); target.focus({ preventScroll: true }); }
  });
}
function renderNavigation() {
  const section = view === 'overview' ? 'overview' : view === 'space' || view === 'workshop' ? 'shops' : ['case', 'handover', 'shift', 'effect'].includes(view) ? 'report' : 'more';
  const labels = { overview: ['ОБЗОР', 'Где проблема, чем подтверждается, что делать'], shops: ['ЦЕХА', 'Выберите участок и автомобиль на карте'], report: ['ОТЧЁТ', 'Данные кейса, передача смены, результаты и эффект'], more: ['ЕЩЁ', 'Задачи, автомобили, задания, модели и видеоэксперимент'] };
  text('section-label', labels[section][0]); text('section-hint', labels[section][1]);
  for (const a of document.querySelectorAll('[data-section]')) {
    if (a.dataset.section === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (a.dataset.section === 'shops') a.href = `#space/${space}`;
    if (a.dataset.section === 'report') a.href = typeof dataSource !== 'undefined' && dataSource === 'case' ? '#case' : '#handover';
  }
  $('shop-navigation').hidden = section !== 'shops';
  $('report-navigation').hidden = section !== 'report';
  $('more-navigation').hidden = section !== 'more';
  $('shop-select').value = space;
  document.title = `${view === 'space' ? SPACES[space].short : { overview: 'Обзор', workshop: '2D-схема', vehicles: 'Автомобили', dispatcher: 'Задачи и решения', orders: 'Задания', shift: 'Результаты смены', handover: 'Передача смены', effect: 'Эффект', lab: 'Модели и эксперименты', video: 'Видеоэксперимент', case: 'Данные кейса' }[view]} · Allur`;
}
function focusKey(el) {
  if (!el || el === document.body || !el.closest('main')) return null;
  const attrs = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}
function render() {
  if (!state) return;
  const key = focusKey(document.activeElement);
  renderChrome();
  if (view === 'space') renderSpace();
  else if (view === 'dispatcher') { renderThreat(); renderTasks(); renderDecisions(); }
  else if (view === 'workshop') { renderActiveProblems(); renderMap(); renderPostDetail(); renderPostBoard(); }
  else if (view === 'vehicles') renderVehicles();
  else if (view === 'orders') renderOrders();
  else if (view === 'shift') renderShift();
  else if (view === 'handover') renderHandover();
  else if (view === 'video') renderVideo();
  else if (view === 'case') renderCase();
  else if (view === 'overview') renderOverview();
  else if (view === 'effect') renderEffect();
  else renderLab();
  renderSide(); renderCar3d();
  if (key && !document.activeElement?.closest('main')) visibleNavigationTarget(key)?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => { setView(location.hash.slice(1)); restoreScroll(history.state?.scroll); restoreNavigationFocus(); });
$('shop-select').addEventListener('change', e => goSpace(e.target.value));
document.addEventListener('click', e => { if (!$('menu').contains(e.target)) $('menu').open = false; });
$('play').addEventListener('click', () => action({ action: state.running ? 'pause' : 'play' }));
$('step').addEventListener('click', () => action({ action: 'step' }));
$('step-menu').addEventListener('click', () => { $('menu').open = false; action({ action: 'step' }); });
$('menu').addEventListener('click', e => { if (e.target.closest('a, button')) $('menu').open = false; });
$('reset').addEventListener('click', async () => { if (await confirmAction('Сбросить смену?', '<p>Смена начнётся заново в 11:00 с тем же seed. Решения, проверки, сравнения и история чата текущей смены будут удалены из сохранённого состояния.</p>')) action({ action: 'reset' }); });
$('release-form').addEventListener('submit', async e => {
  e.preventDefault();
  const quantity = Number($('release-quantity').value), priority = new FormData(e.target).get('release-priority'), model = $('release-model').value;
  if (!await confirmAction(`Выпустить задание: модель ${model} × ${quantity}`, `<p>Во входном буфере появятся ${quantity} синтетических автомобилей. Приоритет: ${esc(PRIORITY[priority])}. Они займут место в очереди; начатые операции не прерываются.</p>`)) return;
  if (await action({ action: 'release', model, quantity, priority, requestId: requestId() })) text('release-note', `Задание ${state.orders.at(-1).id} выпущено: ${quantity} авт. во входном буфере. ${$('release-note').textContent}`);
});
$('plan-form').addEventListener('submit', async e => { e.preventDefault(); const target = Number($('plan-target').value); if (await confirmAction(`Задать план смены: ${target}`, `<p>План — обязательство смены, его задаёт оператор. Сейчас: ${state.plan.target}. Прогноз и факт от этого не меняются.</p>`)) action({ action: 'plan', target, requestId: requestId() }); });

document.addEventListener('click', async e => {
  const t = e.target.closest('button, [role=button]'); if (!t || !state || t.closest('dialog')) return;
  const d = t.dataset;
  if (d.speed) { action({ action: 'speed', value: Number(d.speed) }); return; }
  if (view === 'space' && spaceClick(d)) return;
  if (await cardClick(d)) return;
  if (d.filter) { vehicleFilter = d.filter; selectedVehicle = null; syncHash(); renderVehicles(); return; }
  if (d.navTo) { location.hash = d.navTo; return; }
  if (d.proposal) return applyProposal(d.proposal);
  if (d.compare) return compare(d.compare);
  if (d.apply) return applyDecision(d.exp, d.apply);
  if (d.check) { const p = post(d.postId), job = state.jobKinds.find(j => j.id === d.check); if (await confirmAction(`${job.title} на ${p.code}`, `<p>Техник ТЕХ-1 будет занят ${job.duration} мин${job.stopsPost ? `, ${esc(p.code)} остановится на это время` : ', пост продолжит работу'}. Результат проверки появится в наблюдениях проблемы. Ремонт этим действием не назначается.</p>`)) action({ action: 'job', postId: d.postId, kind: d.check, requestId: requestId() }); return; }
  if (d.job) { const p = post(d.postId), job = state.jobKinds.find(j => j.id === d.job); if (await confirmAction(`${job.title} на ${p.code}`, `<p>Техник ТЕХ-1 будет занят ${job.duration} мин${job.stopsPost ? `, пост остановлен на время работ` : ''}. Если техник занят, работа встанет в очередь.</p>${job.part ? `<p>Запчасть: ${esc(state.stock.find(s => s.id === job.part)?.name ?? job.part)} × 1 — будет зарезервирована для работы.</p>` : ''}`)) action({ action: 'job', postId: d.postId, kind: d.job, requestId: requestId() }); return; }
  if (d.fault) { if (await confirmAction(`Ручной сценарий на ${post(d.fault).code}`, `<p>Будет создан демонстрационный инцидент «${d.kind === 'breakdown' ? 'неисправность' : 'снижение темпа'}». Неисправность не исчезнет сама: потребуется ремонт.</p>`)) action({ action: 'fault', postId: d.fault, kind: d.kind, requestId: requestId() }); return; }
  if (d.transfer) { if (await confirmAction(`Перевести ${d.transfer} на ${post(d.to).code}`, `<p>Автомобиль освободит пост ${esc(post(vehicle(d.transfer)?.location.id)?.code ?? 'источника')} и переедет на ${esc(post(d.to).code)}; остаток операции сохранится. Сервер повторно проверит доступность перевода.</p>`)) action({ action: 'transfer', vehicleId: d.transfer, postId: d.to, requestId: requestId() }); return; }
  if (d.hold) { const on = d.on === '1'; if (await confirmAction(on ? `Не загружать ${post(d.hold).code} новыми автомобилями` : `Вернуть ${post(d.hold).code} в загрузку`, `<p>${on ? 'Следующие автомобили из очереди пойдут на параллельные посты. Текущая операция на посту продолжится.' : 'Пост снова будет получать автомобили из очереди.'}</p>`)) action({ action: 'hold', postId: d.hold, on, requestId: requestId() }); return; }
  if (d.priority) {
    const orderId = d.order, priority = d.priority;
    if (await confirmAction(`Изменить приоритет ${orderId}: ${PRIORITY[priority]}`, '<p>Изменится порядок ещё не начатых операций этого задания в очередях. Уже начатые операции не прерываются.</p>')) action({ action: 'priority', orderId, priority, requestId: requestId() });
  }
});
$('workshop-map').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[role=button]')) { e.preventDefault(); e.target.closest('[role=button]').dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
$('explain').addEventListener('click', async () => {
  if (!state || aiBusy) return;
  aiBusy = true; $('explain').disabled = true; text('explain', 'Объясняю…');
  try { const r = await api('/api/explain', {}); text('ai-text', r.text); text('ai-source', `${r.source === 'openai' ? 'OpenAI' : r.source === 'nvidia' ? 'NVIDIA AI' : 'Локальное объяснение'} · ${r.message} · ${clock(r.minute)}`); aiRevision = r.revision; error(''); render(); }
  catch (e) { error(`Не удалось получить объяснение: ${e.message}. Расчётные показатели доступны выше.`); }
  finally { aiBusy = false; $('explain').disabled = false; text('explain', 'Объяснить ↗'); }
});
async function refresh() {
  if (updating || fetching || chatBusy) return;
  fetching = true;
  // A completed POST can replace state while this GET is still in flight.
  // Identity also works across reset/restart, where revisions can decrease.
  const requestedState = state;
  const stillCurrent = () => !updating && !chatBusy && state === requestedState;
  try {
    const next = await api('/api/state');
    if (stillCurrent()) { const changed = !state || state.revision !== next.revision || state.recordVersion !== next.recordVersion || state.running !== next.running || state.speed !== next.speed || state.csrf !== next.csrf; state = next; if (changed && !$('confirm').open) render(); error(''); }
  } catch { if (stillCurrent()) error('Нет связи с локальным сервером. Проверьте, что npm start продолжает работать. Повторяем подключение…'); }
  finally { fetching = false; }
}
await refresh(); if (!location.hash.slice(1)) history.replaceState(history.state, '', '#overview'); setView(location.hash.slice(1)); setInterval(refresh, 1200);
