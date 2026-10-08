// ---------- Vehicle 3D card: hood, under-hood components, checks, removal and installation ----------
// The card shows and changes the same engine state as the rest of the app: every operation is a server command.
const C3_STATE = { missing: ['warn', 'Отсутствует'], installed: ['idle', 'Установлен · не проверен'], checked: ['ok', 'Проверен'], faulty: ['stop', 'Неисправен'] };
const C3_VIEWS = [['overview', 'Общий'], ['hood', 'Под капотом'], ['wheels', 'Колёса'], ['cabin', 'Салон']];
const c3 = { id: null, viewer: null, loading: false, failed: null, selected: null, busy: null, opening: 0, bodyLoading: false };
const C3_BADGE = '<span class="long">«<a href="https://sketchfab.com/3d-models/kia-sportage-98a84407998a4bc6b4dee912b289f15b" target="_blank" rel="noopener noreferrer">Kia Sportage</a>» — karaman.arman, CC BY 4.0 (Sketchfab); капот вырезан, масштаб и цвет изменены. Условный кузов для всех моделей (Onix, Cobalt, J7 в 3D пока нет); любительская модель, не CAD; узлы под капотом — условные учебные.</span><span class="short">«<a href="https://sketchfab.com/3d-models/kia-sportage-98a84407998a4bc6b4dee912b289f15b" target="_blank" rel="noopener noreferrer">Kia Sportage</a>» — karaman.arman, CC BY 4.0 · не CAD · узлы условные</span>';
const fmtV = x => typeof x === 'number' ? fmt(x, 2) : esc(x);

// The 3D view is an overlay over the current screen; closing it returns to the same screen, filter and scroll.
function openCar3d(id) {
  if (ui.car3d === id) return;
  c3.selected = c3.id === id ? c3.selected : null;
  const fresh = !ui.car3d;
  ui.car3d = id; if (view === 'vehicles') selectedVehicle = id;
  if (fresh) pushHash(currentHash()); else syncHash();
  render();
  requestAnimationFrame(() => $('c3-back')?.focus());
}
function disposeCar3d() { c3.viewer?.dispose(); Object.assign(c3, { id: null, viewer: null, failed: null, selected: null, busy: null }); ++c3.opening; c3.loading = false; $('car3d').hidden = true; $('c3-stage').replaceChildren(); }
function closeCar3d() {
  ui.car3d = null; disposeCar3d();
  if (history.state?.ret) { render(); history.back(); return; }
  syncHash(); render();
}
async function ensureViewer(v) {
  if (c3.id === v.id && (c3.viewer || c3.loading || c3.failed)) return;
  c3.viewer?.dispose(); Object.assign(c3, { id: v.id, viewer: null, failed: null, loading: true });
  const token = ++c3.opening, stage = $('c3-stage');
  stage.replaceChildren();
  renderCar3d();
  try {
    const mod = await import('./viewer3d.js'); // the heavy 3D code is loaded only when a car card is opened
    if (token !== c3.opening) return;
    if (!mod.webglAvailable()) throw new Error('WebGL недоступен');
    c3.viewer = mod.createCarViewer(stage, { modelId: v.modelId, onPick: pick });
    c3.viewer.setComponents(vehicle(v.id)?.components);
    if (c3.selected) c3.viewer.select(c3.selected, { focus: false });
    c3.bodyLoading = true;
    c3.viewer.ready.then(() => { if (token === c3.opening) { c3.bodyLoading = false; renderCar3d(); } });
  } catch (e) { if (token === c3.opening) c3.failed = e.message || 'ошибка загрузки'; }
  finally { if (token === c3.opening) { c3.loading = false; renderCar3d(); } }
}
function pick({ componentId, hood }) {
  if (hood) { c3.viewer?.setHood(!c3.viewer.isHoodOpen()); renderCar3d(); return; }
  if (componentId) { c3.selected = componentId; ui.cardOpen['c3:parts'] = true; c3.viewer?.select(componentId); renderCar3d(); }
}

function renderCar3d() {
  const box = $('car3d'), v = ui.car3d ? vehicle(ui.car3d) : null;
  if (!v) { if (!box.hidden || c3.loading || c3.viewer) { ++c3.opening; c3.loading = false; c3.viewer?.dispose(); c3.viewer = null; c3.id = null; box.hidden = true; $('c3-stage').replaceChildren(); } return; }
  box.hidden = false;
  if (c3.id !== v.id) { ensureViewer(v); return; }
  c3.viewer?.setComponents(v.components);
  const ops = v.atDiagPost && !state.finished, assembled = v.components.some(c => c.state !== 'missing');
  text('c3-title', v.id);
  $('c3-sub').innerHTML = `${esc(v.modelName)} · ${esc(v.orderId)} · ${ico(VEHICLE_KIND(v), v.status)}`;
  $('c3-hood').textContent = c3.viewer?.isHoodOpen() ? 'Закрыть капот' : 'Открыть капот';
  const hasBody = Boolean(c3.viewer?.hasBody());
  $('c3-hood').disabled = !hasBody;
  for (const b of document.querySelectorAll('#car3d [data-c3view]')) b.disabled = !c3.viewer;
  $('c3-badge').innerHTML = C3_BADGE;
  $('c3-status').innerHTML = c3.loading ? '<p class="c3-msg">Загрузка 3D-модели…</p>' : c3.failed ? `<p class="c3-msg err">3D-просмотр недоступен (${esc(c3.failed)}). Узлы и операции доступны в панели справа.</p>` : c3.bodyLoading ? '<p class="c3-msg">Загрузка кузова Kia Sportage (≈21 МБ)…</p>' : c3.viewer?.bodyError() ? `<p class="c3-msg err">Кузов Kia Sportage не загружен: ${esc(c3.viewer.bodyError())}. Показаны только узлы.</p>` : '';

  text('c3-back', `← ${returnLabel()}`);
  const panel = $('c3-panel'), scroll = panel.scrollTop;
  panel.innerHTML = vehicleCard(v, 'c3'); panel.scrollTop = scroll;
}
// Under-hood components of the 3D view; availability and its reason come from the server for every operation.
function partsBody(v) {
  const sel = v.components.find(c => c.id === c3.selected), assembled = v.components.some(c => c.state !== 'missing');
  let html = assembled ? '' : `<p class="c3-note">${ico('idle', '')} Сборка ещё не завершена: узлы под капотом пока не установлены.</p>`;
  html += `<ul class="c3-parts">${v.components.map(c => { const [k, t] = C3_STATE[c.state]; return `<li><button class="c3-part${c.id === c3.selected ? ' sel' : ''}" data-c3part="${c.id}" aria-pressed="${c.id === c3.selected}"><span>${esc(c.name)}</span>${ico(k, t)}</button></li>`; }).join('')}</ul>`;
  if (!sel) return html + '<p class="muted">Выберите узел в списке или на модели (капот откроется сам).</p>';
  const [k, t] = C3_STATE[sel.state], off = { ok: false, reason: 'Операции с узлами — только на посту ДР-1 при диагностике запуска' }, act = sel.actions ?? { check: off, remove: off, install: off };
  html += `<section class="c3-node"><div class="c3-node-head"><b>${esc(sel.name)}</b>${ico(k, t)}</div>`;
  if (sel.lastCheck) html += `<p>${sel.lastCheck.measurements.map(m => `${esc(m.name)}: <b>${fmtV(m.value)}${m.unit ? ` ${esc(m.unit)}` : ''}</b>${m.norm ? ` <span class="muted">(норма ${esc(m.norm)})</span>` : ''}`).join('<br>')}</p><p>${esc(sel.lastCheck.text)}</p>`;
  else if (sel.state === 'installed') html += '<p class="muted">После установки узел ещё не проверялся.</p>';
  else if (sel.state === 'missing') html += `<p class="muted">${sel.removedScrapped ? 'Неисправный узел снят и списан. Установите исправный со склада.' : 'Узел снят. Его можно установить обратно.'}</p>`;
  html += `<div class="ops">${opRow(v, 'component_check', sel.id, 'Проверить', act.check)}${sel.removable ? opRow(v, 'component_remove', sel.id, 'Снять', act.remove) + opRow(v, 'component_install', sel.id, 'Установить', act.install) : '<p class="why">Снятие этого узла в учебной симуляции не предусмотрено — только проверка.</p>'}</div>`;
  if (sel.id === 'battery') html += `<p class="fine-print">Склад: ${esc(state.stock.find(s => s.id === 'battery')?.name ?? 'аккумулятор')} — ${state.stock.find(s => s.id === 'battery')?.available ?? 0} шт.</p>`;
  return html + '</section>';
}
function car3dClick(d) {
  if (d.c3close) { closeCar3d(); return true; }
  if (d.c3view) { c3.viewer?.view(d.c3view).then(renderCar3d); renderCar3d(); return true; }
  if (d.c3hood) { c3.viewer?.setHood(!c3.viewer.isHoodOpen()).then(renderCar3d); renderCar3d(); return true; }
  if (d.c3reset) { c3.viewer?.resetCamera(); return true; }
  if (d.c3part) { c3.selected = d.c3part; c3.viewer?.select(d.c3part); renderCar3d(); return true; }
  if (d.car3d) { openCar3d(d.car3d); return true; }
  return false;
}
