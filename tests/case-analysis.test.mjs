import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataset, applyFilter, normalizeFilter, production, quality, downtimeGroups, downtimeByEquipment, downtimeTotal, planCheck, stageStatuses, deviations, summary, dataQuality, oee, scenario, toCsv, csvText, lineRow, ratioPct, DOWNTIME_TOTAL_NAME, MODE_LABEL } from '../public/case-analysis.js';

const raw = JSON.parse(readFileSync(new URL('../public/case-dataset.json', import.meta.url), 'utf8'));
const load = r => { const v = validateDataset(r); assert.deepEqual(v.errors, []); return v.data; };
const data = load(raw), all = applyFilter(data, {});
const by = (list, stage) => list.find(x => x.stage === stage);
const BOM = String.fromCharCode(0xFEFF);

test('the case dataset is kept apart from the simulation and carries its label', () => {
  assert.equal(data.label, MODE_LABEL);
  assert.equal(data.lines.length, 6); assert.equal(data.downtime.length, 4); assert.equal(data.quality.length, 6); assert.equal(data.modelPlan.length, 3);
  assert.deepEqual(normalizeFilter(data, {}), { from: '2026-10-01', to: '2026-10-02', stage: 'all' });
});

test('monthly plan of the models is 4800, 700 below the 5500 target', () => {
  assert.deepEqual(planCheck(data), { models: 4800, target: 5500, gap: 700, consistent: false });
  const card = deviations(data, all).find(d => d.type === 'plan');
  assert.ok(card); assert.deepEqual(card.evidence, ['М1', 'М2', 'М3']);
  assert.match(dataQuality(data)[0].text, /4\s800 ед\..*5\s500 ед\..*= 700 ед\./);
});

test('painting over two days: 10 defects out of 231, about 4.329 %, computed from counts not from source percentages', () => {
  const k = by(quality(data, all), 'Окраска');
  assert.equal(k.defects, 10); assert.equal(k.produced, 231);
  assert.ok(Math.abs(k.ratePct - 4.329) < 0.001, String(k.ratePct));
  const meanOfSource = (3.5 + 5.2) / 2;
  assert.notEqual(Math.round(k.ratePct * 100) / 100, meanOfSource, 'not the average of rounded percentages');
  const card = deviations(data, all)[0];
  assert.equal(card.id, 'quality-Окраска');
  assert.deepEqual(card.evidence, ['К2', 'К5'], 'only quality records confirm the finding');
  assert.deepEqual(card.context, ['П2'], 'the painting downtime is a related record for a hypothesis, not evidence');
  assert.ok(card.hypotheses.every(h => /не установлена/.test(h)), 'downtime on the same stage is a hypothesis, not the cause');
  assert.match(card.next, /^Проверить параметры процесса участка «Окраска» и журнал дефектов/);
});

test('welding on 2 October: fact 111, plan 120, 92.5 %, deviation −9', () => {
  const v = applyFilter(data, { from: '2026-10-02', to: '2026-10-02', stage: 'Сварка' });
  assert.equal(v.lines.length, 1);
  const r = lineRow(v.lines[0]);
  assert.equal(r.fact, 111); assert.equal(r.plan, 120); assert.equal(r.completionPct, 92.5); assert.equal(r.deviation, -9);
  const p = by(production(data, v), 'Сварка');
  assert.equal(p.completionPct, 92.5); assert.equal(p.deviation, -9);
  assert.ok(deviations(data, v).some(d => d.id === 'production-Сварка'));
});

test('assembly over two days: 240 against a plan of 240 — assembly output only, stages are not added up', () => {
  const p = by(production(data, all), 'Сборка');
  assert.equal(p.fact, 240); assert.equal(p.plan, 240); assert.equal(p.completionPct, 100); assert.equal(p.deviation, 0);
  assert.ok(!deviations(data, all).some(d => d.id === 'production-Сборка'));
  const total = production(data, all).filter(x => x.measured).reduce((s, x) => s + x.fact, 0);
  assert.equal(total, 700); // 229 + 231 + 240 — exists only to show it is never displayed as finished cars
  assert.ok(dataQuality(data).some(d => /не суммируется/.test(d.text)));
});

test('downtime: four records sum to 150 min under its proper name, grouped by date, stage and equipment', () => {
  assert.equal(downtimeTotal(all), 150);
  assert.equal(DOWNTIME_TOTAL_NAME, 'Суммарная длительность зарегистрированных простоев оборудования');
  assert.deepEqual(downtimeGroups(all).map(g => `${g.date} ${g.stage} ${g.equipment} ${g.minutes}`), ['2026-10-01 Окраска Камера-02 40', '2026-10-01 Сварка ABB-01 25', '2026-10-02 Сборка Конвейер-03 55', '2026-10-02 Сварка ABB-04 30']);
  assert.deepEqual(downtimeByEquipment(all).map(g => g.equipment), ['Конвейер-03', 'Камера-02', 'ABB-04', 'ABB-01']);
  assert.ok(!deviations(data, all).some(d => d.type === 'downtime'), 'no record exceeds 60 min, and criticality is unknown anyway');
});

test('filters by date and stage apply to every figure', () => {
  const v = applyFilter(data, { from: '2026-10-01', to: '2026-10-01', stage: 'Окраска' });
  assert.deepEqual([v.lines.map(r => r.id), v.quality.map(r => r.id), v.downtime.map(r => r.id)], [['Л2'], ['К2'], ['П2']]);
  assert.deepEqual(quality(data, v).map(q => q.stage), ['Окраска']);
  assert.equal(by(quality(data, v), 'Окраска').defects, 4);
  assert.equal(downtimeTotal(v), 40);
  assert.ok(!deviations(data, v).some(d => d.type === 'plan'), 'monthly plan card only without a stage filter');
  const csv = toCsv(data, v);
  assert.ok(csv.includes('"Л2"') && !csv.includes('"Л5"') && !csv.includes('"К5"'));
  assert.deepEqual(normalizeFilter(data, { from: '2026-10-02', to: '2026-10-01', stage: 'Нет такого' }), { from: '2026-10-01', to: '2026-10-02', stage: 'all' });
  const assembly = applyFilter(data, { stage: 'Сборка' });
  assert.equal(deviations(data, assembly).length, 0);
  assert.equal(summary(data, assembly).main, null);
});

test('stages without measurements show «Нет данных», never zero or green', () => {
  for (const s of ['Склад комплектующих', 'Контроль качества', 'Склад готовой продукции']) {
    assert.equal(by(stageStatuses(data, all), s).status, 'nodata');
    assert.equal(by(production(data, all), s).measured, false); assert.equal(by(production(data, all), s).fact, undefined);
    assert.equal(by(quality(data, all), s).ratePct, undefined);
  }
  assert.equal(ratioPct(0, 0), null);
  const empty = load({ ...raw, lines: [], quality: [], downtime: [], modelPlan: [] }), v = applyFilter(empty, {});
  assert.equal(v.filter.from, null); assert.equal(downtimeTotal(v), null); assert.equal(planCheck(empty).models, null);
  assert.ok(stageStatuses(empty, v).every(s => s.status === 'nodata'));
  assert.deepEqual(deviations(empty, v), []);
  const zero = load({ ...raw, quality: [{ date: '2026-10-01', stage: 'Окраска', produced: 0, defects: 0, sourceDefectPct: null }] });
  assert.equal(by(quality(zero, applyFilter(zero, {})), 'Окраска').ratePct, null);
});

test('OEE stays unavailable without its inputs; load is not OEE; scenario needs explicit inputs and confirmation', () => {
  const o = oee(data);
  assert.equal(o.available, false); assert.equal(o.label, 'Недостаточно данных для расчёта'); assert.equal(o.targetPct, 85);
  assert.ok(o.missing.some(m => /время цикла/.test(m))); assert.match(o.note, /не является OEE/);
  assert.equal(scenario(data, { remainingDays: 20, accumulated: 240, dailyRate: 230, confirmed: false }).ok, false);
  assert.equal(scenario(data, { remainingDays: '', accumulated: 240, dailyRate: 230, confirmed: true }).ok, false);
  const s = scenario(data, { remainingDays: 20, accumulated: 1000, dailyRate: 230, confirmed: true });
  assert.equal(s.projected, 5600); assert.equal(s.vsTarget, 100); assert.equal(s.vsModels, 800); assert.match(s.text, /не прогноз/);
});

test('CSV: label, filter, quoted text, neutralised formulas, decimal comma', () => {
  assert.equal(csvText('=1+1'), `"'=1+1"`); assert.equal(csvText('a"b'), '"a""b"');
  const csv = toCsv(data, all);
  assert.ok(csv.startsWith(BOM + `"${MODE_LABEL}"`));
  assert.ok(csv.includes('"Л4";"2026-10-02";"Сварка-1";"Сварка";120;111;92,5;-9;7,2;91'));
  assert.ok(csv.includes('"Итого за период";"";"";"Окраска";231;10;4,329;""'));
  assert.ok(csv.includes(`"${DOWNTIME_TOTAL_NAME}";"";"";"";"";"";150`));
});

test('a different small dataset gives different conclusions: nothing is hard-coded', () => {
  const other = load({
    ...raw, id: 'other', lineStage: { 'L-A': 'Сварка', 'L-B': 'Окраска' },
    conditions: { ...raw.conditions, maxDefectPct: 3, monthlyPlanMin: 300 },
    lines: [{ date: '2027-01-10', line: 'L-A', plan: 50, fact: 40, hours: 8, loadPct: 80 }, { date: '2027-01-10', line: 'L-B', plan: 50, fact: 55, hours: 8, loadPct: 100 }],
    quality: [{ date: '2027-01-10', stage: 'Сварка', produced: 40, defects: 0, sourceDefectPct: 0 }, { date: '2027-01-10', stage: 'Окраска', produced: 55, defects: 1, sourceDefectPct: 1.8 }],
    downtime: [{ date: '2027-01-10', stage: 'Сварка', equipment: 'R-9', reason: 'Сбой', minutes: 70 }, { date: '2027-01-10', stage: 'Сварка', equipment: 'R-9', reason: 'Повтор', minutes: 5 }],
    modelPlan: [{ model: 'X', plan: 100 }, { model: 'Y', plan: 200 }],
  });
  const v = applyFilter(other, {}), dev = deviations(other, v);
  assert.deepEqual(dev.map(d => d.id), ['production-Сварка', 'downtime-2027-01-10-R-9']);
  assert.equal(summary(other, v).main.id, 'production-Сварка');
  assert.match(dev[0].value, /40 из 50 ед\. \(80 %/);
  assert.equal(downtimeGroups(v)[0].minutes, 75);
  assert.match(dev[1].threshold, /только для критического/);
  assert.equal(planCheck(other).consistent, true);
  assert.equal(by(stageStatuses(other, v), 'Окраска').status, 'ok');
  assert.equal(by(stageStatuses(other, v), 'Сборка').status, 'nodata');
});

test('invalid datasets are rejected with a path', () => {
  assert.ok(validateDataset([]).errors.length);
  const bad = structuredClone(raw); bad.quality[0].defects = 500; bad.lines[0].line = 'Неизвестная'; bad.lines[1].fact = -1;
  const { data: d, errors } = validateDataset(bad);
  assert.equal(d, null);
  for (const p of ['quality[0].defects', 'lines[0].line', 'lines[1].fact']) assert.ok(errors.some(e => e.startsWith(p)), p);
});
