import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseResults, validateResults, visitRows, summarize, delays, stateAt, staleAfter, occupancySeries, visitsCsv, csvText, dataLabel, sourceLabel, statusLabel, validWindow, safeUrl, visitsAt, OVER_THRESHOLD_CONCLUSION } from '../public/video-analytics.js';
import { createApp } from '../server/index.mjs';

// public/video-fixture.json: saved results of vision/analyze.py for the external Pexels recording (not Allur).
const fixtureText = readFileSync(new URL('../public/video-fixture.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(fixtureText);
const load = raw => { const r = validateResults(raw); assert.deepEqual(r.errors, []); return r.data; };

// A small synthetic results record for the logic tests (60 s, 2 zones, 4 objects, one per visit status).
function synthetic() {
  const tracks = [
    { id: 'S1', zone: 'Z1', from: 3, to: 37, inside: [4.5, 36], bbox: [0.19, 0.49, 0.06, 0.22] },
    { id: 'S2', zone: 'Z1', from: 8, to: 25, inside: [8.5, 23.5], bbox: [0.27, 0.37, 0.06, 0.22] },
    { id: 'S3', zone: 'Z2', from: 28, to: 41, inside: [29, 41], bbox: [0.64, 0.43, 0.12, 0.14] },
    { id: 'S4', zone: 'Z1', from: 44, to: 60, inside: [45, 60], bbox: [0.22, 0.59, 0.06, 0.22] },
  ];
  const frames = [];
  for (let k = 0; k <= 120; k++) {
    const t = k / 2;
    frames.push({ t, objects: tracks.filter(s => t >= s.from && t <= s.to).map(s => ({ trackId: s.id, className: 'car', confidence: 0.8, bbox: [...s.bbox], zoneId: t >= s.inside[0] && t <= s.inside[1] ? s.zone : null })) });
  }
  return {
    schemaVersion: 1,
    source: { id: 'synthetic-demo-1', fileName: 'synthetic-demo.mp4', title: 'Синтетическая демонстрационная сцена (без видео)', url: null, license: 'Синтетические данные проекта', synthetic: true, durationSec: 60, width: 1280, height: 720 },
    analysis: { mode: 'synthetic', model: null, sampleFps: 2, processingSec: null },
    zones: [
      { id: 'Z1', name: 'Зона ожидания у поста', polygon: [[0.08, 0.3], [0.46, 0.3], [0.46, 0.92], [0.08, 0.92]], thresholdSec: 20, thresholdSource: 'demo_assumption' },
      { id: 'Z2', name: 'Проход к участку', polygon: [[0.56, 0.22], [0.94, 0.22], [0.94, 0.8], [0.56, 0.8]], thresholdSec: 10, thresholdSource: 'demo_assumption' },
    ],
    frames,
    visits: [
      { id: 'V1', trackId: 'S1', zoneId: 'Z1', startSec: 4.5, endSec: 36, observedSec: 31.5, status: 'completed' },
      { id: 'V2', trackId: 'S2', zoneId: 'Z1', startSec: 8.5, endSec: 23.5, observedSec: 15, status: 'completed' },
      { id: 'V3', trackId: 'S3', zoneId: 'Z2', startSec: 29, endSec: null, observedSec: 12, status: 'lost' },
      { id: 'V4', trackId: 'S4', zoneId: 'Z1', startSec: 45, endSec: null, observedSec: 15, status: 'open_at_end' },
    ],
  };
}

test('the bundled results are the model output for the external recording, limited to the validity window', () => {
  const r = parseResults(fixtureText);
  assert.deepEqual(r.errors, []);
  const d = r.data;
  assert.equal(d.analysis.mode, 'model');
  assert.equal(d.source.synthetic, false);
  assert.equal(d.source.fileName, 'pexels-5675618-cars-traffic-light.mp4');
  assert.equal(d.source.durationSec, 23.99); assert.equal(d.source.width, 1920); assert.equal(d.source.height, 1080);
  assert.equal(sourceLabel(d), 'Внешняя запись. Не производство Allur. Воспроизведение результатов анализа');
  assert.equal(validWindow(d).label, 'Измерение ограничено 0–21,8 с: дальше камера движется');
  assert.ok(d.frames.every(f => f.t <= 21.8), 'no frame after the window');
  for (const z of d.zones) { assert.equal(z.thresholdSec, 10); assert.equal(z.thresholdSource, 'demo_assumption'); }
  const rows = visitRows(d);
  for (const v of rows) {
    assert.match(v.trackId, /^car-\d+$/, 'temporary anonymous track ids only');
    assert.ok(v.startSec + v.observedSec <= 21.8 + 0.05, `${v.id} measured only inside the window`);
    if (v.truncated) { assert.equal(v.status, 'open_at_end'); assert.equal(v.truncatedAt, 21.8); assert.equal(v.endSec, null); assert.equal(v.lowerBound, true); }
  }
  assert.ok(rows.some(v => v.truncated), 'cars still waiting at 21.8 s are truncated');
  const dl = delays(rows);
  assert.ok(dl.length > 0);
  for (const x of dl) { assert.equal(x.conclusion, 'Превышен демонстрационный порог присутствия; производственная причина не определяется'); assert.equal(x.hypotheses, undefined); }
  assert.match(statusLabel(rows.find(v => v.truncated)), /Измерение остановлено на 21,8 с/);
  // after the window the zone is not measured: no count is shown
  assert.equal(stateAt(d, 21.5).outsideWindow, false);
  assert.ok(Object.values(stateAt(d, 21.5).counts).every(n => Number.isInteger(n)));
  assert.equal(stateAt(d, 22).outsideWindow, true);
  assert.ok(Object.values(stateAt(d, 22).counts).every(n => n === null));
});

test('the screen text has no production causes, VIN, accuracy or savings', () => {
  const d = load(fixture()), rows = visitRows(d);
  const text = [JSON.stringify(delays(rows)), visitsCsv(d, rows), readFileSync(new URL('../public/app/80-video-analytics.js', import.meta.url), 'utf8'), readFileSync(new URL('../public/video-analytics.js', import.meta.url), 'utf8')].join('\n');
  for (const bad of [/гипотез/i, /простой без работы/, /нестандартная/, /освобождения следующего участка/, /экономи/i, /точность/i, /accuracy/i, /DEMO-\d/]) assert.doesNotMatch(text, bad);
  assert.doesNotMatch(text.replace(/не VIN/g, ''), /VIN/, 'VIN is mentioned only to say track ids are not VINs');
  assert.doesNotMatch(readFileSync(new URL('../public/app/80-video-analytics.js', import.meta.url), 'utf8'), /\bapi\(|method:\s*'POST'|requestId/, 'the video screen never changes the simulation');
});

test('the validity window is checked: no zone membership or visit outside it, truncation is consistent', () => {
  const zoneAfter = fixture(); zoneAfter.frames.push({ t: 22.6, objects: [{ trackId: 'car-1', className: 'car', confidence: 0.9, bbox: [0.1, 0.7, 0.1, 0.2], zoneId: 'zone-1' }] });
  assert.ok(validateResults(zoneAfter).errors.some(e => e.startsWith(`frames[${zoneAfter.frames.length - 1}].objects[0].zoneId`)));
  const nullZoneAfter = fixture(); nullZoneAfter.frames.push({ t: 22.6, objects: [{ trackId: 'car-1', className: 'car', confidence: 0.9, bbox: [0.1, 0.7, 0.1, 0.2], zoneId: null }] });
  assert.deepEqual(validateResults(nullZoneAfter).errors, []);
  const i = fixture().visits.findIndex(v => v.truncated);
  const longer = fixture(); longer.visits[i].observedSec = 23;
  assert.ok(validateResults(longer).errors.some(e => e.startsWith(`visits[${i}].observedSec`)), 'observed time cannot run past the truncation point');
  const ended = fixture(); ended.visits[i].endSec = 21.8;
  assert.ok(validateResults(ended).errors.some(e => e.startsWith(`visits[${i}].endSec`)));
  const noAt = fixture(); noAt.visits[i].truncatedAt = null;
  assert.ok(validateResults(noAt).errors.some(e => e.startsWith(`visits[${i}].truncatedAt`)));
  const lateStart = fixture(); lateStart.visits[0].startSec = 22.5; lateStart.visits[0].observedSec = 0.5; lateStart.visits[0].truncated = false; lateStart.visits[0].truncatedAt = null;
  assert.ok(validateResults(lateStart).errors.some(e => e.startsWith('visits[0].startSec')));
  const badWin = fixture(); badWin.analysis.validInterval.untilSec = 30;
  assert.ok(validateResults(badWin).errors.some(e => e.startsWith('analysis.validInterval.untilSec')));
  const noWin = fixture(); delete noWin.analysis.validInterval;
  assert.equal(validWindow(load(noWin)), null, 'without a window the whole recording is measured');
});

test('the synthetic record follows the contract and is labelled as synthetic, not as computer vision', () => {
  const r = validateResults(synthetic());
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.analysis.mode, 'synthetic');
  assert.equal(dataLabel(r.data), 'Синтетические данные');
  assert.equal(dataLabel({ source: { synthetic: false } }), 'Внешняя запись. Не производство Allur');
  assert.equal(validWindow(r.data), null);
});

test('invalid JSON and out-of-range coordinates are rejected with a path to the problem', () => {
  assert.match(parseResults('{"schemaVersion": 1,').errors[0], /Неверный JSON/);
  assert.match(parseResults('[]').errors[0], /JSON-объект/);
  assert.deepEqual(parseResults('﻿' + fixtureText).errors, [], 'a BOM at the start is accepted');
  const raw = synthetic();
  raw.frames[10].objects[0].bbox = [0.9, 0.1, 0.2, 0.1];      // sticks out of the frame
  raw.zones[0].polygon[1] = [1.4, 0.3];                          // outside 0..1
  raw.frames[11].objects[0].zoneId = 'nope';
  raw.visits[0].status = 'done';
  const { data, errors } = validateResults(raw);
  assert.equal(data, null);
  for (const p of ['frames[10].objects[0].bbox', 'zones[0].polygon[1]', 'frames[11].objects[0].zoneId', 'visits[0].status']) assert.ok(errors.some(e => e.startsWith(p)), `${p} in ${errors.join(' | ')}`);
  const wrongVersion = { ...synthetic(), schemaVersion: 2 };
  assert.ok(validateResults(wrongVersion).errors.some(e => e.startsWith('schemaVersion')));
  const completedWithoutEnd = synthetic(); completedWithoutEnd.visits[0].endSec = null;
  assert.ok(validateResults(completedWithoutEnd).errors.some(e => e.startsWith('visits[0].endSec')));
  const longer = synthetic(); longer.visits[1].observedSec = 999;
  assert.ok(validateResults(longer).errors.some(e => e.startsWith('visits[1].observedSec')));
});

test('an empty results record is accepted, shows nothing invented and warns', () => {
  const raw = { ...synthetic(), frames: [], visits: [] };
  const r = validateResults(raw);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some(w => /нет ни одного кадра/.test(w)) && r.warnings.some(w => /нет посещений/.test(w)));
  const rows = visitRows(r.data);
  assert.deepEqual(rows, []); assert.deepEqual(delays(rows), []);
  assert.deepEqual(summarize(rows), { visits: 0, finished: 0, unfinished: 0, exceeded: 0, maxExceedSec: 0 });
  const st = stateAt(r.data, 10);
  assert.equal(st.frame, null); assert.equal(st.stale, true); assert.deepEqual(st.objects, []);
  assert.ok(Object.values(st.counts).every(n => n === null), 'no count is shown without observations');
  assert.ok(occupancySeries(r.data).every(s => s.points.length === 0));
});

test('exceedance is max(0, observed − threshold); lost and open visits are lower bounds and never finished', () => {
  const rows = visitRows(load(synthetic()));
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(by.V1.exceedSec, 31.5 - 20); assert.equal(by.V1.exceeded, true); assert.equal(by.V1.finished, true); assert.equal(by.V1.lowerBound, false);
  assert.equal(by.V2.exceedSec, 0); assert.equal(by.V2.exceeded, false);
  assert.equal(by.V3.status, 'lost'); assert.equal(by.V3.finished, false); assert.equal(by.V3.lowerBound, true); assert.equal(by.V3.endSec, null); assert.equal(by.V3.exceedSec, 2);
  assert.equal(by.V4.status, 'open_at_end'); assert.equal(by.V4.finished, false); assert.equal(by.V4.exceedSec, 0); assert.equal(by.V4.truncated, false);
  for (const r of rows) assert.equal(r.exceedSec, Math.max(0, r.observedSec - r.thresholdSec));
  const dl = delays(rows);
  assert.deepEqual(dl.map(r => r.id), ['V1', 'V3'], 'largest first, only visits above the threshold');
  assert.match(dl[1].text, /не меньше/); assert.match(dl[1].caveat, /не подтверждено/);
  assert.match(dl[0].caveat, /не подтверждённое время операции/);
  assert.ok(dl.every(r => r.conclusion === OVER_THRESHOLD_CONCLUSION));
  assert.deepEqual(summarize(rows), { visits: 4, finished: 2, unfinished: 2, exceeded: 2, maxExceedSec: 11.5 });
});

test('the picture depends only on the video time: seeking back gives the same state as a fresh start', () => {
  const data = load(synthetic());
  const fresh = JSON.stringify(stateAt(data, 12));
  for (const t of [50, 30, 59.9, 0, 41.2]) stateAt(data, t);
  assert.equal(JSON.stringify(stateAt(data, 12)), fresh);
  const st = stateAt(data, 12.2);
  assert.equal(st.frame.t, 12); assert.equal(st.stale, false);
  assert.deepEqual(st.objects.map(o => o.trackId).sort(), ['S1', 'S2']);
  assert.deepEqual(visitsAt(visitRows(data), 30).map(r => r.id), ['V1', 'V3']);
});

test('a lost object disappears without ending its visit; gaps and the end of the video mark observations as stale', () => {
  const data = load(synthetic());
  assert.ok(stateAt(data, 41).objects.some(o => o.trackId === 'S3'));
  assert.ok(!stateAt(data, 41.5).objects.some(o => o.trackId === 'S3'), 'S3 is no longer observed');
  assert.equal(visitRows(data).find(r => r.trackId === 'S3').status, 'lost');
  // gap in the observations: drop frames between 20 s and 26 s
  const raw = synthetic(); raw.frames = raw.frames.filter(f => f.t <= 20 || f.t >= 26);
  const gap = load(raw), st = stateAt(gap, 23);
  assert.equal(st.frame.t, 20); assert.ok(st.ageSec > staleAfter(gap)); assert.equal(st.stale, true);
  assert.ok(Object.values(st.counts).every(n => n === null), 'zone counts are not carried over a gap');
  const series = occupancySeries(gap)[0].points;
  assert.ok(series.some(p => p.n === null && p.t > 20 && p.t < 26), 'the chart breaks at the gap');
  // past the last analysed frame
  const end = synthetic(); end.frames = end.frames.filter(f => f.t <= 50);
  assert.equal(stateAt(load(end), 55).stale, true);
  assert.equal(stateAt(load(synthetic()), 60).stale, false);
});

test('CSV: quoted text cells, formula-like text neutralised, numbers with decimal comma, BOM for Excel', () => {
  assert.equal(csvText('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  for (const bad of ['+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) assert.ok(csvText(bad).startsWith(`"'`), bad);
  assert.equal(csvText('Зона "А"; ряд 1'), '"Зона ""А""; ряд 1"');
  const raw = synthetic();
  raw.source.title = '=cmd|"/c calc"!A1'; raw.zones[0].name = '@Зона; "ожидания"';
  const data = load(raw), csv = visitsCsv(data, visitRows(data));
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 1 + 4);
  assert.ok(lines[1].startsWith(`"'=cmd|""/c calc""!A1";`));
  assert.ok(lines.some(l => l.includes(`"'@Зона; ""ожидания"""`)));
  const v1 = lines.find(l => l.includes('"V1"'));
  assert.ok(v1.includes(';31,5;20;'), v1);
  assert.ok(v1.includes(`;11,5;"нет";"Покинул зону";;"${OVER_THRESHOLD_CONCLUSION}"`), v1);
  const v3 = lines.find(l => l.includes('"V3"'));
  assert.ok(v3.includes(';29;;12;'), 'empty end for an unfinished visit: ' + v3);
  const real = load(fixture()), realCsv = visitsCsv(real, visitRows(real));
  assert.ok(realCsv.includes('"Внешняя запись. Не производство Allur"'));
  assert.ok(realCsv.split('\r\n').some(l => l.includes(';21,8;') && l.includes('Измерение остановлено на 21,8 с')), 'truncation is exported');
});

test('only http(s) source links are rendered as links', () => {
  assert.equal(safeUrl('https://example.org/video'), 'https://example.org/video');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('not a url'), null);
});

test('the server serves the analytics module and fixture and lets the page play local (blob:) video', async () => {
  const app = createApp({ publicDir: fileURLToPath(new URL('../public', import.meta.url)) });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${app.address().port}`;
    const r = await fetch(base + '/video-fixture.json');
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/json/);
    assert.match(r.headers.get('content-security-policy'), /media-src 'self' blob:/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self';/);
    assert.equal((await fetch(base + '/video-analytics.js')).status, 200);
  } finally { app.close(); }
});
