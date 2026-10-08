// ---------- Vehicles ----------
function renderVehicles() {
  $('vehicle-filters').innerHTML = FILTERS.map(([id, name]) => `<button data-filter="${id}" aria-pressed="${vehicleFilter === id}">${name} <span>${state.vehicles.filter(filterOf[id]).length}</span></button>`).join('');
  const list = state.vehicles.filter(filterOf[vehicleFilter]);
  if (!selectedVehicle || !vehicle(selectedVehicle)) selectedVehicle = list[0]?.id ?? state.vehicles[0]?.id;
  $('vehicle-list').innerHTML = list.length ? `<div class="vrow vhead" aria-hidden="true"><span>ID</span><span>Модель · задание</span><span>Статус</span><span>Операция</span></div>` + list.map(v => `<button class="vrow ${esc(v.state)}${selectedVehicle === v.id ? ' selected' : ''}" data-vehicle-select="${esc(v.id)}" aria-pressed="${selectedVehicle === v.id}"><span class="vid">${esc(v.id)}</span><span>${esc(v.modelName)} · ${esc(v.orderId)}${v.priority === 'high' ? ' · ↑' : ''}${v.reworked ? ' · ↺' : ''}</span><span class="vstate">${esc(VEHICLE_STATES[v.state])}</span><span>${v.currentOperation && v.currentOperation.completedAt === null ? `${bar(v.currentOperation.progress)} ${Math.round(v.currentOperation.progress * 100)}%` : esc(v.accepted ? `принят ${clock(v.acceptedAt)}` : '—')}</span></button>`).join('') : '<p class="muted pad">Нет автомобилей с таким статусом.</p>';
  renderPassport();
}
function renderPassport() {
  const v = vehicle(selectedVehicle);
  if (!v) { $('vehicle-passport').innerHTML = '<p class="muted pad">Выберите автомобиль.</p>'; return; }
  const events = state.events.filter(e => e.vehicleId === v.id).reverse();
  $('vehicle-passport').innerHTML = `<div class="detail-head"><div><span class="eyebrow">ПАСПОРТ · СИНТЕТИЧЕСКИЙ ID, НЕ VIN</span><h2>${esc(v.id)}</h2></div><span class="status-pill ${esc(v.state)}">${esc(VEHICLE_STATES[v.state])}</span></div>
  <p class="reason">${esc(v.status)}</p>
  <dl class="facts"><div><dt>Модель</dt><dd>${esc(v.modelName)} (условная)</dd></div><div><dt>Задание</dt><dd>${orderLink(v.orderId)} · приоритет ${PRIORITY[v.priority].toLowerCase()}</dd></div><div><dt>Маршрут</dt><dd>${esc(v.routeVersion)} · создан ${clock(v.createdAt)}${v.startedAt !== null ? ` · запущен ${clock(v.startedAt)}` : ''}</dd></div><div><dt>Контроль</dt><dd>${v.inspections.length ? v.inspections.map(i => `${clock(i.minute)} ${esc(i.postCode)}: ${i.result === 'pass' ? 'принят' : `не пройден — ${esc(i.defect)}`}`).join('; ') : 'ещё не проверялся'}</dd></div><div><dt>Приёмка</dt><dd>${v.accepted ? `принят в ${clock(v.acceptedAt)}${v.reworked ? ' после доработки' : ' с первого предъявления'}${v.shipped ? ` · отгружен ${clock(v.shippedAt)}` : ''}` : 'не принят'}</dd></div></dl>
  <p><button class="link" data-chat-about="vehicle" data-chat-id="${esc(v.id)}">Спросить диспетчера об этом автомобиле</button></p>
  <h3>Маршрут операций</h3>
  <ol class="route">${v.route.map(r => `<li class="${r.status}${r.result === 'fail' ? ' failed' : ''}"><span class="route-dot" aria-hidden="true"></span><div><strong>${esc(r.operation)}</strong><span>${r.status === 'done' ? `выполнено на ${esc(r.postCode)} · ${clock(r.startedAt)}–${clock(r.completedAt)} · ${r.completedAt - r.startedAt} мин${r.result === 'fail' ? ` · не пройден: ${esc(r.defect)}` : r.result === 'pass' ? ' · пройден' : ''}` : r.status === 'current' ? `${esc(r.postCode)} · начато ${clock(r.startedAt)} · ${Math.round(r.progress * 100)}%${v.state === 'paused' ? ' · пауза' : ''}` : `ожидает · норматив ${r.norm} мин`}</span></div></li>`).join('')}</ol>
  <h3>История событий</h3>
  <ol class="history">${events.map(e => `<li><time>${clock(e.minute)}</time><span>${esc(e.text)}</span>${e.actor === 'operator' ? '<em>оператор</em>' : ''}</li>`).join('')}</ol>`;
}
// ---------- Orders ----------
function renderOrders() {
  const left = state.maxVehicles - state.totals.created;
  text('release-note', state.finished ? 'Смена завершена — новые задания недоступны.' : `Можно создать ещё ${left} автомобил${left === 1 ? 'ь' : left > 1 && left < 5 ? 'я' : 'ей'} (лимит демо ${state.maxVehicles} на смену, партия до ${state.maxOrderQuantity}). Новые машины встают во входной буфер; приоритет влияет только на ещё не начатые операции.`);
  $('release-form').querySelector('button[type=submit]').disabled = state.finished || left < 1;
  $('release-quantity').max = String(Math.max(1, Math.min(state.maxOrderQuantity, left)));
  $('order-list').innerHTML = [...state.orders].reverse().map(o => {
    const counts = [['не начаты', o.notStarted], ['в работе', o.inProcess], ['приняты', o.accepted], ['из них отгружены', o.shipped]];
    const late = state.forecast.lateOrders.includes(o.id);
    return `<article class="panel order ${esc(o.state)}" id="order-${esc(o.id)}"><div class="order-head"><div><span class="eyebrow">${esc(ORDER_STATES[o.state].toUpperCase())}${o.overdue ? ' · <b class="negative">СРОК ПРОШЁЛ</b>' : late ? ' · <b class="negative">ПО ПРОГНОЗУ ОПОЗДАЕТ</b>' : ''}</span><h2>${esc(o.id)} · ${esc(state.models.find(m => m.id === o.modelId).name)} × ${o.quantity}</h2></div><span class="order-due">срок ${o.dueMinute > 480 ? 'следующая смена' : clock(o.dueMinute)}<br>выпущено ${clock(o.releasedAt)}</span></div>
    <div class="order-progress">${bar(o.accepted / o.quantity, 'wide')}<strong>${o.accepted}/${o.quantity}</strong> принято</div>
    <p class="order-counts">${counts.map(([k, n]) => `${k}: <b>${n}</b>`).join(' · ')}</p>
    <div class="segmented-buttons" role="group" aria-label="Приоритет ${esc(o.id)}"><span>Приоритет</span>${Object.entries(PRIORITY).map(([id, name]) => `<button data-priority="${id}" data-order="${esc(o.id)}" aria-pressed="${o.priority === id}" ${o.state === 'completed' || state.finished ? 'disabled' : ''}>${name}</button>`).join('')}</div>
    <div class="order-vehicles">${o.vehicleIds.map(id => { const v = vehicle(id); return `<button class="mini ${esc(v.state)}" data-vehicle="${esc(id)}" title="${esc(v.status)}">${esc(id.replace('DEMO-', '#'))} <span>${esc(VEHICLE_STATES[v.state])}</span></button>`; }).join('')}</div></article>`;
  }).join('');
}
