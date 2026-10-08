// ---------- One vehicle card for the map, the vehicle list, tasks, events and the 3D view ----------
// The same renderer and the same operation handler everywhere; the server decides the next action and whether an
// operation is allowed (with a reason). The card only shows the snapshot and sends confirmed commands.
const SHOP_OF_STAGE = { weld: 'weld', paint: 'paint', assembly: 'assembly', quality: 'tests', rework: 'rework', shipping: 'ship' };
const SHOP_OF_BUFFER = { BACKLOG: 'weld', B1: 'paint', B2: 'assembly', B3: 'tests', FG: 'ship', RWQ: 'rework' };
const NA_ICON = { op: 'check', wait: 'wait', navigate: 'stop', none: 'ok' };
const NA_LABEL = { op: 'нужно действие', wait: 'ожидание', navigate: 'ждёт ремонта поста', none: 'действий не требуется' };
const OP_LABEL = { component_check: 'Проверить', component_remove: 'Снять', component_install: 'Установить', start_test: 'Проверка запуска', door_measure: 'Измерить зазор', door_adjust: 'Отрегулировать дверь' };
const CONFIRM_OPS = new Set(['component_remove', 'component_install', 'start_test', 'door_adjust']);
const STEP_ICON = { done: 'ok', current: 'check', todo: 'idle' };
const bufferName = id => id === 'RWQ' ? state.rework.buffer.name : state.stages.find(s => s.buffer.id === id)?.buffer.name ?? id;
function vehicleShop(v) { if (v.shipped) return 'ship'; return v.location.type === 'post' ? SHOP_OF_STAGE[post(v.location.id).stage] : SHOP_OF_BUFFER[v.location.id] ?? 'enterprise'; }
function vehicleWhere(v) {
  if (v.shipped) return 'Отгружен';
  const shop = SPACES[vehicleShop(v)]?.short ?? '';
  return v.location.type === 'post' ? `${shop} · пост ${post(v.location.id).code}` : `${shop} · ${bufferName(v.location.id)}`;
}

// ---------- Navigation that remembers where the user came from ----------
const VIEW_RETURN = { vehicles: 'К списку автомобилей', dispatcher: 'К задачам смены', orders: 'К заданиям', shift: 'К результатам смены', lab: 'К моделям', workshop: 'К 2D-схеме', handover: 'К передаче смены' };
function labelForHash(h) {
  const parts = (h || '').split('/'), [n, a] = parts, [type, id] = n === 'space' ? parts.slice(2) : parts.slice(1);
  let oid = ''; try { oid = id ? decodeURIComponent(id) : ''; } catch { /* A malformed origin still has a safe return label. */ }
  if (type === 'vehicle' && n !== 'vehicles') return `К карточке ${oid}`;
  if (type === 'problem' || type === 'compare') return `К ${oid}`;
  if (type === 'post') return `К посту ${post(oid)?.code ?? oid}`;
  if (n === 'space') return a === 'enterprise' ? 'К карте предприятия' : `К цеху «${SPACES[a]?.short ?? 'Сборка'}»`;
  return VIEW_RETURN[n] ?? 'Назад';
}
const baseHash = () => view === 'space' ? `space/${space}` : view;
const returnLabel = () => history.state?.ret?.label ?? labelForHash(baseHash());
function captureScroll() { return { win: scrollY, list: $('vehicle-list')?.scrollTop ?? 0 }; }
function restoreScroll(sc) { if (!sc) return; requestAnimationFrame(() => { scrollTo(0, sc.win); if ($('vehicle-list')) $('vehicle-list').scrollTop = sc.list; }); }
function navigationFocusKey(el = document.activeElement) {
  if (!el || el === document.body) return null;
  if (el.dataset?.focusKey) {
    const root = el.closest('.view[id]');
    return `${root ? `#${CSS.escape(root.id)} ` : ''}[data-focus-key="${CSS.escape(el.dataset.focusKey)}"]`;
  }
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attrs = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}
function visibleNavigationTarget(selector, root = document) {
  if (!selector) return null;
  const visible = [...root.querySelectorAll(selector)].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  return visible.find(el => el.closest('#side:not([hidden]), #legacy .view:not([hidden]), #view-space:not([hidden])')) ?? visible[0] ?? null;
}
function restoreNavigationFocus(fallback = false) {
  const hash = location.hash, selector = history.state?.focus, version = navigationFocusVersion;
  requestAnimationFrame(() => {
    if (location.hash !== hash || history.state?.focus !== selector || navigationFocusVersion !== version) return;
    const el = visibleNavigationTarget(selector);
    if (el) el.focus({ preventScroll: true });
    // A missing async list target is restored by its owner after rendering, not by the global chat toggle.
    else if (fallback) $('chat-toggle')?.focus({ preventScroll: true });
  });
}
// Async views capture this token on route entry and complete it only after their current render finishes.
let navigationFocusVersion = 0;
document.addEventListener('focusin', () => { navigationFocusVersion++; });
function captureNavigationReturnFocus(root) {
  const selector = history.state?.focus;
  if (!root?.id || !selector?.startsWith(`#${CSS.escape(root.id)} `)) return null;
  return { root, selector, hash: location.hash, version: navigationFocusVersion };
}
function restoreNavigationReturnFocus(token, fallback) {
  if (!token || token.used || location.hash !== token.hash || history.state?.focus !== token.selector || navigationFocusVersion !== token.version || token.root.closest('[hidden]')) return false;
  token.used = true;
  // A collapsed details hides its children from layout; reopen only the matching link's visible-view ancestors.
  const target = [...token.root.querySelectorAll(token.selector)].find(el => {
    if (el.disabled || el.closest('[hidden]')) return false;
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (css.display === 'none' || css.visibility === 'hidden') return false;
      if (node === token.root) break;
    }
    return true;
  });
  for (let details = target?.closest('details'); details; details = details.parentElement?.closest('details')) details.open = true;
  const visible = visibleNavigationTarget(token.selector, token.root);
  if (visible) { restoreScroll(history.state?.scroll); visible.focus({ preventScroll: true }); return true; }
  if (fallback?.getClientRects().length && !fallback.disabled) fallback.focus({ preventScroll: true });
  return false;
}
const isReferenceRoute = hash => /^(?:orders\/order|dispatcher\/problem|vehicles\/vehicle|workshop\/post)\/[^/]+$/.test(hash);
function referenceLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !state) return;
  const link = e.target.closest?.('a[data-focus-key][href^="#"]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const hash = link.getAttribute('href').slice(1);
  if (!isReferenceRoute(hash)) return;
  e.preventDefault(); navPush(hash, link);
  requestAnimationFrame(() => {
    if (location.hash !== `#${hash}`) return;
    const heading = ui.panel ? $('side').querySelector('h2') : view === 'vehicles' ? $('vehicle-passport').querySelector('h2') : null;
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  });
}
document.addEventListener('click', referenceLinkClick);
function backFromReference() {
  if (!history.state?.ret || !isReferenceRoute(location.hash.slice(1))) return false;
  navBack(); return true;
}
// Opening a card or the 3D view from another screen is a history step: Back returns to the same list, filter and scroll.
function pushHash(hash, opener = document.activeElement) {
  const from = location.hash.slice(1) || baseHash();
  history.replaceState({ ...(history.state || {}), scroll: captureScroll(), focus: navigationFocusKey(opener) }, '');
  history.pushState({ ret: { from, label: labelForHash(from) } }, '', `#${hash}`);
}
function navPush(hash, opener = document.activeElement) { if (location.hash !== `#${hash}`) pushHash(hash, opener); setView(hash); }
// Without a remembered origin (a direct link) the fallback is the base screen of the current route.
function navBack(fallback = baseHash()) {
  if (history.state?.ret) { history.back(); return; }
  history.replaceState(null, '', `#${fallback}`); setView(fallback);
}
const backLink = () => `<button class="link back-link" data-back="1">← ${esc(returnLabel())}</button>`;

// ---------- Card blocks ----------
function vehicleChips(v) {
  const order = state.orders.find(o => o.id === v.orderId);
  return tag(esc(v.modelName), 'blue') + tag(`${esc(v.orderId)}${order ? ` · срок ${order.dueMinute > state.shift ? 'после смены' : clock(order.dueMinute)}` : ''}`) + tag(esc(vehicleWhere(v))) + tag(ico(VEHICLE_KIND(v), VEHICLE_STATES[v.state] ?? v.state));
}
function opRow(v, op, comp, label, avail, primary = false) {
  const busy = ui.vbusy === v.id, mine = busy && ui.vbusyOp === `${op}:${comp ?? ''}`;
  const ok = Boolean(avail?.ok) && !busy && !state.finished;
  return `<div class="op-row"><button class="${primary ? 'primary' : ''}" data-vop="${op}" data-vid="${esc(v.id)}"${comp ? ` data-comp="${esc(comp)}"` : ''} ${ok ? '' : 'disabled'}>${mine ? 'Выполняется…' : esc(label)}${CONFIRM_OPS.has(op) && !mine ? '…' : ''}</button>${avail && !avail.ok && avail.reason ? `<p class="why">${esc(avail.reason)}</p>` : ''}</div>`;
}
function nextActionBlock(v) {
  const na = v.nextAction;
  let act = '';
  if (na.kind === 'op') {
    const comp = na.component ? v.components.find(c => c.id === na.component)?.name.toLowerCase() : '';
    act = opRow(v, na.op, na.component, `${OP_LABEL[na.op]}${comp ? `: ${comp}` : ''}`, na.blockers.length ? { ok: false, reason: na.blockers.join('; ') } : { ok: true }, true);
  } else if (na.target) act = `<button class="${na.kind === 'navigate' ? 'primary' : 'secondary'}" data-ref-type="${esc(na.target.type)}" data-ref-id="${esc(na.target.id)}">Открыть ${na.target.type === 'problem' ? `проблему ${esc(na.target.id)}` : na.target.type === 'vehicle' ? esc(na.target.id) : `пост ${esc(post(na.target.id)?.code ?? '')}`}</button>`;
  return `<section class="nextact ${na.kind}" aria-label="Следующее действие"><span class="eyebrow">СЛЕДУЮЩЕЕ ДЕЙСТВИЕ · ${ico(NA_ICON[na.kind], NA_LABEL[na.kind])}</span><h3>${esc(na.title)}</h3>
    ${na.why ? `<p>${esc(na.why)}</p>` : ''}${na.blockers.length && na.kind !== 'op' ? `<p><b>Мешает:</b> ${esc(na.blockers.join('; '))}</p>` : ''}${na.expected ? `<p><b>Ожидаемый результат:</b> ${esc(na.expected)}</p>` : ''}${act ? `<div class="na-row">${act}</div>` : ''}</section>`;
}
// A vehicle on a faulty or slow post can move to a free parallel post; otherwise the reason is shown.
function transferRow(v) {
  const p = v.location.type === 'post' ? post(v.location.id) : null, op = v.currentOperation && v.currentOperation.completedAt === null;
  if (!p || !op || state.finished) return '';
  const sib = state.posts.filter(q => q.stage === p.stage && q.id !== p.id), bad = ['fault', 'maintenance', 'slow'].includes(p.state);
  if (!sib.length || !bad) return '';
  const free = sib.filter(q => !q.vehicleId && !['fault', 'maintenance', 'shift_over'].includes(q.state) && !q.problemId && !q.hold);
  return `<div><dt>Перевод</dt><dd>${free.length ? free.map(q => `<button class="secondary" data-transfer="${esc(v.id)}" data-to="${esc(q.id)}">Перевести на ${esc(q.code)}…</button>`).join(' ') : `<span class="why">Недоступно: ${sib.map(q => q.vehicleId ? `${esc(q.code)} занят ${esc(q.vehicleId)}` : `${esc(q.code)} — ${esc(POST_SHORT[q.state].toLowerCase())}`).join('; ')}</span>`}</dd></div>`;
}
function overviewBody(v) {
  const order = state.orders.find(o => o.id === v.orderId), op = v.currentOperation && v.currentOperation.completedAt === null ? v.currentOperation : null;
  const route = `<ol class="vroute">${v.route.map(r => `<li class="${r.status}${r.result === 'fail' ? ' failed' : ''}">${r.status === 'done' ? ico(r.result === 'fail' ? 'warn' : 'ok', '') : r.status === 'current' ? ico('check', '') : '<span class="pend" aria-hidden="true"></span>'}<span class="vr-name">${esc(r.stageName)}${r.postCode ? ` · ${esc(r.postCode)}` : ''}${r.status === 'current' ? ' — сейчас' : ''}${r.result === 'fail' ? ` · не пройден: ${esc(r.defect)}` : r.result === 'pass' ? ' · пройден' : ''}</span><span class="vr-time mono">${r.status === 'done' ? `${clock(r.startedAt)}–${clock(r.completedAt)}` : r.status === 'current' ? `с ${clock(r.startedAt)}` : `норматив ${r.norm} мин`}</span></li>`).join('')}</ol>`;
  return `<dl class="kv"><div><dt>Сейчас</dt><dd>${esc(v.status)}${op ? `${bar(op.progress, 'wide')}${Math.round(op.progress * 100)}% · норматив ${op.norm} мин${op.pauseReason ? ` · пауза: ${esc(op.pauseReason.toLowerCase())}` : ''}` : ''}</dd></div>
    <div><dt>Задание</dt><dd>${orderLink(v.orderId)} · приоритет ${PRIORITY[v.priority].toLowerCase()}${order ? ` · срок ${order.dueMinute > state.shift ? 'следующая смена' : clock(order.dueMinute)}${state.forecast.lateOrders.includes(order.id) ? ' · по прогнозу опоздает' : ''}` : ''}</dd></div>
    <div><dt>Место</dt><dd>${esc(vehicleWhere(v))} <button class="link" data-show-in-shop="${esc(v.id)}">Показать в цехе</button></dd></div>
${transferRow(v)}    <div><dt>Синтетический ID</dt><dd class="mono">${esc(v.id)} · не VIN · маршрут ${esc(v.routeVersion)}</dd></div></dl><h4>Маршрут</h4>${route}`;
}
function inspectBody(v) {
  return `<p>Кузов — любительская модель «Kia Sportage» (karaman.arman, CC BY 4.0), не CAD Kia/Allur. Капот вырезан из кузова для показа и открывается на шарнире; узлы под капотом — условные учебные, не устройство Sportage. Двери не открываются и не регулируются.</p>
    <button class="secondary" data-car3d="${esc(v.id)}">Открыть 3D-осмотр ${esc(v.id)}</button>${v.procedure?.type === 'door' ? '<p class="honest">Дефект двери в 3D не показывается: замер и регулировка выполняются в блоке «Проверки и ремонт», результат — синтетическое измерение.</p>' : ''}`;
}
function procedureBody(v, mode) {
  const p = v.procedure, fails = v.inspections.filter(i => i.result === 'fail');
  let html = `<dl class="kv"><div><dt>Контроль</dt><dd>${v.inspections.length ? v.inspections.map(i => `${clock(i.minute)} ${esc(i.postCode)}: ${i.result === 'pass' ? (i.first ? 'принят' : 'принят после доработки') : `не пройден — ${esc(i.defect)}`}`).join('; ') : 'ещё не предъявлялся'}</dd></div>`;
  const probs = state.problems.filter(x => x.vehicleIds.includes(v.id));
  if (probs.length) html += `<div><dt>Оборудование</dt><dd>${probs.map(x => `<button class="link" data-problem="${esc(x.id)}">${esc(x.id)}</button> на ${esc(x.postCode)} — ${x.status === 'open' ? 'открыта' : x.status === 'resolved' ? `закрыта ${clock(x.resolvedAt)}` : 'не устранена'}`).join('<br>')}<br><span class="fine-print">Это неисправность поста, а не дефект автомобиля.</span></dd></div>`;
  html += '</dl>';
  if (!p) return html + (fails.length ? '' : '<p class="muted">Дефектов автомобиля не выявлено.</p>');
  html += `<h4>${esc(p.title)} · ${esc(p.category.toLowerCase())}</h4><ol class="steps">${p.steps.map(s => `<li class="${s.status}">${ico(STEP_ICON[s.status], '')}<span>${esc(s.label)}</span></li>`).join('')}</ol>`;
  if (!p.atPost) html += `<p class="honest">${p.recheck ? 'Доработка выполнена; годной машина станет только после повторного контроля.' : `Операции доработки выполняются на посту ДР-1. Сейчас: ${esc(v.status)}.`}</p>`;
  if (p.type === 'door') {
    const d = p.door;
    html += `<p>Норма: ${esc(d.name.toLowerCase())} ${fmt(d.nominal)} ± ${fmt(d.tolerance)} ${esc(d.unit)} · ${esc(d.side)} дверь · регулировок: ${d.adjustments}</p>`;
    if (d.checks.length) html += `<table class="measure-table"><thead><tr><th scope="col">Время</th><th scope="col">Замер</th><th scope="col">Отклонение</th><th scope="col">Результат</th></tr></thead><tbody>${d.checks.map(c => `<tr><td class="mono">${clock(c.minute)}</td><td class="mono">${fmt(c.value)} ${esc(d.unit)}</td><td class="mono">${c.deviation > 0 ? '+' : ''}${fmt(c.deviation)}</td><td class="${c.ok ? 'good' : 'bad'}">${c.ok ? 'в допуске' : 'вне допуска'}${c.afterAdjustment ? ' · после регулировки' : ''}</td></tr>`).join('')}</tbody></table>`;
    if (p.atPost && v.doorActions) html += `<div class="ops">${opRow(v, 'door_measure', null, d.checks.length ? 'Измерить зазор повторно' : 'Измерить зазор', v.doorActions.measure)}${opRow(v, 'door_adjust', null, 'Отрегулировать петли и замок', v.doorActions.adjust)}</div>`;
    html += '<p class="fine-print">Синтетические значения учебной симуляции; не руководство по кузовному ремонту.</p>';
  } else if (p.type === 'start') {
    const checks = v.componentChecks.filter(k => k.component === 'battery').slice(-3).reverse(), starts = (v.diagnosis?.startTests ?? []).slice(-2).reverse();
    if (!checks.length) html += `<p class="honest">${esc(v.diagnosis?.hypothesis ?? '')}</p>`;
    if (checks.length) html += `<table class="measure-table"><thead><tr><th scope="col">Время</th><th scope="col">Аккумулятор</th><th scope="col">Вывод</th></tr></thead><tbody>${checks.map(k => `<tr><td class="mono">${clock(k.minute)}</td><td>${k.measurements.map(m => `${esc(m.name)}: <b class="mono">${fmtV(m.value)} ${esc(m.unit ?? '')}</b>`).join('<br>')}</td><td class="${k.result === 'ok' ? 'good' : 'bad'}">${esc(k.text)}</td></tr>`).join('')}</tbody></table>`;
    for (const t of starts) html += `<p class="c3-start ${t.result}">${ico(t.result === 'pass' ? 'ok' : 'stop', `Проверка запуска ${clock(t.minute)}: ${t.result === 'pass' ? 'пройдена' : 'не пройдена'}`)}</p>`;
    const b = v.components.find(c => c.id === 'battery');
    if (p.atPost && mode === 'c3') html += `<div class="ops">${opRow(v, 'start_test', null, 'Проверка запуска', v.startTestAction)}</div><p class="fine-print">Проверка, снятие и установка аккумулятора — в блоке «Узлы под капотом».</p>`;
    else if (p.atPost && b?.actions) html += `<div class="ops">${opRow(v, 'component_check', 'battery', 'Проверить аккумулятор', b.actions.check)}${opRow(v, 'component_remove', 'battery', 'Снять аккумулятор', b.actions.remove)}${opRow(v, 'component_install', 'battery', 'Установить аккумулятор', b.actions.install)}${opRow(v, 'start_test', null, 'Проверка запуска', v.startTestAction)}</div><p class="fine-print">Остальные узлы под капотом — в 3D-осмотре. Склад: ${esc(state.stock.find(s => s.id === 'battery')?.name ?? 'аккумулятор')} — ${state.stock.find(s => s.id === 'battery')?.available ?? 0} шт.</p>`;
  } else html += `<p>${esc(p.auto.running ? `Выполняется на ДР-1: ${p.auto.work}; осталось ${p.auto.remaining} мин из ${p.auto.norm}. Ручных операций не требуется; дальше — повторный контроль.` : `Будет выполнено на ДР-1 за ${p.auto.norm} мин: ${p.auto.work}; затем повторный контроль.`)}</p>`;
  return html;
}
const HIST_STRONG = new Set(['inspection_failed', 'vehicle_accepted', 'component_checked', 'component_removed', 'component_installed', 'start_test', 'door_measured', 'door_adjusted', 'door_ok', 'vehicle_shipped']);
function historyBody(v) {
  const all = state.events.filter(e => e.vehicleId === v.id).reverse(), full = ui.histAll === v.id, list = full ? all : all.slice(0, 12);
  return `<ol class="history-list">${list.map(e => `<li class="${HIST_STRONG.has(e.type) ? 'op' : ''}"><span class="mono">${clock(e.minute)}</span><span>${esc(e.text)}${e.actor === 'operator' ? ' · <em>оператор</em>' : ''}</span></li>`).join('') || '<li class="muted">Событий пока нет.</li>'}</ol>${all.length > 12 ? `<button class="link" data-hist-all="${full ? '' : esc(v.id)}">${full ? 'Свернуть' : `Показать всю историю (${all.length})`}</button>` : ''}`;
}
// mode: 'side' (compact card on any screen), 'full' (vehicle list), 'c3' (beside the 3D view).
function vehicleCard(v, mode = 'side') {
  const groups = mode === 'c3' ? [['parts', 'Узлы под капотом', partsBody], ['work', 'Проверки и ремонт', procedureBody], ['overview', 'Обзор и маршрут', overviewBody], ['history', 'История', historyBody]]
    : [['overview', 'Обзор и маршрут', overviewBody], ['inspect', 'Осмотр · 3D', inspectBody], ['work', 'Проверки и ремонт', procedureBody], ['history', 'История', historyBody]];
  const defaults = { side: { overview: !v.procedure, inspect: false, work: Boolean(v.procedure), history: false }, full: { overview: true, inspect: false, work: true, history: true }, c3: { parts: v.procedure?.type === 'start' || Boolean(c3.selected), overview: false, work: Boolean(v.procedure), history: !v.procedure } }[mode];
  const open = g => ui.cardOpen[`${mode}:${g}`] ?? defaults[g];
  const count = { history: state.events.filter(e => e.vehicleId === v.id).length, work: v.procedure ? v.procedure.steps.filter(s => s.status === 'done').length + '/' + v.procedure.steps.length : null };
  return `<div class="vcard">${nextActionBlock(v)}${groups.map(([g, t, fn]) => `<details data-card-group="${mode}:${g}" ${open(g) ? 'open' : ''}><summary>${t}${count[g] ? `<span class="count">${count[g]}</span>` : ''}</summary><div class="group-body">${fn(v, mode)}</div></details>`).join('')}</div>`;
}
function vehiclePanel(v) {
  return sideHead('АВТОМОБИЛЬ', `<span class="mono">${esc(v.id)}</span>`, vehicleChips(v), chatBtn('vehicle', v.id)) + `<div class="side-body">${view !== 'space' || history.state?.ret ? backLink() : ''}${vehicleCard(v, 'side')}<p><button class="link" data-full-card="${esc(v.id)}">Полная карточка в списке автомобилей →</button></p><p class="lock">Измерения записываются сразу; снятие, установка, проверка запуска и регулировка меняют производство и требуют подтверждения.</p></div>`;
}
function vehicleFull(v) {
  return `${history.state?.ret ? backLink() : ''}<div class="vcard-head"><span class="eyebrow">АВТОМОБИЛЬ · СИНТЕТИЧЕСКИЙ ID, НЕ VIN</span><h2 class="mono">${esc(v.id)}</h2><div class="chipline">${vehicleChips(v)}</div><div class="passport-actions"><button class="secondary" data-car3d="${esc(v.id)}">Открыть 3D-осмотр</button><button class="link" data-open-chat="1" data-ctx-type="vehicle" data-ctx-id="${esc(v.id)}">Спросить в чате об ${esc(v.id)}</button></div></div>${vehicleCard(v, 'full')}`;
}

// ---------- One handler for every vehicle operation ----------
const withTimeout = (p, ms) => Promise.race([p ?? Promise.resolve(), new Promise(r => setTimeout(r, ms))]);
async function vehicleOp(vid, op, comp) {
  const v = vehicle(vid); if (!v || ui.vbusy) return;
  const c = comp ? v.components.find(x => x.id === comp) : null, name = c?.name.toLowerCase() ?? '';
  const texts = {
    component_remove: [`Снять: ${name} (${v.id})`, `<p>Узел будет снят с ${esc(v.id)}${c?.state === 'faulty' ? '. Неисправность подтверждена измерением — узел уйдёт в утиль.' : ' и отложен для установки обратно.'}</p><p>Без обязательных узлов проверка запуска невозможна.</p>`],
    component_install: [`Установить: ${name} (${v.id})`, `<p>${c?.removedScrapped ? `Будет установлен исправный узел со склада (доступно: ${state.stock.find(s => s.id === 'battery')?.available ?? 0}).` : 'Будет установлен снятый ранее узел.'} После установки его нужно проверить.</p>`],
    start_test: [`Проверка запуска ${v.id}`, '<p>Стартер прокрутит двигатель от установленного аккумулятора. Если проверка пройдена, доработка завершится и машина пойдёт на повторный контроль качества.</p>'],
    door_adjust: [`Регулировка двери ${v.id}`, `<p>Будут отрегулированы петли и замок (${esc(v.procedure?.door?.side ?? '')} дверь). После регулировки нужен повторный замер; задача закроется только после повторного контроля качества.</p>`],
  };
  if (CONFIRM_OPS.has(op) && !await confirmAction(...texts[op])) return;
  ui.vbusy = vid; ui.vbusyOp = `${op}:${comp ?? ''}`; render();
  try {
    const in3d = ui.car3d === vid && c3.viewer;
    const anim = in3d && op === 'component_remove' ? withTimeout(c3.viewer.animatePart(comp, 'remove'), 2500) : null;
    const ok = await action({ action: op, vehicleId: vid, ...(comp ? { component: comp } : {}), requestId: requestId() });
    await anim;
    if (ok && in3d && op === 'component_install') await withTimeout(c3.viewer.animatePart(comp, 'install'), 2500);
  } finally { ui.vbusy = null; ui.vbusyOp = null; render(); }
}
document.addEventListener('toggle', e => { const k = e.target?.dataset?.cardGroup; if (k) ui.cardOpen[k] = e.target.open; }, true);
