// Checks a video analysis results file against the «Видеоанализ» contract (schemaVersion 1) with the same code the
// screen uses. Usage: node scripts/check-video-results.mjs path/to/results.json  — exit code 1 when the file is rejected.
import { readFile } from 'node:fs/promises';
import { parseResults, visitRows, summarize, sourceLabel, validWindow, MODES } from '../public/video-analytics.js';

const file = process.argv[2];
if (!file) { console.error('Укажите путь к JSON: node scripts/check-video-results.mjs results.json'); process.exit(2); }
const { data, errors, warnings } = parseResults(await readFile(file, 'utf8'));
for (const w of warnings) console.log(`Предупреждение: ${w}`);
if (!data) { console.error(`Файл не принят (${errors.length}):`); for (const e of errors) console.error(`  ${e}`); process.exit(1); }
const rows = visitRows(data), s = summarize(rows), win = validWindow(data);
console.log(`Принят: ${data.source.title} · ${sourceLabel(data)} · ${MODES[data.analysis.mode]}`);
if (win) console.log(`${win.label} (${win.reason}); обрезано посещений: ${rows.filter(r => r.truncated).length}`);
console.log(`Зон: ${data.zones.length}, кадров: ${data.frames.length}, посещений: ${s.visits} (завершено ${s.finished}, незавершено ${s.unfinished}, с превышением ${s.exceeded})`);
