import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseResults, validateResults, visitRows, summarize, delays, stateAt, staleAfter, occupancySeries, visitsCsv, csvText, dataLabel, safeUrl, visitsAt } from '../public/video-analytics.js';
import { createApp } from '../server/index.mjs';

const fixtureText = readFileSync(new URL('../public/video-fixture.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(fixtureText);
const load = raw => { const r = validateResults(raw); assert.deepEqual(r.errors, []); return r.data; };

test('the synthetic fixture follows the contract and is labelled as synthetic, not as computer vision', () => {
  const r = parseResults(fixtureText);
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.analysis.mode, 'synthetic');
  assert.equal(r.data.source.synthetic, true);
  assert.equal(dataLabel(r.data), 'Синтетические данные');
  assert.equal(dataLabel({ source: { synthetic: false } }), 'Не данные Allur');
});

test('invalid JSON and out-of-range coordinates are rejected with a path to the problem', () => {
  assert.match(parseResults('{"schemaVersion": 1,').errors[0], /Неверный JSON/);
  assert.match(parseResults('[]').errors[0], /JSON-объект/);
  assert.deepEqual(parseResults('\uFEFF' + fixtureText).errors, [], 'a BOM at the start is accepted');
  const raw = fixture();
  raw.frames[10].objects[0].bbox = [0.9, 0.1, 0.2, 0.1];      // sticks out of the frame
  raw.zones[0].polygon[1] = [1.4, 0.3];                          // outside 0..1
  raw.frames[11].objects[0].zoneId = 'nope';
  raw.visits[0].status = 'done';
  const { data, errors } = validateResults(raw);
  assert.equal(data, null);
  for (const p of ['frames[10].objects[0].bbox', 'zones[0].polygon[1]', 'frames[11].objects[0].zoneId', 'visits[0].status']) assert.ok(errors.some(e => e.startsWith(p)), `${p} in ${errors.join(' | ')}`);
  const wrongVersion = { ...fixture(), schemaVersion: 2 };
  assert.ok(validateResults(wrongVersion).errors.some(e => e.startsWith('schemaVersion')));
  const completedWithoutEnd = fixture(); completedWithoutEnd.visits[0].endSec = null;
  assert.ok(validateResults(completedWithoutEnd).errors.some(e => e.startsWith('visits[0].endSec')));
  const longer = fixture(); longer.visits[1].observedSec = 999;
  assert.ok(validateResults(longer).errors.some(e => e.startsWith('visits[1].observedSec')));
});

test('an empty results record is accepted, shows nothing invented and warns', () => {
  const raw = { ...fixture(), frames: [], visits: [] };
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
  const rows = visitRows(load(fixture()));
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(by.V1.exceedSec, 31.5 - 20); assert.equal(by.V1.exceeded, true); assert.equal(by.V1.finished, true); assert.equal(by.V1.lowerBound, false);
  assert.equal(by.V2.exceedSec, 0); assert.equal(by.V2.exceeded, false);
  assert.equal(by.V3.status, 'lost'); assert.equal(by.V3.finished, false); assert.equal(by.V3.lowerBound, true); assert.equal(by.V3.endSec, null); assert.equal(by.V3.exceedSec, 2);
  assert.equal(by.V4.status, 'open_at_end'); assert.equal(by.V4.finished, false); assert.equal(by.V4.exceedSec, 0);
  for (const r of rows) assert.equal(r.exceedSec, Math.max(0, r.observedSec - r.thresholdSec));
  const dl = delays(rows);
  assert.deepEqual(dl.map(r => r.id), ['V1', 'V3'], 'largest first, only visits above the threshold');
  assert.match(dl[1].text, /не меньше/); assert.match(dl[1].caveat, /не подтверждено/);
  assert.match(dl[0].caveat, /не подтверждённое время операции/);
  assert.ok(dl.every(r => r.hypotheses.length > 0));
  assert.deepEqual(summarize(rows), { visits: 4, finished: 2, unfinished: 2, exceeded: 2, maxExceedSec: 11.5 });
});

test('the picture depends only on the video time: seeking back gives the same state as a fresh start', () => {
  const data = load(fixture());
  const fresh = JSON.stringify(stateAt(data, 12));
  for (const t of [50, 30, 59.9, 0, 41.2]) stateAt(data, t);
  assert.equal(JSON.stringify(stateAt(data, 12)), fresh);
  const st = stateAt(data, 12.2);
  assert.equal(st.frame.t, 12); assert.equal(st.stale, false);
  assert.deepEqual(st.objects.map(o => o.trackId).sort(), ['S1', 'S2']);
  assert.deepEqual(visitsAt(visitRows(data), 30).map(r => r.id), ['V1', 'V3']);
});

test('a lost object disappears without ending its visit; gaps and the end of the video mark observations as stale', () => {
  const data = load(fixture());
  assert.ok(stateAt(data, 41).objects.some(o => o.trackId === 'S3'));
  assert.ok(!stateAt(data, 41.5).objects.some(o => o.trackId === 'S3'), 'S3 is no longer observed');
  assert.equal(visitRows(data).find(r => r.trackId === 'S3').status, 'lost');
  // gap in the observations: drop frames between 20 s and 26 s
  const raw = fixture(); raw.frames = raw.frames.filter(f => f.t <= 20 || f.t >= 26);
  const gap = load(raw), st = stateAt(gap, 23);
  assert.equal(st.frame.t, 20); assert.ok(st.ageSec > staleAfter(gap)); assert.equal(st.stale, true);
  assert.ok(Object.values(st.counts).every(n => n === null), 'zone counts are not carried over a gap');
  const series = occupancySeries(gap)[0].points;
  assert.ok(series.some(p => p.n === null && p.t > 20 && p.t < 26), 'the chart breaks at the gap');
  // past the last analysed frame
  const end = fixture(); end.frames = end.frames.filter(f => f.t <= 50);
  assert.equal(stateAt(load(end), 55).stale, true);
  assert.equal(stateAt(load(fixture()), 60).stale, false);
});

test('CSV: quoted text cells, formula-like text neutralised, numbers with decimal comma, BOM for Excel', () => {
  assert.equal(csvText('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  for (const bad of ['+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) assert.ok(csvText(bad).startsWith(`"'`), bad);
  assert.equal(csvText('Зона "А"; ряд 1'), '"Зона ""А""; ряд 1"');
  const raw = fixture();
  raw.source.title = '=cmd|"/c calc"!A1'; raw.zones[0].name = '@Зона; "ожидания"';
  const data = load(raw), csv = visitsCsv(data, visitRows(data));
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 1 + 4);
  assert.ok(lines[1].startsWith(`"'=cmd|""/c calc""!A1";`));
  assert.ok(lines.some(l => l.includes(`"'@Зона; ""ожидания"""`)));
  const v1 = lines.find(l => l.includes('"V1"'));
  assert.ok(v1.includes(';31,5;20;'), v1);
  assert.ok(v1.includes(';11,5;"нет";"Покинул зону"'), v1);
  const v3 = lines.find(l => l.includes('"V3"'));
  assert.ok(v3.includes(';29;;12;'), 'empty end for an unfinished visit: ' + v3);
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
