// ---------- Selection and navigation inside spaces ----------
function openPanel(panel, selected, ctx) {
  ui.panel = panel; if (selected !== undefined) ui.selected = selected; if (ctx) chatContext = ctx;
  if (view !== 'space') { location.hash = `space/${['assembly', 'diag'].includes(space) ? space : 'assembly'}`; return; }
  syncHash(); render();
  if (narrow() && scene && ui.selected) { if (ui.selected.type === 'vehicle') scene.focusVehicle(ui.selected.id, 1.6); else if (ui.selected.type === 'post') scene.focusPost(ui.selected.id, 1.6); }
  requestAnimationFrame(() => $('side').querySelector('h2')?.focus?.());
}
const selectVehicle = id => openPanel({ type: 'vehicle', id }, { type: 'vehicle', id }, { type: 'vehicle', id });
const selectPost = id => openPanel({ type: 'post', id }, { type: 'post', id }, { type: 'post', id });
const selectProblem = id => { const p = problem(id); openPanel({ type: 'problem', id }, p ? { type: 'post', id: p.postId } : null, { type: 'problem', id }); };
function closePanel() { ui.panel = null; ui.selected = null; ui.ribbonOnlySelected = false; syncHash(); render(); }
// The address bar follows the open card, so a link can be shared or opened again; replaceState does not fire hashchange.
function syncHash() { if (view !== 'space') return; const p = ui.panel; history.replaceState(null, '', `#space/${space}${p ? `/${p.type}${p.id ? `/${encodeURIComponent(p.id)}` : ''}` : ''}`); }
function goSpace(id) { location.hash = `space/${id}`; }
function openRefSpace(type, id) {
  if (type === 'vehicle') return selectVehicle(id);
  if (type === 'post') return selectPost(id);
  if (type === 'problem') return selectProblem(id);
  if (type === 'order') return openOrder(id);
  if (type === 'experiment') { const e = state.experiments.find(x => x.id === id); if (e) return openPanel({ type: 'compare', id: e.problemId }); return; }
  if (type === 'decision') { const d = state.decisions.find(x => x.id === id); if (d) return selectProblem(d.problemId); return; }
  if (type === 'job') { const j = state.jobs.find(x => x.id === id); if (j?.problemId) return selectProblem(j.problemId); if (j) return selectPost(j.postId); return; }
  if (type === 'event') { const e = state.events.find(x => String(x.seq) === String(id)); if (e) return openEvent(e); }
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
  if (d.openChat) { if (d.ctxType) chatContext = { type: d.ctxType, id: d.ctxId }; else if (ui.selected) chatContext = ui.selected.type === 'vehicle' ? { type: 'vehicle', id: ui.selected.id } : ui.panel?.type === 'problem' ? { type: 'problem', id: ui.panel.id } : { type: 'post', id: ui.selected.id }; ui.panel = { type: 'chat' }; syncHash(); render(); requestAnimationFrame(() => $('side-chat-input')?.focus()); return true; }
  if (d.refType) { openRefSpace(d.refType, d.refId); return true; }
  if (d.ask) { const input = $('side-chat-input'); if (input) input.value = d.ask; ask(d.ask, SIDE_CHAT); return true; }
  if (d.chatClear) { chatContext = null; updateSideChat(); return true; }
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

