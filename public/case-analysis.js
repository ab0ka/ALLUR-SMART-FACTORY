// Analysis of the case test data («Данные кейса»). Pure functions over the dataset file: no DOM, no network, no
// simulation state. The screen, the CSV and the printed report all call these same functions.
// Every conclusion keeps the source records it rests on; nothing is filled in where the source is silent.

export const MODE_LABEL = 'Тестовые данные задания. Не подтверждённые реальные показатели Allur';
export const KINDS = { fact: 'Факт из источника', calc: 'Расчёт по данным', hypothesis: 'Гипотеза', scenario: 'Сценарий при допущениях' };
export const DOWNTIME_TOTAL_NAME = 'Суммарная длительность зарегистрированных простоев оборудования';
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nonEmpty = v => typeof v === 'string' && v.trim() !== '';

// ---------- Loading ----------
export function validateDataset(raw) {
  const errors = [], err = (p, m) => { if (errors.length < 40) errors.push(`${p}: ${m}`); };
  if (!isObj(raw)) return { data: null, errors: ['Нужен JSON-объект набора данных'] };
  if (!Array.isArray(raw.route) || !raw.route.every(nonEmpty)) err('route', 'список участков маршрута');
  if (!isObj(raw.lineStage)) err('lineStage', 'сопоставление линия → участок');
  const c = raw.conditions;
  if (!isObj(c)) err('conditions', 'условия задания');
  else for (const k of ['shifts', 'shiftHours', 'oeeTargetPct', 'maxDefectPct', 'maxCriticalDowntimeMinPerDay', 'monthlyPlanMin']) if (!isNum(c[k]) || c[k] < 0) err(`conditions.${k}`, 'неотрицательное число');
  const table = (name, check) => { if (!Array.isArray(raw[name])) return err(name, 'нужен массив (может быть пустым)'); raw[name].forEach((r, i) => isObj(r) ? check(r, `${name}[${i}]`) : err(`${name}[${i}]`, 'нужен объект')); };
  const count = (r, p, k) => { if (!Number.isInteger(r[k]) || r[k] < 0) err(`${p}.${k}`, 'целое неотрицательное количество'); };
  table('lines', (r, p) => { if (!isDate(r.date)) err(`${p}.date`, 'дата ГГГГ-ММ-ДД'); if (!nonEmpty(r.line)) err(`${p}.line`, 'строка'); else if (isObj(raw.lineStage) && !nonEmpty(raw.lineStage[r.line])) err(`${p}.line`, `линия «${r.line}» не сопоставлена с участком`); count(r, p, 'plan'); count(r, p, 'fact'); if (r.hours != null && (!isNum(r.hours) || r.hours < 0)) err(`${p}.hours`, 'число часов'); if (r.loadPct != null && (!isNum(r.loadPct) || r.loadPct < 0)) err(`${p}.loadPct`, 'процент'); });
  table('downtime', (r, p) => { if (!isDate(r.date)) err(`${p}.date`, 'дата ГГГГ-ММ-ДД'); for (const k of ['stage', 'equipment', 'reason']) if (!nonEmpty(r[k])) err(`${p}.${k}`, 'строка'); if (!isNum(r.minutes) || r.minutes < 0) err(`${p}.minutes`, 'длительность в минутах'); });
  table('modelPlan', (r, p) => { if (!nonEmpty(r.model)) err(`${p}.model`, 'строка'); count(r, p, 'plan'); });
  table('quality', (r, p) => { if (!isDate(r.date)) err(`${p}.date`, 'дата ГГГГ-ММ-ДД'); if (!nonEmpty(r.stage)) err(`${p}.stage`, 'строка'); count(r, p, 'produced'); count(r, p, 'defects'); if (Number.isInteger(r.defects) && Number.isInteger(r.produced) && r.defects > r.produced) err(`${p}.defects`, 'брак больше выпущенного'); if (r.sourceDefectPct != null && !isNum(r.sourceDefectPct)) err(`${p}.sourceDefectPct`, 'число или null'); });
  if (errors.length) return { data: null, errors };
  const id = (prefix, rows) => rows.map((r, i) => ({ ...r, id: `${prefix}${i + 1}` }));
  const data = {
    id: raw.id ?? 'dataset', title: raw.title ?? 'Набор данных', label: raw.label ?? MODE_LABEL, source: raw.source ?? {}, unit: raw.unit ?? 'ед.',
    route: [...raw.route], lineStage: { ...raw.lineStage }, conditions: { ...c },
    lines: id('Л', raw.lines).map(r => ({ ...r, stage: raw.lineStage[r.line] })),
    downtime: id('П', raw.downtime), modelPlan: id('М', raw.modelPlan), quality: id('К', raw.quality),
  };
  return { data, errors };
}

// ---------- Numbers ----------
export const ratioPct = (num, den) => den > 0 ? num / den * 100 : null; // null, not 0, when there is nothing to divide by
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
export const fmtNum = (n, digits = 1) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
export const fmtPct = (n, digits = 1) => n == null ? 'нет данных' : `${fmtNum(n, digits)} %`;
const fmtSigned = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n), 0)}`;
export const fmtDate = d => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—';
const fmtPeriod = (from, to) => from === to ? fmtDate(from) : `${fmtDate(from)}–${fmtDate(to)}`;

// ---------- Filter: one filter for every number, chart, table, CSV and report ----------
export function datesOf(data) { return [...new Set([...data.lines, ...data.downtime, ...data.quality].map(r => r.date))].sort(); }
export function normalizeFilter(data, f = {}) {
  const dates = datesOf(data);
  let from = dates.includes(f.from) ? f.from : dates[0] ?? null, to = dates.includes(f.to) ? f.to : dates.at(-1) ?? null;
  if (from && to && from > to) [from, to] = [to, from];
  const stage = data.route.includes(f.stage) ? f.stage : 'all';
  return { from, to, stage };
}
export function applyFilter(data, filter) {
  const f = normalizeFilter(data, filter), inDate = r => f.from != null && r.date >= f.from && r.date <= f.to, inStage = s => f.stage === 'all' || s === f.stage;
  return { filter: f, lines: data.lines.filter(r => inDate(r) && inStage(r.stage)), downtime: data.downtime.filter(r => inDate(r) && inStage(r.stage)), quality: data.quality.filter(r => inDate(r) && inStage(r.stage)) };
}
const stagesIn = (data, view) => data.route.filter(s => view.filter.stage === 'all' || s === view.filter.stage);

// ---------- Aggregates ----------
export const lineRow = r => ({ ...r, completionPct: ratioPct(r.fact, r.plan), deviation: r.fact - r.plan });
export function production(data, view) {
  return stagesIn(data, view).map(stage => {
    const rows = view.lines.filter(r => r.stage === stage).map(lineRow);
    if (!rows.length) return { stage, measured: false, rows };
    const plan = sum(rows, 'plan'), fact = sum(rows, 'fact');
    return { stage, measured: true, rows, plan, fact, completionPct: ratioPct(fact, plan), deviation: fact - plan, hours: sum(rows.filter(r => isNum(r.hours)), 'hours') };
  });
}
// Defect rate of a stage = total defects / total produced; source percentages are kept for comparison only.
export function quality(data, view) {
  return stagesIn(data, view).map(stage => {
    const rows = view.quality.filter(r => r.stage === stage).map(r => ({ ...r, ratePct: ratioPct(r.defects, r.produced) }));
    if (!rows.length) return { stage, measured: false, rows };
    const produced = sum(rows, 'produced'), defects = sum(rows, 'defects');
    return { stage, measured: true, rows, produced, defects, ratePct: ratioPct(defects, produced) };
  });
}
// Downtime records grouped by date, stage and equipment. Records may overlap in time: the total is not a plant stoppage.
export function downtimeGroups(view) {
  const map = new Map();
  for (const r of view.downtime) {
    const key = `${r.date}|${r.stage}|${r.equipment}`;
    if (!map.has(key)) map.set(key, { date: r.date, stage: r.stage, equipment: r.equipment, minutes: 0, records: [] });
    const g = map.get(key); g.minutes += r.minutes; g.records.push(r);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.stage.localeCompare(b.stage) || a.equipment.localeCompare(b.equipment));
}
export function downtimeByEquipment(view) {
  const map = new Map();
  for (const r of view.downtime) { const g = map.get(r.equipment) ?? { equipment: r.equipment, stage: r.stage, minutes: 0, records: [] }; g.minutes += r.minutes; g.records.push(r); map.set(r.equipment, g); }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes || a.equipment.localeCompare(b.equipment));
}
export const downtimeTotal = view => view.downtime.length ? sum(view.downtime, 'minutes') : null;
export function planCheck(data) {
  const models = data.modelPlan.length ? sum(data.modelPlan, 'plan') : null, target = data.conditions.monthlyPlanMin;
  return { models, target, gap: models == null ? null : target - models, consistent: models === target };
}

// ---------- Stage statuses for the route scheme ----------
// A stage without measurements in the filter is «Нет данных», never green and never zero.
export function stageStatuses(data, view) {
  const prod = Object.fromEntries(production(data, view).map(p => [p.stage, p])), q = Object.fromEntries(quality(data, view).map(p => [p.stage, p]));
  const max = data.conditions.maxDefectPct;
  return stagesIn(data, view).map(stage => {
    const p = prod[stage], k = q[stage], dt = view.downtime.filter(r => r.stage === stage);
    if (!p.measured && !k.measured && !dt.length) return { stage, status: 'nodata', label: 'Нет данных', notes: [] };
    const notes = [];
    let status = 'ok';
    if (k.measured && k.ratePct != null && k.ratePct > max) { status = 'problem'; notes.push(`брак ${fmtPct(k.ratePct)} > ${fmtPct(max, 0)}`); }
    if (p.measured && p.completionPct != null && p.completionPct < 100) { if (status === 'ok') status = 'warn'; notes.push(`план ${fmtPct(p.completionPct)}`); }
    if (dt.length) notes.push(`простои ${fmtNum(sum(dt, 'minutes'), 0)} мин`);
    const partial = !p.measured || !k.measured;
    return { stage, status, label: { ok: partial ? 'В пределах условий (данные неполные)' : 'В пределах условий', warn: 'Ниже плана', problem: 'Выше порога брака' }[status], notes };
  });
}

// ---------- Deviations ----------
const periodOf = rows => { const d = rows.map(r => r.date).sort(); return d.length ? fmtPeriod(d[0], d.at(-1)) : '—'; };
export function deviations(data, view) {
  const cards = [], max = data.conditions.maxDefectPct, u = data.unit, f = view.filter;
  for (const k of quality(data, view)) {
    if (!k.measured || k.ratePct == null || k.ratePct <= max) continue;
    const days = k.rows.filter(r => r.ratePct != null && r.ratePct > max), dt = view.downtime.filter(r => r.stage === k.stage);
    cards.push({
      id: `quality-${k.stage}`, type: 'quality', rank: 0, magnitude: k.ratePct / max,
      title: `Брак на участке «${k.stage}» выше допустимого`, stage: k.stage, period: periodOf(k.rows),
      value: `${fmtPct(k.ratePct, 2)} (${k.defects} из ${k.produced} ${u})`, threshold: `допустимо ≤ ${fmtPct(max, 0)}`,
      evidence: [...k.rows.map(r => r.id), ...dt.map(r => r.id)],
      facts: k.rows.map(r => `${fmtDate(r.date)}: выпущено ${r.produced} ${u}, брак ${r.defects} ${u}${r.sourceDefectPct != null ? ` (в источнике ${fmtPct(r.sourceDefectPct)})` : ''} — запись ${r.id}`),
      calc: [`Брак за период = ${k.defects} / ${k.produced} × 100 % = ${fmtPct(k.ratePct, 3)}; это в ${fmtNum(k.ratePct / max, 2)} раза выше порога.`,
        days.length ? `Дни выше порога: ${days.map(r => `${fmtDate(r.date)} — ${fmtPct(r.ratePct, 2)}`).join('; ')}.` : 'По отдельным дням порог не превышен, превышение — по сумме за период.'],
      hypotheses: dt.length ? dt.map(r => `В тот же период на участке зарегистрирован простой ${r.equipment} ${fmtDate(r.date)} (${r.reason.toLowerCase()}, ${r.minutes} мин). Связь с браком не установлена — запись ${r.id}.`) : ['Возможны отклонения параметров процесса или качества материалов на участке — требует проверки.'],
      known: ['количество выпущенных изделий и брака по дням', 'допустимый уровень брака по условиям задания'],
      unknown: ['типы и причины дефектов', 'на каком этапе возник дефект и как изделия связаны между участками', 'исправлен ли брак повторной обработкой'],
      next: `Проверить параметры процесса участка «${k.stage}» и журнал дефектов за ${periodOf(k.rows)}; разделить дефекты по типам и сопоставить со сменами.`,
    });
  }
  for (const p of production(data, view)) {
    if (!p.measured || p.completionPct == null || p.completionPct >= 100) continue;
    const worst = p.rows.reduce((a, b) => (b.completionPct ?? 101) < (a.completionPct ?? 101) ? b : a), dt = view.downtime.filter(r => r.stage === p.stage);
    cards.push({
      id: `production-${p.stage}`, type: 'production', rank: 1, magnitude: 1 - p.completionPct / 100,
      title: `Выпуск участка «${p.stage}» ниже плана`, stage: p.stage, period: periodOf(p.rows),
      value: `${p.fact} из ${p.plan} ${u} (${fmtPct(p.completionPct, 2)}, отклонение ${fmtSigned(p.deviation)} ${u})`, threshold: `план ${p.plan} ${u}`,
      evidence: [...p.rows.map(r => r.id), ...dt.map(r => r.id)],
      facts: p.rows.map(r => `${fmtDate(r.date)}, ${r.line}: план ${r.plan} ${u}, факт ${r.fact} ${u}${isNum(r.hours) ? `, время работы ${fmtNum(r.hours)} ч` : ''}${isNum(r.loadPct) ? `, загрузка ${fmtNum(r.loadPct, 0)} %` : ''} — запись ${r.id}`),
      calc: [`Выполнение плана = ${p.fact} / ${p.plan} × 100 % = ${fmtPct(p.completionPct, 2)}; отклонение = ${p.fact} − ${p.plan} = ${fmtSigned(p.deviation)} ${u}.`,
        `Наибольшее отставание: ${fmtDate(worst.date)} — ${worst.fact} из ${worst.plan} ${u} (${fmtPct(worst.completionPct, 2)}, ${fmtSigned(worst.deviation)} ${u}).`],
      hypotheses: dt.length ? dt.map(r => `${fmtDate(r.date)} зарегистрирован простой ${r.equipment}: ${r.reason.toLowerCase()}, ${r.minutes} мин (запись ${r.id}). Может объяснять часть недовыпуска; это не доказано.`) : ['Зарегистрированных простоев на участке в периоде нет; причина недовыпуска в источнике не указана.'],
      known: ['план и факт по дням', 'время работы и загрузка из источника', 'зарегистрированные простои участка'],
      unknown: ['около 8 ч в строке — одна смена или весь день при двух сменах', 'время начала и окончания простоев', 'идеальное время цикла'],
      next: `Сверить сменные журналы участка «${p.stage}» за ${fmtDate(worst.date)} с журналом простоев: пришлись ли простои на рабочее время линии и сколько единиц ими объясняется.`,
    });
  }
  const crit = data.conditions.maxCriticalDowntimeMinPerDay;
  for (const g of downtimeGroups(view)) {
    if (g.minutes <= crit) continue;
    cards.push({
      id: `downtime-${g.date}-${g.equipment}`, type: 'downtime', rank: 2, magnitude: g.minutes / crit,
      title: `Простой ${g.equipment} больше ${crit} мин за сутки`, stage: g.stage, period: fmtDate(g.date),
      value: `${g.minutes} мин`, threshold: `${crit} мин в сутки — только для критического оборудования`,
      evidence: g.records.map(r => r.id),
      facts: g.records.map(r => `${fmtDate(r.date)}, ${r.stage}, ${r.equipment}: ${r.reason}, ${r.minutes} мин — запись ${r.id}`),
      calc: [`Сумма записей за сутки = ${g.minutes} мин.`], hypotheses: ['Порог применим, только если оборудование критическое — это в источнике не указано.'],
      known: ['длительность и зарегистрированная причина'], unknown: ['является ли оборудование критическим', 'время начала и окончания, пересечения записей'],
      next: `Уточнить, относится ли ${g.equipment} к критическому оборудованию, и проверить журнал ремонта за ${fmtDate(g.date)}.`,
    });
  }
  const plan = planCheck(data);
  if (f.stage === 'all' && plan.models != null && !plan.consistent) cards.push({
    id: 'plan-mismatch', type: 'plan', rank: 3, magnitude: Math.abs(plan.gap) / plan.target,
    title: 'Сумма месячных планов моделей не совпадает с общим ориентиром', stage: 'Предприятие', period: 'месяц (фильтр по дате не применяется)',
    value: `${fmtNum(plan.models, 0)} ${u}`, threshold: `ориентир ≥ ${fmtNum(plan.target, 0)} ${u} в месяц`,
    evidence: data.modelPlan.map(r => r.id),
    facts: [...data.modelPlan.map(r => `${r.model}: ${fmtNum(r.plan, 0)} ${u} — запись ${r.id}`), `Условие задания: план выпуска ≥ ${fmtNum(plan.target, 0)} автомобилей в месяц.`],
    calc: [`Сумма планов моделей = ${data.modelPlan.map(r => fmtNum(r.plan, 0)).join(' + ')} = ${fmtNum(plan.models, 0)} ${u}; расхождение с ориентиром = ${fmtNum(plan.target, 0)} − ${fmtNum(plan.models, 0)} = ${fmtNum(plan.gap, 0)} ${u}.`],
    hypotheses: ['Ориентир может включать модели или резерв, которых нет в таблице моделей.'],
    known: ['планы трёх моделей', 'общее условие по выпуску'], unknown: ['какой план считается действующим', 'есть ли модели вне таблицы'],
    next: 'Уточнить у планирования, какой месячный план действующий и откуда разница в 700 ед.'.replace('700', fmtNum(plan.gap, 0)),
  });
  return cards.sort((a, b) => a.rank - b.rank || b.magnitude - a.magnitude);
}
export function summary(data, view) {
  const dev = deviations(data, view), f = view.filter;
  return { main: dev[0] ?? null, others: dev.slice(1, 4), count: dev.length, period: f.from ? fmtPeriod(f.from, f.to) : 'нет дат', stage: f.stage === 'all' ? 'все участки' : f.stage };
}

// ---------- Data quality and what cannot be computed ----------
export function dataQuality(data) {
  const plan = planCheck(data), hours = data.lines.filter(r => isNum(r.hours)).map(r => r.hours), c = data.conditions, dates = datesOf(data);
  const mismatch = data.quality.filter(r => r.sourceDefectPct != null && r.produced > 0 && Math.abs(Math.round(r.defects / r.produced * 1000) / 10 - r.sourceDefectPct) > .05);
  const prodVsLine = data.quality.filter(r => { const l = data.lines.find(x => x.date === r.date && x.stage === r.stage); return l && l.fact !== r.produced; });
  return [
    { kind: 'calc', title: 'Месячные планы', text: plan.models == null ? 'Таблица планов по моделям пуста.' : `Сумма месячных планов моделей = ${fmtNum(plan.models, 0)} ед., общий ориентир = ${fmtNum(plan.target, 0)} ед., расхождение = ${fmtNum(plan.gap, 0)} ед.` },
    { kind: 'limit', title: 'Смена или сутки', text: hours.length ? `Время работы в строках ${fmtNum(Math.min(...hours))}–${fmtNum(Math.max(...hours))} ч при режиме ${c.shifts} смены по ${c.shiftHours} ч: неясно, описывает строка одну смену или весь день.` : 'Время работы линий не указано.' },
    { kind: 'limit', title: 'Критическое оборудование', text: `Неизвестно, какое оборудование считается критическим, поэтому порог ${c.maxCriticalDowntimeMinPerDay} мин в сутки не применяется автоматически.` },
    { kind: 'limit', title: 'Простои', text: 'Нет времени начала и окончания простоев: нельзя определить пересечения и то, пришёлся ли простой на рабочее время линии.' },
    { kind: 'limit', title: 'OEE', text: 'Нет идеального (нормативного) времени цикла и планового времени работы: OEE рассчитать нельзя.' },
    { kind: 'limit', title: 'Брак', text: 'Нет детализации причин брака и связи изделий между этапами: неизвестно, где возник дефект.' },
    { kind: 'limit', title: 'Период', text: dates.length ? `Данные охватывают ${dates.length} дн. (${fmtPeriod(dates[0], dates.at(-1))}) — это не полная история предприятия.` : 'В наборе нет датированных записей.' },
    { kind: 'calc', title: 'Проценты брака источника', text: mismatch.length ? `Не совпадают с расчётом по количеству: ${mismatch.map(r => r.id).join(', ')}.` : 'Проценты брака из источника совпадают с расчётом по количеству после округления до 0,1.' },
    { kind: 'calc', title: 'Выпущено и факт линии', text: prodVsLine.length ? `«Выпущено» в таблице качества отличается от факта линии: ${prodVsLine.map(r => r.id).join(', ')}.` : '«Выпущено» в таблице качества совпадает с фактом соответствующей линии за тот же день.' },
    { kind: 'limit', title: 'Линии и участки', text: `Линии сопоставлены с участками по названию: ${Object.entries(data.lineStage).map(([l, s]) => `${l} → ${s}`).join(', ')}.` },
    { kind: 'limit', title: 'Выпуск', text: 'Выпуск последовательных участков не суммируется: выпуск сборки — это выпуск сборки, данных о финальной приёмке и отгрузке нет.' },
  ];
}
export function oee(data) {
  return { available: false, label: 'Недостаточно данных для расчёта', targetPct: data.conditions.oeeTargetPct,
    missing: ['идеальное (нормативное) время цикла по линиям', 'плановое время работы: строка — смена или сутки', 'время начала и окончания простоев по оборудованию линии', 'количество годных изделий по этапам с учётом исправленного брака'],
    note: 'Загрузка, % из источника не является OEE.' };
}
// Scenario only: every input comes from the user and the daily rate must be confirmed as an assumption.
export function scenario(data, { remainingDays, accumulated, dailyRate, confirmed }) {
  const n = v => v === '' || v == null ? NaN : Number(v);
  const days = n(remainingDays), acc = n(accumulated), rate = n(dailyRate);
  if (![days, acc, rate].every(v => Number.isFinite(v) && v >= 0)) return { ok: false, reason: 'Введите неотрицательные числа: оставшиеся рабочие дни, накопленный выпуск и дневной темп.' };
  if (!confirmed) return { ok: false, reason: 'Подтвердите допущение о дневном темпе.' };
  const projected = acc + days * rate, plan = planCheck(data);
  return { ok: true, projected, vsTarget: projected - plan.target, vsModels: plan.models == null ? null : projected - plan.models, target: plan.target, models: plan.models,
    text: `Сценарий при допущениях: ${fmtNum(acc, 0)} + ${fmtNum(days, 0)} дн. × ${fmtNum(rate, 1)} ед./день = ${fmtNum(projected, 0)} ед. Это не прогноз и не ML-модель.` };
}

// ---------- CSV of the filtered data ----------
export function csvText(v) { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; }
const csvNum = v => v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 1000) / 1000).replace('.', ',');
export function toCsv(data, view) {
  const f = view.filter, out = [], row = cells => out.push(cells.join(';')), t = csvText;
  row([t(data.label)]); row([t('Источник'), t(data.source.document ?? data.title)]); row([t('Период'), t(f.from ? fmtPeriod(f.from, f.to) : 'нет дат')]); row([t('Участок'), t(f.stage === 'all' ? 'все участки' : f.stage)]); out.push('');
  row([t('Работа линий'), t('Запись'), t('Дата'), t('Линия'), t('Участок'), t('План, ед.'), t('Факт, ед.'), t('Выполнение плана, %'), t('Отклонение, ед.'), t('Время работы, ч'), t('Загрузка, % (источник)')]);
  for (const r of view.lines.map(lineRow)) row([t(''), t(r.id), t(r.date), t(r.line), t(r.stage), csvNum(r.plan), csvNum(r.fact), csvNum(r.completionPct), csvNum(r.deviation), csvNum(r.hours), csvNum(r.loadPct)]);
  out.push('');
  row([t('Качество'), t('Запись'), t('Дата'), t('Участок'), t('Выпущено, ед.'), t('Брак, ед.'), t('Брак, % (расчёт)'), t('Брак, % (источник)')]);
  for (const r of view.quality) row([t(''), t(r.id), t(r.date), t(r.stage), csvNum(r.produced), csvNum(r.defects), csvNum(ratioPct(r.defects, r.produced)), csvNum(r.sourceDefectPct)]);
  for (const k of quality(data, view).filter(q => q.measured)) row([t('Итого за период'), t(''), t(''), t(k.stage), csvNum(k.produced), csvNum(k.defects), csvNum(k.ratePct), t('')]);
  out.push('');
  row([t('Простои'), t('Запись'), t('Дата'), t('Участок'), t('Оборудование'), t('Зарегистрированная причина'), t('Длительность, мин')]);
  for (const r of view.downtime) row([t(''), t(r.id), t(r.date), t(r.stage), t(r.equipment), t(r.reason), csvNum(r.minutes)]);
  row([t(DOWNTIME_TOTAL_NAME), t(''), t(''), t(''), t(''), t(''), csvNum(downtimeTotal(view))]);
  out.push('');
  row([t('Отклонения'), t('Тип'), t('Участок'), t('Период'), t('Значение'), t('Порог / план'), t('Исходные записи'), t('Следующий шаг проверки')]);
  for (const d of deviations(data, view)) row([t(d.title), t(d.type), t(d.stage), t(d.period), t(d.value), t(d.threshold), t(d.evidence.join(', ')), t(d.next)]);
  return '\uFEFF' + out.join('\r\n') + '\r\n';
}
