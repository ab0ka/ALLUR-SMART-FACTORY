// Video analytics over pre-computed analysis results (contract schemaVersion 1). Pure functions: no DOM, no network.
// Every number shown on the «Видеоанализ» screen is computed here from the loaded file; nothing is inferred
// beyond what the results contain. Time in a zone is observed presence, not an operation time.

export const SCHEMA_VERSION = 1;
export const MODES = {
  model: 'Результаты модели компьютерного зрения',
  manual: 'Ручная разметка',
  synthetic: 'Синтетические результаты (не компьютерное зрение)',
};
export const STATUS = {
  completed: 'Покинул зону',
  lost: 'Потерян из виду: выход не подтверждён',
  open_at_end: 'В зоне на конце записи',
};
export const THRESHOLD_SOURCES = { demo_assumption: 'демонстрационный норматив, не норматив Allur' };
const EPS = 1e-6, TIME_EPS = .05, MAX_ERRORS = 40;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = v => typeof v === 'string';
const in01 = v => isNum(v) && v >= -EPS && v <= 1 + EPS;

// ---------- Validation ----------
// Returns { data, errors, warnings }. data is null when there is at least one error; the input is never mutated.
export function validateResults(raw) {
  const errors = [], warnings = [];
  const err = (path, msg) => { if (errors.length < MAX_ERRORS) errors.push(`${path}: ${msg}`); };
  if (!isObj(raw)) return { data: null, errors: ['Файл должен содержать JSON-объект результатов'], warnings };
  if (raw.schemaVersion !== SCHEMA_VERSION) err('schemaVersion', `ожидается ${SCHEMA_VERSION}`);

  const s = raw.source;
  if (!isObj(s)) err('source', 'нет описания источника');
  else {
    for (const k of ['id', 'fileName', 'title', 'license']) if (!isStr(s[k]) || !s[k].trim()) err(`source.${k}`, 'нужна непустая строка');
    if (s.url != null && !isStr(s.url)) err('source.url', 'строка или null');
    if (typeof s.synthetic !== 'boolean') err('source.synthetic', 'true или false');
    if (!isNum(s.durationSec) || s.durationSec <= 0) err('source.durationSec', 'положительное число секунд');
    for (const k of ['width', 'height']) if (!Number.isInteger(s[k]) || s[k] <= 0) err(`source.${k}`, 'положительное целое число пикселей');
  }
  const a = raw.analysis;
  if (!isObj(a)) err('analysis', 'нет описания анализа');
  else {
    if (!Object.hasOwn(MODES, a.mode)) err('analysis.mode', 'model, manual или synthetic');
    if (a.model != null && !isStr(a.model)) err('analysis.model', 'строка или null');
    if (!isNum(a.sampleFps) || a.sampleFps <= 0) err('analysis.sampleFps', 'положительное число кадров в секунду');
    if (a.processingSec != null && (!isNum(a.processingSec) || a.processingSec < 0)) err('analysis.processingSec', 'неотрицательное число или null');
  }
  const duration = isObj(s) && isNum(s.durationSec) ? s.durationSec : Infinity;

  const zoneIds = new Set();
  if (!Array.isArray(raw.zones)) err('zones', 'нужен массив зон');
  else raw.zones.forEach((z, i) => {
    const p = `zones[${i}]`;
    if (!isObj(z)) return err(p, 'нужен объект');
    if (!isStr(z.id) || !z.id) err(`${p}.id`, 'нужна строка');
    else if (zoneIds.has(z.id)) err(`${p}.id`, `повторяется «${z.id}»`);
    else zoneIds.add(z.id);
    if (!isStr(z.name) || !z.name.trim()) err(`${p}.name`, 'нужна строка');
    if (!Array.isArray(z.polygon) || z.polygon.length < 3) err(`${p}.polygon`, 'не меньше трёх точек');
    else z.polygon.forEach((pt, j) => { if (!Array.isArray(pt) || pt.length !== 2 || !in01(pt[0]) || !in01(pt[1])) err(`${p}.polygon[${j}]`, 'точка [x, y] с координатами 0..1'); });
    if (!isNum(z.thresholdSec) || z.thresholdSec < 0) err(`${p}.thresholdSec`, 'неотрицательное число секунд');
    if (!isStr(z.thresholdSource) || !z.thresholdSource) err(`${p}.thresholdSource`, 'нужна строка');
  });

  let prevT = -Infinity, unsorted = false;
  if (!Array.isArray(raw.frames)) err('frames', 'нужен массив кадров');
  else raw.frames.forEach((f, i) => {
    const p = `frames[${i}]`;
    if (!isObj(f)) return err(p, 'нужен объект');
    if (!isNum(f.t) || f.t < 0 || f.t > duration + TIME_EPS) err(`${p}.t`, 'время в пределах записи');
    else { if (f.t < prevT) unsorted = true; prevT = f.t; }
    if (!Array.isArray(f.objects)) return err(`${p}.objects`, 'нужен массив');
    f.objects.forEach((o, j) => {
      const q = `${p}.objects[${j}]`;
      if (!isObj(o)) return err(q, 'нужен объект');
      if (!(isStr(o.trackId) && o.trackId) && !Number.isInteger(o.trackId)) err(`${q}.trackId`, 'строка или целое число');
      if (!isStr(o.className) || !o.className) err(`${q}.className`, 'нужна строка');
      if (o.confidence != null && !in01(o.confidence)) err(`${q}.confidence`, 'число 0..1 или null');
      const b = o.bbox;
      if (!Array.isArray(b) || b.length !== 4 || !b.every(in01) || b[2] <= 0 || b[3] <= 0 || b[0] + b[2] > 1 + EPS || b[1] + b[3] > 1 + EPS) err(`${q}.bbox`, '[x, y, ширина, высота] в долях кадра 0..1, рамка внутри кадра');
      if (o.zoneId != null && !zoneIds.has(o.zoneId)) err(`${q}.zoneId`, `нет зоны «${o.zoneId}»`);
    });
  });

  const visitIds = new Set();
  if (!Array.isArray(raw.visits)) err('visits', 'нужен массив посещений');
  else raw.visits.forEach((v, i) => {
    const p = `visits[${i}]`;
    if (!isObj(v)) return err(p, 'нужен объект');
    if (!isStr(v.id) || !v.id) err(`${p}.id`, 'нужна строка');
    else if (visitIds.has(v.id)) err(`${p}.id`, `повторяется «${v.id}»`);
    else visitIds.add(v.id);
    if (!(isStr(v.trackId) && v.trackId) && !Number.isInteger(v.trackId)) err(`${p}.trackId`, 'строка или целое число');
    if (!zoneIds.has(v.zoneId)) err(`${p}.zoneId`, `нет зоны «${v.zoneId}»`);
    if (!Object.hasOwn(STATUS, v.status)) err(`${p}.status`, 'completed, lost или open_at_end');
    if (!isNum(v.startSec) || v.startSec < 0 || v.startSec > duration + TIME_EPS) err(`${p}.startSec`, 'время в пределах записи');
    if (v.endSec === null) { if (v.status === 'completed') err(`${p}.endSec`, 'у завершённого посещения нужен конец'); }
    else if (!isNum(v.endSec) || v.endSec > duration + TIME_EPS || (isNum(v.startSec) && v.endSec < v.startSec)) err(`${p}.endSec`, 'не раньше начала и в пределах записи, или null');
    const span = (isNum(v.endSec) ? v.endSec : duration) - v.startSec;
    if (!isNum(v.observedSec) || v.observedSec < 0) err(`${p}.observedSec`, 'неотрицательное число секунд');
    else if (isNum(v.startSec) && Number.isFinite(span) && v.observedSec > span + TIME_EPS) err(`${p}.observedSec`, 'больше промежутка между началом и концом');
  });

  if (errors.length) return { data: null, errors, warnings };
  if (unsorted) warnings.push('Кадры были не по порядку времени — отсортированы при загрузке.');
  if (!raw.frames.length) warnings.push('В результатах нет ни одного кадра с наблюдениями.');
  if (!raw.visits.length) warnings.push('В результатах нет посещений зон.');
  for (const z of raw.zones) if (!THRESHOLD_SOURCES[z.thresholdSource]) warnings.push(`Порог зоны «${z.name}»: источник «${z.thresholdSource}» не подтверждён этим экраном.`);
  const data = {
    schemaVersion: raw.schemaVersion,
    source: { ...s, url: s.url ?? null },
    analysis: { mode: a.mode, model: a.model ?? null, sampleFps: a.sampleFps, processingSec: a.processingSec ?? null },
    zones: raw.zones.map(z => ({ id: z.id, name: z.name, polygon: z.polygon.map(([x, y]) => [x, y]), thresholdSec: z.thresholdSec, thresholdSource: z.thresholdSource })),
    frames: raw.frames.map(f => ({ t: f.t, objects: f.objects.map(o => ({ trackId: String(o.trackId), className: o.className, confidence: o.confidence ?? null, bbox: [...o.bbox], zoneId: o.zoneId ?? null })) })).sort((x, y) => x.t - y.t),
    visits: raw.visits.map(v => ({ id: v.id, trackId: String(v.trackId), zoneId: v.zoneId, startSec: v.startSec, endSec: v.endSec, observedSec: v.observedSec, status: v.status })),
  };
  return { data, errors, warnings };
}
export function parseResults(text) {
  let raw;
  // Files saved on Windows may start with a byte order mark.
  try { raw = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return { data: null, errors: [`Неверный JSON: ${e.message}`], warnings: [] }; }
  return validateResults(raw);
}

// ---------- Labels ----------
export const dataLabel = data => data.source.synthetic ? 'Синтетические данные' : 'Не данные Allur';
export const thresholdLabel = zone => THRESHOLD_SOURCES[zone.thresholdSource] ?? `источник порога: ${zone.thresholdSource}`;

// ---------- Visits ----------
// Exceedance = max(0, observed − threshold). For lost / open visits the real presence is unknown: the observed time
// is a lower bound, so the exceedance is a lower bound too and the visit is never treated as a finished operation.
export function visitRows(data) {
  const zone = Object.fromEntries(data.zones.map(z => [z.id, z]));
  return data.visits.map(v => {
    const z = zone[v.zoneId], exceedSec = Math.max(0, v.observedSec - z.thresholdSec);
    return { ...v, zoneName: z.name, thresholdSec: z.thresholdSec, thresholdSource: z.thresholdSource, exceedSec, exceeded: exceedSec > 0, finished: v.status === 'completed', lowerBound: v.status !== 'completed' };
  }).sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
}
export function summarize(rows) {
  return {
    visits: rows.length,
    finished: rows.filter(r => r.finished).length,
    unfinished: rows.filter(r => !r.finished).length,
    exceeded: rows.filter(r => r.exceeded).length,
    maxExceedSec: rows.reduce((m, r) => Math.max(m, r.exceedSec), 0),
  };
}
// Possible delays: visits above the threshold, largest first, with a template explanation. Causes are hypotheses.
export function delays(rows) {
  return rows.filter(r => r.exceeded).sort((a, b) => b.exceedSec - a.exceedSec).map(r => ({
    ...r,
    text: `Объект ${r.trackId} в зоне «${r.zoneName}»: наблюдаемое время ${fmtSec(r.observedSec)} при пороге ${fmtSec(r.thresholdSec)} — превышение ${r.lowerBound ? 'не меньше ' : ''}${fmtSec(r.exceedSec)}.`,
    caveat: r.lowerBound
      ? 'Объект не был виден до выхода из зоны: фактическое время неизвестно, показана нижняя оценка. Завершение не подтверждено.'
      : 'Это время присутствия в зоне по видео, а не подтверждённое время операции.',
    hypotheses: ['ожидание освобождения следующего участка', 'нестандартная или дополнительная работа', 'простой без работы'],
  }));
}

// ---------- State at a video time ----------
// Observations older than staleSec are not shown as current: after a seek the picture depends only on t.
export const staleAfter = data => Math.max(2 / data.analysis.sampleFps, .25);
export function frameIndexAt(frames, t) {
  let lo = 0, hi = frames.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (frames[mid].t <= t + EPS) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at;
}
export function stateAt(data, t) {
  const i = frameIndexAt(data.frames, t);
  if (i < 0) return { t, frame: null, ageSec: null, stale: true, objects: [], counts: Object.fromEntries(data.zones.map(z => [z.id, null])) };
  const frame = data.frames[i], ageSec = t - frame.t, stale = ageSec > staleAfter(data);
  const counts = Object.fromEntries(data.zones.map(z => [z.id, stale ? null : frame.objects.filter(o => o.zoneId === z.id).length]));
  return { t, frame, ageSec, stale, objects: frame.objects, counts };
}
// Visits that cover time t (for highlighting rows while the video plays).
export const visitsAt = (rows, t) => rows.filter(r => r.startSec <= t + EPS && t <= (r.endSec ?? r.startSec + r.observedSec) + EPS);

// ---------- Zone occupancy over time ----------
// Number of observed objects in each zone per analysed frame; null where observations are missing (a gap longer
// than the stale limit), so the chart breaks instead of drawing an assumed value. Not a queue length.
export function occupancySeries(data) {
  const gap = staleAfter(data);
  return data.zones.map(z => {
    const points = [];
    data.frames.forEach((f, i) => {
      if (i && f.t - data.frames[i - 1].t > gap) points.push({ t: data.frames[i - 1].t + gap, n: null });
      points.push({ t: f.t, n: f.objects.filter(o => o.zoneId === z.id).length });
    });
    return { zoneId: z.id, zoneName: z.name, points, max: points.reduce((m, p) => Math.max(m, p.n ?? 0), 0) };
  });
}

// ---------- Export ----------
export function fmtSec(s) {
  if (s == null || !Number.isFinite(s)) return '—';
  const r = Math.round(s * 10) / 10, m = Math.floor(r / 60), sec = r - m * 60;
  const ss = (Number.isInteger(sec) ? String(sec) : sec.toFixed(1)).replace('.', ',');
  return m ? `${m} мин ${ss} с` : `${ss} с`;
}
export const fmtClock = s => { if (s == null || !Number.isFinite(s)) return '—'; const t = Math.max(0, s), m = Math.floor(t / 60), sec = t - m * 60; return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`; };
// Text cells are quoted and neutralised against spreadsheet formulas (=, +, -, @, tab, CR at the start).
export function csvText(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const csvNum = v => v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 100) / 100).replace('.', ',');
export function visitsCsv(data, rows) {
  const head = ['Источник', 'Тип данных', 'Режим', 'Посещение', 'Объект', 'Зона', 'Начало, с', 'Конец, с', 'Наблюдаемая длительность, с', 'Порог, с', 'Источник порога', 'Превышение, с', 'Превышение — нижняя оценка', 'Статус'];
  const lines = [head.map(csvText).join(';')];
  for (const r of rows) lines.push([
    csvText(data.source.title), csvText(dataLabel(data)), csvText(MODES[data.analysis.mode]), csvText(r.id), csvText(r.trackId), csvText(r.zoneName),
    csvNum(r.startSec), csvNum(r.endSec), csvNum(r.observedSec), csvNum(r.thresholdSec), csvText(thresholdLabel({ thresholdSource: r.thresholdSource })), csvNum(r.exceedSec), csvText(r.lowerBound ? 'да' : 'нет'), csvText(STATUS[r.status]),
  ].join(';'));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
// Only plain http(s) links from the results file are rendered as links.
export const safeUrl = u => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
