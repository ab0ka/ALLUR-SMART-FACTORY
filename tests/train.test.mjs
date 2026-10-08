import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generate, train, shiftSamples } from '../scripts/train-lift-risk.mjs';
import { features } from '../server/equipment.mjs';
import { loadRiskModel, assessRisk, labSummary } from '../server/risk-model.mjs';
import { Workshop } from '../server/simulation.mjs';

test('training data is split by whole shifts and never contains the demo shift', () => {
  const d = generate({ shifts: 20, seed: 30 });
  const sets = ['train', 'validation', 'test'].map(k => new Set(d[k].samples.map(s => s.shift)));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.equal([...sets[i]].filter(x => sets[j].has(x)).length, 0, 'a shift in two parts');
  for (const k of ['train', 'validation', 'test']) assert.ok(!d[k].shifts.includes(42), 'demo seed 42 excluded');
  assert.ok(d.train.samples.length > d.test.samples.length);
});
test('features use only readings up to the prediction minute (no look-ahead)', () => {
  const { samples } = shiftSamples(7003);
  const w = new Workshop({ seed: 7003, warmup: 0, plan: false, episode: false });
  while (w.minute < 240) w.tick();
  const r = w.equipment['LIFT-A1'].readings, t = 200;
  const before = features(r.filter(x => x.minute <= t), t), withFuture = features(r, t);
  assert.deepEqual(withFuture, before);
  assert.ok(samples.every(s => s.y === 0 || s.y === 1));
});
test('training is reproducible and the artifact is accepted by the server', () => {
  const a = train({ shifts: 40, seed: 900, epochs: 120 }), b = train({ shifts: 40, seed: 900, epochs: 120 });
  assert.deepEqual(a.weights, b.weights); assert.equal(a.threshold, b.threshold);
  assert.ok(['model', 'baseline'].includes(a.selected));
  for (const part of ['validation', 'test']) for (const v of ['model', 'baseline']) assert.ok(a.metrics[part][v].f1 >= 0 && a.metrics[part][v].f1 <= 1);
  const dir = mkdtempSync(path.join(tmpdir(), 'allur-train-')), file = path.join(dir, 'm.json');
  writeFileSync(file, JSON.stringify(a));
  const m = loadRiskModel(file); assert.ok(m, 'server loads the artifact');
  const w = new Workshop(); w.advance(60);
  const risk = assessRisk(w, m); assert.equal(risk.available, true); assert.equal(risk.items.length, 3);
  const s = labSummary(m); assert.equal(s.available, true); assert.equal(s.coefficients.length, a.features.length);
});
test('without an artifact the lab says so honestly and names a command that exists', () => {
  const s = labSummary(null);
  assert.equal(s.available, false); assert.match(s.reason, /не подключена/);
  const cmd = s.reason.match(/npm\.cmd run (\w+)/)?.[1];
  assert.ok(cmd && JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts[cmd], `package.json has "${cmd}"`);
});
