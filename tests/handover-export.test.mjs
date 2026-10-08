import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, handoverCsv, formatHandover } from '../server/handover-export.mjs';
const fixture = () => ({ schemaVersion: 1, synthetic: true, revision: 0, elapsed: 0, shift: 'Смена', shiftStart: 480, finished: false,
  metrics: { planTarget: 16, referenceTotal: null, forecast: 0, forecastLow: 0, forecastHigh: 1, accepted: 0, shipped: 0, wip: 4, firstPassYield: 0 },
  counts: { problems: 1, jobs: 0, tasks: 0, orders: 0 },
  problems: [{ id: 'PR-1', title: '=HYPERLINK("bad")', postId: 'A1', vehicleIds: ['DEMO-1'], status: 'open', detectedAt: 0 }],
  jobs: [], tasks: [], orders: [], resources: { technicians: [], stock: [], heldPosts: [] },
  events: [{ id: 'EV-1', minute: 0, text: 'Текст, "кавычки"\r\nНовая строка', kind: 'event' }],
});
// Independent CSV reader checks actual cell boundaries, including embedded CR/LF.
function parseCsv(csv) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') { if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\r' && csv[i + 1] === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  assert.equal(quoted, false); return rows;
}
test('CSV quotes multiline Unicode cells and keeps a rectangular typed-section table', () => {
  const report = fixture(), before = structuredClone(report), rows = parseCsv(handoverCsv(report));
  assert.ok(rows.every(row => row.length === 4));
  assert.deepEqual(rows[0], ['section', 'row', 'field', 'value']);
  assert.equal(rows.find(row => row[0] === 'events' && row[2] === 'text')[3], report.events[0].text);
  assert.equal(rows.find(row => row[0] === 'metrics' && row[2] === 'forecast')[3], '0');
  assert.equal(rows.find(row => row[0] === 'metrics' && row[2] === 'referenceTotal')[3], '');
  assert.deepEqual(rows.find(row => row[0] === 'jobs'), ['jobs', '', '', '']);
  assert.deepEqual(report, before); assert.equal(handoverCsv(report), handoverCsv(report));
});
test('CSV neutralizes formula and whitespace prefixes in text, never in numeric cells', () => {
  for (const value of ['=1+1', '+1', '-1', '@SUM(1)', '\t=1', '\r=1', '\n=1', ' =1', '\u0000=1', '\u00a0=1', '\u007f=1']) {
    assert.equal(parseCsv(csvCell(value) + '\r\n')[0][0], "'" + value);
  }
  assert.equal(csvCell(-12.5), '-12.5'); assert.equal(csvCell(0), '0');
  assert.equal(csvCell(false), 'false'); assert.equal(csvCell(null), '');
  assert.equal(csvCell('safe'), '"safe"');
});
test('JSON is the report verbatim and download headers use fixed filenames', () => {
  const report = fixture();
  for (const format of [null, 'json']) {
    const result = formatHandover(report, format);
    assert.deepEqual(JSON.parse(result.body), report);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(result.headers['Content-Disposition'], format === null ? undefined : 'attachment; filename="allur-handover.json"');
  }
  const csv = formatHandover(report, 'csv');
  assert.equal(csv.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(csv.headers['Content-Disposition'], 'attachment; filename="allur-handover.csv"');
  for (const format of ['', 'xml', 'CSV', '../file', 'json\r\nInjected: yes']) assert.throws(() => formatHandover(report, format), { status: 400, expose: true });
});
