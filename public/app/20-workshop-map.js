// ---------- Workshop map ----------
const LAYOUT = {
  zones: [
    { stage: 'weld', x: 186, y: 30, w: 236 }, { stage: 'paint', x: 558, y: 30, w: 236 },
    { stage: 'assembly', x: 830, y: 300, w: 346 }, { stage: 'quality', x: 462, y: 300, w: 236 }, { stage: 'shipping', x: 200, y: 300, w: 126 },
  ],
  buffers: { BACKLOG: { x: 16, y: 30, w: 150, slots: 6 }, B1: { x: 442, y: 30, w: 96 }, B2: { x: 814, y: 30, w: 96 }, B3: { x: 714, y: 300, w: 96 }, FG: { x: 346, y: 300, w: 100 }, RWQ: { x: 930, y: 30, w: 100, slots: 4 } },
  rework: { x: 1040, y: 30, w: 136 }, shipped: { x: 16, y: 300, w: 166 },
};
const ZONE_H = 220, POST_W = 100, POST_H = 128;
function bufferZone(b, id) {
  const l = LAYOUT.buffers[id], slots = l.slots ?? b.capacity, ids = b.vehicleIds;
  let out = `<rect class="zone buffer${b.capacity !== null && ids.length >= b.capacity ? ' full' : ''}" x="${l.x}" y="${l.y}" width="${l.w}" height="${ZONE_H}" rx="10"/>`;
  out += `<text class="zone-label buffer-label" x="${l.x + 10}" y="${l.y + 22}">${esc({ BACKLOG: 'ВХОД', FG: 'ГОТОВЫЕ', RWQ: 'К ДОРАБ.' }[id] ?? id)}</text><text class="zone-count" x="${l.x + l.w - 10}" y="${l.y + 22}" text-anchor="end">${ids.length}${b.capacity !== null ? `/${b.capacity}` : ''}</text>`;
  for (let i = 0; i < slots; i++) {
    const y = l.y + 36 + i * 28, vid = ids[i];
    if (i === slots - 1 && ids.length > slots) { out += `<text class="more" x="${l.x + l.w / 2}" y="${y + 17}" text-anchor="middle">+${ids.length - slots + 1} в очереди</text>`; break; }
    out += vid ? vehicleChip(vehicle(vid), l.x + 8, y, l.w - 16) : `<rect class="slot-empty" x="${l.x + 8}" y="${y}" width="${l.w - 16}" height="24" rx="5"/>`;
  }
  return out + `<text class="buffer-name" x="${l.x + l.w / 2}" y="${l.y + ZONE_H - 10}" text-anchor="middle">${esc({ BACKLOG: 'кузова к сварке', B1: 'к окраске', B2: 'к сборке', B3: 'к контролю', FG: 'к отгрузке', RWQ: 'не прошли контроль' }[id])}</text>`;
}
function renderMap() {
  const stageName = Object.fromEntries(state.stages.map(s => [s.id, s]));
  let out = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrow-head"/></marker><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" class="grid-line"/></pattern></defs><rect width="1200" height="560" fill="url(#grid)"/>';
  out += '<path class="flow" d="M166 140H186M422 140H442M538 140H558M794 140H814" marker-end="url(#arrow)"/><path class="flow" d="M862 250V300" marker-end="url(#arrow)"/><path class="flow" d="M830 410H810M714 410H698M462 410H446M346 410H326M200 410H182" marker-end="url(#arrow)"/><path class="flow rework-flow" d="M640 300V270H980V250" marker-end="url(#arrow)"/><path class="flow rework-flow" d="M1108 250V280H762V300" marker-end="url(#arrow)"/>';
  for (const z of LAYOUT.zones) {
    const s = stageName[z.stage];
    out += `<rect class="zone" x="${z.x}" y="${z.y}" width="${z.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${z.x + 12}" y="${z.y + 22}">${esc(s.name.toUpperCase())} · ${s.postIds.length} ${s.postIds.length === 1 ? 'пост' : 'поста'}</text>`;
    s.postIds.forEach((id, i) => { out += postNode(post(id), z.x + 10 + i * (POST_W + 10), z.y + 50); });
  }
  for (const s of state.stages) out += bufferZone(s.buffer, s.buffer.id);
  out += bufferZone(state.rework.buffer, 'RWQ');
  const r = LAYOUT.rework; out += `<rect class="zone" x="${r.x}" y="${r.y}" width="${r.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${r.x + 12}" y="${r.y + 22}">ДОРАБОТКА</text>${postNode(post('R1'), r.x + 18, r.y + 50)}`;
  const sh = LAYOUT.shipped, shipped = state.vehicles.filter(v => v.shipped).sort((a, b) => b.shippedAt - a.shippedAt);
  out += `<rect class="zone done" x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${ZONE_H}" rx="10"/><text class="zone-label" x="${sh.x + 10}" y="${sh.y + 22}">ОТГРУЖЕНО</text><text class="zone-big" x="${sh.x + sh.w / 2}" y="${sh.y + 92}" text-anchor="middle">${shipped.length}</text>`;
  shipped.slice(0, 3).forEach((v, i) => { out += vehicleChip(v, sh.x + 10, sh.y + 116 + i * 28, sh.w - 20); });
  out += `<text class="map-caption" x="16" y="548">УСЛОВНАЯ СХЕМА · СИНТЕТИЧЕСКАЯ ПЛАНИРОВКА, НЕ CAD ALLUR · принято ${state.totals.accepted} · в работе ${state.totals.inProcess}</text>`;
  $('workshop-map').innerHTML = out;
}
function vehicleChip(v, x, y, w) {
  return `<g class="chip ${esc(v.state)}" role="button" tabindex="0" data-vehicle="${esc(v.id)}" aria-label="${esc(`${v.id}, ${v.modelName}, ${v.status}`)}"><rect x="${x}" y="${y}" width="${w}" height="24" rx="5"/><text x="${x + 7}" y="${y + 16}">${esc(v.id.replace('DEMO-', '#'))}</text><text class="chip-model" x="${x + w - 7}" y="${y + 16}" text-anchor="end">${esc(v.modelId)}${v.priority === 'high' ? ' ↑' : ''}${v.reworked ? ' ↺' : ''}</text></g>`;
}
function postNode(p, x, y) {
  const v = p.vehicleId ? vehicle(p.vehicleId) : null, sel = selectedPost === p.id;
  const label = `${p.code}: ${POST_STATES[p.state]}${v ? `, ${v.id}, ${p.operation}, ${Math.round(p.progress * 100)}%` : ''}${p.problemId ? `, проблема ${p.problemId}` : ''}`;
  let inner = `<rect class="post-box" x="${x}" y="${y}" width="${POST_W}" height="${POST_H}" rx="8"/><text class="post-code" x="${x + 8}" y="${y + 19}">${esc(p.code)}</text><circle class="post-dot" cx="${x + POST_W - 12}" cy="${y + 14}" r="5"/><text class="post-state" x="${x + 8}" y="${y + 37}">${esc(POST_SHORT[p.state])}${p.hold ? ' · стоп-загр.' : ''}</text>`;
  if (v) inner += `<text class="post-vehicle" x="${x + 8}" y="${y + 64}">${esc(v.id)}</text><text class="post-model" x="${x + 8}" y="${y + 81}">${esc(v.modelName)}${v.priority === 'high' ? ' · ↑' : ''}</text><rect class="pbar-bg" x="${x + 8}" y="${y + 92}" width="${POST_W - 16}" height="6" rx="3"/><rect class="pbar" x="${x + 8}" y="${y + 92}" width="${(POST_W - 16) * p.progress}" height="6" rx="3"/><text class="post-progress" x="${x + 8}" y="${y + 116}">${Math.round(p.progress * 100)}% · ${p.progress >= 1 ? 'готово' : `${fmt(p.remaining)} мин`}</text>`;
  else inner += `<text class="post-empty" x="${x + POST_W / 2}" y="${y + 84}" text-anchor="middle">нет автомобиля</text>`;
  if (p.problemId) inner += `<text class="post-problem" x="${x + POST_W - 8}" y="${y + 37}" text-anchor="end">${esc(p.problemId)}</text>`;
  return `<g class="post ${esc(p.state)}${sel ? ' selected' : ''}" role="button" tabindex="0" data-post="${esc(p.id)}" aria-pressed="${sel}" aria-label="${esc(label)}">${inner}</g>`;
}
// ---------- Post detail and board ----------
function renderPostDetail() {
  const p = post(selectedPost), v = p.vehicleId ? vehicle(p.vehicleId) : null;
  const stage = p.stage === 'rework' ? { name: 'Доработка', buffer: state.rework.buffer } : state.stages.find(s => s.id === p.stage);
  const incident = p.incidentId ? state.incidents.find(i => i.id === p.incidentId) : null;
  const queue = stage.buffer.vehicleIds;
  let html = `<div class="detail-head"><div><span class="eyebrow">ПОСТ · ${esc(stage.name.toUpperCase())}</span><h2>${esc(p.code)}</h2></div><span class="status-pill ${esc(p.state)}">${esc(POST_STATES[p.state])}</span></div>`;
  if (p.reason) html += `<p class="reason">${esc(p.reason)}</p>`;
  if (p.problemId) html += `<p>Связанная проблема: ${problemLink(p.problemId)} — диагностика и сравнение решений в «Диспетчере смены».</p>`;
  html += '<div class="dcol">';
  if (v) {
    const op = v.currentOperation;
    html += `<dl class="facts"><div><dt>Автомобиль</dt><dd>${vehicleLink(v.id)} · ${esc(v.modelName)} · ${esc(v.orderId)}</dd></div><div><dt>Операция</dt><dd>${esc(op.operation)}</dd></div><div><dt>Прогресс</dt><dd>${bar(op.progress)} ${Math.round(op.progress * 100)}% · ${op.completedAt !== null ? `завершена в ${clock(op.completedAt)}` : `осталось ${fmt(op.remaining)} мин из ${op.work}`}</dd></div><div><dt>Норматив / факт</dt><dd>${op.norm} мин / ${op.work} мин (синтетика)</dd></div><div><dt>Начало</dt><dd>${clock(op.startedAt)}${op.posts.length > 1 ? ` · переводы: ${op.posts.map(x => `${esc(x.postCode)} с ${clock(x.from)}`).join(' → ')}` : ''}</dd></div></dl>`;
  } else html += '<p class="muted">Автомобиля на посту нет.</p>';
  if (!state.finished) {
    const actions = [];
    if (!incident) actions.push(`<button data-fault="${esc(p.id)}" data-kind="breakdown">Ручной сценарий: неисправность</button>`, `<button data-fault="${esc(p.id)}" data-kind="slowdown">Ручной сценарий: снижение темпа</button>`);
    html += `<h3>Действия</h3><div class="actions">${actions.join('')}</div><p class="fine-print">Ремонт занимает модельное время и единственного техника; без ремонта неисправность не исчезает.</p>`;
  }
  html += `<h3>Действия поста</h3><div class="actions-col">${postActionButtons(p, 'workshop')}</div>${postResources(p)}`;
  let queueHtml = `<h3>Очередь · ${esc(stage.buffer.name)} ${queue.length}${stage.buffer.capacity !== null ? `/${stage.buffer.capacity}` : ''}</h3>`;
  queueHtml += queue.length ? `<ol class="queue">${queue.slice(0, 8).map(id => { const q = vehicle(id); return `<li>${vehicleLink(id)} <span>${esc(q.modelName)} · ${esc(q.orderId)} · ${PRIORITY[q.priority].toLowerCase()}${q.reworked ? ' · после доработки' : ''}</span></li>`; }).join('')}${queue.length > 8 ? `<li class="muted">и ещё ${queue.length - 8}</li>` : ''}</ol><p class="fine-print">Порядок: приоритет задания → время прихода в буфер. Начатые операции не прерываются.</p>` : '<p class="muted">Очередь пуста.</p>';
  html += `</div><div class="dcol">${queueHtml}</div>`;
  const m = p.metrics;
  html += `<p class="post-metrics">A ${pct(m.availability)} · P ${pct(m.performance)} · Q ${pct(m.quality)} · OEE ${pct(m.oee)} · неисправность ${p.stats.fault} · работы техника ${p.stats.maintenance} · нет входа ${p.stats.starved} · блокировка ${p.stats.blocked} мин</p>`;
  $('post-detail').innerHTML = html;
}
function renderPostBoard() {
  const groups = [...state.stages, { id: 'rework', name: 'Доработка', postIds: ['R1'], buffer: state.rework.buffer }];
  $('post-board').innerHTML = groups.map(s => `<div class="board-stage"><h3>${esc(s.name)}</h3>${s.postIds.map(id => { const p = post(id); return `<button class="board-post ${esc(p.state)}${selectedPost === id ? ' selected' : ''}" data-post-link="${esc(id)}" aria-pressed="${selectedPost === id}"><b>${esc(p.code)}</b><span>${esc(POST_STATES[p.state])}</span><span>${p.vehicleId ? `${esc(p.vehicleId)} · ${Math.round(p.progress * 100)}%` : '—'}</span></button>`; }).join('')}<span class="board-queue">${esc(s.buffer.name)}: ${s.buffer.vehicleIds.length}${s.buffer.capacity !== null ? `/${s.buffer.capacity}` : ''}</span></div>`).join('');
}
function renderActiveProblems() {
  const open = state.problems.filter(p => p.status !== 'resolved');
  $('active-problems').innerHTML = open.map(p => `<div class="incident-banner ${p.kind === 'equipment' ? 'warning' : 'critical'}"><strong>${esc(p.id)} · ${esc(p.title)}</strong><span>${p.status === 'unresolved' ? 'Не устранена к концу смены' : `обнаружена ${clock(p.detectedAt)}`}</span><span class="banner-actions">${postLink(p.postId)}<button data-problem="${esc(p.id)}">Открыть в диспетчере</button></span></div>`).join('');
}
