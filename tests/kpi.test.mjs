import test from 'node:test';
import assert from 'node:assert/strict';
import { Workshop, MODELS } from '../server/simulation.mjs';
import { stageKpis, CASE_TARGETS } from '../server/kpi.mjs';
import { fullState } from '../server/index.mjs';

test('model names follow the organiser test data', () => {
  assert.deepEqual(Object.values(MODELS).map(m => m.name), ['Chevrolet Onix', 'Chevrolet Cobalt', 'JAC J7']);
  assert.ok(new Workshop().snapshot().vehicles.every(v => ['Chevrolet Onix', 'Chevrolet Cobalt', 'JAC J7'].includes(v.modelName)));
});
test('stage KPIs: shares within 0..1, defects attributed to the stage that made them, case targets attached', () => {
  const w = new Workshop(); for (let i = 0; i < 4; i++) w.advance(60);
  const k = stageKpis(w);
  assert.equal(k.targets.oee, .85); assert.equal(k.targets.defectRate, .02); assert.equal(k.targets.criticalDowntimePerDay, 60);
  for (const s of k.stages) {
    for (const x of [s.load, s.oee]) assert.ok(x >= 0 && x <= 1, `${s.id}: ${x}`);
    if (s.defectRate !== null) { assert.ok(s.defectRate >= 0 && s.defectRate <= 1); assert.ok(s.defects <= s.completed); }
  }
  const fails = w.inspections.filter(i => i.result === 'fail').length;
  assert.equal(k.stages.reduce((a, s) => a + (s.defects ?? 0), 0), fails, 'every failed inspection belongs to one stage');
  assert.equal(k.stages.find(s => s.id === 'quality').defectRate, null, 'control does not make defects');
  assert.equal(k.criticalDowntime.perShiftBudget, CASE_TARGETS.criticalDowntimePerDay / CASE_TARGETS.shiftsPerDay);
});
test('the snapshot for every screen carries the KPIs', () => {
  const s = fullState(new Workshop());
  assert.ok(s.kpi && s.kpi.stages.length === 5);
});
