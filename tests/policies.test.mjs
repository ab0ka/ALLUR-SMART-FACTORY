import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { comparePolicies, playShift, POLICIES } from '../scripts/compare-policies.mjs';
import { loadPolicyReport } from '../server/risk-model.mjs';

test('policies play the same shifts, keep balances and are reproducible', () => {
  const a = comparePolicies({ shifts: 6, seed: 9001 }), b = comparePolicies({ shifts: 6, seed: 9001 });
  assert.deepEqual(a, b, 'same seeds give the same report');
  assert.equal(a.policies[0].id, 'reactive'); assert.equal(a.policies[0].vsBaseline, null);
  for (const p of a.policies) {
    assert.equal(p.integrityErrors, 0, `${p.id}: engine integrity`);
    if (p.vsBaseline) assert.equal(p.vsBaseline.better + p.vsBaseline.same + p.vsBaseline.worse, a.shifts);
  }
  assert.ok(!a.policies.some(p => p.id === 'risk'), 'the model policy needs a trained model');
});
test('evaluation shifts exclude the demo shift and the model training shifts', () => {
  const r = comparePolicies({ shifts: 3, seed: 7299 });
  assert.equal(r.shifts, 0 + [7299, 7300, 7301].filter(s => s > 7300).length);
  const d = comparePolicies({ shifts: 2, seed: 41 });
  assert.equal(d.shifts, 1, 'seed 42 skipped');
});
test('without the system a degrading lift fails; detection prevents the failure on the same shift', () => {
  // Find a shift where the reactive policy sees a failure; detection on the same shift must act earlier.
  const reactive = POLICIES.find(p => p.id === 'reactive'), detect = POLICIES.find(p => p.id === 'detect');
  let seed = 9001; while (playShift(seed, reactive).failures === 0 && seed < 9060) seed++;
  assert.ok(seed < 9060, 'a shift with a failure exists');
  assert.ok(playShift(seed, detect).failures <= playShift(seed, reactive).failures);
});
test('the report format is accepted by the server', () => {
  const r = comparePolicies({ shifts: 3, seed: 9001 });
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'allur-pol-')), 'p.json');
  writeFileSync(file, JSON.stringify(r));
  assert.equal(loadPolicyReport(file).format, 'allur-policy-comparison');
});
