// Compare manual zone visits (reference.csv) with the system's visits. No dependencies.
// CSV columns: object,zone,start,end[,note]; time in seconds (12.3) or mm:ss(.s).
// Usage: node presentation/tools/compare.mjs reference.csv system.csv [--iou 0.3]
import { readFileSync } from 'node:fs';

const t = s => { s = String(s).trim(); if (s.includes(':')) { const p = s.split(':').map(Number); return p.reduce((a, x) => a * 60 + x, 0); } return Number(s); };
// analysis.json (schemaVersion 1): open or lost visits end at the last observed moment (startSec + observedSec).
function readAnalysis(file) {
  const a = JSON.parse(readFileSync(file, 'utf8'));
  return a.visits.map(v => ({ object: v.trackId, zone: v.zoneId, start: v.startSec, end: v.endSec ?? v.startSec + v.observedSec, note: v.status }));
}
function read(file) {
  if (file.endsWith('.json')) return readAnalysis(file);
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const head = lines.shift().split(',').map(h => h.trim().toLowerCase());
  const col = k => { const i = head.indexOf(k); if (i < 0) throw new Error(`${file}: нет колонки ${k}`); return i; };
  return lines.map(l => { const c = l.split(','); return { object: c[col('object')]?.trim(), zone: c[col('zone')]?.trim(), start: t(c[col('start')]), end: t(c[col('end')]), note: head.includes('note') ? c.slice(col('note')).join(',').trim() : '' }; })
    .filter(v => Number.isFinite(v.start) && Number.isFinite(v.end) && v.end >= v.start);
}
const iou = (a, b) => { const i = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)), u = Math.max(a.end, b.end) - Math.min(a.start, b.start); return u > 0 ? i / u : 0; };
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = x => x === null ? 'не измерено' : Math.round(x * 10) / 10;

export function compare(ref, sys, minIou = 0.3) {
  // Greedy one-to-one matching inside each zone by the best interval overlap.
  const pairs = [], usedR = new Set(), usedS = new Set();
  const cand = [];
  ref.forEach((r, i) => sys.forEach((s, j) => { if (r.zone === s.zone) { const o = iou(r, s); if (o >= minIou) cand.push([o, i, j]); } }));
  cand.sort((a, b) => b[0] - a[0]);
  for (const [o, i, j] of cand) if (!usedR.has(i) && !usedS.has(j)) { usedR.add(i); usedS.add(j); pairs.push({ ref: ref[i], sys: sys[j], iou: o }); }
  const dur = pairs.map(p => Math.abs((p.sys.end - p.sys.start) - (p.ref.end - p.ref.start)));
  return {
    sample: { visits: ref.length, holdout: ref.filter(r => /holdout/i.test(r.note)).length, seconds: ref.length ? Math.max(...ref.map(r => r.end)) - Math.min(...ref.map(r => r.start)) : 0 },
    found: sys.length, matched: pairs.length, missed: ref.filter((_, i) => !usedR.has(i)), extra: sys.filter((_, j) => !usedS.has(j)),
    durationError: { median: median(dur), max: dur.length ? Math.max(...dur) : null },
    startError: { median: median(pairs.map(p => Math.abs(p.sys.start - p.ref.start))) }, endError: { median: median(pairs.map(p => Math.abs(p.sys.end - p.ref.end))) },
    pairs,
  };
}

if (process.argv[1]?.endsWith('compare.mjs')) {
  const [refFile, sysFile] = process.argv.slice(2), k = process.argv.indexOf('--iou'), wi = process.argv.indexOf('--window');
  // Optional evaluation window [from,to] in seconds: visits are clipped to it, visits outside are dropped.
  const win = wi > 0 ? process.argv[wi + 1].split(',').map(Number) : null;
  const clip = list => !win ? list : list.map(v => ({ ...v, start: Math.max(v.start, win[0]), end: Math.min(v.end, win[1]) })).filter(v => v.end > v.start);
  if (!refFile || !sysFile) { console.log('node presentation/tools/compare.mjs reference.csv system.csv [--iou 0.3]'); process.exit(1); }
  const r = compare(clip(read(refFile)), clip(read(sysFile)), k > 0 ? Number(process.argv[k + 1]) : 0.3);
  if (win) console.log(`Окно проверки: ${win[0]}–${win[1]} с.`);
  for (const p of r.pairs) console.log(`  пара: ${p.ref.object} ↔ ${p.sys.object} · ручное ${p.ref.start}–${p.ref.end} · система ${Math.round(p.sys.start * 100) / 100}–${Math.round(p.sys.end * 100) / 100} · ошибка длительности ${Math.round(Math.abs((p.sys.end - p.sys.start) - (p.ref.end - p.ref.start)) * 100) / 100} с`);
  console.log(`Выборка: ${r.sample.visits} ручных посещений (из них отложенный фрагмент: ${r.sample.holdout}), охват ≈ ${r1(r.sample.seconds)} с видео.`);
  console.log(`Система: ${r.found} посещений; совпало ${r.matched}; пропущено ${r.missed.length}; лишних ${r.extra.length}.`);
  console.log(`Ошибка длительности, с: медиана ${r1(r.durationError.median)}, максимум ${r1(r.durationError.max)}; ошибка начала (медиана) ${r1(r.startError.median)}, конца ${r1(r.endError.median)}.`);
  for (const m of r.missed) console.log(`  пропущено: ${m.object} ${m.zone} ${m.start}–${m.end} ${m.note}`);
  for (const e of r.extra) console.log(`  лишнее: ${e.object} ${e.zone} ${e.start}–${e.end}`);
  console.log('Это результат на указанной выборке, а не общая точность системы.');
}
