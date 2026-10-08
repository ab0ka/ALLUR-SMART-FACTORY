// Server inference for the lift failure-risk model trained by scripts/train-lift-risk.mjs on synthetic shifts.
// If the artifact is missing or incompatible, risk is reported as unavailable — never replaced by a fixed percentage.
import { readFileSync, existsSync } from 'node:fs';
import { features, FEATURES, LIFT_MODEL_VERSION } from './equipment.mjs';
import { LIFTS } from './simulation.mjs';

const sigmoid = z => 1 / (1 + Math.exp(-z));
export function loadRiskModel(file) {
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    const ok = m.format === 'allur-lift-risk' && m.generatorVersion === LIFT_MODEL_VERSION && Array.isArray(m.features) && m.features.join() === FEATURES.join()
      && m.weights?.length === FEATURES.length && m.mean?.length === FEATURES.length && m.std?.length === FEATURES.length && Number.isFinite(m.bias) && Number.isFinite(m.threshold) && m.baseline?.feature && Number.isFinite(m.baseline.threshold);
    return ok ? m : null;
  } catch { return null; }
}
export function predictProbability(model, f) {
  const z = model.bias + FEATURES.reduce((a, k, i) => a + model.weights[i] * ((f[k] - model.mean[i]) / model.std[i]), 0);
  return sigmoid(z);
}
export const baselineAlarm = (model, f) => f[model.baseline.feature] >= model.baseline.threshold;
// Risk for every lift from readings available now. The working variant is whatever was better on held-out shifts.
export function assessRisk(sim, model) {
  if (!model) return { available: false, reason: 'Модель риска не обучена: выполните npm.cmd run train', items: [] };
  const items = LIFTS.map(l => {
    const eq = sim.equipment[l.id];
    if (eq.failed) return { equipmentId: l.id, postId: l.postId, failed: true, text: 'Подъёмник в отказе — прогноз отказа не применяется' };
    const f = features(eq.readings, sim.minute);
    if (!f) return { equipmentId: l.id, postId: l.postId, probability: null, text: 'Недостаточно измерений (нужно 4 замера за 30 мин)' };
    const probability = predictProbability(model, f), base = baselineAlarm(model, f);
    const alarm = model.selected === 'model' ? probability >= model.threshold : base;
    return { equipmentId: l.id, postId: l.postId, probability: Math.round(probability * 1000) / 1000, modelAlarm: probability >= model.threshold, baselineAlarm: base, alarm };
  });
  return { available: true, modelVersion: model.modelVersion, selected: model.selected, horizon: model.horizon, threshold: model.threshold, baseline: model.baseline, items };
}
export function labSummary(model) {
  if (!model) return { available: false, reason: 'Модель не обучена. Выполните npm.cmd run train — скрипт сгенерирует синтетические смены, обучит модель и сохранит models/lift-risk-v1.json.' };
  const { weights, mean, std, ...meta } = model;
  return { available: true, ...meta, coefficients: FEATURES.map((k, i) => ({ feature: k, weight: Math.round(weights[i] * 1000) / 1000, mean: Math.round(mean[i] * 1000) / 1000, std: Math.round(std[i] * 1000) / 1000 })) };
}
export function loadPolicyReport(file) {
  if (!existsSync(file)) return null;
  try { const r = JSON.parse(readFileSync(file, 'utf8')); return r.format === 'allur-policy-comparison' ? r : null; } catch { return null; }
}
