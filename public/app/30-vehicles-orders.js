// ---------- Vehicles ----------
function renderVehicles() {
  $('vehicle-filters').innerHTML = FILTERS.map(([id, name]) => `<button data-filter="${id}" aria-pressed="${vehicleFilter === id}">${name} <span>${state.vehicles.filter(filterOf[id]).length}</span></button>`).join('');
  const list = state.vehicles.filter(filterOf[vehicleFilter]);
  if (!selectedVehicle || !vehicle(selectedVehicle)) selectedVehicle = list[0]?.id ?? state.vehicles[0]?.id;
  $('vehicle-list').innerHTML = list.length ? `<div class="vrow vhead" aria-hidden="true"><span>ID</span><span>Модель · задание</span><span>Статус</span><span>Операция</span></div>` + list.map(v => `<button class="vrow ${esc(v.state)}${selectedVehicle === v.id ? ' selected' : ''}" data-vehicle-select="${esc(v.id)}" aria-pressed="${selectedVehicle === v.id}"><span class="vid">${esc(v.id)}</span><span>${esc(v.modelName)} · ${esc(v.orderId)}${v.priority === 'high' ? ' · ↑' : ''}${v.reworked ? ' · ↺' : ''}</span><span class="vstate">${esc(VEHICLE_STATES[v.state])}</span><span>${v.currentOperation && v.currentOperation.completedAt === null ? `${bar(v.currentOperation.progress)} ${Math.round(v.currentOperation.progress * 100)}%` : esc(v.accepted ? `принят ${clock(v.acceptedAt)}` : '—')}</span></button>`).join('') : '<p class="muted pad">Нет автомобилей с таким статусом.</p>';
  renderPassport();
}
// The full mode of the same vehicle card that opens from the map, tasks, events and the 3D view.
function renderPassport() {
  const v = vehicle(selectedVehicle), box = $('vehicle-passport');
  if (!v) { box.innerHTML = '<p class="muted pad">Выберите автомобиль.</p>'; return; }
  const scroll = box.scrollTop; box.innerHTML = vehicleFull(v); box.scrollTop = scroll;
}
// ---------- Orders ----------
let ordersFilter = 'all';
const ORDERS_FILTERS = [['all', 'Все'], ['active', 'В работе'], ['risk', 'Под угрозой срока'], ['completed', 'Выполнены']];
function ordersAtRisk(o) { return o.state !== 'completed' && (o.overdue || state.forecast.lateOrders.includes(o.id) || (state.finished && o.dueMinute <= state.elapsed)); }
function ordersMatch(o, filter) { return filter === 'all' || (filter === 'active' && o.state === 'in_progress') || (filter === 'risk' && ordersAtRisk(o)) || (filter === 'completed' && o.state === 'completed'); }
// Reveal an explicitly referenced order before the shared PR45 navigation scrolls to it.
document.addEventListener('click', e => {
  const link = e.target.closest('[data-order-link], [data-ref-type="order"]');
  const id = link?.dataset.orderLink || link?.dataset.refId;
  const order = state?.orders.find(o => o.id === id);
  if (order && !ordersMatch(order, ordersFilter)) {
    ordersFilter = 'all';
    if (view === 'orders') renderOrders();
  }
});
$('orders-filters').addEventListener('click', e => {
  const button = e.target.closest('[data-orders-filter]');
  if (!button) return;
  ordersFilter = button.dataset.ordersFilter; renderOrders();
  $('orders-filters').querySelector(`[data-orders-filter="${ordersFilter}"]`).focus();
});
function renderOrders() {
  $('orders-filters').innerHTML = ORDERS_FILTERS.map(([key, label]) => `<button data-orders-filter="${key}" aria-pressed="${ordersFilter === key}">${label} <span>${state.orders.filter(o => ordersMatch(o, key)).length}</span></button>`).join('');
  const visible = state.orders.filter(o => ordersMatch(o, ordersFilter));
  text('orders-result', `Заданий: ${visible.length} из ${state.orders.length}`);
  const left = state.maxVehicles - state.totals.created;
  text('release-note', state.finished ? 'Смена завершена — новые задания недоступны.' : `Можно создать ещё ${left} автомобил${left === 1 ? 'ь' : left > 1 && left < 5 ? 'я' : 'ей'} (лимит демо ${state.maxVehicles} на смену, партия до ${state.maxOrderQuantity}). Новые машины встают во входной буфер; приоритет влияет только на ещё не начатые операции.`);
  $('release-form').querySelector('button[type=submit]').disabled = state.finished || left < 1;
  $('release-quantity').max = String(Math.max(1, Math.min(state.maxOrderQuantity, left)));
  $('order-list').innerHTML = [...visible].reverse().map(o => {
    const counts = [['не начаты', o.notStarted], ['в работе', o.inProcess], ['приняты', o.accepted], ['из них отгружены', o.shipped]];
    const completedLate = o.state === 'completed' && o.vehicleIds.some(id => vehicle(id).acceptedAt > o.dueMinute);
    const missedAtEnd = state.finished && o.accepted < o.quantity && o.dueMinute <= state.elapsed;
    const late = !state.finished && o.state !== 'completed' && state.forecast.lateOrders.includes(o.id);
    const deadline = completedLate ? 'ВЫПОЛНЕНО С ОПОЗДАНИЕМ' : missedAtEnd ? 'СРОК НЕ ВЫПОЛНЕН' : o.overdue ? 'СРОК ПРОШЁЛ' : late ? 'ПО ПРОГНОЗУ ОПОЗДАЕТ' : '';
    return `<article class="panel order ${esc(o.state)}" id="order-${esc(o.id)}"><div class="order-head"><div><span class="eyebrow">${o.state === 'completed' ? '✓' : o.state === 'in_progress' ? '↻' : '○'} ${esc(ORDER_STATES[o.state].toUpperCase())}${deadline ? ` · <b class="negative">⚠ ${deadline}</b>` : ''}</span><h2>${esc(o.id)} · ${esc(state.models.find(m => m.id === o.modelId).name)} × ${o.quantity}</h2></div><span class="order-due">срок ${o.dueMinute > 480 ? 'следующая смена' : clock(o.dueMinute)}<br>выпущено ${clock(o.releasedAt)}</span></div>
    <div class="order-progress">${bar(o.accepted / o.quantity, 'wide')}<strong>${o.accepted}/${o.quantity}</strong> принято</div>
    <dl class="orders-counts">${counts.map(([k, n]) => `<div><dt>${k}</dt><dd>${n}</dd></div>`).join('')}</dl>
    <div class="segmented-buttons" role="group" aria-label="Приоритет ${esc(o.id)}"><span>Приоритет</span>${Object.entries(PRIORITY).map(([id, name]) => `<button data-priority="${id}" data-order="${esc(o.id)}" aria-pressed="${o.priority === id}" ${o.state === 'completed' || state.finished ? 'disabled' : ''}>${name}</button>`).join('')}</div>
    <div class="order-vehicles">${o.vehicleIds.map(id => { const v = vehicle(id); return `<button class="mini ${esc(v.state)}" data-show-in-shop="${esc(id)}" title="${esc(v.status)}">${esc(id.replace('DEMO-', '#'))} <span>${esc(VEHICLE_STATES[v.state])}</span></button>`; }).join('')}</div></article>`;
  }).join('') || '<p class="orders-empty">Нет заданий по выбранному фильтру.</p>';
}
