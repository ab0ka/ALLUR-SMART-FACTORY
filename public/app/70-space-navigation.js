// ---------- Cards, selection and history on every screen ----------
// Address: #<screen>[/<vehicle|post|problem|compare|chat|car3d>/<id>], where <screen> is a view or space/<shop>.
// Keep the return stack; chat transitions retain their own object and focus in history.
function currentHash() {
  const p = ui.car3d ? { type: 'car3d', id: ui.car3d } : ui.panel;
  let tail = '';
  if (p) { const id = p.type === 'chat' ? (chatContext ? `${chatContext.type}:${chatContext.id}` : '') : p.id; tail = `/${p.type}${id ? `/${encodeURIComponent(id)}` : ''}`; }
  else if (ui.routeRef) tail = `/${ui.routeRef.type}/${encodeURIComponent(ui.routeRef.id)}`;
  else if (view === 'vehicles' && selectedVehicle) tail = `/vehicle/${encodeURIComponent(selectedVehicle)}`;
  return baseHash() + tail;
}
function syncHash() { const h = `#${currentHash()}`; if (location.hash !== h) history.replaceState(history.state, '', h); }
function showPanel(panel) {
  const fresh = !ui.panel && !ui.car3d, chatStep = ui.panel?.type === 'chat' || panel.type === 'chat';
  ui.car3d = null; ui.panel = panel; ui.routeRef = null;
  if ((fresh || chatStep) && location.hash !== `#${currentHash()}`) pushHash(currentHash()); else syncHash();
  render();
}
function openPanel(panel, selected, ctx) {
  if (selected !== undefined) ui.selected = selected;
  if (ctx !== undefined) setChatContext(ctx);
  showPanel(panel);
  if (view === 'space' && narrow() && scene && ui.selected) { if (ui.selected.type === 'vehicle') scene.focusVehicle(ui.selected.id, 1.6); else if (ui.selected.type === 'post') scene.focusPost(ui.selected.id, 1.6); }
  requestAnimationFrame(() => { const heading = $('side').querySelector('h2'); if (heading) { heading.tabIndex = -1; heading.focus(); } });
}
const selectVehicle = id => openPanel({ type: 'vehicle', id }, { type: 'vehicle', id }, { type: 'vehicle', id });
const selectPost = id => openPanel({ type: 'post', id }, { type: 'post', id }, { type: 'post', id });
const selectProblem = id => { const p = problem(id); openPanel({ type: 'problem', id }, p ? { type: 'post', id: p.postId } : null, { type: 'problem', id }); };
function closePanel() {
  ui.panel = null; ui.selected = null; ui.ribbonOnlySelected = false;
  if (history.state?.ret) { render(); history.back(); return; }
  setChatContext(null); syncHash(); render(); restoreNavigationFocus(true);
}
function selectInList(id) {
  selectedVehicle = id; setChatContext({ type: 'vehicle', id });
  if (!filterOf[vehicleFilter](vehicle(id))) vehicleFilter = 'all';
  syncHash(); renderVehicles();
  if (matchMedia('(max-width: 1099px)').matches) $('vehicle-passport').scrollIntoView({ block: 'start' });
}
// One entry point for an object reference: a click on the map, a list row, a task, an event or a chat link.
function openCard(type, id) {
  const ctx = validChatContext(type, id);
  if (!ctx) { error('Объект не найден'); return; }
  id = ctx.id;
  if (type === 'vehicle') return view === 'vehicles' ? (ui.panel || ui.car3d ? navPush(`vehicles/vehicle/${encodeURIComponent(id)}`) : selectInList(id)) : selectVehicle(id);
  if (type === 'post') return selectPost(id);
  if (type === 'problem') return selectProblem(id);
  if (type === 'order') return openOrder(id);
}
function openOrder(id) {
  const ctx = validChatContext('order', id);
  if (!ctx) { error('Объект не найден'); return; }
  navPush(`orders/order/${encodeURIComponent(ctx.id)}`);
}
function goSpace(id) { location.hash = `space/${id}`; }
function openRef(type, id) {
  if (['vehicle', 'post', 'problem', 'order'].includes(type)) return openCard(type, id);
  if (type === 'experiment') { const e = state.experiments.find(x => x.id === id); if (e) openPanel({ type: 'compare', id: e.problemId }, null, { type: 'problem', id: e.problemId }); return; }
  if (type === 'decision') { const d = state.decisions.find(x => x.id === id); if (d) navPush(`dispatcher/decision/${encodeURIComponent(id)}`); return; }
  if (type === 'job') { const j = state.jobs.find(x => x.id === id); if (j?.problemId) return selectProblem(j.problemId); if (j) return openCard('post', j.postId); return; }
  if (type === 'task') return openTask(id);
  if (type === 'event') { const e = state.events.find(x => String(x.seq) === String(id)); if (e) navPush(`${view === 'space' ? baseHash() : `space/${space}`}/event/${encodeURIComponent(id)}`); }
}
function openEvent(e) {
  if (e.problemId && ['problem_detected', 'problem_resolved', 'decision_applied', 'check_completed', 'verify_completed'].includes(e.type)) return selectProblem(e.problemId);
  if (e.vehicleId) return openCard('vehicle', e.vehicleId);
  if (e.problemId) return selectProblem(e.problemId);
  if (e.postId) return openCard('post', e.postId);
}
// The chat takes the object the user is looking at; a different object is announced in the chat.
function currentObjectCtx() {
  if (ui.car3d) return validChatContext('vehicle', ui.car3d);
  const p = ui.panel;
  if (p?.type === 'chat') return chatContext && validChatContext(chatContext.type, chatContext.id);
  if (p) return validChatContext(p.type === 'compare' ? 'problem' : p.type, p.id);
  if (ui.routeRef?.type === 'order') return validChatContext('order', ui.routeRef.id);
  if (ui.routeRef?.type === 'decision') return recordChatContext(state.decisions.find(x => x.id === ui.routeRef.id));
  if (ui.routeRef?.type === 'event') return recordChatContext(state.events.find(x => String(x.seq) === ui.routeRef.id));
  if (view === 'vehicles' && selectedVehicle) return validChatContext('vehicle', selectedVehicle);
  if (view === 'dispatcher' && currentTask) { const t = state.tasks.find(x => x.id === currentTask); if (t) return validChatContext(t.object.type, t.object.id); }
  return null;
}
function openChat(d) {
  const ctx = d.ctxType ? { type: d.ctxType, id: d.ctxId } : currentObjectCtx();
  setChatContext(ctx);
  showPanel({ type: 'chat' });
  requestAnimationFrame(() => $('side-chat-input')?.focus());
}
// Clicks that only exist inside shops (scene, camera, ribbon). Returns true when handled.
function spaceClick(d) {
  if (d.mode) { ui.table = d.mode === 'table'; render(); return true; }
  if (d.cam) { if (scene) { if (d.cam === 'home') scene.home(); else scene.zoom(d.cam === 'in' ? 1.2 : 1 / 1.2); } return true; }
  if (d.space) { goSpace(d.space); return true; }
  if (d.ribbon) { if (d.ribbon === 'open') ui.ribbonOpen = true; else if (d.ribbon === 'close') ui.ribbonOpen = false; else ui.ribbonOnlySelected = !ui.ribbonOnlySelected; renderRibbon(); return true; }
  if (d.table) { ui.table = true; render(); return true; }
  return false;
}
// Clicks shared by all screens: cards, 3D, chat, tasks and vehicle operations.
async function cardClick(d) {
  if (car3dClick(d)) return true;
  if (d.closePanel) { closePanel(); return true; }
  if (d.back) { if (ui.panel) closePanel(); else navBack(); return true; }
  if (d.vop) { vehicleOp(d.vid, d.vop, d.comp); return true; }
  if (d.histAll !== undefined) { ui.histAll = d.histAll || null; render(); return true; }
  if (d.fullCard) { selectedVehicle = d.fullCard; vehicleFilter = filterOf[vehicleFilter](vehicle(d.fullCard)) ? vehicleFilter : 'all'; navPush(`vehicles/vehicle/${encodeURIComponent(d.fullCard)}`); return true; }
  if (d.showInShop) { const v = vehicle(d.showInShop); if (v) navPush(`space/${vehicleShop(v) === 'enterprise' ? 'weld' : vehicleShop(v)}/vehicle/${encodeURIComponent(v.id)}`); return true; }
  if (d.event) { const e = state.events.find(x => String(x.seq) === d.event); if (e) openEvent(e); return true; }
  if (d.vehicleSelect) { selectInList(d.vehicleSelect); return true; }
  if (d.vehicle) { openCard('vehicle', d.vehicle); return true; }
  if (d.post || d.postLink) { openCard('post', d.post || d.postLink); return true; }
  if (d.problem) { selectProblem(d.problem); return true; }
  if (d.orderLink) { openOrder(d.orderLink); return true; }
  if (d.task) { openTask(d.task); return true; }
  if (d.taskFilter) { taskFilter = d.taskFilter; renderTasks(); return true; }
  if (d.openChat) { openChat(d); return true; }
  if (d.refType) { openRef(d.refType, d.refId); return true; }
  if (d.ask) { const input = $('side-chat-input'); if (input) input.value = d.ask; ask(d.ask); return true; }
  if (d.chatClear) { setChatContext(null); chatPrevContext = null; showPanel({ type: 'chat' }); return true; }
  if (d.chatRestore) { const prev = chatPrevContext; setChatContext(prev); chatPrevContext = null; showPanel({ type: 'chat' }); return true; }
  if (d.chatOk) { chatPrevContext = null; updateSideChat(); return true; }
  if (d.applyChoice) { const id = ui.choice[d.applyChoice]; if (id) await applyDecision(d.applyChoice, id); return true; }
  return false;
}

// Camera: drag to pan, wheel to zoom, keyboard activation of scene objects.
let drag = null, suppressClick = false;
$('scene-wrap').addEventListener('pointerdown', e => { if (e.button !== 0 || !scene) return; drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; });
$('scene-wrap').addEventListener('pointermove', e => {
  if (!drag || !scene) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) { drag.moved = true; $('scene-wrap').setPointerCapture(drag.id); $('scene-wrap').classList.add('dragging'); }
  const k = 1000 / Math.max(1, $('scene').clientWidth);
  scene.pan(dx * k, dy * k); drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = () => { if (drag?.moved) suppressClick = true; drag = null; $('scene-wrap').classList.remove('dragging'); };
$('scene-wrap').addEventListener('pointerup', endDrag); $('scene-wrap').addEventListener('pointercancel', endDrag);
$('scene-wrap').addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
$('scene-wrap').addEventListener('wheel', e => { if (!scene) return; e.preventDefault(); scene.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
for (const id of ['scene', 'enterprise']) $(id).addEventListener('keydown', e => { const t = e.target.closest?.('[role=button]'); if ((e.key === 'Enter' || e.key === ' ') && t) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
// Keep the overview framed when the window is resized, unless the user moved the camera.
addEventListener('resize', () => { if (scene?.atHome && !narrow()) scene.home(); });
$('diag-toggle').addEventListener('change', e => { ui.diag = e.target.checked; render(); });
document.addEventListener('change', e => { const c = e.target.dataset?.choice; if (c) { ui.choice[c] = e.target.value; renderSide(); } });
document.addEventListener('submit', e => { if (e.target.id === 'side-chat-form') { e.preventDefault(); ask($('side-chat-input').value); } });
document.addEventListener('input', e => { if (e.target.id === 'side-chat-input') { chatDraft = e.target.value; chatDraftVersion++; text('side-chat-count', `${e.target.value.length}/500`); } });
document.addEventListener('keydown', e => {
  if (e.target.id === 'side-chat-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || $('confirm').open) return;
  if (e.key === 'Escape') { if ($('menu').open) { $('menu').open = false; return; } if (ui.car3d) { closeCar3d(); return; } if (ui.panel) closePanel(); else backFromReference(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (ui.car3d) return; // keyboard shortcuts of the shop scene are off while the 3D view is open
  if (view !== 'space') return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= 6) { goSpace(SPACE_KEYS[n - 1]); return; }
  if (e.key === '0') { scene?.home(); return; }
  if (e.key === '+' || e.key === '=') { scene?.zoom(1.2); return; }
  if (e.key === '-') { scene?.zoom(1 / 1.2); return; }
  if (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'е') { ui.table = !ui.table; render(); }
});
