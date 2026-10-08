import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, oee, lineParameters, BASELINE, STATIONS, SCENARIOS, BASE_REJECT_RATE } from '../server/simulation.mjs';

test('OEE uses known A×P×Q values, and zero-time is finite', () => {
  const m = oee(100, 80, 60, 54);
  assert.equal(m.availability, .8); assert.equal(m.performance, .75); assert.equal(m.quality, .9);
  assert.ok(Math.abs(m.oee - .54) < 1e-10);
  assert.deepEqual(oee(0, 0, 0, 0), { availability: 0, performance: 0, quality: 0, oee: 0 });
});
test('fixed seed reproduces history, total equals good plus categorized defects', () => {
  const a = new Simulation(), b = new Simulation(); assert.deepEqual(a.snapshot(), b.snapshot());
  a.inject('defects'); a.advance(60);
  const s = a.snapshot(); assert.equal(s.total, s.good + s.rejects);
  assert.equal(Object.values(s.defects).reduce((x, y) => x + y, 0), s.rejects);
  assert.equal(s.stations.length, 5); assert.ok(s.history.length > 20);
});
test('paint stop lowers forecast immediately, blocks output, and lowers availability', () => {
  const sim = new Simulation(); const before = sim.snapshot(); sim.inject('stop');
  const injected = sim.snapshot(); assert.equal(injected.total, before.total); assert.equal(injected.good, before.good);
  assert.deepEqual(injected.metrics, before.metrics); assert.ok(injected.forecast.projected < before.forecast.projected);
  sim.advance(10); const stopped = sim.snapshot(); assert.equal(stopped.total, before.total);
  assert.equal(stopped.downtime, 10); assert.ok(stopped.metrics.availability < before.metrics.availability);
  sim.resolve(sim.active('stop').id); sim.advance(5); assert.ok(sim.total > before.total);
  assert.equal(sim.snapshot().downtime, 10); assert.equal(sim.incidents[0].status, 'resolved');
});
test('quality scenario creates more defects and slower assembly lowers performance', () => {
  const base = new Simulation(), bad = new Simulation(), slow = new Simulation();
  bad.inject('defects'); slow.inject('slowdown');
  base.advance(60); bad.advance(60); slow.advance(60);
  assert.ok(bad.snapshot().rejects > base.snapshot().rejects);
  assert.ok(bad.snapshot().metrics.quality < base.snapshot().metrics.quality);
  assert.ok(slow.total < base.total); assert.ok(slow.snapshot().metrics.performance < base.snapshot().metrics.performance);
});
test('incidents auto-resolve at specified minute, cannot duplicate, invalid inputs rejected', () => {
  const sim = new Simulation(); sim.inject('stop');
  assert.throws(() => sim.inject('stop')); assert.throws(() => sim.inject('unknown')); assert.throws(() => sim.resolve(999));
  assert.throws(() => sim.inject('__proto__')); assert.throws(() => sim.inject('constructor'));
  assert.throws(() => sim.advance(0)); assert.throws(() => sim.advance(61));
  sim.advance(45); assert.equal(sim.elapsed, 165); assert.equal(sim.active('stop'), undefined);
  assert.equal(sim.incidents[0].end, 165); sim.advance(5); assert.ok(sim.total > 103);
});
test('forecast factors reconcile with baseline; overlapping scenarios do not double count', () => {
  const sim = new Simulation(); sim.inject('stop'); sim.inject('defects'); sim.inject('slowdown');
  const f = sim.forecast(), losses = Object.values(f.factors).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(f.future + losses - f.remaining * .86 * .975) < .003);
  assert.ok(f.low <= f.projected && f.high >= f.projected);
});
test('end of shift stops simulation and forecast equals actual; reset restores seeded demo', () => {
  const sim = new Simulation(); sim.running = true;
  for (let i = 0; i < 10; i++) sim.advance(60);
  const s = sim.snapshot(); assert.equal(s.elapsed, 480); assert.equal(s.running, false); assert.equal(s.finished, true);
  assert.equal(s.forecast.projected, s.good); assert.equal(s.forecast.low, s.good); assert.equal(s.forecast.high, s.good);
  assert.throws(() => sim.inject('stop'));
  sim.reset(); assert.equal(sim.elapsed, 120); assert.equal(sim.running, false); assert.equal(sim.incidents.length, 0);
  assert.equal(sim.total, new Simulation().total);
});
test('incident left open at shift end is "not resolved", keeps real recovery time and no invented end', () => {
  const sim = new Simulation(); for (let i = 0; i < 5; i++) sim.advance(60); sim.advance(55);
  sim.inject('stop'); assert.equal(sim.elapsed, 475); sim.advance(10);
  const s = sim.snapshot(), item = s.incidents[0];
  assert.equal(s.finished, true); assert.equal(item.status, 'unresolved'); assert.equal(item.end, null);
  assert.equal(item.expires, 520); assert.equal(item.resolution, 'Не устранён к концу смены');
  assert.equal(s.incidents.filter(i => i.status === 'active').length, 0);
  assert.throws(() => sim.resolve(item.id), e => e.status === 404);
  assert.equal(s.downtime, 5); assert.equal(s.forecast.projected, s.good);
  // An incident whose recovery falls exactly on 16:00 is recovered by the scenario, not left open.
  const exact = new Simulation(); for (let i = 0; i < 5; i++) exact.advance(60);
  assert.equal(exact.elapsed, 420); exact.inject('defects'); exact.advance(60); assert.equal(exact.incidents[0].status, 'resolved'); assert.equal(exact.incidents[0].end, 480);
});
test('simulation, forecast and explanation share one parameter source', () => {
  assert.equal(BASELINE.rate, Math.min(...STATIONS.map(s => s.rate))); assert.equal(BASELINE.rejectRate, BASE_REJECT_RATE);
  const slow = lineParameters(['slowdown']); assert.equal(slow.rate, SCENARIOS.slowdown.effect.rates.assembly); assert.equal(slow.bottleneck.id, 'assembly');
  assert.equal(lineParameters(['defects']).rejectRate, SCENARIOS.defects.effect.rejectRate); assert.equal(lineParameters(['stop']).stopped, true);
  // Forecast with only slowdown active for its whole duration matches the shared parameters minute by minute.
  const sim = new Simulation(); sim.inject('slowdown'); const f = sim.forecast(), d = SCENARIOS.slowdown.duration;
  const expected = d * slow.rate * slow.yieldRate + (f.remaining - d) * BASELINE.rate * BASELINE.yieldRate;
  assert.ok(Math.abs(f.future - expected) < .002); assert.equal(f.baseline.rate, BASELINE.rate);
  // The scenario effect actually drives the minute-by-minute simulation.
  const a = new Simulation(); a.inject('slowdown'); const before = a.total; a.advance(10);
  assert.ok(Math.abs((a.total - before) - 10 * slow.rate) <= 1);
});
test('bottleneck is reported for the map; incidents carry station, recommendation and remedy', () => {
  const sim = new Simulation(); assert.equal(sim.snapshot().bottleneck, 'assembly');
  sim.inject('stop'); const s = sim.snapshot(); assert.equal(s.bottleneck, 'paint');
  const item = s.incidents[0];
  assert.equal(item.stationName, 'Окраска'); assert.ok(item.advice.length > 10); assert.ok(item.remedy.length > 10);
  assert.ok(item.cause.startsWith('Синтетический сигнал')); assert.equal(item.effect, undefined);
  sim.resolve(item.id); assert.equal(sim.snapshot().bottleneck, 'assembly');
  const q = new Simulation(); q.inject('defects'); assert.equal(q.snapshot().incidents[0].stationName, 'Контроль качества');
});
test('simulation input errors carry explicit client status codes', () => {
  const sim = new Simulation(); sim.inject('stop');
  assert.throws(() => sim.inject('unknown'), e => e.status === 400 && e.expose);
  assert.throws(() => sim.inject('stop'), e => e.status === 409);
  assert.throws(() => sim.resolve(42), e => e.status === 404);
  assert.throws(() => sim.advance(0), e => e.status === 400);
});
