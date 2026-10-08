// ---------- Routing and render ----------
function setView(hash) {
  const [name, arg, type, id] = hash.split('/');
  if (VIEWS.includes(name)) view = name;
  else {
    view = 'space'; space = SPACES[arg] ? arg : 'assembly';
    // Deep links: #space/<space>/<vehicle|post|problem|compare|chat>/<id> open the same card as a click.
    if (['vehicle', 'post', 'problem', 'compare', 'chat'].includes(type)) {
      const objId = id ? decodeURIComponent(id) : undefined;
      ui.panel = { type, id: objId };
      if (type === 'vehicle' || type === 'post') ui.selected = { type, id: objId };
      if (type !== 'chat' && objId) chatContext = { type: type === 'compare' ? 'problem' : type, id: objId };
    }
  }
  $('view-space').hidden = view !== 'space'; $('legacy').hidden = view === 'space';
  for (const s of document.querySelectorAll('#legacy .view')) s.hidden = s.id !== `view-${view}`;
  for (const a of document.querySelectorAll('[data-nav]')) { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  for (const a of document.querySelectorAll('[data-space-link]')) { if (view === 'space' && a.dataset.spaceLink === space) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  $('menu').open = false;
  if (view !== 'space') destroyScene();
  if (view === 'lab' && !lab) loadLab();
  render();
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
  else if (view === 'dispatcher') { renderThreat(); renderProblemCard(); renderComparison(); renderDecisions(); renderChat(); }
  else if (view === 'workshop') { renderActiveProblems(); renderMap(); renderPostDetail(); renderPostBoard(); }
  else if (view === 'vehicles') renderVehicles();
  else if (view === 'orders') renderOrders();
  else if (view === 'shift') renderShift();
  else if (view === 'video') renderVideo();
  else if (view === 'case') renderCase();
  else renderLab();
  if (key && !document.activeElement?.closest('main')) document.querySelector(key)?.focus({ preventScroll: true });
}
function openVehicle(id) { selectedVehicle = id; chatContext = { type: 'vehicle', id }; if (!filterOf[vehicleFilter](vehicle(id))) vehicleFilter = 'all'; if (location.hash !== '#vehicles') location.hash = 'vehicles'; else render(); requestAnimationFrame(() => $('vehicle-passport').scrollIntoView({ block: 'nearest' })); }
function openPost(id) { selectedPost = id; chatContext = { type: 'post', id }; if (location.hash !== '#workshop') location.hash = 'workshop'; else render(); requestAnimationFrame(() => { if (matchMedia('(max-width: 1499px)').matches) $('post-detail').scrollIntoView({ block: 'nearest' }); }); }
function openProblem(id) { selectedProblem = id; chatContext = { type: 'problem', id }; if (location.hash !== '#dispatcher') location.hash = 'dispatcher'; else render(); requestAnimationFrame(() => $('problem-card').scrollIntoView({ block: 'start' })); }
function openOrder(id) { chatContext = { type: 'order', id }; if (location.hash !== '#orders') location.hash = 'orders'; else render(); requestAnimationFrame(() => document.getElementById(`order-${id}`)?.scrollIntoView({ block: 'start' })); }
function openRef(type, id) {
  if (type === 'vehicle') return openVehicle(id);
  if (type === 'post') return openPost(id);
  if (type === 'order') return openOrder(id);
  if (type === 'problem') return openProblem(id);
  if (type === 'experiment') { const e = state.experiments.find(x => x.id === id); if (e) selectedProblem = e.problemId; if (location.hash !== '#dispatcher') location.hash = 'dispatcher'; else render(); return requestAnimationFrame(() => $('comparison').scrollIntoView({ block: 'start' })); }
  if (type === 'decision') { if (location.hash !== '#dispatcher') location.hash = 'dispatcher'; return requestAnimationFrame(() => $('decision-log').scrollIntoView({ block: 'start' })); }
  if (type === 'job') { const j = state.jobs.find(x => x.id === id); if (j?.problemId) return openProblem(j.problemId); return openPost(j?.postId ?? selectedPost); }
  if (type === 'event') { location.hash = 'shift'; requestAnimationFrame(() => { const el = document.getElementById(`ev-${id}`); if (el) { el.classList.add('highlight'); el.scrollIntoView({ block: 'center' }); } }); }
}

window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
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
$('chat-form').addEventListener('submit', e => { e.preventDefault(); ask($('chat-input').value); });
$('chat-input').addEventListener('input', e => text('chat-count', `${e.target.value.length}/500`));
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); } });
document.addEventListener('click', async e => {
  const t = e.target.closest('button, [role=button]'); if (!t || !state || t.closest('dialog')) return;
  const d = t.dataset;
  if (d.speed) { action({ action: 'speed', value: Number(d.speed) }); return; }
  if (view === 'space' && await spaceClick(t, d)) return;
  if (d.openChat) { location.hash = 'dispatcher'; requestAnimationFrame(() => $('chat-input').focus()); return; }
  if (d.post) { selectedPost = d.post; chatContext = { type: 'post', id: d.post }; render(); return; }
  if (d.postLink) return openPost(d.postLink);
  if (d.vehicle) return openVehicle(d.vehicle);
  if (d.vehicleSelect) { selectedVehicle = d.vehicleSelect; chatContext = { type: 'vehicle', id: d.vehicleSelect }; renderVehicles(); if (matchMedia('(max-width: 1099px)').matches) $('vehicle-passport').scrollIntoView({ block: 'start' }); return; }
  if (d.filter) { vehicleFilter = d.filter; selectedVehicle = null; renderVehicles(); return; }
  if (d.orderLink) return openOrder(d.orderLink);
  if (d.problem) return openProblem(d.problem);
  if (d.navTo) { location.hash = d.navTo; return; }
  if (d.refType) return openRef(d.refType, d.refId);
  if (d.ask) { $('chat-input').value = d.ask; return ask(d.ask); }
  if (d.chatClear) { chatContext = null; renderChat(); return; }
  if (d.chatAbout) { chatContext = { type: d.chatAbout, id: d.chatId }; location.hash = 'dispatcher'; requestAnimationFrame(() => $('chat-input').focus()); return; }
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
