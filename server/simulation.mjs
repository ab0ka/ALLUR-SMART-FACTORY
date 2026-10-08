// Allur Smart Factory — single authoritative workshop engine. Vehicles, posts, buffers, orders, quality inspection
// with rework, equipment degradation with diagnostics and repair, problems, plan and belief-based forecasts.
// Every vehicle, order, post, norm, measurement, part, tariff and layout here is SYNTHETIC, not Allur data.
import { LIFT_MODEL_VERSION, HYPOTHESES, CHECKS, CHANNELS, NOMINAL, UNITS, CHANNEL_NAMES, degradationAt, reading, liftSpeed, features, anomalyScore, hypothesisEvidence, hashUniform, hashNormal } from './equipment.mjs';

export const SHIFT = 480;
export const SHIFT_START = 8 * 60;
export const WARMUP = 180;
export const MAX_VEHICLES = 24;
export const MAX_ORDER_QUANTITY = 8;
export const DEFAULT_PLAN_TARGET = 16;
export const DEFECT_RATE = .15;
export const ANOMALY_THRESHOLD = 4.5;
export const PRIORITIES = { high: { rank: 0, name: 'Высокий' }, normal: { rank: 1, name: 'Обычный' }, low: { rank: 2, name: 'Низкий' } };
export const MODELS = { A: { name: 'Модель A' }, B: { name: 'Модель B' }, C: { name: 'Модель C' } };
export const STAGES = [
  { id: 'weld', name: 'Сварка', operation: 'Сварка кузова', norms: { A: 28, B: 30, C: 33 }, buffer: { id: 'BACKLOG', name: 'Входной буфер кузовов', capacity: null } },
  { id: 'paint', name: 'Окраска', operation: 'Окраска кузова', norms: { A: 30, B: 33, C: 35 }, buffer: { id: 'B1', name: 'Буфер перед окраской', capacity: 3 } },
  { id: 'assembly', name: 'Сборка', operation: 'Сборка и комплектация', norms: { A: 50, B: 56, C: 62 }, buffer: { id: 'B2', name: 'Буфер перед сборкой', capacity: 3 } },
  { id: 'quality', name: 'Контроль', operation: 'Контроль качества', norms: { A: 22, B: 24, C: 26 }, buffer: { id: 'B3', name: 'Буфер перед контролем', capacity: 2 } },
  { id: 'shipping', name: 'Отгрузка', operation: 'Передача в отгрузку', norms: { A: 8, B: 8, C: 8 }, buffer: { id: 'FG', name: 'Готовые автомобили', capacity: 4 } },
];
export const REWORK = { id: 'rework', name: 'Доработка', operation: 'Доработка дефекта', norm: 20, buffer: { id: 'RWQ', name: 'Очередь доработки', capacity: null } };
export const POSTS = [
  ['W1', 'СВ-1', 'weld'], ['W2', 'СВ-2', 'weld'], ['P1', 'ОК-1', 'paint'], ['P2', 'ОК-2', 'paint'],
  ['A1', 'СБ-1', 'assembly'], ['A2', 'СБ-2', 'assembly'], ['A3', 'СБ-3', 'assembly'],
  ['Q1', 'КК-1', 'quality'], ['Q2', 'КК-2', 'quality'], ['S1', 'ОТ-1', 'shipping'], ['R1', 'ДР-1', 'rework'],
].map(([id, code, stage]) => ({ id, code, stage, capacity: 1 }));
export const DEFECTS = { weld: 'Сварной шов: непровар', paint: 'Покрытие: включения', assembly: 'Зазор двери вне допуска' };
export const LIFTS = ['A1', 'A2', 'A3'].map(postId => ({ id: `LIFT-${postId}`, postId, name: `Гидроподъёмник ${POSTS.find(p => p.id === postId).code}` }));
export const TECHNICIANS = [{ id: 'T1', name: 'ТЕХ-1 (синтетический ремонтник)' }];
export const STOCK_ITEMS = { seal_kit: { name: 'Ремкомплект уплотнений гидроцилиндра', onHand: 2, cost: 4000 }, pump: { name: 'Гидронасос подъёмника', onHand: 1, cost: 26000 } };
export const TARIFFS = { technicianPerMinute: 25, currency: 'усл. ед.', note: 'Синтетические тарифы демо: работа техника и стоимость запчастей. Стоимость потерянного выпуска не оценивается.' };
export const JOB_KINDS = {
  pressure_hold: { title: 'Тест удержания давления', type: 'check', duration: 15, stopsPost: true, lift: true },
  pump_check: { title: 'Замер тока и температуры насоса', type: 'check', duration: 10, stopsPost: false, lift: true },
  repair_seal: { title: 'Замена уплотнений гидроцилиндра', type: 'repair', duration: 35, stopsPost: true, lift: true, part: 'seal_kit', fixes: 'leak' },
  repair_pump: { title: 'Замена гидронасоса', type: 'repair', duration: 55, stopsPost: true, lift: true, part: 'pump', fixes: 'wear' },
  verify: { title: 'Проверка после ремонта', type: 'verify', duration: 5, stopsPost: true, lift: true, internal: true },
  repair_generic: { title: 'Аварийный ремонт поста', type: 'repair', duration: 30, stopsPost: true, incident: 'breakdown' },
  adjust: { title: 'Наладка поста', type: 'repair', duration: 10, stopsPost: false, incident: 'slowdown' },
};
const STAGE_CAUSES = { weld: 'отказ сварочного манипулятора', paint: 'недоступность камеры окраски', assembly: 'отказ оборудования сборки', quality: 'отказ стенда контроля', shipping: 'неисправность транспортной тележки', rework: 'отказ оборудования доработки' };
export const INCIDENT_KINDS = {
  breakdown: { title: 'Неисправность поста', duration: null, speed: 0, severity: 'critical', advice: 'Назначить аварийный ремонт; если параллельный пост свободен, перевести на него автомобиль.' },
  slowdown: { title: 'Снижение темпа поста', duration: 60, speed: .6, severity: 'warning', advice: 'Назначить наладку поста или дождаться восстановления темпа.' },
  lift_failure: { title: 'Отказ гидроподъёмника', duration: null, speed: 0, severity: 'critical', advice: 'Определить причину проверкой и выполнить соответствующий ремонт.', internal: true },
};
export const DEFAULT_ORDERS = [
  { modelId: 'A', quantity: 6, priority: 'normal', dueMinute: 300 },
  { modelId: 'B', quantity: 8, priority: 'normal', dueMinute: 480 },
  { modelId: 'C', quantity: 6, priority: 'low', dueMinute: 600 },
];
// The default demo has one hidden degradation episode on a lift; its cause is drawn from the seed and never shown.
export const defaultEpisode = seed => ({ postId: 'A2', cause: hashUniform(seed, 'episode-cause') < .5 ? 'leak' : 'wear', onset: 150, duration: 170 });
export class SimulationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}
export const clock = m => `${String(Math.floor((SHIFT_START + m) / 60)).padStart(2, '0')}:${String((SHIFT_START + m) % 60).padStart(2, '0')}`;
const STAGE = Object.fromEntries([...STAGES.map((s, i) => [s.id, { ...s, index: i }]), ['rework', { ...REWORK, index: 3.5 }]]);
const POST = Object.fromEntries(POSTS.map(p => [p.id, p]));
const LIFT_BY_POST = Object.fromEntries(LIFTS.map(l => [l.postId, l]));
const postsOf = stageId => POSTS.filter(p => p.stage === stageId);
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const planCache = new Map();
const beliefDefect = (seed, vehicleId) => hashUniform(seed, 'belief-defect', vehicleId) < DEFECT_RATE ? ['weld', 'paint', 'assembly'][Math.floor(hashUniform(seed, 'belief-code', vehicleId) * 3)] : null;

// Post OEE over planned (elapsed) time: A = run / planned, P = nominal work / run, Q = good operations / completed.
export function postOee({ run, nominal }, elapsed, quality = 1) {
  const availability = elapsed > 0 ? run / elapsed : 0;
  const performance = run > 0 ? Math.min(1, nominal / run) : 0;
  return { availability, performance, quality, oee: availability * performance * quality };
}

export class Workshop {
  constructor({ seed = 42, warmup = WARMUP, plan = true, episode = 'default', beliefDefects = false } = {}) { this.reset(seed, warmup, plan, episode, beliefDefects); }
  reset(seed = 42, warmup = WARMUP, plan = true, episode = 'default', beliefDefects = false) {
    Object.assign(this, {
      seed: seed >>> 0, rng: seed >>> 0, minute: 0, running: false, speed: 5, finished: false, beliefDefects,
      revision: (this.revision || 0) + 1, recordVersion: (this.recordVersion || 0) + 1,
      eventSeq: 0, orderSeq: 100, vehicleSeq: 0, executionSeq: 0, incidentSeq: 0, problemSeq: 0, jobSeq: 0, inspectionSeq: 0, experimentSeq: 0, decisionSeq: 0,
      orders: [], vehicles: [], executions: [], incidents: [], events: [], shipped: [], history: [{ minute: 0, accepted: 0 }],
      jobs: [], problems: [], inspections: [], experiments: [], decisions: [], chat: [], requests: {}, holds: {}, planTarget: DEFAULT_PLAN_TARGET,
    });
    this.buffers = Object.fromEntries([...STAGES.map(s => [s.buffer.id, []]), [REWORK.buffer.id, []]]);
    this.posts = Object.fromEntries(POSTS.map(p => [p.id, { vehicleId: null, executionId: null, stats: { run: 0, fault: 0, maintenance: 0, starved: 0, blocked: 0, nominal: 0, completed: 0 } }]));
    this.technicians = Object.fromEntries(TECHNICIANS.map(t => [t.id, { jobId: null, busyMinutes: 0 }]));
    this.stock = Object.fromEntries(Object.entries(STOCK_ITEMS).map(([id, s]) => [id, { onHand: s.onHand, reserved: 0, used: 0 }]));
    const ep = episode === 'default' ? defaultEpisode(this.seed) : episode || null;
    this.equipment = Object.fromEntries(LIFTS.map(l => [l.id, { readings: [], failed: false, failedAt: null, problemId: null, active: false,
      hidden: ep && ep.postId === l.postId ? { cause: ep.cause, base: 0, t0: ep.onset, rate: 1 / ep.duration } : { cause: null, base: 0, t0: 0, rate: 0 } }]));
    for (const order of DEFAULT_ORDERS) this.releaseOrder(order, 'system');
    this.planProfile = plan ? Workshop.planProfile(this.seed) : null;
    for (let i = 0; i < warmup; i += 5) this.advance(Math.min(5, warmup - i));
    this.revision++;
  }
  // Reference capacity: the same engine and default orders, no equipment episode, no incidents, typical defect rate.
  static planProfile(seed) {
    if (!planCache.has(seed)) {
      const ideal = new Workshop({ seed, warmup: 0, plan: false, episode: false, beliefDefects: true }), profile = [0];
      while (ideal.minute < SHIFT) { ideal.tick(); profile.push(ideal.acceptedCount()); }
      planCache.set(seed, Object.freeze(profile));
    }
    return planCache.get(seed);
  }
  random() { this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0; return this.rng / 4294967296; }
  log(type, text, refs = {}, actor = 'system') { this.events.push({ seq: ++this.eventSeq, minute: this.minute, type, actor, text, ...Object.fromEntries(Object.entries(refs).filter(([, v]) => v !== undefined && v !== null)) }); }
  vehicle(id) { return this.vehicles.find(v => v.id === id); }
  order(id) { return this.orders.find(o => o.id === id); }
  execution(id) { return this.executions.find(e => e.id === id); }
  job(id) { return this.jobs.find(j => j.id === id); }
  problem(id) { return this.problems.find(p => p.id === id); }
  postIncident(postId) { return this.incidents.find(i => i.postId === postId && i.status === 'active'); }
  liftOf(postId) { return LIFT_BY_POST[postId] ? this.equipment[LIFT_BY_POST[postId].id] : null; }
  isBroken(postId) { const i = this.postIncident(postId); return Boolean(i && INCIDENT_KINDS[i.kind].speed === 0) || Boolean(this.liftOf(postId)?.failed); }
  runningStopJob(postId) { return this.jobs.find(j => j.postId === postId && j.status === 'running' && JOB_KINDS[j.kind].stopsPost); }
  openProblemFor(postId) { return this.problems.find(p => p.postId === postId && p.status === 'open'); }
  acceptedCount() { return this.vehicles.filter(v => v.accepted).length; }
  requireOpenShift() { if (this.finished) throw new SimulationError('Смена завершена. Сбросьте демо.', 409); }
  touch() { this.revision++; }

  // ---------------- Orders and planning ----------------
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
      const r1 = this.random(), r2 = this.random();
      const defect = this.beliefDefects ? beliefDefect(this.seed, id) : r1 < DEFECT_RATE ? ['weld', 'paint', 'assembly'][Math.floor(r2 * 3)] : null;
      this.vehicles.push({ id, seq, orderId: order.id, modelId, routeVersion: 'R2-synthetic', createdAt: this.minute, readyAt: this.minute, stageIndex: 0, location: { type: 'buffer', id: 'BACKLOG' }, currentExecutionId: null, startedAt: null, accepted: false, acceptedAt: null, shipped: false, shippedAt: null, reworked: false, work, executionIds: [], hidden: { defect } });
      this.buffers.BACKLOG.push(id); order.vehicleIds.push(id);
      this.log('vehicle_created', `Автомобиль ${id} создан по заданию ${order.id}`, { vehicleId: id, orderId: order.id }, actor);
    }
    this.flow(); this.touch();
    return order;
  }
  setPriority(orderId, priority, actor = 'operator') {
    this.requireOpenShift();
    const order = typeof orderId === 'string' ? this.order(orderId) : null;
    if (!order) throw new SimulationError('Задание не найдено', 404);
    if (typeof priority !== 'string' || !Object.hasOwn(PRIORITIES, priority)) throw new SimulationError('Неизвестный приоритет');
    if (order.vehicleIds.every(id => this.vehicle(id).accepted)) throw new SimulationError('Задание уже выполнено', 409);
    if (order.priority === priority) return;
    const before = order.priority; order.priority = priority;
    this.log('priority_changed', `Приоритет ${order.id}: «${PRIORITIES[before].name.toLowerCase()}» → «${PRIORITIES[priority].name.toLowerCase()}». Начатые операции не прерываются`, { orderId: order.id }, actor);
    this.touch();
  }
  setPlanTarget(target, actor = 'operator') {
    if (!Number.isInteger(target) || target < 1 || target > MAX_VEHICLES) throw new SimulationError(`План смены — целое число от 1 до ${MAX_VEHICLES}`);
    if (target === this.planTarget) return;
    const before = this.planTarget; this.planTarget = target;
    this.log('plan_changed', `План смены изменён оператором: ${before} → ${target} принятых автомобилей`, {}, actor);
    this.touch();
  }
  setHold(postId, on, actor = 'operator') {
    this.requireOpenShift();
    if (typeof postId !== 'string' || !Object.hasOwn(POST, postId)) throw new SimulationError('Пост не найден', 404);
    if (typeof on !== 'boolean') throw new SimulationError('Укажите on: true или false');
    if (Boolean(this.holds[postId]) === on) return;
    if (on) {
      const free = postsOf(POST[postId].stage).filter(p => p.id !== postId && !this.holds[p.id]);
      if (!free.length) throw new SimulationError('Нельзя снять нагрузку с последнего поста участка', 409);
      this.holds[postId] = true;
    } else delete this.holds[postId];
    this.log('hold_changed', on ? `${POST[postId].code}: новые автомобили на пост не направляются (текущая операция продолжается)` : `${POST[postId].code}: пост снова принимает автомобили`, { postId }, actor);
    this.flow(); this.touch();
  }

  // ---------------- Incidents, problems, jobs ----------------
  injectIncident(postId, kind, actor = 'operator') {
    this.requireOpenShift();
    if (typeof postId !== 'string' || !Object.hasOwn(POST, postId)) throw new SimulationError('Пост не найден', 404);
    if (typeof kind !== 'string' || !Object.hasOwn(INCIDENT_KINDS, kind) || INCIDENT_KINDS[kind].internal) throw new SimulationError('Неизвестный тип инцидента');
    if (this.postIncident(postId)) throw new SimulationError('На этом посту уже есть активный инцидент', 409);
    return this.createIncident(postId, kind, actor);
  }
  createIncident(postId, kind, actor = 'system') {
    const spec = INCIDENT_KINDS[kind], post = POST[postId];
    const cause = kind === 'lift_failure' ? 'Подъёмник остановился; причина устанавливается проверкой' : kind === 'breakdown' ? `Ручной сценарий демо: ${STAGE_CAUSES[post.stage]}; причина не диагностируется` : 'Ручной сценарий демо: темп поста снижен до 60%';
    const incident = { id: ++this.incidentSeq, kind, postId, postCode: post.code, stage: post.stage, stageName: STAGE[post.stage].name, title: `${spec.title} ${post.code}`, severity: spec.severity, cause, advice: spec.advice, start: this.minute, expires: spec.duration ? this.minute + spec.duration : null, end: null, status: 'active', resolution: null, vehicleId: this.posts[postId].vehicleId };
    this.incidents.unshift(incident);
    this.log('incident_started', `${incident.title}: ${cause}`, { incidentId: incident.id, postId, vehicleId: incident.vehicleId }, actor);
    if (kind !== 'lift_failure') this.createProblem({ kind: 'incident', postId, incidentId: incident.id, title: incident.title, observation: `${incident.title} (${actor === 'operator' ? 'ручной сценарий' : 'система'})` });
    this.touch();
    return incident;
  }
  resolveIncident(id, resolution) {
    const item = this.incidents.find(i => i.id === id && i.status === 'active');
    if (!item) return;
    item.status = 'resolved'; item.end = this.minute; item.resolution = resolution;
    this.log('incident_resolved', `${item.title}: ${resolution.toLowerCase()}`, { incidentId: item.id, postId: item.postId });
    const problem = this.problems.find(p => p.incidentId === item.id && p.status === 'open');
    if (problem) this.closeProblem(problem, resolution);
  }
  createProblem({ kind, postId, incidentId = null, equipmentId = null, title, observation }) {
    const vehicleIds = [this.posts[postId].vehicleId, ...(this.buffers[STAGE[POST[postId].stage].buffer.id] || [])].filter(Boolean);
    const problem = { id: `PR-${++this.problemSeq}`, kind, postId, incidentId, equipmentId, title, detectedAt: this.minute, status: 'open', resolvedAt: null, resolution: null,
      initialVehicleIds: vehicleIds, observations: [{ minute: this.minute, text: observation }], checks: [], hypothesisStatus: {}, decisionIds: [] };
    this.problems.unshift(problem);
    this.log('problem_detected', `${problem.id} обнаружена: ${title}`, { problemId: problem.id, postId, equipmentId });
    if (equipmentId) this.equipment[equipmentId].problemId = problem.id;
    return problem;
  }
  closeProblem(problem, resolution) {
    problem.status = 'resolved'; problem.resolvedAt = this.minute; problem.resolution = resolution;
    problem.observations.push({ minute: this.minute, text: `Проблема закрыта: ${resolution}` });
    if (problem.equipmentId) Object.assign(this.equipment[problem.equipmentId], { problemId: null, lastResolvedAt: this.minute });
    if (this.holds[problem.postId]) { delete this.holds[problem.postId]; this.log('hold_changed', `${POST[problem.postId].code}: ограничение загрузки снято после устранения`, { postId: problem.postId }); }
    this.log('problem_resolved', `${problem.id} закрыта: ${resolution}`, { problemId: problem.id, postId: problem.postId });
  }
  jobAvailability(postId, kind) {
    if (typeof postId !== 'string' || !Object.hasOwn(POST, postId)) return { ok: false, status: 404, reason: 'Пост не найден' };
    if (typeof kind !== 'string' || !Object.hasOwn(JOB_KINDS, kind) || JOB_KINDS[kind].internal) return { ok: false, status: 400, reason: 'Неизвестный вид работ' };
    const spec = JOB_KINDS[kind], code = POST[postId].code;
    if (this.finished) return { ok: false, status: 409, reason: 'Смена завершена' };
    if (spec.lift && !this.liftOf(postId)) return { ok: false, status: 409, reason: `На ${code} нет гидроподъёмника` };
    if (spec.incident && this.postIncident(postId)?.kind !== spec.incident) return { ok: false, status: 409, reason: spec.incident === 'breakdown' ? `На ${code} нет активной неисправности` : `На ${code} нет снижения темпа` };
    if (this.jobs.some(j => j.postId === postId && j.kind === kind && ['queued', 'running'].includes(j.status))) return { ok: false, status: 409, reason: `${spec.title} на ${code} уже запланирована` };
    if (spec.type === 'repair' && spec.lift && this.jobs.some(j => j.postId === postId && JOB_KINDS[j.kind].type === 'repair' && ['queued', 'running'].includes(j.status))) return { ok: false, status: 409, reason: `На ${code} уже запланирован другой ремонт` };
    if (spec.part) { const s = this.stock[spec.part]; if (s.onHand - s.reserved < 1) return { ok: false, status: 409, reason: `Нет на складе: ${STOCK_ITEMS[spec.part].name} (доступно ${s.onHand - s.reserved})` }; }
    return { ok: true };
  }
  createJob({ postId, kind, followUp = null, decisionId = null, urgent = false }, actor = 'operator') {
    const spec = JOB_KINDS[kind];
    if (!(spec?.internal && actor === 'system')) { const a = this.jobAvailability(postId, kind); if (!a.ok) throw new SimulationError(a.reason, a.status); }
    if (followUp !== null && (followUp !== 'repair_by_result' || spec.type !== 'check')) throw new SimulationError('Последующее действие допустимо только для проверки: repair_by_result');
    if (spec.part) this.stock[spec.part].reserved++;
    const problem = this.openProblemFor(postId);
    const job = { id: `JOB-${++this.jobSeq}`, kind, title: spec.title, type: spec.type, postId, postCode: POST[postId].code, equipmentId: LIFT_BY_POST[postId]?.id ?? null, problemId: problem?.id ?? null,
      technicianId: null, createdAt: this.minute, startedAt: null, completedAt: null, duration: spec.duration, remaining: spec.duration, status: 'queued', part: spec.part ?? null, followUp, decisionId, urgent, result: null };
    if (urgent) { const i = this.jobs.findIndex(j => j.status === 'queued'); this.jobs.splice(i < 0 ? this.jobs.length : i, 0, job); } else this.jobs.push(job);
    this.log('job_created', `${job.id}: «${job.title}» на ${job.postCode} запланирована${spec.part ? `, зарезервировано: ${STOCK_ITEMS[spec.part].name}` : ''}`, { jobId: job.id, postId, problemId: job.problemId }, actor);
    this.startJobs(); this.touch();
    return job;
  }
  startJobs() {
    for (const [tid, tech] of Object.entries(this.technicians)) {
      if (tech.jobId || this.finished) continue;
      const job = this.jobs.find(j => j.status === 'queued');
      if (!job) break;
      Object.assign(job, { status: 'running', startedAt: this.minute, technicianId: tid }); tech.jobId = job.id;
      this.log('job_started', `${job.id}: ${TECHNICIANS.find(t => t.id === tid).name} начал «${job.title}» на ${job.postCode}${JOB_KINDS[job.kind].stopsPost ? ' — пост остановлен на время работ' : ' — без остановки поста'}`, { jobId: job.id, postId: job.postId });
    }
  }
  completeJob(job) {
    const spec = JOB_KINDS[job.kind], eq = job.equipmentId ? this.equipment[job.equipmentId] : null, problem = job.problemId ? this.problem(job.problemId) : null;
    job.status = 'done'; job.completedAt = this.minute; job.remaining = 0;
    this.technicians[job.technicianId].jobId = null;
    if (spec.part) { const s = this.stock[spec.part]; s.reserved--; s.onHand--; s.used++; }
    if (spec.type === 'check') {
      const check = CHECKS[job.kind], d = degradationAt(eq.hidden, this.minute);
      const value = round(check.value(eq.hidden.cause, d, hashNormal(this.seed, job.id, 'check')), 1), verdict = check.interpret(value);
      job.result = { value, unit: check.unit, measure: check.measure, text: verdict.text };
      this.log('check_completed', `${job.id}: ${check.title} на ${job.postCode} — ${check.measure.toLowerCase()} ${value} ${check.unit}: ${verdict.text}`, { jobId: job.id, postId: job.postId, problemId: job.problemId });
      if (problem) {
        problem.checks.push({ jobId: job.id, kind: job.kind, title: check.title, minute: this.minute, value, unit: check.unit, measure: check.measure, text: verdict.text });
        for (const h of Object.keys(HYPOTHESES)) if (verdict[h]) problem.hypothesisStatus[h] = { status: verdict[h], by: job.id, minute: this.minute };
        problem.observations.push({ minute: this.minute, text: `${check.title}: ${check.measure.toLowerCase()} ${value} ${check.unit} — ${verdict.text}` });
      }
      if (job.followUp === 'repair_by_result') {
        const cause = this.indicatedCause(problem);
        if (!cause) this.log('follow_up_skipped', `${job.id}: результат не указывает однозначную причину — ремонт по результату не назначен, нужна дополнительная проверка`, { jobId: job.id, problemId: job.problemId });
        else {
          const kind = HYPOTHESES[cause].repair, a = this.jobAvailability(job.postId, kind);
          if (a.ok) this.createJob({ postId: job.postId, kind, decisionId: job.decisionId, urgent: true }, 'system');
          else this.log('follow_up_skipped', `${job.id}: ремонт по результату не назначен — ${a.reason}`, { jobId: job.id, problemId: job.problemId });
        }
      }
    } else if (spec.type === 'repair' && spec.lift) {
      const fixed = eq.hidden.cause === spec.fixes;
      job.result = { text: 'ремонт выполнен, нужна проверка восстановления' };
      if (fixed) { eq.hidden = { cause: null, base: 0, t0: this.minute, rate: 0 }; if (eq.failed) { eq.failed = false; const inc = this.incidents.find(i => i.postId === job.postId && i.kind === 'lift_failure' && i.status === 'active'); if (inc) this.resolveIncident(inc.id, 'Подъёмник отремонтирован'); } }
      this.log('repair_completed', `${job.id}: «${job.title}» на ${job.postCode} завершена, израсходовано: ${STOCK_ITEMS[spec.part].name}`, { jobId: job.id, postId: job.postId, problemId: job.problemId });
      if (problem) problem.observations.push({ minute: this.minute, text: `Выполнено: ${job.title}. Назначена проверка восстановления.` });
      this.createJob({ postId: job.postId, kind: 'verify', decisionId: job.decisionId, urgent: true }, 'system');
      job.repairedCause = spec.fixes;
    } else if (spec.type === 'verify') {
      const r = reading({ seed: this.seed, equipmentId: job.equipmentId, minute: this.minute, d: degradationAt(eq.hidden, this.minute), cause: eq.hidden.cause, active: true });
      const restored = !eq.failed && r.cycle < 46.5 && r.pressure > 171;
      job.result = { restored, cycle: r.cycle, pressure: r.pressure, text: restored ? 'параметры в норме — подъёмник восстановлен' : 'параметры вне нормы — ремонт не устранил причину' };
      this.log('verify_completed', `${job.id}: проверка ${job.postCode} — цикл ${r.cycle} с, давление ${r.pressure} бар: ${job.result.text}`, { jobId: job.id, postId: job.postId, problemId: job.problemId });
      if (problem) {
        problem.observations.push({ minute: this.minute, text: `Проверка после ремонта: цикл ${r.cycle} с, давление ${r.pressure} бар — ${job.result.text}` });
        const repaired = [...this.jobs].reverse().find(j => j.postId === job.postId && j.repairedCause && j.completedAt <= this.minute);
        if (restored) { if (repaired) problem.hypothesisStatus[repaired.repairedCause] = { status: 'confirmed', by: job.id, minute: this.minute }; this.closeProblem(problem, `ремонт подтверждён проверкой (${repaired?.title ?? 'ремонт'})`); }
        else if (repaired) problem.hypothesisStatus[repaired.repairedCause] = { status: 'rejected', by: job.id, minute: this.minute };
      }
    } else {
      const inc = this.postIncident(job.postId);
      job.result = { text: 'пост восстановлен' };
      this.log('repair_completed', `${job.id}: «${job.title}» на ${job.postCode} завершена`, { jobId: job.id, postId: job.postId, problemId: job.problemId });
      if (inc) this.resolveIncident(inc.id, `Устранено работой ${job.id}`);
    }
  }
  indicatedCause(problem) {
    if (!problem) return null;
    const st = h => problem.hypothesisStatus[h]?.status, hs = Object.keys(HYPOTHESES);
    const confirmed = hs.filter(h => st(h) === 'confirmed');
    if (confirmed.length === 1) return confirmed[0];
    const open = hs.filter(h => st(h) !== 'rejected');
    return open.length === 1 ? open[0] : null;
  }
  transferAvailability(vehicleId, postId) {
    const v = typeof vehicleId === 'string' ? this.vehicle(vehicleId) : null;
    if (!v) return { ok: false, status: 404, reason: 'Автомобиль не найден' };
    if (typeof postId !== 'string' || !Object.hasOwn(POST, postId)) return { ok: false, status: 404, reason: 'Пост не найден' };
    const exec = v.currentExecutionId ? this.execution(v.currentExecutionId) : null;
    if (this.finished) return { ok: false, status: 409, reason: 'Смена завершена' };
    if (!exec || exec.completedAt !== null || v.location.type !== 'post') return { ok: false, status: 409, reason: `${v.id} не выполняет операцию на посту` };
    const from = v.location.id, impaired = this.isBroken(from) || this.runningStopJob(from) || this.openProblemFor(from) || this.postIncident(from);
    if (!impaired) return { ok: false, status: 409, reason: `${POST[from].code} исправен — перевод не требуется` };
    const target = POST[postId];
    if (target.stage !== exec.stage) return { ok: false, status: 409, reason: `${target.code} относится к другому участку` };
    const t = this.posts[postId];
    if (t.vehicleId) { const ex = this.execution(t.executionId); return { ok: false, status: 409, reason: `${target.code} занят: ${t.vehicleId}${ex && ex.completedAt === null ? ` (${Math.round((1 - ex.remaining / ex.work) * 100)}%)` : ', ждёт перемещения'}` }; }
    if (this.isBroken(postId) || this.runningStopJob(postId)) return { ok: false, status: 409, reason: `${target.code} неисправен или в ремонте` };
    if (this.openProblemFor(postId)) return { ok: false, status: 409, reason: `${target.code} имеет открытую проблему` };
    if (this.holds[postId]) return { ok: false, status: 409, reason: `${target.code} снят с загрузки` };
    return { ok: true };
  }
  postTransferOptions(postId) {
    const def = POST[postId], post = this.posts[postId];
    const targets = POSTS.filter(p => p.stage === def.stage && p.id !== postId);
    const reason = this.finished ? 'Смена завершена' : !post.vehicleId ? `${def.code}: на посту нет автомобиля` : !targets.length ? `${def.code}: на участке нет параллельных постов` : null;
    return { reason, targets: targets.map(target => ({ postId: target.id, postCode: target.code,
      ...(reason ? { ok: false, status: 409, reason } : this.transferAvailability(post.vehicleId, target.id)) })) };
  }
  transfer(vehicleId, postId, actor = 'operator') {
    const a = this.transferAvailability(vehicleId, postId);
    if (!a.ok) throw new SimulationError(a.reason, a.status);
    const v = this.vehicle(vehicleId), exec = this.execution(v.currentExecutionId), from = v.location.id;
    this.posts[from].vehicleId = null; this.posts[from].executionId = null;
    Object.assign(this.posts[postId], { vehicleId: v.id, executionId: exec.id });
    exec.postId = postId; exec.posts.push({ postId, from: this.minute }); exec.pauseReason = null;
    v.location = { type: 'post', id: postId };
    this.log('vehicle_transferred', `${v.id} переведён с ${POST[from].code} на ${POST[postId].code}; остаток операции ${round(exec.remaining, 1)} мин сохранён`, { vehicleId: v.id, postId, orderId: v.orderId }, actor);
    this.flow(); this.touch();
  }
  // One entry point for operator/decision commands. A repeated requestId returns the stored result without effect.
  command(cmd, actor = 'operator') {
    if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) throw new SimulationError('Некорректная команда');
    const rid = cmd.requestId;
    if (rid !== undefined) {
      if (typeof rid !== 'string' || !REQUEST_ID.test(rid)) throw new SimulationError('Некорректный requestId');
      if (this.requests[rid]) return { duplicate: true, ...this.requests[rid] };
    }
    let result = null;
    switch (cmd.action) {
      case 'release': result = this.releaseOrder({ modelId: cmd.model, quantity: cmd.quantity, priority: cmd.priority }, actor).id; break;
      case 'priority': this.setPriority(cmd.orderId, cmd.priority, actor); break;
      case 'fault': result = this.injectIncident(cmd.postId, cmd.kind, actor).id; break;
      case 'job': result = this.createJob({ postId: cmd.postId, kind: cmd.kind, followUp: cmd.followUp ?? null, decisionId: cmd.decisionId ?? null }, actor).id; break;
      case 'transfer': this.transfer(cmd.vehicleId, cmd.postId, actor); break;
      case 'hold': this.setHold(cmd.postId, cmd.on, actor); break;
      case 'plan': this.setPlanTarget(cmd.target, actor); break;
      default: throw new SimulationError('Неизвестное действие');
    }
    if (rid) {
      this.requests[rid] = { minute: this.minute, action: cmd.action, result };
      const keys = Object.keys(this.requests); if (keys.length > 300) delete this.requests[keys[0]];
    }
    return { duplicate: false, result };
  }

  // ---------------- Flow ----------------
  pickNext(bufferId) {
    const queue = this.buffers[bufferId];
    if (!queue.length) return null;
    const first = this.queueOrder(bufferId)[0];
    queue.splice(queue.indexOf(first), 1);
    return this.vehicle(first);
  }
  queueOrder(bufferId) {
    const rank = id => { const v = this.vehicle(id); return [PRIORITIES[this.order(v.orderId).priority].rank, v.readyAt, v.seq]; };
    return [...this.buffers[bufferId]].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  }
  canDispatch(postId) { return !this.posts[postId].vehicleId && !this.isBroken(postId) && !this.runningStopJob(postId) && !this.holds[postId] && !this.finished; }
  startExecution(v, def, stage, norm, work) {
    const exec = { id: ++this.executionSeq, vehicleId: v.id, stage: stage.id, operation: stage.operation, postId: def.id, posts: [{ postId: def.id, from: this.minute }], startedAt: this.minute, norm, work, remaining: work, completedAt: null, pauseReason: null, result: null };
    this.executions.push(exec); v.executionIds.push(exec.id);
    Object.assign(this.posts[def.id], { vehicleId: v.id, executionId: exec.id });
    Object.assign(v, { location: { type: 'post', id: def.id }, currentExecutionId: exec.id });
    if (stage.id === 'weld' && v.startedAt === null) v.startedAt = this.minute;
    this.log('operation_started', `${v.id}: начата операция «${stage.operation}» на ${def.code} (норматив ${norm} мин)`, { vehicleId: v.id, postId: def.id, orderId: v.orderId, executionId: exec.id });
  }
  moveOut(def) {
    const post = this.posts[def.id], exec = post.executionId ? this.execution(post.executionId) : null;
    if (!exec || exec.completedAt === null) return;
    const v = this.vehicle(post.vehicleId);
    let target;
    if (def.stage === 'shipping') target = 'SHIPPED';
    else if (def.stage === 'quality') target = v.accepted ? 'FG' : 'RWQ';
    else if (def.stage === 'rework') target = 'B3';
    else target = STAGES[STAGE[def.stage].index + 1].buffer.id;
    if (target === 'SHIPPED') {
      v.shipped = true; v.shippedAt = this.minute; v.location = { type: 'shipped', id: 'SHIPPED' }; v.currentExecutionId = null; this.shipped.push(v.id);
      this.log('vehicle_shipped', `${v.id} отгружен (выпуск уже учтён при приёмке)`, { vehicleId: v.id, postId: def.id, orderId: v.orderId });
    } else {
      const buffer = target === 'RWQ' ? REWORK.buffer : STAGES.find(s => s.buffer.id === target).buffer;
      if (buffer.capacity !== null && this.buffers[target].length >= buffer.capacity) return;
      this.buffers[target].push(v.id);
      Object.assign(v, { location: { type: 'buffer', id: target }, readyAt: this.minute, currentExecutionId: null, stageIndex: target === 'RWQ' ? 3 : STAGES.findIndex(s => s.buffer.id === target) });
      this.log('vehicle_moved', `${v.id} перемещён: ${def.code} → ${buffer.name}`, { vehicleId: v.id, postId: def.id, orderId: v.orderId });
    }
    post.vehicleId = null; post.executionId = null;
  }
  flow() {
    if (this.finished) return;
    for (let i = STAGES.length - 1; i >= 0; i--) {
      const stage = STAGES[i];
      for (const def of postsOf(stage.id)) this.moveOut(def);
      for (const def of postsOf(stage.id)) {
        if (!this.canDispatch(def.id)) continue;
        const v = this.pickNext(stage.buffer.id);
        if (!v) break;
        this.startExecution(v, def, stage, stage.norms[v.modelId], v.work[stage.id]);
      }
      if (stage.id === 'quality') { // rework returns into B3 after quality posts have pulled from it
        const r = POST.R1; this.moveOut(r);
        if (this.canDispatch(r.id)) { const v = this.pickNext('RWQ'); if (v) this.startExecution(v, r, STAGE.rework, REWORK.norm, REWORK.norm); }
      }
    }
  }
  tick() {
    const done = [];
    for (const l of LIFTS) this.equipment[l.id].active = false;
    for (const def of POSTS) {
      const post = this.posts[def.id], incident = this.postIncident(def.id), lift = this.liftOf(def.id);
      const exec = post.executionId ? this.execution(post.executionId) : null;
      if (this.runningStopJob(def.id)) { post.stats.maintenance++; if (exec && exec.completedAt === null) exec.pauseReason = `Работы на ${def.code}`; continue; }
      if (this.isBroken(def.id)) { post.stats.fault++; if (exec && exec.completedAt === null) exec.pauseReason = `Неисправность ${def.code}`; continue; }
      if (!exec) { post.stats.starved++; continue; }
      if (exec.completedAt !== null) { post.stats.blocked++; continue; }
      const speed = (incident ? INCIDENT_KINDS[incident.kind].speed : 1) * (lift ? liftSpeed(degradationAt(lift.hidden, this.minute)) : 1);
      const step = Math.min(speed, exec.remaining);
      exec.pauseReason = null; exec.remaining = round(exec.remaining - step, 6);
      post.stats.run++; post.stats.nominal += step * exec.norm / exec.work;
      if (lift) lift.active = true;
      if (exec.remaining <= 0) { exec.remaining = 0; done.push(exec); }
    }
    for (const [tid, tech] of Object.entries(this.technicians)) { const job = tech.jobId && this.job(tech.jobId); if (job) { job.remaining--; tech.busyMinutes++; } }
    this.minute++;
    this.observeEquipment();
    for (const i of this.incidents.filter(i => i.status === 'active' && i.expires !== null && i.expires <= this.minute)) this.resolveIncident(i.id, 'Восстановлено по сценарию');
    for (const job of this.jobs.filter(j => j.status === 'running' && j.remaining <= 0)) this.completeJob(job);
    this.startJobs();
    for (const exec of done) {
      const v = this.vehicle(exec.vehicleId), def = POST[exec.postId];
      exec.completedAt = this.minute; this.posts[def.id].stats.completed++;
      this.log('operation_completed', `${v.id}: завершена операция «${exec.operation}» на ${def.code}`, { vehicleId: v.id, postId: def.id, orderId: v.orderId, executionId: exec.id });
      if (exec.stage === 'quality') this.inspect(v, exec, def);
      if (exec.stage === 'rework') { v.reworked = true; v.hidden.defect = null; }
    }
    this.flow();
    if (this.minute % 5 === 0 || this.minute === SHIFT) this.history.push({ minute: this.minute, accepted: this.acceptedCount() });
    if (this.minute >= SHIFT) this.finishShift();
  }
  inspect(v, exec, def) {
    const first = !this.inspections.some(i => i.vehicleId === v.id), defect = v.hidden.defect;
    const inspection = { id: `QI-${++this.inspectionSeq}`, vehicleId: v.id, executionId: exec.id, postId: def.id, minute: this.minute, first, result: defect ? 'fail' : 'pass', defect: defect ? DEFECTS[defect] : null, origin: defect };
    if (defect) inspection.originPostId = v.executionIds.map(id => this.execution(id)).find(e => e.stage === defect)?.postId ?? null;
    this.inspections.push(inspection); exec.result = inspection.result; exec.defect = inspection.defect;
    if (defect) this.log('inspection_failed', `${v.id}: контроль не пройден — ${DEFECTS[defect]}; направлен на доработку`, { vehicleId: v.id, postId: def.id, orderId: v.orderId });
    else {
      v.accepted = true; v.acceptedAt = this.minute;
      this.log('vehicle_accepted', `${v.id} принят контролем${v.reworked ? ' после доработки' : ' с первого предъявления'} и засчитан в годный выпуск`, { vehicleId: v.id, postId: def.id, orderId: v.orderId });
    }
  }
  observeEquipment() {
    for (const l of LIFTS) {
      const eq = this.equipment[l.id], d = degradationAt(eq.hidden, this.minute);
      if (!eq.failed && d >= 1) {
        eq.failed = true; eq.failedAt = this.minute;
        this.createIncident(l.postId, 'lift_failure', 'system');
        const p = eq.problemId ? this.problem(eq.problemId) : this.createProblem({ kind: 'equipment', postId: l.postId, equipmentId: l.id, title: `${l.name}: отказ`, observation: 'Подъёмник остановился (отказ)' });
        if (eq.problemId && p) p.observations.push({ minute: this.minute, text: 'Отказ: подъёмник остановился, пост не работает' });
      }
      if (this.minute % 5 !== 0) continue;
      eq.readings.push(reading({ seed: this.seed, equipmentId: l.id, minute: this.minute, d, cause: eq.hidden.cause, active: eq.active }));
      if (eq.readings.length > 120) eq.readings.shift();
      const f = features(eq.readings, this.minute), score = anomalyScore(f);
      if (!eq.problemId && !eq.failed && score > ANOMALY_THRESHOLD && (this.minute - (eq.lastResolvedAt ?? -999)) > 30) {
        const latest = eq.readings.at(-1);
        this.createProblem({ kind: 'equipment', postId: l.postId, equipmentId: l.id, title: `${l.name}: отклонение параметров`,
          observation: `Отклонение от нормы (z = ${round(score, 1)}): среднее за 30 мин — давление ${round(f.pressure_mean, 1)} бар (норма ${NOMINAL.pressure}), температура ${round(f.temperature_mean, 1)} °C (норма ${NOMINAL.temperature}), цикл ${round(f.cycle_mean, 1)} с (норма ${NOMINAL.cycle}); последнее измерение ${clock(latest.minute)}` });
      }
    }
  }
  finishShift() {
    if (this.finished) return;
    this.finished = true; this.running = false;
    // No invented completions: vehicles, operations, jobs and problems stay as they are.
    for (const i of this.incidents.filter(i => i.status === 'active')) { i.status = 'unresolved'; i.resolution = 'Не устранён к концу смены'; }
    for (const p of this.problems.filter(p => p.status === 'open')) { p.status = 'unresolved'; p.observations.push({ minute: this.minute, text: 'Не устранена к концу смены' }); }
    const open = this.vehicles.filter(v => !v.accepted).length;
    this.log('shift_finished', `Смена завершена. Не приняты к концу смены: ${open} автомобил${open % 10 === 1 && open % 100 !== 11 ? 'ь' : 'ей'}; они остаются на своих местах`);
  }
  advance(minutes = 5) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new SimulationError('Шаг должен быть от 1 до 60 минут');
    for (let n = 0; n < minutes && this.minute < SHIFT; n++) this.tick();
    if (this.minute >= SHIFT) this.finishShift();
    this.touch();
  }
  runToEnd() { while (this.minute < SHIFT) this.tick(); this.finishShift(); return this; }

  // Invariants used after restore and in tests: one place per vehicle, capacities, balance, stock, technicians.
  checkIntegrity() {
    const errors = [], places = new Map();
    const put = (id, where) => { if (places.has(id)) errors.push(`${id} находится в ${places.get(id)} и ${where}`); places.set(id, where); };
    if (!Number.isInteger(this.minute) || this.minute < 0 || this.minute > SHIFT) errors.push('некорректная минута смены');
    for (const [id, queue] of Object.entries(this.buffers)) {
      const spec = id === 'RWQ' ? REWORK.buffer : STAGES.find(s => s.buffer.id === id)?.buffer;
      if (!spec) { errors.push(`неизвестный буфер ${id}`); continue; }
      if (spec.capacity !== null && queue.length > spec.capacity) errors.push(`${id} переполнен`);
      for (const v of queue) { put(v, id); if (this.vehicle(v)?.location.id !== id) errors.push(`${v}: место не совпадает с ${id}`); }
    }
    for (const p of POSTS) {
      const post = this.posts[p.id]; if (!post) { errors.push(`нет поста ${p.id}`); continue; }
      if (post.vehicleId) { put(post.vehicleId, p.id); if (this.execution(post.executionId)?.vehicleId !== post.vehicleId) errors.push(`${p.id}: операция не совпадает`); }
      const st = post.stats; if (st.run + st.fault + st.maintenance + st.starved + st.blocked !== this.minute) errors.push(`${p.id}: время поста не сходится`);
    }
    for (const id of this.shipped) { put(id, 'SHIPPED'); if (!this.vehicle(id)?.accepted) errors.push(`${id} отгружен без приёмки`); }
    if (places.size !== this.vehicles.length) errors.push('не все автомобили имеют место');
    if (!this.totals().balanced) errors.push('баланс автомобилей не сходится');
    if (this.vehicles.filter(v => v.accepted).length !== this.inspections.filter(i => i.result === 'pass').length) errors.push('приёмка не совпадает с успешными проверками');
    for (const [k, s] of Object.entries(this.stock)) if (s.onHand < 0 || s.reserved < 0 || s.reserved > s.onHand) errors.push(`склад ${k} некорректен`);
    for (const [tid, t] of Object.entries(this.technicians)) { const running = this.jobs.filter(j => j.status === 'running' && j.technicianId === tid); if (running.length > 1 || (t.jobId ?? null) !== (running[0]?.id ?? null)) errors.push(`${tid}: назначение не совпадает`); }
    return errors;
  }

  // ---------------- Copies, beliefs and forecast ----------------
  serialize() { const { _forecast, planProfile, ...data } = this; return structuredClone(data); }
  static restore(data) { const w = Object.assign(Object.create(Workshop.prototype), structuredClone(data)); w.planProfile = Workshop.planProfile(w.seed); return w; }
  clone() { const { _forecast, planProfile, ...data } = this; return Object.assign(Object.create(Workshop.prototype), structuredClone(data), { planProfile }); }
  // What the dispatcher may assume: undetected equipment is healthy; a detected problem is one of the hypotheses with
  // degradation and rate estimated from readings; uninspected vehicles have the typical defect rate. Hidden truth is not used.
  hypothesisView(problem) {
    const eq = this.equipment[problem.equipmentId], f = features(eq.readings, this.minute), ev = f ? hypothesisEvidence(f) : null;
    const prev = features(eq.readings, this.minute - 15), evPrev = prev ? hypothesisEvidence(prev) : null;
    const lls = Object.keys(HYPOTHESES).map(h => ev ? ev[h].ll / 4 : 0), m = Math.max(...lls);
    let w = Object.keys(HYPOTHESES).map((h, i) => Math.exp(lls[i] - m));
    w = w.map((x, i) => { const st = problem.hypothesisStatus[Object.keys(HYPOTHESES)[i]]?.status; return st === 'rejected' ? x * .03 : st === 'confirmed' ? x * 30 : x; });
    const sum = w.reduce((a, b) => a + b, 0);
    return Object.keys(HYPOTHESES).map((h, i) => {
      const d = eq.failed ? 1 : ev ? Math.min(1, ev[h].d) : 0, dPrev = evPrev ? Math.min(1, evPrev[h].d) : d;
      const rate = Math.min(.02, Math.max(.002, (d - dPrev) / 15));
      const st = problem.hypothesisStatus[h]?.status ?? null, p = w[i] / sum;
      return { id: h, title: HYPOTHESES[h].title, probability: round(p, 3), status: st === 'confirmed' ? 'confirmed' : st === 'rejected' ? 'rejected' : p > .75 ? 'supported' : 'open', estimate: { degradation: round(d, 3), ratePerMinute: round(rate, 4) },
        basis: ev ? `Модель «${HYPOTHESES[h].title.toLowerCase()}» объясняет средние за 30 мин при износе ≈ ${Math.round(d * 100)}%; правдоподобие по давлению, температуре и циклу${st ? `; ${st === 'confirmed' ? 'подтверждена' : 'исключена'} в ${clock(problem.hypothesisStatus[h].minute)}` : ''}` : 'Недостаточно измерений' };
    });
  }
  beliefScenarios() {
    const base = this.clone();
    for (const v of base.vehicles) if (!v.accepted && !v.reworked && !base.inspections.some(i => i.vehicleId === v.id)) v.hidden.defect = beliefDefect(this.seed, v.id);
    const open = this.problems.filter(p => p.status === 'open' && p.kind === 'equipment');
    for (const l of LIFTS) if (!open.some(p => p.equipmentId === l.id)) { const eq = base.equipment[l.id]; if (!eq.failed) eq.hidden = { cause: null, base: 0, t0: 0, rate: 0 }; }
    if (!open.length) return [{ weight: 1, label: 'Без известных отклонений оборудования', workshop: base, hypotheses: {} }];
    const p = open[0], hs = this.hypothesisView(p).filter(h => h.probability >= .02), total = hs.reduce((a, h) => a + h.probability, 0);
    return hs.map(h => {
      const w = base.clone(), eq = w.equipment[p.equipmentId];
      eq.hidden = { cause: h.id, base: h.estimate.degradation, t0: this.minute, rate: h.estimate.ratePerMinute };
      return { weight: h.probability / total, label: `Если причина — ${h.title.toLowerCase()} (вес ${Math.round(h.probability / total * 100)}%)`, workshop: w, hypotheses: { [p.id]: h.id } };
    });
  }
  outcomeFrom(start) {
    const due = this.orders.filter(o => o.dueMinute <= SHIFT);
    const orders = due.map(o => { const vs = o.vehicleIds.map(id => this.vehicle(id)), last = Math.max(...vs.map(v => v.acceptedAt ?? Infinity)); return { id: o.id, due: o.dueMinute, onTime: last <= o.dueMinute, accepted: vs.filter(v => v.accepted).length, quantity: o.quantity }; });
    const downtime = POSTS.reduce((a, p) => a + this.posts[p.id].stats.fault + this.posts[p.id].stats.maintenance, 0) - start.downtime;
    const techMinutes = Object.values(this.technicians).reduce((a, t) => a + t.busyMinutes, 0) - start.techMinutes;
    const parts = Object.fromEntries(Object.keys(STOCK_ITEMS).map(k => [k, this.stock[k].used - start.parts[k]]));
    const cost = techMinutes * TARIFFS.technicianPerMinute + Object.entries(parts).reduce((a, [k, n]) => a + n * STOCK_ITEMS[k].cost, 0);
    return { accepted: this.acceptedCount(), ordersOnTime: orders.filter(o => o.onTime).length, ordersDue: orders.length, lateOrders: orders.filter(o => !o.onTime).map(o => o.id), downtime, wip: this.vehicles.filter(v => v.startedAt !== null && !v.accepted).length, notStarted: this.vehicles.filter(v => v.startedAt === null).length, techMinutes, parts, cost };
  }
  counters() { return { downtime: POSTS.reduce((a, p) => a + this.posts[p.id].stats.fault + this.posts[p.id].stats.maintenance, 0), techMinutes: Object.values(this.technicians).reduce((a, t) => a + t.busyMinutes, 0), parts: Object.fromEntries(Object.keys(STOCK_ITEMS).map(k => [k, this.stock[k].used])) }; }
  forecast() {
    if (this._forecast?.revision === this.revision) return this._forecast.value;
    const reference = this.planProfile ? this.planProfile[SHIFT] : null, start = this.counters();
    const runs = this.beliefScenarios().map(s => {
      const copy = s.workshop, trajectory = [{ minute: copy.minute, accepted: copy.acceptedCount() }];
      const before = Object.fromEntries(STAGES.map(st => [st.id, postsOf(st.id).reduce((a, p) => a + copy.posts[p.id].stats.run, 0)]));
      while (copy.minute < SHIFT) { copy.tick(); if (copy.minute % 5 === 0 || copy.minute === SHIFT) trajectory.push({ minute: copy.minute, accepted: copy.acceptedCount() }); }
      copy.finishShift();
      const window = SHIFT - this.minute;
      const load = STAGES.map(st => ({ id: st.id, name: st.name, utilization: window > 0 ? round((postsOf(st.id).reduce((a, p) => a + copy.posts[p.id].stats.run, 0) - before[st.id]) / (postsOf(st.id).length * window)) : 0 }));
      return { ...s, outcome: copy.outcomeFrom(start), trajectory, load };
    });
    const main = runs.reduce((a, b) => b.weight > a.weight ? b : a), expected = runs.reduce((a, r) => a + r.weight * r.outcome.accepted, 0);
    const value = {
      projected: Math.round(expected), expected: round(expected, 2), low: Math.min(...runs.map(r => r.outcome.accepted)), high: Math.max(...runs.map(r => r.outcome.accepted)),
      plan: this.planTarget, gap: Math.round(expected) - this.planTarget, reference,
      openAtEnd: main.outcome.wip + main.outcome.notStarted, trajectory: main.trajectory, load: main.load,
      limiting: this.minute < SHIFT ? main.load.reduce((a, b) => b.utilization > a.utilization ? b : a) : null,
      scenarios: runs.map(r => ({ label: r.label, weight: round(r.weight, 3), accepted: r.outcome.accepted, lateOrders: r.outcome.lateOrders })),
      lateOrders: main.outcome.lateOrders,
      method: 'Копии текущего состояния прогоняются тем же движком до 16:00 без новых вмешательств: те же очереди, работы и приоритеты. Скрытая причина неисправности не используется — по каждой гипотезе берётся оценка износа по измерениям, итог взвешивается. Для непроверенных автомобилей — типовая доля брака 15%.',
      assumption: 'Сценарный расчёт, не статистический интервал и не ML-модель. Новые инциденты не предполагаются.',
    };
    this._forecast = { revision: this.revision, value };
    return value;
  }

  // ---------------- Views ----------------
  vehicleView(v) {
    const order = this.order(v.orderId), exec = v.currentExecutionId ? this.execution(v.currentExecutionId) : null;
    const executions = v.executionIds.map(id => this.execution(id));
    const steps = executions.map(e => ({ stage: e.stage, stageName: STAGE[e.stage].name, operation: e.operation, status: e.completedAt !== null ? 'done' : 'current', postId: e.postId, postCode: POST[e.postId].code, startedAt: e.startedAt, completedAt: e.completedAt, progress: round(1 - e.remaining / e.work), norm: e.norm, work: e.work, result: e.result, defect: e.defect ?? null }));
    const lastStage = Math.max(-1, ...executions.filter(e => STAGE[e.stage].index % 1 === 0).map(e => STAGE[e.stage].index));
    for (const s of STAGES.slice(lastStage + 1)) steps.push({ stage: s.id, stageName: s.name, operation: s.operation, status: 'pending', norm: s.norms[v.modelId] });
    let state, status;
    if (v.shipped) { state = 'shipped'; status = `Отгружен в ${clock(v.shippedAt)}`; }
    else if (v.location.type === 'buffer') {
      const id = v.location.id, buffer = id === 'RWQ' ? REWORK.buffer : STAGES.find(s => s.buffer.id === id).buffer, pos = this.queueOrder(id).indexOf(v.id) + 1;
      state = id === 'BACKLOG' ? 'not_started' : id === 'FG' ? 'ready' : id === 'RWQ' ? 'rework_wait' : 'waiting';
      status = id === 'FG' ? `Принят, ждёт отгрузки · ${buffer.name}, ${pos}-й в очереди` : id === 'RWQ' ? `Не прошёл контроль, ждёт доработки · ${pos}-й в очереди` : `Ожидает: ${STAGES[v.stageIndex].operation.toLowerCase()} · ${buffer.name}, ${pos}-й в очереди${v.reworked && id === 'B3' ? ' (повторный контроль)' : ''}`;
    } else {
      const code = POST[v.location.id].code;
      if (exec.completedAt !== null) { state = 'blocked'; status = `Операция выполнена на ${code}, ждёт места в следующем буфере`; }
      else if (this.finished) { state = 'stopped'; status = `Смена завершена: «${exec.operation}» на ${code} выполнена на ${Math.round((1 - exec.remaining / exec.work) * 100)}%`; }
      else if (this.runningStopJob(v.location.id)) { state = 'paused'; status = `Пауза: работы на ${code} (${this.runningStopJob(v.location.id).title.toLowerCase()})`; }
      else if (this.isBroken(v.location.id)) { state = 'paused'; status = `Пауза: неисправность ${code}`; }
      else { state = exec.stage === 'rework' ? 'rework' : 'processing'; status = `${exec.operation} · ${code}`; }
    }
    const inspections = this.inspections.filter(i => i.vehicleId === v.id).map(({ id, minute, result, defect, first, postId }) => ({ id, minute, result, defect, first, postCode: POST[postId].code }));
    return {
      id: v.id, seq: v.seq, orderId: v.orderId, modelId: v.modelId, modelName: MODELS[v.modelId].name, priority: order.priority, routeVersion: v.routeVersion,
      state, status, accepted: v.accepted, acceptedAt: v.acceptedAt, shipped: v.shipped, shippedAt: v.shippedAt, createdAt: v.createdAt, startedAt: v.startedAt, reworked: v.reworked, inspections,
      location: { ...v.location }, currentOperation: exec ? { executionId: exec.id, stage: exec.stage, operation: exec.operation, postId: exec.postId, postCode: POST[exec.postId].code, progress: round(1 - exec.remaining / exec.work), remaining: round(exec.remaining, 1), norm: exec.norm, work: exec.work, startedAt: exec.startedAt, completedAt: exec.completedAt, pauseReason: exec.pauseReason, posts: exec.posts.map(p => ({ ...p, postCode: POST[p.postId].code })) } : null,
      route: steps,
    };
  }
  postQuality(postId) {
    const completed = this.posts[postId].stats.completed, stage = POST[postId].stage;
    if (!completed || ['quality', 'rework', 'shipping'].includes(stage)) return 1;
    const bad = this.inspections.filter(i => i.result === 'fail' && i.origin === stage && i.originPostId === postId).length;
    return (completed - bad) / completed;
  }
  postView(def) {
    const post = this.posts[def.id], incident = this.postIncident(def.id) ?? null, job = this.runningStopJob(def.id);
    const exec = post.executionId ? this.execution(post.executionId) : null, stage = STAGE[def.stage];
    const lift = this.liftOf(def.id), problem = this.openProblemFor(def.id);
    let state, reason = null;
    if (job) { state = 'maintenance'; reason = `${job.title} (${job.id}), осталось ${job.remaining} мин${exec && exec.completedAt === null ? `; операция ${exec.vehicleId} на паузе` : ''}`; }
    else if (this.isBroken(def.id)) { state = 'fault'; reason = `${incident ? incident.cause : 'Отказ оборудования'}${exec && exec.completedAt === null ? `; операция ${exec.vehicleId} на паузе` : ''}`; }
    else if (exec && exec.completedAt !== null) { const next = def.stage === 'quality' ? (this.vehicle(exec.vehicleId).accepted ? STAGES[4].buffer : REWORK.buffer) : def.stage === 'rework' ? STAGES[3].buffer : STAGES[stage.index + 1].buffer; state = 'blocked'; reason = `Операция завершена, «${next.name}» заполнен (${this.buffers[next.id].length}/${next.capacity})`; }
    else if (exec) { state = incident || problem ? 'slow' : 'working'; if (incident) reason = `${incident.cause}`; else if (problem) reason = `${problem.id}: ${problem.title}`; }
    else { state = 'idle'; reason = this.holds[def.id] ? 'Снят с загрузки оператором' : `Нет автомобилей в очереди «${stage.buffer.name}»`; }
    if (this.finished) { state = 'shift_over'; reason = !exec ? 'Смена завершена' : exec.completedAt !== null ? `Смена завершена; ${exec.vehicleId} ждёт перемещения` : `Смена завершена; ${exec.vehicleId} остаётся на посту, операция не завершена`; }
    const quality = this.postQuality(def.id);
    return {
      id: def.id, code: def.code, stage: def.stage, stageName: stage.name, capacity: def.capacity, state, reason, incidentId: incident?.id ?? null, problemId: problem?.id ?? null, hold: Boolean(this.holds[def.id]), equipmentId: LIFT_BY_POST[def.id]?.id ?? null,
      vehicleId: post.vehicleId, operation: exec ? exec.operation : null, progress: exec ? round(1 - exec.remaining / exec.work) : null, remaining: exec ? round(exec.remaining, 1) : null,
      transfer: this.postTransferOptions(def.id),
      stats: { ...post.stats, nominal: round(post.stats.nominal, 2) }, metrics: postOee(post.stats, this.minute, quality),
    };
  }
  problemView(p) {
    const post = POST[p.postId], stage = STAGE[post.stage], onPost = this.posts[p.postId].vehicleId;
    const vehicleIds = [...new Set([onPost, ...this.queueOrder(stage.buffer.id), ...p.initialVehicleIds].filter(Boolean))];
    const orderIds = [...new Set(vehicleIds.map(id => this.vehicle(id).orderId))];
    const jobs = this.jobs.filter(j => j.problemId === p.id || (j.postId === p.postId && j.createdAt >= p.detectedAt)).map(j => ({ id: j.id, title: j.title, status: j.status, createdAt: j.createdAt, startedAt: j.startedAt, completedAt: j.completedAt, remaining: j.remaining, result: j.result }));
    const view = { ...structuredClone(p), postCode: post.code, stageName: stage.name, vehicleIds, orderIds, jobs, hold: Boolean(this.holds[p.postId]) };
    if (p.kind === 'equipment') {
      const eq = this.equipment[p.equipmentId], f = features(eq.readings, this.minute);
      view.hypotheses = this.hypothesisView(p);
      view.latest = f ? Object.fromEntries(CHANNELS.map(c => [c, { mean: round(f[`${c}_mean`], 1), slopePerHour: round(f[`${c}_slope`] * 60, 2), nominal: NOMINAL[c], unit: UNITS[c], name: CHANNEL_NAMES[c] }])) : null;
      view.anomalyScore = round(anomalyScore(f), 2);
      view.availableChecks = ['pressure_hold', 'pump_check'].map(k => ({ kind: k, title: JOB_KINDS[k].title, duration: JOB_KINDS[k].duration, stopsPost: JOB_KINDS[k].stopsPost, done: p.checks.some(c => c.kind === k), ...this.jobAvailability(p.postId, k) }));
    } else {
      view.hypotheses = [{ id: 'unknown', title: 'Причина не моделируется (ручной сценарий)', probability: null, status: 'open', basis: 'Инцидент создан оператором для демонстрации; диагностические проверки для него не предусмотрены' }];
      view.availableChecks = [];
    }
    return view;
  }
  snapshot() {
    const totals = this.totals(), plan = this.planProfile;
    const accepted = this.vehicles.filter(v => v.accepted);
    const leads = accepted.filter(v => v.startedAt !== null).map(v => v.acceptedAt - v.startedAt);
    const firsts = this.inspections.filter(i => i.first);
    return {
      synthetic: true, seed: this.seed, revision: this.revision, recordVersion: this.recordVersion, elapsed: this.minute, shift: SHIFT, shiftStart: SHIFT_START,
      running: this.running, speed: this.speed, finished: this.finished, maxVehicles: MAX_VEHICLES, maxOrderQuantity: MAX_ORDER_QUANTITY,
      models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, norms: Object.fromEntries(STAGES.map(s => [s.id, s.norms[id]])) })),
      priorities: Object.entries(PRIORITIES).map(([id, p]) => ({ id, ...p })),
      incidentKinds: Object.entries(INCIDENT_KINDS).filter(([, k]) => !k.internal).map(([id, k]) => ({ id, title: k.title, duration: k.duration, speed: k.speed })),
      jobKinds: Object.entries(JOB_KINDS).filter(([, k]) => !k.internal).map(([id, k]) => ({ id, title: k.title, type: k.type, duration: k.duration, stopsPost: k.stopsPost, part: k.part ?? null })),
      stages: STAGES.map(s => ({ id: s.id, name: s.name, operation: s.operation, postIds: postsOf(s.id).map(p => p.id), buffer: { ...s.buffer, vehicleIds: this.queueOrder(s.buffer.id) } })),
      rework: { postId: 'R1', buffer: { ...REWORK.buffer, vehicleIds: this.queueOrder('RWQ') }, norm: REWORK.norm },
      posts: POSTS.map(p => this.postView(p)),
      vehicles: this.vehicles.map(v => this.vehicleView(v)),
      orders: this.orders.map(o => {
        const vs = o.vehicleIds.map(id => this.vehicle(id)), done = vs.filter(v => v.accepted).length, started = vs.filter(v => v.startedAt !== null).length;
        return { ...o, vehicleIds: [...o.vehicleIds], accepted: done, shipped: vs.filter(v => v.shipped).length, started, notStarted: o.quantity - started, inProcess: started - done, state: done === o.quantity ? 'completed' : started ? 'in_progress' : 'released', overdue: done < o.quantity && this.minute > o.dueMinute };
      }),
      incidents: this.incidents.map(i => ({ ...i })),
      problems: this.problems.map(p => this.problemView(p)),
      equipment: LIFTS.map(l => { const eq = this.equipment[l.id]; return { id: l.id, postId: l.postId, name: l.name, modelVersion: LIFT_MODEL_VERSION, failed: eq.failed, failedAt: eq.failedAt, problemId: eq.problemId, readings: eq.readings.map(r => ({ ...r })), anomalyScore: round(anomalyScore(features(eq.readings, this.minute)), 2) }; }),
      jobs: this.jobs.map(({ repairedCause, ...j }) => ({ ...j })),
      technicians: TECHNICIANS.map(t => ({ ...t, jobId: this.technicians[t.id].jobId, busyMinutes: this.technicians[t.id].busyMinutes })),
      stock: Object.entries(STOCK_ITEMS).map(([id, s]) => ({ id, name: s.name, cost: s.cost, ...this.stock[id], available: this.stock[id].onHand - this.stock[id].reserved })),
      tariffs: TARIFFS, holds: Object.keys(this.holds),
      inspections: this.inspections.map(({ origin, originPostId, ...i }) => ({ ...i, postCode: POST[i.postId].code })),
      quality: { inspections: this.inspections.length, firstInspections: firsts.length, firstPass: firsts.filter(i => i.result === 'pass').length, firstPassYield: firsts.length ? round(firsts.filter(i => i.result === 'pass').length / firsts.length) : null, failed: this.inspections.filter(i => i.result === 'fail').length, reworkedAccepted: accepted.filter(v => v.reworked).length, inRework: this.vehicles.filter(v => v.location.id === 'RWQ' || v.location.id === 'R1').length },
      experiments: this.experiments.slice(-8).map(e => structuredClone(e)),
      decisions: this.decisions.map(d => structuredClone(d)),
      chat: this.chat.map(m => ({ ...m })),
      events: this.events.slice(-700).map(e => ({ ...e })),
      totals,
      plan: { target: this.planTarget, reference: plan ? { total: plan[SHIFT], now: plan[this.minute], profile: plan.map((accepted, minute) => ({ minute, accepted })).filter(p => p.minute % 5 === 0), method: 'Эталонная мощность: тот же движок, seed и начальные задания, без отклонений оборудования и инцидентов, с типовой долей брака 15%.' } : null },
      history: this.history.map(h => ({ ...h })),
      leadTime: leads.length ? { average: round(leads.reduce((a, b) => a + b, 0) / leads.length, 1), count: leads.length } : null,
      forecast: this.forecast(),
    };
  }
  totals() {
    const notStarted = this.vehicles.filter(v => v.startedAt === null).length;
    const inProcess = this.vehicles.filter(v => v.startedAt !== null && !v.accepted).length;
    const rework = this.vehicles.filter(v => !v.accepted && (v.location.id === 'RWQ' || v.location.id === 'R1')).length;
    const ready = this.vehicles.filter(v => v.accepted && !v.shipped).length;
    const shipped = this.vehicles.filter(v => v.shipped).length;
    const created = this.vehicles.length;
    return { created, notStarted, inProcess, rework, ready, shipped, accepted: ready + shipped, wip: inProcess, balanced: created === notStarted + inProcess + ready + shipped };
  }
}
