// ---------- Routing and render ----------
function setView(hash) {
  const parts = hash.split('/');
  // A route owns its card. Never carry a selection from another shop or screen.
  ui.panel = null; ui.selected = null; ui.car3d = null; ui.ribbonOnlySelected = false;
  let type, id;
  if (VIEWS.includes(parts[0])) { view = parts[0]; [, type, id] = parts; }
  else { view = 'space'; space = SPACES[parts[1]] ? parts[1] : 'assembly'; [, , type, id] = parts; }
  // Deep links: #<screen>/<vehicle|post|problem|compare|chat|car3d>/<id> open the same card as a click.
  const objId = id ? decodeURIComponent(id) : undefined;
  if (type === 'car3d' && objId) { ui.car3d = objId; if (view === 'vehicles') selectedVehicle = objId; chatContext = { type: 'vehicle', id: objId }; }
  else if (type === 'vehicle' && view === 'vehicles') { if (objId) { selectedVehicle = objId; chatContext = { type: 'vehicle', id: objId }; } }
  else if (['vehicle', 'post', 'problem', 'compare'].includes(type) && objId) {
    ui.panel = { type, id: objId };
    if (type === 'vehicle' || type === 'post') ui.selected = { type, id: objId };
    chatContext = { type: type === 'compare' ? 'problem' : type, id: objId };
  } else if (type === 'chat') {
    ui.panel = { type: 'chat' };
    const [ct, ...rest] = (objId ?? '').split(':');
    if (ct && rest.length) chatContext = { type: ct, id: rest.join(':') };
  }
  $('view-space').hidden = view !== 'space'; $('legacy').hidden = view === 'space';
  for (const s of document.querySelectorAll('#legacy .view')) s.hidden = s.id !== `view-${view}`;
  for (const a of document.querySelectorAll('[data-nav]')) { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  for (const a of document.querySelectorAll('[data-space-link]')) { if (view === 'space' && a.dataset.spaceLink === space) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  $('menu').open = false;
  renderNavigation();
  if (view !== 'space') destroyScene();
  if (view === 'lab' && !lab) loadLab();
  $('summary').hidden = view === 'handover';
  if (typeof handoverRoute === 'function') handoverRoute();
  render();
}
function renderNavigation() {
  const section = view === 'space' || view === 'workshop' ? 'shops' : view === 'vehicles' ? 'vehicles' : ['dispatcher', 'orders'].includes(view) ? 'manage' : 'analytics';
  const labels = { shops: ['ЦЕХА', 'Выберите участок и автомобиль на карте'], vehicles: ['АВТОМОБИЛИ', 'Все машины смены · следующее действие, маршрут, ремонт и 3D-осмотр'], manage: ['УПРАВЛЕНИЕ', 'Задачи смены: оборудование, автомобили, задержки и риски сроков'], analytics: ['АНАЛИТИКА', 'Результаты смены, прогноз и эксперименты'] };
  text('section-label', labels[section][0]); text('section-hint', labels[section][1]);
  for (const a of document.querySelectorAll('[data-section]')) {
    if (a.dataset.section === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (a.dataset.section === 'shops') a.href = `#space/${space}`;
  }
  $('shop-navigation').hidden = section !== 'shops';
  $('manage-navigation').hidden = section !== 'manage';
  $('analytics-navigation').hidden = section !== 'analytics';
  $('shop-select').value = space;
  document.title = `${view === 'space' ? SPACES[space].short : { workshop: '2D-схема', vehicles: 'Автомобили', dispatcher: 'Задачи и решения', orders: 'Задания', shift: 'Результаты смены', handover: 'Передача смены', lab: 'Модели и эксперименты' }[view]} · Allur`;
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
  else renderLab();
  renderSide(); renderCar3d();
  if (key && !document.activeElement?.closest('main')) document.querySelector(key)?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => { setView(location.hash.slice(1)); restoreScroll(history.state?.scroll); });
$('shop-select').addEventListener('change', e => goSpace(e.target.value));
document.addEventListener('click', e => { if (!$('menu').contains(e.target)) $('menu').open = false; });
$('play').addEventListener('click', () => action({ action: state.running ? 'pause' : 'play' }));
$('step').addEventListener('click', () => action({ action: 'step' }));
$('step-menu').addEventListener('click', () => { $('menu').open = false; action({ action: 'step' }); });
$('menu').addEventListener('click', e => { if (e.target.closest('a, button')) $('menu').open = false; });
$('reset').addEventListener('click', async () => { if (await confirmAction('Сбросить смену?', '<p>Смена начнётся заново в 11:00 с тем же seed. Решения, проверки, сравнения и история чата текущей смены будут удалены из сохранённого состояния.</p>')) action({ action: 'reset' }); });
$('release-form').addEventListener('submit', async e => {
  e.preventDefault();
  const quantity = Number($('release-quantity').value), priority = new FormData(e.target).get('release-priority');
  if (await action({ action: 'release', model: $('release-model').value, quantity, priority, requestId: requestId() })) text('release-note', `Задание ${state.orders.at(-1).id} выпущено: ${quantity} авт. во входном буфере. ${$('release-note').textContent}`);
});
$('plan-form').addEventListener('submit', async e => { e.preventDefault(); const target = Number($('plan-target').value); if (await confirmAction(`Задать план смены: ${target}`, `<p>План — обязательство смены, его задаёт оператор. Сейчас: ${state.plan.target}. Прогноз и факт от этого не меняются.</p>`)) action({ action: 'plan', target }); });
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
  if (d.job) { const p = post(d.postId), job = state.jobKinds.find(j => j.id === d.job); if (await confirmAction(`${job.title} на ${p.code}`, `<p>Техник ТЕХ-1 будет занят ${job.duration} мин${job.stopsPost ? `, пост остановлен на время работ` : ''}. Если техник занят, работа встанет в очередь.</p>`)) action({ action: 'job', postId: d.postId, kind: d.job, requestId: requestId() }); return; }
  if (d.fault) { if (await confirmAction(`Ручной сценарий на ${post(d.fault).code}`, `<p>Будет создан демонстрационный инцидент «${d.kind === 'breakdown' ? 'неисправность' : 'снижение темпа'}». Неисправность не исчезнет сама: потребуется ремонт.</p>`)) action({ action: 'fault', postId: d.fault, kind: d.kind, requestId: requestId() }); return; }
  if (d.transfer) { if (await confirmAction(`Перевести ${d.transfer} на ${post(d.to).code}`, '<p>Автомобиль переедет на параллельный пост; остаток операции сохранится. Сервер проверит, что пост свободен и исправен.</p>')) action({ action: 'transfer', vehicleId: d.transfer, postId: d.to, requestId: requestId() }); return; }
  if (d.hold) { const on = d.on === '1'; if (await confirmAction(on ? `Не загружать ${post(d.hold).code} новыми автомобилями` : `Вернуть ${post(d.hold).code} в загрузку`, `<p>${on ? 'Следующие автомобили из очереди пойдут на параллельные посты. Текущая операция на посту продолжится.' : 'Пост снова будет получать автомобили из очереди.'}</p>`)) action({ action: 'hold', postId: d.hold, on }); return; }
  if (d.priority) action({ action: 'priority', orderId: d.order, priority: d.priority });
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
  try {
    const next = await api('/api/state');
    if (!updating) { const changed = !state || state.revision !== next.revision || state.recordVersion !== next.recordVersion || state.running !== next.running || state.speed !== next.speed || state.csrf !== next.csrf; state = next; if (changed && !$('confirm').open) render(); error(''); }
  } catch { error('Нет связи с локальным сервером. Проверьте, что npm start продолжает работать. Повторяем подключение…'); }
  finally { fetching = false; }
}
await refresh(); setView(location.hash.slice(1)); setInterval(refresh, 1200);
