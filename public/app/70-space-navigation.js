// ---------- Selection and navigation inside spaces ----------
function openPanel(panel, selected, ctx) {
  ui.panel = panel; if (selected !== undefined) ui.selected = selected; if (ctx !== undefined) chatContext = ctx;
  if (view !== 'space') { location.hash = panelHash(); return; }
  syncHash(); render();
  if (narrow() && scene && ui.selected) { if (ui.selected.type === 'vehicle') scene.focusVehicle(ui.selected.id, 1.6); else if (ui.selected.type === 'post') scene.focusPost(ui.selected.id, 1.6); }
  requestAnimationFrame(() => $('side').querySelector('h2')?.focus?.());
}
const selectVehicle = id => openPanel({ type: 'vehicle', id }, { type: 'vehicle', id }, { type: 'vehicle', id });
const selectPost = id => openPanel({ type: 'post', id }, { type: 'post', id }, { type: 'post', id });
const selectProblem = id => { const p = problem(id); openPanel({ type: 'problem', id }, p ? { type: 'post', id: p.postId } : null, { type: 'problem', id }); };
function closePanel() { ui.panel = null; ui.selected = null; chatContext = null; ui.ribbonOnlySelected = false; syncHash(); render(); }
// Card navigation gets a history entry; pushState avoids rerendering the same card via hashchange.
function panelHash() {
  const p = ui.panel;
  const suffix = p?.type === 'chat' && chatContext ? `/${chatContext.type}/${encodeURIComponent(chatContext.id)}` : p?.id ? `/${encodeURIComponent(p.id)}` : '';
  return `space/${space}${p ? `/${p.type}${suffix}` : ''}`;
}
function syncHash() { const hash = `#${panelHash()}`; if (view === 'space' && location.hash !== hash) history.pushState(null, '', hash); }
function goSpace(id) { location.hash = `space/${id}`; }
function openRefSpace(type, id) {
  if (type === 'vehicle') return selectVehicle(id);
  if (type === 'post') return selectPost(id);
  if (type === 'problem') return selectProblem(id);
  if (type === 'order') return openOrder(id);
  if (['experiment', 'decision', 'job', 'event'].includes(type)) {
    const collection = { experiment: state.experiments, decision: state.decisions, job: state.jobs, event: state.events }[type];
    const item = collection.find(x => String(type === 'event' ? x.seq : x.id) === String(id));
    if (item) openPanel({ type, id }, null, referenceContext(item));
  }
}
function validChatContext(type, id) {
  const rows = { vehicle: state.vehicles, post: state.posts, problem: state.problems, order: state.orders };
  return Object.hasOwn(rows, type) && rows[type].some(x => x.id === id) ? { type, id } : null;
}
function panelChatContext(panel) {
  if (!panel) return null;
  if (panel.type === 'chat') return chatContext && validChatContext(chatContext.type, chatContext.id);
  const rows = { experiment: state.experiments, decision: state.decisions, job: state.jobs, event: state.events };
  if (Object.hasOwn(rows, panel.type)) return referenceContext(rows[panel.type].find(x => String(panel.type === 'event' ? x.seq : x.id) === panel.id));
  return validChatContext(panel.type === 'compare' ? 'problem' : panel.type, panel.id);
}
function referenceContext(item) {
  for (const type of ['problem', 'vehicle', 'post']) if (item?.[`${type}Id`]) return validChatContext(type, item[`${type}Id`]);
  return null;
}
function openEvent(e) {
  if (e.problemId && ['problem_detected', 'problem_resolved', 'decision_applied', 'check_completed', 'verify_completed'].includes(e.type)) return selectProblem(e.problemId);
  if (e.vehicleId) return selectVehicle(e.vehicleId);
  if (e.problemId) return selectProblem(e.problemId);
  if (e.postId) return selectPost(e.postId);
}
// Returns true when the click was handled by the space UI.
async function spaceClick(t, d) {
  if (d.closePanel) { closePanel(); return true; }
  if (d.mode) { ui.table = d.mode === 'table'; render(); return true; }
  if (d.cam) { if (scene) { if (d.cam === 'home') scene.home(); else scene.zoom(d.cam === 'in' ? 1.2 : 1 / 1.2); } return true; }
  if (d.space) { goSpace(d.space); return true; }
  if (d.ribbon) { if (d.ribbon === 'open') ui.ribbonOpen = true; else if (d.ribbon === 'close') ui.ribbonOpen = false; else ui.ribbonOnlySelected = !ui.ribbonOnlySelected; renderRibbon(); return true; }
  if (d.event) { const e = state.events.find(x => String(x.seq) === d.event); if (e) openEvent(e); return true; }
  if (d.vehicle || d.vehicleSelect) { selectVehicle(d.vehicle || d.vehicleSelect); return true; }
  if (d.post || d.postLink) { selectPost(d.post || d.postLink); return true; }
  if (d.problem) { selectProblem(d.problem); return true; }
  if (d.table) { ui.table = true; render(); return true; }
  if (d.openChat) { chatContext = d.ctxType ? validChatContext(d.ctxType, d.ctxId) : panelChatContext(ui.panel); ui.panel = { type: 'chat' }; syncHash(); render(); requestAnimationFrame(() => $('side-chat-input')?.focus()); return true; }
  if (d.refType) { openRefSpace(d.refType, d.refId); return true; }
  if (d.ask) { const input = $('side-chat-input'); if (input) input.value = d.ask; ask(d.ask, SIDE_CHAT); return true; }
  if (d.chatClear) { chatContext = null; ui.selected = null; syncHash(); updateSideChat(); return true; }
  if (d.applyChoice) { const id = ui.choice[d.applyChoice]; if (id) await applyDecision(d.applyChoice, id); return true; }
  if (d.legacy) { if (d.legacy === 'vehicles') openVehicle(d.legacyId); else if (d.legacy === 'dispatcher') openProblem(d.legacyId); return true; }
  return false;
}
const SIDE_CHAT = { input: 'side-chat-input', send: 'side-chat-send', count: 'side-chat-count' };

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
$('diag-toggle').addEventListener('change', e => { ui.diag = e.target.checked; render(); });
document.addEventListener('change', e => { const c = e.target.dataset?.choice; if (c) { ui.choice[c] = e.target.value; renderSide(); } });
document.addEventListener('submit', e => { if (e.target.id === 'side-chat-form') { e.preventDefault(); ask($('side-chat-input').value, SIDE_CHAT); } });
document.addEventListener('input', e => { if (e.target.id === 'side-chat-input') text('side-chat-count', `${e.target.value.length}/500`); });
document.addEventListener('keydown', e => {
  if (e.target.id === 'side-chat-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value, SIDE_CHAT); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || $('confirm').open || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Escape') { if ($('menu').open) { $('menu').open = false; return; } if (view === 'space' && ui.panel) { closePanel(); } return; }
  if (view !== 'space') return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= 6) { goSpace(SPACE_KEYS[n - 1]); return; }
  if (e.key === '0') { scene?.home(); return; }
  if (e.key === '+' || e.key === '=') { scene?.zoom(1.2); return; }
  if (e.key === '-') { scene?.zoom(1 / 1.2); return; }
  if (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'е') { ui.table = !ui.table; render(); }
});

