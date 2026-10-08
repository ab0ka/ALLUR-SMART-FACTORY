// Allur Smart Factory — single authoritative workshop engine (stage 1 of WORKSHOP_SPEC.md).
// Every vehicle, order, post, norm, incident and layout here is SYNTHETIC, not Allur production data.
export const SHIFT = 480;
export const SHIFT_START = 8 * 60;
export const WARMUP = 180;
export const MAX_VEHICLES = 24;
export const MAX_ORDER_QUANTITY = 8;
export const PRIORITIES = { high: { rank: 0, name: 'Высокий' }, normal: { rank: 1, name: 'Обычный' }, low: { rank: 2, name: 'Низкий' } };
export const MODELS = { A: { name: 'Модель A' }, B: { name: 'Модель B' }, C: { name: 'Модель C' } };
// Route = stage order. Norms are synthetic ideal minutes per vehicle; actual work varies by seed (−5…+10%).
export const STAGES = [
  { id: 'weld', name: 'Сварка', operation: 'Сварка кузова', norms: { A: 28, B: 30, C: 33 }, buffer: { id: 'BACKLOG', name: 'Входной буфер кузовов', capacity: null } },
  { id: 'paint', name: 'Окраска', operation: 'Окраска кузова', norms: { A: 30, B: 33, C: 35 }, buffer: { id: 'B1', name: 'Буфер перед окраской', capacity: 3 } },
  { id: 'assembly', name: 'Сборка', operation: 'Сборка и комплектация', norms: { A: 50, B: 56, C: 62 }, buffer: { id: 'B2', name: 'Буфер перед сборкой', capacity: 3 } },
  { id: 'quality', name: 'Контроль', operation: 'Контроль качества', norms: { A: 22, B: 24, C: 26 }, buffer: { id: 'B3', name: 'Буфер перед контролем', capacity: 2 } },
  { id: 'shipping', name: 'Отгрузка', operation: 'Передача в отгрузку', norms: { A: 8, B: 8, C: 8 }, buffer: { id: 'FG', name: 'Готовые автомобили', capacity: 4 } },
];
export const POSTS = [
  ['W1', 'СВ-1', 'weld'], ['W2', 'СВ-2', 'weld'], ['P1', 'ОК-1', 'paint'], ['P2', 'ОК-2', 'paint'],
  ['A1', 'СБ-1', 'assembly'], ['A2', 'СБ-2', 'assembly'], ['A3', 'СБ-3', 'assembly'],
  ['Q1', 'КК-1', 'quality'], ['Q2', 'КК-2', 'quality'], ['S1', 'ОТ-1', 'shipping'],
].map(([id, code, stage]) => ({ id, code, stage, capacity: 1 }));
const STAGE_CAUSES = { weld: 'отказ сварочного манипулятора', paint: 'недоступность камеры окраски', assembly: 'отказ подъёмника сборки', quality: 'отказ стенда контроля', shipping: 'неисправность транспортной тележки' };
export const INCIDENT_KINDS = {
  breakdown: { title: 'Неисправность поста', duration: 60, speed: 0, severity: 'critical', advice: 'Проверить оборудование поста. Если параллельный пост свободен, перевести на него автомобиль.', remedy: 'Пост снова принимает и обрабатывает автомобили; накопленный простой остаётся в истории.' },
  slowdown: { title: 'Снижение темпа поста', duration: 60, speed: .6, severity: 'warning', advice: 'Проверить настройку оборудования и подачу на пост.', remedy: 'Темп поста возвращается к нормативу.' },
};
// The demo shift starts with three synthetic orders released at 08:00.
export const DEFAULT_ORDERS = [
  { modelId: 'A', quantity: 6, priority: 'normal', dueMinute: 300 },
  { modelId: 'B', quantity: 8, priority: 'normal', dueMinute: 480 },
  { modelId: 'C', quantity: 6, priority: 'low', dueMinute: 600 },
];
export class SimulationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}
export const clock = m => `${String(Math.floor((SHIFT_START + m) / 60)).padStart(2, '0')}:${String((SHIFT_START + m) % 60).padStart(2, '0')}`;
const STAGE = Object.fromEntries(STAGES.map((s, i) => [s.id, { ...s, index: i }]));
const POST = Object.fromEntries(POSTS.map(p => [p.id, p]));
const postsOf = stageId => POSTS.filter(p => p.stage === stageId);
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const planCache = new Map();

// Post OEE over planned (elapsed) time. All post stops (fault, no input, blocked output) are availability losses
// and are reported separately; P = nominal work / run time; Q = 1 in stage 1 (no defects modelled yet).
export function postOee({ run, nominal }, elapsed, quality = 1) {
  const availability = elapsed > 0 ? run / elapsed : 0;
  const performance = run > 0 ? Math.min(1, nominal / run) : 0;
  return { availability, performance, quality, oee: availability * performance * quality };
}

export class Workshop {
  constructor({ seed = 42, warmup = WARMUP, plan = true } = {}) { this.reset(seed, warmup, plan); }
  reset(seed = 42, warmup = WARMUP, plan = true) {
    Object.assign(this, {
      seed: seed >>> 0, rng: seed >>> 0, minute: 0, running: false, speed: 5, finished: false,
      revision: (this.revision || 0) + 1, eventSeq: 0, orderSeq: 100, vehicleSeq: 0, executionSeq: 0, incidentSeq: 0,
      orders: [], vehicles: [], executions: [], incidents: [], events: [], shipped: [], history: [{ minute: 0, accepted: 0 }],
    });
    this.buffers = Object.fromEntries(STAGES.map(s => [s.buffer.id, []]));
    this.posts = Object.fromEntries(POSTS.map(p => [p.id, { vehicleId: null, executionId: null, stats: { run: 0, fault: 0, starved: 0, blocked: 0, nominal: 0, completed: 0 } }]));
    for (const order of DEFAULT_ORDERS) this.releaseOrder(order, 'system');
    this.planProfile = plan ? Workshop.planProfile(this.seed) : null;
    for (let i = 0; i < warmup; i += 5) this.advance(Math.min(5, warmup - i));
    this.revision++;
  }
  // Achievable plan: the same engine, same seed and default orders, no incidents, run to the end of the shift.
  static planProfile(seed) {
    if (!planCache.has(seed)) {
      const ideal = new Workshop({ seed, warmup: 0, plan: false }), profile = [0];
      while (ideal.minute < SHIFT) { ideal.tick(); profile.push(ideal.acceptedCount()); }
      planCache.set(seed, Object.freeze(profile));
    }
    return planCache.get(seed);
  }
  random() { this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0; return this.rng / 4294967296; }
  log(type, text, refs = {}, actor = 'system') { this.events.push({ seq: ++this.eventSeq, minute: this.minute, type, actor, text, ...refs }); }
  vehicle(id) { return this.vehicles.find(v => v.id === id); }
  order(id) { return this.orders.find(o => o.id === id); }
  execution(id) { return this.executions.find(e => e.id === id); }
  postIncident(postId) { return this.incidents.find(i => i.postId === postId && i.status === 'active'); }
  isBroken(postId) { const i = this.postIncident(postId); return Boolean(i && INCIDENT_KINDS[i.kind].speed === 0); }
  acceptedCount() { return this.vehicles.filter(v => v.accepted).length; }
  requireOpenShift() { if (this.finished) throw new SimulationError('Смена завершена. Сбросьте демо.', 409); }

  releaseOrder({ modelId, quantity, priority = 'normal', dueMinute = SHIFT } = {}, actor = 'operator') {
    this.requireOpenShift();
    if (typeof modelId !== 'string' || !Object.hasOwn(MODELS, modelId)) throw new SimulationError('Неизвестная модель');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) throw new SimulationError(`Количество должно быть от 1 до ${MAX_ORDER_QUANTITY}`);
    if (typeof priority !== 'string' || !Object.hasOwn(PRIORITIES, priority)) throw new SimulationError('Неизвестный приоритет');
    if (this.vehicles.length + quantity > MAX_VEHICLES) throw new SimulationError(`Лимит демо — ${MAX_VEHICLES} автомобиля на смену`, 409);
    const order = { id: `ORD-${++this.orderSeq}`, modelId, quantity, priority, dueMinute, releasedAt: this.minute, vehicleIds: [] };
    this.orders.push(order);
    this.log('order_released', `Задание ${order.id} выпущено: ${MODELS[modelId].name} × ${quantity}, приоритет «${PRIORITIES[priority].name.toLowerCase()}»`, { orderId: order.id }, actor);
    for (let n = 0; n < quantity; n++) {
      const seq = ++this.vehicleSeq, id = `DEMO-${String(seq).padStart(3, '0')}`;
      const work = Object.fromEntries(STAGES.map(s => [s.id, s.id === 'shipping' ? s.norms[modelId] : Math.max(1, Math.round(s.norms[modelId] * (.95 + .15 * this.random())))]));
      this.vehicles.push({ id, seq, orderId: order.id, modelId, routeVersion: 'R1-synthetic', createdAt: this.minute, readyAt: this.minute, stageIndex: 0, location: { type: 'buffer', id: 'BACKLOG' }, currentExecutionId: null, startedAt: null, accepted: false, acceptedAt: null, shipped: false, shippedAt: null, work, executionIds: [] });
      this.buffers.BACKLOG.push(id); order.vehicleIds.push(id);
      this.log('vehicle_created', `Автомобиль ${id} создан по заданию ${order.id}`, { vehicleId: id, orderId: order.id }, actor);
    }
    this.flow(); this.revision++;
    return order;
  }
  setPriority(orderId, priority) {
    this.requireOpenShift();
    const order = typeof orderId === 'string' ? this.order(orderId) : null;
    if (!order) throw new SimulationError('Задание не найдено', 404);
    if (typeof priority !== 'string' || !Object.hasOwn(PRIORITIES, priority)) throw new SimulationError('Неизвестный приоритет');
    if (order.vehicleIds.every(id => this.vehicle(id).accepted)) throw new SimulationError('Задание уже выполнено', 409);
    if (order.priority === priority) return;
    const before = order.priority; order.priority = priority;
    this.log('priority_changed', `Приоритет ${order.id}: «${PRIORITIES[before].name.toLowerCase()}» → «${PRIORITIES[priority].name.toLowerCase()}». Начатые операции не прерываются`, { orderId: order.id }, 'operator');
    this.revision++;
  }
  injectIncident(postId, kind) {
    this.requireOpenShift();
    if (typeof postId !== 'string' || !Object.hasOwn(POST, postId)) throw new SimulationError('Пост не найден', 404);
    if (typeof kind !== 'string' || !Object.hasOwn(INCIDENT_KINDS, kind)) throw new SimulationError('Неизвестный тип инцидента');
    if (this.postIncident(postId)) throw new SimulationError('На этом посту уже есть активный инцидент', 409);
    const spec = INCIDENT_KINDS[kind], post = POST[postId];
    const cause = kind === 'breakdown' ? `Синтетический сигнал: ${STAGE_CAUSES[post.stage]}` : 'Синтетический сигнал: снижение темпа поста до 60%';
    const incident = { id: ++this.incidentSeq, kind, postId, postCode: post.code, stage: post.stage, stageName: STAGE[post.stage].name, title: `${spec.title} ${post.code}`, severity: spec.severity, cause, advice: spec.advice, remedy: spec.remedy, start: this.minute, expires: this.minute + spec.duration, end: null, status: 'active', resolution: null, vehicleId: this.posts[postId].vehicleId };
    this.incidents.unshift(incident);
    this.log('incident_started', `${incident.title}: ${cause}`, { incidentId: incident.id, postId, vehicleId: incident.vehicleId ?? undefined }, 'operator');
    this.revision++;
    return incident;
  }
  resolveIncident(id, auto = false) {
    const item = Number.isInteger(id) ? this.incidents.find(i => i.id === id && i.status === 'active') : null;
    if (!item) throw new SimulationError('Активный инцидент не найден', 404);
    item.status = 'resolved'; item.end = this.minute; item.resolution = auto ? 'Восстановлено по сценарию' : 'Устранено оператором демо';
    this.log('incident_resolved', `${item.title}: ${item.resolution.toLowerCase()}`, { incidentId: item.id, postId: item.postId }, auto ? 'system' : 'operator');
    if (!auto) this.flow();
    this.revision++;
  }
  transfer(vehicleId, postId) {
    this.requireOpenShift();
    const v = typeof vehicleId === 'string' ? this.vehicle(vehicleId) : null;
    if (!v) throw new SimulationError('Автомобиль не найден', 404);
    if (typeof postId !== 'string' || !Object.hasOwn(POST, postId)) throw new SimulationError('Пост не найден', 404);
    const exec = v.currentExecutionId ? this.execution(v.currentExecutionId) : null;
    if (!exec || exec.completedAt !== null || v.location.type !== 'post' || !this.isBroken(v.location.id)) throw new SimulationError('Перевод возможен только для автомобиля с незавершённой операцией на неисправном посту', 409);
    const target = POST[postId];
    if (target.stage !== exec.stage) throw new SimulationError('Пост другого участка не выполняет эту операцию', 409);
    if (this.posts[postId].vehicleId || this.isBroken(postId)) throw new SimulationError('Целевой пост занят или неисправен', 409);
    const from = v.location.id;
    this.posts[from].vehicleId = null; this.posts[from].executionId = null;
    Object.assign(this.posts[postId], { vehicleId: v.id, executionId: exec.id });
    exec.postId = postId; exec.posts.push({ postId, from: this.minute }); exec.pauseReason = null;
    v.location = { type: 'post', id: postId };
    this.log('vehicle_transferred', `${v.id} переведён с ${POST[from].code} на ${target.code}; остаток операции ${round(exec.remaining, 1)} мин сохранён`, { vehicleId: v.id, postId, orderId: v.orderId }, 'operator');
    this.flow(); this.revision++;
  }
  // Pull the next vehicle for a stage: priority of its order, then arrival in the buffer, then creation order.
  pickNext(bufferId) {
    const queue = this.buffers[bufferId];
    if (!queue.length) return null;
    const ordered = this.queueOrder(bufferId);
    queue.splice(queue.indexOf(ordered[0]), 1);
    return this.vehicle(ordered[0]);
  }
  queueOrder(bufferId) {
    const rank = id => { const v = this.vehicle(id); return [PRIORITIES[this.order(v.orderId).priority].rank, v.readyAt, v.seq]; };
    return [...this.buffers[bufferId]].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  }
  // Transfers and dispatch, downstream first so a freed slot can be used in the same minute boundary.
  flow() {
    if (this.finished) return;
    for (let i = STAGES.length - 1; i >= 0; i--) {
      const stage = STAGES[i];
      for (const def of postsOf(stage.id)) {
        const post = this.posts[def.id], exec = post.executionId ? this.execution(post.executionId) : null;
        if (!exec || exec.completedAt === null) continue;
        const v = this.vehicle(post.vehicleId);
        if (i === STAGES.length - 1) {
          v.shipped = true; v.shippedAt = this.minute; v.location = { type: 'shipped', id: 'SHIPPED' }; v.currentExecutionId = null; this.shipped.push(v.id);
          this.log('vehicle_shipped', `${v.id} отгружен (выпуск уже учтён при приёмке)`, { vehicleId: v.id, postId: def.id, orderId: v.orderId });
        } else {
          const next = STAGES[i + 1].buffer;
          if (this.buffers[next.id].length >= next.capacity) continue;
          this.buffers[next.id].push(v.id);
          Object.assign(v, { location: { type: 'buffer', id: next.id }, readyAt: this.minute, stageIndex: i + 1, currentExecutionId: null });
          this.log('vehicle_moved', `${v.id} перемещён: ${def.code} → ${next.name}`, { vehicleId: v.id, postId: def.id, orderId: v.orderId });
        }
        post.vehicleId = null; post.executionId = null;
      }
      for (const def of postsOf(stage.id)) {
        if (this.posts[def.id].vehicleId || this.isBroken(def.id)) continue;
        const v = this.pickNext(stage.buffer.id);
        if (!v) break;
        const exec = { id: ++this.executionSeq, vehicleId: v.id, stage: stage.id, operation: stage.operation, postId: def.id, posts: [{ postId: def.id, from: this.minute }], startedAt: this.minute, norm: stage.norms[v.modelId], work: v.work[stage.id], remaining: v.work[stage.id], completedAt: null, pauseReason: null };
        this.executions.push(exec); v.executionIds.push(exec.id);
        Object.assign(this.posts[def.id], { vehicleId: v.id, executionId: exec.id });
        Object.assign(v, { location: { type: 'post', id: def.id }, currentExecutionId: exec.id, stageIndex: i });
        if (i === 0) v.startedAt = this.minute;
        this.log('operation_started', `${v.id}: начата операция «${stage.operation}» на ${def.code} (норматив ${exec.norm} мин)`, { vehicleId: v.id, postId: def.id, orderId: v.orderId, executionId: exec.id });
      }
    }
  }
  tick() {
    const done = [];
    for (const def of POSTS) {
      const post = this.posts[def.id], incident = this.postIncident(def.id), speed = incident ? INCIDENT_KINDS[incident.kind].speed : 1;
      const exec = post.executionId ? this.execution(post.executionId) : null;
      if (speed === 0) { post.stats.fault++; if (exec && exec.completedAt === null) exec.pauseReason = `Неисправность ${def.code}`; continue; }
      if (!exec) { post.stats.starved++; continue; }
      if (exec.completedAt !== null) { post.stats.blocked++; continue; }
      const step = Math.min(speed, exec.remaining);
      exec.pauseReason = null; exec.remaining = round(exec.remaining - step, 6);
      post.stats.run++; post.stats.nominal += step * exec.norm / exec.work;
      if (exec.remaining <= 0) { exec.remaining = 0; done.push(exec); }
    }
    this.minute++;
    for (const i of this.incidents.filter(i => i.status === 'active' && i.expires <= this.minute)) this.resolveIncident(i.id, true);
    for (const exec of done) {
      const v = this.vehicle(exec.vehicleId), def = POST[exec.postId];
      exec.completedAt = this.minute; this.posts[def.id].stats.completed++;
      this.log('operation_completed', `${v.id}: завершена операция «${exec.operation}» на ${def.code}`, { vehicleId: v.id, postId: def.id, orderId: v.orderId, executionId: exec.id });
      if (exec.stage === 'quality') {
        v.accepted = true; v.acceptedAt = this.minute;
        this.log('vehicle_accepted', `${v.id} принят контролем и засчитан в годный выпуск`, { vehicleId: v.id, postId: def.id, orderId: v.orderId });
      }
    }
    this.flow();
    if (this.minute % 5 === 0 || this.minute === SHIFT) this.history.push({ minute: this.minute, accepted: this.acceptedCount() });
    if (this.minute >= SHIFT) this.finishShift();
  }
  finishShift() {
    if (this.finished) return;
    this.finished = true; this.running = false;
    // No invented completions: vehicles stay where they are, executions stay open, incidents become "not resolved".
    for (const i of this.incidents.filter(i => i.status === 'active')) { i.status = 'unresolved'; i.resolution = 'Не устранён к концу смены'; }
    const open = this.vehicles.filter(v => !v.accepted).length;
    this.log('shift_finished', `Смена завершена. Не приняты к концу смены: ${open} автомобил${open % 10 === 1 && open % 100 !== 11 ? 'ь' : 'ей'}; они остаются на своих местах`);
  }
  advance(minutes = 5) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new SimulationError('Шаг должен быть от 1 до 60 минут');
    for (let n = 0; n < minutes && this.minute < SHIFT; n++) this.tick();
    if (this.minute >= SHIFT) this.finishShift();
    this.revision++;
  }
  clone() {
    const { _forecast, planProfile, ...data } = this;
    return Object.assign(Object.create(Workshop.prototype), structuredClone(data), { planProfile });
  }
  // Forecast on a copy: same queues, resources and known recoveries; never touches this state or its PRNG.
  forecast() {
    if (this._forecast?.revision === this.revision) return this._forecast.value;
    const plan = this.planProfile ? this.planProfile[SHIFT] : null;
    const run = mutate => {
      const copy = this.clone(); mutate?.(copy);
      const start = Object.fromEntries(STAGES.map(s => [s.id, postsOf(s.id).reduce((a, p) => a + copy.posts[p.id].stats.run, 0)]));
      const trajectory = [{ minute: copy.minute, accepted: copy.acceptedCount() }];
      while (copy.minute < SHIFT) { copy.tick(); if (copy.minute % 5 === 0 || copy.minute === SHIFT) trajectory.push({ minute: copy.minute, accepted: copy.acceptedCount() }); }
      copy.finishShift();
      const window = SHIFT - this.minute;
      const load = STAGES.map(s => ({ id: s.id, name: s.name, utilization: window > 0 ? (postsOf(s.id).reduce((a, p) => a + copy.posts[p.id].stats.run, 0) - start[s.id]) / (postsOf(s.id).length * window) : 0 }));
      return { accepted: copy.acceptedCount(), trajectory, load, open: copy.vehicles.filter(v => !v.accepted).length };
    };
    const active = this.incidents.filter(i => i.status === 'active');
    const base = run(), pessimistic = active.length ? run(c => { for (const i of c.incidents) if (i.status === 'active') i.expires = Infinity; }) : null;
    const limiting = base.load.reduce((a, b) => b.utilization > a.utilization ? b : a);
    const value = {
      projected: base.accepted, low: pessimistic ? pessimistic.accepted : base.accepted, high: base.accepted, plan, gap: plan === null ? null : base.accepted - plan,
      openAtEnd: base.open, trajectory: base.trajectory, load: base.load.map(l => ({ ...l, utilization: round(l.utilization) })),
      limiting: this.minute < SHIFT ? { ...limiting, utilization: round(limiting.utilization) } : null,
      scenarios: pessimistic ? [{ name: 'Активные инциденты восстанавливаются по расчёту', accepted: base.accepted }, { name: 'Активные инциденты не устранены до конца смены', accepted: pessimistic.accepted }] : [{ name: 'Без новых инцидентов', accepted: base.accepted }],
      constraints: active.map(i => `${i.title}: до ${clock(i.expires)}${i.expires > SHIFT ? ' (после конца смены)' : ''}`),
      method: 'Копия текущего состояния прогоняется тем же движком до 16:00: те же очереди, посты, приоритеты и известные сроки восстановления. Новые инциденты не предполагаются.',
      assumption: 'Сценарный расчёт, не статистический интервал и не ML-модель. Нижняя граница — если активные инциденты не будут устранены до конца смены.',
    };
    this._forecast = { revision: this.revision, value };
    return value;
  }
  vehicleView(v) {
    const order = this.order(v.orderId), exec = v.currentExecutionId ? this.execution(v.currentExecutionId) : null;
    const route = STAGES.map((s, i) => {
      const execs = v.executionIds.map(id => this.execution(id)).filter(e => e.stage === s.id), last = execs.at(-1);
      const status = !last ? 'pending' : last.completedAt !== null ? 'done' : 'current';
      return { stage: s.id, stageName: s.name, operation: s.operation, norm: s.norms[v.modelId], work: v.work[s.id], status, postId: last?.postId ?? null, postCode: last ? POST[last.postId].code : null, startedAt: last?.startedAt ?? null, completedAt: last?.completedAt ?? null, progress: last ? round(1 - last.remaining / last.work) : 0, index: i };
    });
    let state, status;
    if (v.shipped) { state = 'shipped'; status = `Отгружен в ${clock(v.shippedAt)}`; }
    else if (v.location.type === 'buffer') {
      const buffer = STAGES.find(s => s.buffer.id === v.location.id).buffer;
      state = v.location.id === 'BACKLOG' ? 'not_started' : v.location.id === 'FG' ? 'ready' : 'waiting';
      const pos = this.queueOrder(v.location.id).indexOf(v.id) + 1;
      status = v.location.id === 'FG' ? `Принят, ждёт отгрузки · ${buffer.name}, ${pos}-й в очереди` : `Ожидает: ${STAGES[v.stageIndex].operation.toLowerCase()} · ${buffer.name}, ${pos}-й в очереди`;
    } else {
      const code = POST[v.location.id].code;
      if (exec.completedAt !== null) { state = 'blocked'; status = `Операция выполнена на ${code}, ждёт места: ${STAGES[v.stageIndex + 1]?.buffer.name ?? ''}`; }
      else if (this.finished) { state = 'stopped'; status = `Смена завершена: «${exec.operation}» на ${code} выполнена на ${Math.round((1 - exec.remaining / exec.work) * 100)}%`; }
      else if (this.isBroken(v.location.id)) { state = 'paused'; status = `Пауза: неисправность ${code}`; }
      else { state = 'processing'; status = `${exec.operation} · ${code}`; }
    }
    return {
      id: v.id, seq: v.seq, orderId: v.orderId, modelId: v.modelId, modelName: MODELS[v.modelId].name, priority: order.priority, routeVersion: v.routeVersion,
      state, status, accepted: v.accepted, acceptedAt: v.acceptedAt, shipped: v.shipped, shippedAt: v.shippedAt, createdAt: v.createdAt, startedAt: v.startedAt,
      location: { ...v.location }, currentOperation: exec ? { executionId: exec.id, stage: exec.stage, operation: exec.operation, postId: exec.postId, postCode: POST[exec.postId].code, progress: round(1 - exec.remaining / exec.work), remaining: round(exec.remaining, 1), norm: exec.norm, work: exec.work, startedAt: exec.startedAt, completedAt: exec.completedAt, pauseReason: exec.pauseReason, posts: exec.posts.map(p => ({ ...p, postCode: POST[p.postId].code })) } : null,
      route,
    };
  }
  postView(def) {
    const post = this.posts[def.id], incident = this.postIncident(def.id) ?? null;
    const exec = post.executionId ? this.execution(post.executionId) : null, stage = STAGE[def.stage];
    const nextBuffer = STAGES[stage.index + 1]?.buffer;
    let state, reason = null;
    if (incident && INCIDENT_KINDS[incident.kind].speed === 0) { state = 'fault'; reason = `${incident.cause}. Расчётное восстановление ${clock(incident.expires)}${exec && exec.completedAt === null ? `; операция ${exec.vehicleId} на паузе` : ''}`; }
    else if (exec && exec.completedAt !== null) { state = 'blocked'; reason = `Операция завершена, «${nextBuffer.name}» заполнен (${this.buffers[nextBuffer.id].length}/${nextBuffer.capacity})`; }
    else if (exec) { state = incident ? 'slow' : 'working'; if (incident) reason = `${incident.cause}. Расчётное восстановление ${clock(incident.expires)}`; }
    else { state = 'idle'; reason = `Нет автомобилей в очереди «${stage.buffer.name}»${incident ? `; ${incident.cause.toLowerCase()}` : ''}`; }
    if (this.finished) { state = 'shift_over'; reason = !exec ? 'Смена завершена' : exec.completedAt !== null ? `Смена завершена; ${exec.vehicleId} ждёт перемещения в следующий буфер` : `Смена завершена; ${exec.vehicleId} остаётся на посту, операция не завершена`; }
    return {
      id: def.id, code: def.code, stage: def.stage, stageName: stage.name, capacity: def.capacity, state, reason, incidentId: incident?.id ?? null,
      vehicleId: post.vehicleId, operation: exec ? exec.operation : null, progress: exec ? round(1 - exec.remaining / exec.work) : null, remaining: exec ? round(exec.remaining, 1) : null,
      stats: { ...post.stats, nominal: round(post.stats.nominal, 2) }, metrics: postOee(post.stats, this.minute),
    };
  }
  totals() {
    const notStarted = this.vehicles.filter(v => v.startedAt === null).length;
    const inProcess = this.vehicles.filter(v => v.startedAt !== null && !v.accepted).length;
    const ready = this.vehicles.filter(v => v.accepted && !v.shipped).length;
    const shipped = this.vehicles.filter(v => v.shipped).length;
    const created = this.vehicles.length;
    return { created, notStarted, inProcess, ready, shipped, accepted: ready + shipped, wip: inProcess, balanced: created === notStarted + inProcess + ready + shipped };
  }
  snapshot() {
    const totals = this.totals(), plan = this.planProfile;
    const accepted = this.vehicles.filter(v => v.accepted).sort((a, b) => a.acceptedAt - b.acceptedAt);
    const leads = accepted.filter(v => v.startedAt !== null).map(v => v.acceptedAt - v.startedAt);
    return {
      synthetic: true, seed: this.seed, revision: this.revision, elapsed: this.minute, shift: SHIFT, shiftStart: SHIFT_START,
      running: this.running, speed: this.speed, finished: this.finished, maxVehicles: MAX_VEHICLES, maxOrderQuantity: MAX_ORDER_QUANTITY,
      models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, norms: Object.fromEntries(STAGES.map(s => [s.id, s.norms[id]])) })),
      priorities: Object.entries(PRIORITIES).map(([id, p]) => ({ id, ...p })),
      incidentKinds: Object.entries(INCIDENT_KINDS).map(([id, k]) => ({ id, title: k.title, duration: k.duration, speed: k.speed })),
      stages: STAGES.map(s => ({ id: s.id, name: s.name, operation: s.operation, postIds: postsOf(s.id).map(p => p.id), buffer: { ...s.buffer, vehicleIds: this.queueOrder(s.buffer.id) } })),
      posts: POSTS.map(p => this.postView(p)),
      vehicles: this.vehicles.map(v => this.vehicleView(v)),
      orders: this.orders.map(o => {
        const vs = o.vehicleIds.map(id => this.vehicle(id)), done = vs.filter(v => v.accepted).length, started = vs.filter(v => v.startedAt !== null).length;
        return { ...o, vehicleIds: [...o.vehicleIds], accepted: done, shipped: vs.filter(v => v.shipped).length, started, notStarted: o.quantity - started, inProcess: started - done, state: done === o.quantity ? 'completed' : started ? 'in_progress' : 'released', overdue: done < o.quantity && this.minute > o.dueMinute };
      }),
      incidents: this.incidents.map(i => ({ ...i })),
      events: this.events.slice(-400).map(e => ({ ...e })),
      totals,
      plan: plan ? { total: plan[SHIFT], now: plan[this.minute], profile: plan.map((accepted, minute) => ({ minute, accepted })).filter(p => p.minute % 5 === 0), method: 'Эталонный прогон того же движка: тот же seed и начальные задания, без инцидентов, до 16:00.' } : null,
      history: this.history.map(h => ({ ...h })),
      leadTime: leads.length ? { average: round(leads.reduce((a, b) => a + b, 0) / leads.length, 1), count: leads.length } : null,
      forecast: this.forecast(),
    };
  }
}
