export const SHIFT = 480;
export const PLAN = 400;
export const IDEAL_CYCLE = 1;
export const BASE_REJECT_RATE = .025;
export const STATIONS = [
  { id: 'weld', name: 'Сварка', code: '01', rate: .96, detail: 'Соединение кузовных элементов' },
  { id: 'paint', name: 'Окраска', code: '02', rate: .91, detail: 'Подготовка и нанесение покрытия' },
  { id: 'assembly', name: 'Сборка', code: '03', rate: .86, detail: 'Монтаж узлов и комплектация' },
  { id: 'quality', name: 'Контроль качества', code: '04', rate: .94, detail: 'Финальная проверка автомобиля' },
  { id: 'shipping', name: 'Отгрузка', code: '05', rate: .98, detail: 'Передача годной продукции' },
];
const round = n => Math.round(n * 1000) / 1000;
const ru = n => String(round(n)).replace('.', ',');
const stationRate = id => STATIONS.find(s => s.id === id).rate;
// Single source of scenario parameters for simulation, forecast and explanations. All values are synthetic.
export const SCENARIOS = {
  stop: { title: 'Остановка окраски', station: 'paint', duration: 45, severity: 'critical', effect: { stop: true }, cause: 'Синтетический сигнал: недоступность камеры окраски', advice: 'Проверить камеру окраски и подтвердить готовность перед возобновлением.', remedy: 'Поток линии возобновляется; накопленный простой остаётся в истории.' },
  defects: { title: 'Рост брака', station: 'quality', duration: 60, severity: 'warning', effect: { rejectRate: .22 }, cause: 'Синтетический сигнал: рост дефектов покрытия', advice: 'Проверить параметры покрытия и изолировать подозрительную партию.', remedy: `Вероятность брака возвращается к базовой ${ru(BASE_REJECT_RATE * 100)}%; учтённый брак сохраняется.` },
  slowdown: { title: 'Замедление сборки', station: 'assembly', duration: 60, severity: 'warning', effect: { rates: { assembly: .57 } }, cause: 'Синтетический сигнал: снижение темпа сборки', advice: 'Проверить снабжение рабочего места и баланс операций.', remedy: `Темп сборки возвращается к ${ru(stationRate('assembly'))} шт./мин.` },
};
export class SimulationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}
export function oee(elapsed, runMinutes, total, good) {
  const availability = elapsed > 0 ? Math.min(1, runMinutes / elapsed) : 0;
  const performance = runMinutes > 0 ? Math.min(1, total * IDEAL_CYCLE / runMinutes) : 0;
  const quality = total > 0 ? good / total : 0;
  return { availability, performance, quality, oee: availability * performance * quality };
}
// Line parameters for a set of active scenario types. Used for every minute of simulation and forecast.
export function lineParameters(types = []) {
  const effects = [...types].map(t => SCENARIOS[t].effect);
  const rates = STATIONS.map(s => ({ ...s, effectiveRate: Math.min(s.rate, ...effects.map(e => e.rates?.[s.id] ?? Infinity)) }));
  const bottleneck = rates.reduce((a, b) => a.effectiveRate <= b.effectiveRate ? a : b);
  const rejectRate = Math.max(BASE_REJECT_RATE, ...effects.map(e => e.rejectRate ?? 0));
  return { rates, bottleneck, rate: bottleneck.effectiveRate, rejectRate, yieldRate: 1 - rejectRate, stopped: effects.some(e => e.stop) };
}
export const BASELINE = lineParameters();
export class Simulation {
  constructor(seed = 42, warmup = 120) { this.reset(seed, warmup); }
  reset(seed = 42, warmup = 120) {
    this.seed = seed >>> 0; this.rng = this.seed; this.elapsed = 0; this.total = 0; this.good = 0;
    this.runMinutes = 0; this.carry = 0; this.incidents = []; this.sequence = 0;
    this.running = false; this.speed = 5; this.revision = (this.revision || 0) + 1;
    this.defects = { 'Покрытие': 0, 'Геометрия': 0, 'Комплектация': 0 };
    this.history = [{ minute: 0, good: 0, plan: 0 }];
    this.stationRun = Object.fromEntries(STATIONS.map(s => [s.id, 0]));
    for (let i = 0; i < warmup; i += 5) this.advance(Math.min(5, warmup - i));
  }
  random() { this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0; return this.rng / 4294967296; }
  active(type) { return this.incidents.find(i => i.type === type && i.status === 'active'); }
  parameters() { return lineParameters(this.incidents.filter(i => i.status === 'active').map(i => i.type)); }
  inject(type) {
    if (typeof type !== 'string' || !Object.hasOwn(SCENARIOS, type)) throw new SimulationError('Неизвестный сценарий');
    if (this.elapsed >= SHIFT) throw new SimulationError('Смена завершена. Сбросьте демо.', 409);
    if (this.active(type)) throw new SimulationError('Этот инцидент уже активен', 409);
    const { effect, ...spec } = SCENARIOS[type];
    const stationName = STATIONS.find(s => s.id === spec.station).name;
    this.incidents.unshift({ id: ++this.sequence, type, ...spec, stationName, start: this.elapsed, end: null, expires: this.elapsed + spec.duration, status: 'active', resolution: null });
    this.revision++;
  }
  resolve(id, auto = false) {
    const item = this.incidents.find(i => i.id === id && i.status === 'active');
    if (!item) throw new SimulationError('Активный инцидент не найден', 404);
    item.status = 'resolved'; item.end = this.elapsed; item.resolution = auto ? 'Восстановлено по сценарию' : 'Устранено оператором демо';
    this.revision++;
  }
  advance(minutes = 5) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new SimulationError('Шаг должен быть от 1 до 60 минут');
    for (let n = 0; n < minutes && this.elapsed < SHIFT; n++) {
      for (const i of this.incidents.filter(i => i.status === 'active' && i.expires <= this.elapsed)) this.resolve(i.id, true);
      const p = this.parameters();
      // Simplified synchronous line, no WIP/buffers. A stop blocks every station.
      if (!p.stopped) {
        this.runMinutes++;
        for (const s of STATIONS) this.stationRun[s.id]++;
        this.carry += p.rate;
        while (this.carry >= 1) {
          this.carry -= 1; this.total++;
          if (this.random() < p.rejectRate) {
            const category = this.active('defects') ? 'Покрытие' : Object.keys(this.defects)[Math.floor(this.random() * 3)];
            this.defects[category]++;
          } else this.good++;
        }
      }
      this.elapsed++;
      if (this.elapsed % 5 === 0 || this.elapsed === SHIFT) this.history.push({ minute: this.elapsed, good: this.good, plan: round(PLAN * this.elapsed / SHIFT) });
    }
    for (const i of this.incidents.filter(i => i.status === 'active' && i.expires <= this.elapsed)) this.resolve(i.id, true);
    if (this.elapsed >= SHIFT) {
      this.running = false;
      // No invented resolution time: end stays null, the scheduled recovery stays in `expires`.
      for (const i of this.incidents.filter(i => i.status === 'active')) { i.status = 'unresolved'; i.resolution = 'Не устранён к концу смены'; }
    }
    this.revision++;
  }
  forecast() {
    // Piecewise expectation: respect scheduled incident recovery, no random draws.
    let future = 0, lostStop = 0, lostSlow = 0, lostQuality = 0;
    const baseGood = BASELINE.rate * BASELINE.yieldRate;
    for (let m = this.elapsed; m < SHIFT; m++) {
      const p = lineParameters(this.incidents.filter(i => i.status === 'active' && i.expires > m).map(i => i.type));
      if (p.stopped) lostStop += baseGood;
      else { lostSlow += (BASELINE.rate - p.rate) * BASELINE.yieldRate; lostQuality += p.rate * (BASELINE.yieldRate - p.yieldRate); future += p.rate * p.yieldRate; }
    }
    const projected = Math.round(this.good + future);
    return {
      projected, low: Math.round(this.good + future * .9), high: Math.round(this.good + future * 1.1),
      gap: projected - PLAN, future: round(future), remaining: SHIFT - this.elapsed,
      baseline: { bottleneck: BASELINE.bottleneck.id, rate: BASELINE.rate, yieldRate: BASELINE.yieldRate },
      factors: { stop: round(lostStop), slowdown: round(lostSlow), quality: round(lostQuality) },
      formula: 'Годные сейчас + Σ (темп узкого места × доля годных) за оставшиеся минуты; при остановке вклад = 0.',
      assumption: `Базовый синтетический режим: ${BASELINE.bottleneck.name.toLowerCase()} ${ru(BASELINE.rate)} шт./мин, доля годных ${ru(BASELINE.yieldRate * 100)}%. Активные инциденты заканчиваются в указанное время. Новых остановок нет. Диапазон: ±10% будущего выпуска, не доверительный интервал.`,
    };
  }
  snapshot() {
    const p = this.parameters(), metrics = oee(this.elapsed, this.runMinutes, this.total, this.good);
    const active = this.incidents.filter(i => i.status === 'active');
    const stopStations = new Set(active.filter(i => SCENARIOS[i.type].effect.stop).map(i => i.station));
    const warnStations = new Set(active.filter(i => !SCENARIOS[i.type].effect.stop).map(i => i.station));
    const state = id => stopStations.size ? (stopStations.has(id) ? 'stop' : 'waiting') : warnStations.has(id) ? 'warning' : 'normal';
    return {
      synthetic: true, seed: this.seed, revision: this.revision, elapsed: this.elapsed, shift: SHIFT, plan: PLAN,
      planNow: round(PLAN * this.elapsed / SHIFT), total: this.total, good: this.good, rejects: this.total - this.good,
      delta: round(this.good - PLAN * this.elapsed / SHIFT), running: this.running, speed: this.speed,
      finished: this.elapsed >= SHIFT, runMinutes: this.runMinutes, downtime: this.elapsed - this.runMinutes,
      idealCycle: IDEAL_CYCLE, metrics, defects: { ...this.defects }, history: this.history.map(x => ({ ...x })),
      incidents: this.incidents.map(x => ({ ...x })), forecast: this.forecast(),
      bottleneck: stopStations.size ? [...stopStations][0] : p.bottleneck.id,
      stations: p.rates.map(s => ({ ...s, state: state(s.id), metrics: oee(this.elapsed, this.stationRun[s.id], this.total, this.good) })),
    };
  }
}
