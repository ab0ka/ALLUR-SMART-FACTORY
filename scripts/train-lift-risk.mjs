// Reproducible training of the lift failure-risk model on synthetic shifts (no real Allur data).
// 1. Generate whole shifts with the same engine and lift model as the demo (generator lift-degradation-v1).
// 2. Split by whole shifts: train / validation / test — windows of one shift never land in two parts.
// 3. Baseline: one feature with a threshold, chosen on train. Model: logistic regression on standardized features.
// 4. The model threshold and the working variant (model or baseline) are chosen on validation; test is used once.
// 5. Artifact models/lift-risk-v1.json (read by server/risk-model.mjs) and report reports/lift-risk-v1.md.
// Usage: npm.cmd run train            (node scripts/train-lift-risk.mjs [--shifts 300] [--seed 7001])
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workshop, LIFTS, SHIFT } from '../server/simulation.mjs';
import { features, featureVector, FEATURES, FEATURE_WINDOW, SAMPLE_EVERY, LIFT_MODEL_VERSION, hashUniform } from '../server/equipment.mjs';

export const HORIZON = 30;
const MODEL_VERSION = 'lift-risk-v1';
const DEMO_SEED = 42; // the demo shift is never used for training or evaluation
const BASELINE_FEATURES = ['temperature_mean', 'cycle_mean', 'temperature_slope', 'cycle_slope'];

// One synthetic shift: with probability 0.65 one lift degrades (leak or wear) from a random onset; a share of
// episodes reaches failure inside the shift, others only drift. Everything is derived from the shift seed.
export function shiftEpisode(seed) {
  const u = k => hashUniform('train', seed, k);
  if (u('has') > .65) return null;
  return { postId: LIFTS[Math.floor(u('lift') * LIFTS.length)].postId, cause: u('cause') < .5 ? 'leak' : 'wear', onset: Math.round(20 + u('onset') * 340), duration: Math.round(90 + u('duration') * 240) };
}
// Windows every 5 minutes for every lift while it works; label = failure within the next HORIZON minutes.
export function shiftSamples(seed) {
  const w = new Workshop({ seed, warmup: 0, plan: false, episode: shiftEpisode(seed) || false });
  const failedAt = {}, snaps = {};
  for (const l of LIFTS) snaps[l.id] = [];
  while (w.minute < SHIFT) {
    w.tick();
    for (const l of LIFTS) {
      const eq = w.equipment[l.id];
      if (eq.failed && failedAt[l.id] === undefined) failedAt[l.id] = eq.failedAt;
      if (w.minute % SAMPLE_EVERY || eq.failed) continue;
      const f = features(eq.readings, w.minute); // only readings with minute ≤ now
      if (f) snaps[l.id].push({ minute: w.minute, x: featureVector(f), f });
    }
  }
  const out = [];
  for (const l of LIFTS) for (const s of snaps[l.id]) {
    const fa = failedAt[l.id];
    out.push({ shift: seed, lift: l.id, minute: s.minute, x: s.x, f: s.f, y: fa !== undefined && fa > s.minute && fa <= s.minute + HORIZON ? 1 : 0 });
  }
  return { samples: out, failures: Object.entries(failedAt).map(([lift, minute]) => ({ shift: seed, lift, minute })) };
}
export function generate({ shifts = 300, seed = 7001 } = {}) {
  const seeds = Array.from({ length: shifts }, (_, i) => seed + i).filter(s => s !== DEMO_SEED);
  const n = seeds.length, cut1 = Math.round(n * .6), cut2 = Math.round(n * .8);
  const parts = { train: seeds.slice(0, cut1), validation: seeds.slice(cut1, cut2), test: seeds.slice(cut2) };
  const data = {};
  for (const [k, list] of Object.entries(parts)) {
    const all = list.map(shiftSamples);
    data[k] = { shifts: list, samples: all.flatMap(r => r.samples), failures: all.flatMap(r => r.failures) };
  }
  return data;
}

// ---------- Model ----------
const sigmoid = z => 1 / (1 + Math.exp(-z));
export function fitLogistic(samples, { epochs = 400, lr = .5, l2 = 1e-3 } = {}) {
  const k = FEATURES.length, n = samples.length;
  const mean = Array.from({ length: k }, (_, j) => samples.reduce((a, s) => a + s.x[j], 0) / n);
  const std = Array.from({ length: k }, (_, j) => Math.sqrt(samples.reduce((a, s) => a + (s.x[j] - mean[j]) ** 2, 0) / n) || 1);
  const X = samples.map(s => s.x.map((v, j) => (v - mean[j]) / std[j])), y = samples.map(s => s.y);
  const pos = y.filter(Boolean).length, wPos = pos ? (n - pos) / pos : 1; // class balance: failures are rare
  let w = new Array(k).fill(0), b = 0;
  for (let e = 0; e < epochs; e++) {
    const g = new Array(k).fill(0); let gb = 0, ws = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(b + X[i].reduce((a, v, j) => a + v * w[j], 0)), cw = y[i] ? wPos : 1, d = (p - y[i]) * cw;
      for (let j = 0; j < k; j++) g[j] += d * X[i][j];
      gb += d; ws += cw;
    }
    w = w.map((v, j) => v - lr * (g[j] / ws + l2 * v)); b -= lr * gb / ws;
  }
  // Class weighting shifts probabilities up; recalibrate the intercept on train to the observed failure share.
  const target = pos / n;
  let lo = -20, hi = 20;
  for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2, avg = X.reduce((a, x) => a + sigmoid(mid + x.reduce((s, v, j) => s + v * w[j], 0)), 0) / n; if (avg > target) hi = mid; else lo = mid; }
  return { weights: w, bias: (lo + hi) / 2, mean, std };
}
export const predict = (m, x) => sigmoid(m.bias + x.reduce((a, v, j) => a + m.weights[j] * (v - m.mean[j]) / m.std[j], 0));

// ---------- Metrics ----------
function averagePrecision(scored) {
  const s = [...scored].sort((a, b) => b.score - a.score), pos = s.filter(r => r.y).length;
  if (!pos) return 0;
  let tp = 0, ap = 0;
  s.forEach((r, i) => { if (r.y) { tp++; ap += tp / (i + 1); } });
  return ap / pos;
}
// How long before each failure the alarm had been on continuously (minutes); failures inside the evaluated shifts.
function leadTimes(part, alarmOf) {
  const lead = [];
  for (const fl of part.failures) {
    const ws = part.samples.filter(s => s.shift === fl.shift && s.lift === fl.lift && s.minute < fl.minute).sort((a, b) => b.minute - a.minute);
    let m = 0; for (const s of ws) { if (!alarmOf(s)) break; m = fl.minute - s.minute; }
    lead.push(m);
  }
  const warned = lead.filter(x => x > 0).sort((a, b) => a - b);
  return { median: warned.length ? warned[Math.floor((warned.length - 1) / 2)] : null, warned: warned.length, failures: lead.length };
}
export function evaluate(part, scoreOf, alarmOf, probabilistic) {
  let tp = 0, fp = 0, fn = 0;
  for (const s of part.samples) { const a = alarmOf(s); if (a && s.y) tp++; else if (a) fp++; else if (s.y) fn++; }
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    precision: r4(precision), recall: r4(recall), f1: r4(precision + recall ? 2 * precision * recall / (precision + recall) : 0),
    prAuc: r4(averagePrecision(part.samples.map(s => ({ score: scoreOf(s), y: s.y })))), falseAlarmsPerShift: r4(fp / part.shifts.length),
    leadTime: leadTimes(part, alarmOf), brier: probabilistic ? r4(part.samples.reduce((a, s) => a + (scoreOf(s) - s.y) ** 2, 0) / part.samples.length) : null,
  };
}
const r4 = x => Math.round(x * 1e4) / 1e4;
function bestThreshold(samples, scoreOf) {
  const values = [...new Set(samples.map(scoreOf).map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(values.length / 400));
  let best = { f1: -1, threshold: values.at(-1) };
  for (let i = 0; i < values.length; i += step) {
    const t = values[i]; let tp = 0, fp = 0, fn = 0;
    for (const s of samples) { const a = scoreOf(s) >= t; if (a && s.y) tp++; else if (a) fp++; else if (s.y) fn++; }
    const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0, f1 = p + r ? 2 * p * r / (p + r) : 0;
    if (f1 > best.f1) best = { f1, threshold: t };
  }
  return best;
}

export function train(opts = {}) {
  const { shifts = 300, seed = 7001 } = opts;
  const data = generate({ shifts, seed });
  // Baseline: the single feature and threshold with the best F1 on train.
  const baseline = BASELINE_FEATURES.map(feature => ({ feature, ...bestThreshold(data.train.samples, s => s.f[feature]) })).sort((a, b) => b.f1 - a.f1)[0];
  const m = fitLogistic(data.train.samples, opts);
  const score = s => predict(m, s.x);
  const { threshold } = bestThreshold(data.validation.samples, score); // tuned on validation, never on test
  const bScore = s => s.f[baseline.feature], bAlarm = s => s.f[baseline.feature] >= baseline.threshold, mAlarm = s => score(s) >= threshold;
  const metrics = {
    validation: { model: evaluate(data.validation, score, mAlarm, true), baseline: evaluate(data.validation, bScore, bAlarm, false) },
    test: { model: evaluate(data.test, score, mAlarm, true), baseline: evaluate(data.test, bScore, bAlarm, false) },
  };
  const selected = metrics.validation.model.f1 > metrics.validation.baseline.f1 ? 'model' : 'baseline';
  const calibration = Array.from({ length: 5 }, (_, i) => {
    const from = i / 5, to = (i + 1) / 5, inBin = data.test.samples.filter(s => { const p = score(s); return p >= from && (i === 4 ? p <= to : p < to); });
    return { from, to, count: inBin.length, meanPredicted: inBin.length ? r4(inBin.reduce((a, s) => a + score(s), 0) / inBin.length) : 0, observedRate: inBin.length ? r4(inBin.filter(s => s.y).length / inBin.length) : 0 };
  });
  const all = [...data.train.samples, ...data.validation.samples, ...data.test.samples];
  return {
    format: 'allur-lift-risk', modelVersion: MODEL_VERSION, generatorVersion: LIFT_MODEL_VERSION, trainingSeed: seed,
    task: `Вероятность отказа гидроподъёмника в ближайшие ${HORIZON} мин по измерениям за последние ${FEATURE_WINDOW} мин`,
    modelType: 'логистическая регрессия, стандартизованные признаки, L2, веса классов, сдвиг свободного члена под долю отказов',
    horizon: HORIZON, featureWindow: FEATURE_WINDOW, features: FEATURES,
    weights: m.weights.map(r4), bias: r4(m.bias), mean: m.mean.map(r4), std: m.std.map(r4), threshold: r4(threshold),
    baseline: { feature: baseline.feature, threshold: r4(baseline.threshold) }, selected,
    selectionReason: `на сменах настройки F1 модели ${metrics.validation.model.f1.toFixed(3)} против ${metrics.validation.baseline.f1.toFixed(3)} у правила; тестовые смены в выборе не участвовали`,
    data: {
      shifts: { total: data.train.shifts.length + data.validation.shifts.length + data.test.shifts.length, train: data.train.shifts.length, validation: data.validation.shifts.length, test: data.test.shifts.length },
      shiftSeeds: { train: [data.train.shifts[0], data.train.shifts.at(-1)], validation: [data.validation.shifts[0], data.validation.shifts.at(-1)], test: [data.test.shifts[0], data.test.shifts.at(-1)] },
      samples: { total: all.length, train: data.train.samples.length, validation: data.validation.samples.length, test: data.test.samples.length },
      positiveRate: r4(all.filter(s => s.y).length / all.length),
    },
    metrics, calibration,
    limitations: [
      'Данные полностью синтетические: генератор деградации тот же, что в демо. Хорошее качество здесь не означает пригодность для реального оборудования.',
      'Две причины (утечка и износ насоса) дают похожие сигналы; модель предсказывает отказ, а не причину — причину устанавливает проверка.',
      'Окна одной смены попадают только в одну часть (обучение, настройка или тест); демо-смена (seed 42) в данных не участвует.',
      'Признаки считаются только по измерениям до момента прогноза; после отказа окна не используются.',
    ],
  };
}

function report(m) {
  const row = (name, x) => `| ${name} | ${x.precision} | ${x.recall} | ${x.f1} | ${x.prAuc} | ${x.falseAlarmsPerShift} | ${x.leadTime.median ?? '—'} (${x.leadTime.warned}/${x.leadTime.failures}) | ${x.brier ?? '—'} |`;
  return `# Модель риска отказа подъёмника · ${m.modelVersion}

Синтетические данные учебной симуляции (генератор ${m.generatorVersion}, seed обучения ${m.trainingSeed}). Не для реального оборудования Allur.

- Задача: ${m.task}.
- Смены: ${m.data.shifts.total} — обучение ${m.data.shifts.train} (seed ${m.data.shiftSeeds.train.join('–')}), настройка ${m.data.shifts.validation} (${m.data.shiftSeeds.validation.join('–')}), тест ${m.data.shifts.test} (${m.data.shiftSeeds.test.join('–')}). Разбиение по целым сменам.
- Окон: ${m.data.samples.total}; доля окон с отказом в ближайшие ${m.horizon} мин: ${m.data.positiveRate}.
- Базовое правило: \`${m.baseline.feature} ≥ ${m.baseline.threshold}\` (подобрано на обучении).
- Модель: ${m.modelType}; порог ${m.threshold} (подобран на настройке).
- Рабочий вариант: **${m.selected === 'model' ? 'модель' : 'базовое правило'}** — ${m.selectionReason}.

| Вариант | Precision | Recall | F1 | PR-AUC | Ложных тревог на смену | Предупреждение, мин (успели/отказов) | Brier |
|---|---|---|---|---|---|---|---|
${row('Правило — тест', m.metrics.test.baseline)}
${row('Модель — тест', m.metrics.test.model)}
${row('Правило — настройка', m.metrics.validation.baseline)}
${row('Модель — настройка', m.metrics.validation.model)}

Ограничения:
${m.limitations.map(l => `- ${l}`).join('\n')}

Повторить: \`npm.cmd run train\` (тот же seed даёт тот же артефакт).
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : undefined; };
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const t0 = Date.now();
  const m = train({ shifts: arg('shifts') ?? 300, seed: arg('seed') ?? 7001 });
  mkdirSync(path.join(root, 'models'), { recursive: true }); mkdirSync(path.join(root, 'reports'), { recursive: true });
  writeFileSync(path.join(root, 'models', 'lift-risk-v1.json'), JSON.stringify(m, null, 1));
  writeFileSync(path.join(root, 'reports', 'lift-risk-v1.md'), report(m));
  const t = m.metrics.test;
  console.log(`Обучено за ${((Date.now() - t0) / 1000).toFixed(1)} с: ${m.data.shifts.total} синтетических смен, ${m.data.samples.total} окон.`);
  console.log(`Тест: модель F1 ${t.model.f1}, PR-AUC ${t.model.prAuc}; правило ${m.baseline.feature} F1 ${t.baseline.f1}. Рабочий вариант: ${m.selected}.`);
  console.log('Артефакт: models/lift-risk-v1.json · отчёт: reports/lift-risk-v1.md');
}
