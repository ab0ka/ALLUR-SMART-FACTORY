// "A shift without the system vs a shift with it" on many synthetic shifts (no real Allur data).
// Every policy plays the same shifts: same seed, orders, defects, lift degradation episode and sensor noise
// (noise is hashed from seed/minute, so it does not depend on actions). Policies act only through the same server
// commands as the operator, see only what the operator sees (problems, check results, model risk, forecasts on copies)
// and never read the hidden cause. Result: reports/policy-comparison.json (shown in the lab) and a Markdown report.
// Usage: npm.cmd run policies          (node scripts/compare-policies.mjs [--shifts 200] [--seed 9001])
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workshop, LIFTS, SHIFT, STOCK_ITEMS, TARIFFS } from '../server/simulation.mjs';
import { buildOptions, compareOptions, applyOption } from '../server/decisions.mjs';
import { loadRiskModel, assessRisk } from '../server/risk-model.mjs';
import { shiftEpisode } from './train-lift-risk.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_SEED = 42, TRAIN_SEEDS = [7001, 7300]; // evaluation shifts never overlap the model's training shifts
const busy = (w, postId) => w.jobs.some(j => j.postId === postId && ['queued', 'running'].includes(j.status));
const openEquipment = w => w.problems.filter(p => p.status === 'open' && p.kind === 'equipment');
const run = (w, cmds) => { for (const c of cmds) w.command(c, 'operator'); };
let requestSeq = 0;
const rid = () => `policy-${String(++requestSeq).padStart(8, '0')}`;

// Diagnose-and-repair as the operator would choose it in the problem card: the check with automatic repair by its
// result, or the repair of a confirmed cause; if both checks were ambiguous, repair the more likely hypothesis.
function diagnoseAndRepair(w, p) {
  const options = buildOptions(w, p);
  const fix = options.find(o => ['repair_confirmed', 'diagnose_repair'].includes(o.id) && o.available);
  if (fix) return run(w, fix.commands), true;
  const best = [...w.hypothesisView(p)].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0];
  const guess = best && options.find(o => o.id === `repair_${best.id}_now` && o.available);
  if (guess) return run(w, guess.commands), true;
  return false;
}

export const POLICIES = [
  { id: 'reactive', name: 'Без системы: ремонт после отказа', description: 'Отклонения не отслеживаются. После отказа подъёмника техник проверяет причину и ремонтирует.',
    step(w) { for (const p of openEquipment(w)) if (w.equipment[p.equipmentId].failed && !busy(w, p.postId)) diagnoseAndRepair(w, p); } },
  { id: 'detect', name: 'Система: проверка и ремонт при обнаружении отклонения', description: 'Как только мониторинг открывает проблему (отклонение z > 4,5), техник выполняет проверку и ремонт по её результату.',
    step(w) { for (const p of openEquipment(w)) if (!busy(w, p.postId)) diagnoseAndRepair(w, p); } },
  { id: 'risk', name: 'Система + модель риска: ремонт по прогнозу отказа', description: 'При обнаружении отклонения пост перестаёт получать новые машины (параллельные посты продолжают). Проверка и ремонт — когда модель риска даёт тревогу или пост освободился.',
    needsModel: true,
    step(w, ctx) {
      const risk = assessRisk(w, ctx.model);
      for (const p of openEquipment(w)) {
        if (!w.holds[p.postId] && !ctx.held.has(p.id)) { const hold = buildOptions(w, p).find(o => o.id === 'hold' && o.available); if (hold) { run(w, [hold.commands[0]]); ctx.held.add(p.id); } }
        const item = risk.items?.find(r => r.postId === p.postId);
        const due = w.equipment[p.equipmentId].failed || item?.alarm || !w.posts[p.postId].vehicleId;
        if (due && !busy(w, p.postId)) diagnoseAndRepair(w, p);
      }
      for (const postId of Object.keys(w.holds)) if (w.holds[postId] && !w.openProblemFor(postId) && !busy(w, postId)) run(w, [{ action: 'hold', postId, on: false }]);
    } },
  advisorPolicy('advisor', 'Система: рекомендация по сравнению вариантов', 'При открытой проблеме система сравнивает варианты на копиях текущего снимка до 16:00 и применяет вариант с наибольшим ожидаемым выпуском (при равенстве — с меньшими затратами). Повторное сравнение — после завершения работ или через 30 мин.', 0),
  advisorPolicy('advisor_next', 'Система: рекомендация с учётом следующей смены', 'То же сравнение вариантов, но если вариант с ремонтом или проверкой уступает лучшему не больше 0,3 машины к 16:00, выбирается он: неисправный подъёмник не передаётся следующей смене.', 0.3),
];

const REPAIRS = new Set(['repair_confirmed', 'diagnose_repair', 'repair_leak_now', 'repair_wear_now', 'repair_now']);
// Decision support: compare options on copies of the current snapshot and apply the best expected output to 16:00.
// tolerance > 0 prefers an option that repairs the lift when it is at most that many cars behind the best one.
function advisorPolicy(id, name, description, tolerance) {
  return { id, name, description,
    step(w, ctx) {
      for (const p of openEquipment(w)) {
        if (busy(w, p.postId)) continue;
        const last = ctx.decided.get(p.id);
        if (last !== undefined && w.minute - last < 30 && !w.equipment[p.equipmentId].failed) continue;
        if ((ctx.count.get(p.id) ?? 0) >= 6) { diagnoseAndRepair(w, p); continue; }
        const exp = compareOptions(w, p.id);
        const ranked = exp.options.filter(o => o.available && o.expected).sort((a, b) => b.expected.accepted - a.expected.accepted || a.expected.cost - b.expected.cost);
        let best = ranked[0];
        const repair = tolerance > 0 && ranked.find(o => o.commands.some(c => c.action === 'job') && REPAIRS.has(o.id));
        if (repair && best && best.expected.accepted - repair.expected.accepted <= tolerance) best = repair;
        ctx.decided.set(p.id, w.minute); ctx.count.set(p.id, (ctx.count.get(p.id) ?? 0) + 1);
        if (best && best.id !== 'continue') applyOption(w, { experimentId: exp.id, optionId: best.id, requestId: rid() });
      }
    } };
}
// One shift under one policy: the same engine, ticked minute by minute; the policy acts after every minute.
export function playShift(seed, policy, model) {
  const w = new Workshop({ seed, warmup: 0, plan: false, episode: shiftEpisode(seed) || false });
  const start = w.counters(), ctx = { model, held: new Set(), decided: new Map(), count: new Map() };
  let failures = 0; const seen = new Set();
  while (w.minute < SHIFT) {
    w.tick();
    for (const l of LIFTS) if (w.equipment[l.id].failed && !seen.has(`${l.id}:${w.equipment[l.id].failedAt}`)) { seen.add(`${l.id}:${w.equipment[l.id].failedAt}`); failures++; }
    if (w.minute < SHIFT) policy.step(w, ctx);
  }
  w.finishShift();
  const o = w.outcomeFrom(start);
  // Scoring only (never seen by a policy): lifts left failed or still degrading carry the problem into the next shift.
  const carried = LIFTS.filter(l => w.equipment[l.id].failed || w.equipment[l.id].hidden.cause).length;
  return { accepted: o.accepted, downtime: o.downtime, techMinutes: o.techMinutes, cost: o.cost, lateOrders: o.lateOrders.length, failures, carried, episode: Boolean(shiftEpisode(seed)), integrity: w.checkIntegrity().length === 0 };
}

const r2 = x => Math.round(x * 100) / 100;
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const stats = xs => ({ mean: r2(xs.reduce((a, x) => a + x, 0) / xs.length), median: r2(quantile(xs, .5)), p10: r2(quantile(xs, .1)), p90: r2(quantile(xs, .9)) });

export function comparePolicies({ shifts = 200, seed = 9001, model = null, onProgress = null } = {}) {
  const seeds = Array.from({ length: shifts }, (_, i) => seed + i).filter(s => s !== DEMO_SEED && (s < TRAIN_SEEDS[0] || s > TRAIN_SEEDS[1]));
  const policies = POLICIES.filter(p => !p.needsModel || model);
  const results = Object.fromEntries(policies.map(p => [p.id, []]));
  seeds.forEach((s, i) => { for (const p of policies) results[p.id].push(playShift(s, p, model)); onProgress?.(i + 1, seeds.length); });
  const base = results[policies[0].id];
  const withEpisode = seeds.map((_, i) => base[i].episode);
  const summary = policies.map(p => {
    const rs = results[p.id], pick = k => rs.map(r => r[k]);
    const deltas = rs.map((r, i) => r.accepted - base[i].accepted), epDeltas = deltas.filter((_, i) => withEpisode[i]);
    const histogram = {}; for (const d of deltas) histogram[d] = (histogram[d] ?? 0) + 1;
    return {
      id: p.id, name: p.name, description: p.description,
      accepted: stats(pick('accepted')), downtime: stats(pick('downtime')), cost: stats(pick('cost')), techMinutes: stats(pick('techMinutes')),
      lateOrders: r2(pick('lateOrders').reduce((a, x) => a + x, 0) / rs.length), failures: r2(pick('failures').reduce((a, x) => a + x, 0) / rs.length),
      shiftsWithFailure: rs.filter(r => r.failures > 0).length, carriedOver: r2(pick('carried').reduce((a, x) => a + x, 0) / rs.length), shiftsCarried: rs.filter(r => r.carried > 0).length, integrityErrors: rs.filter(r => !r.integrity).length,
      vsBaseline: p.id === policies[0].id ? null : {
        better: deltas.filter(d => d > 0).length, same: deltas.filter(d => d === 0).length, worse: deltas.filter(d => d < 0).length,
        meanDelta: r2(deltas.reduce((a, d) => a + d, 0) / deltas.length), meanDeltaWithEpisode: epDeltas.length ? r2(epDeltas.reduce((a, d) => a + d, 0) / epDeltas.length) : 0,
        histogram: Object.fromEntries(Object.entries(histogram).sort((a, b) => Number(a[0]) - Number(b[0]))),
      },
    };
  });
  return {
    format: 'allur-policy-comparison', version: 1, generatedFrom: { seeds: [seeds[0], seeds.at(-1)], excluded: ['демо-смена seed 42', `смены обучения модели ${TRAIN_SEEDS.join('–')}`] },
    shifts: seeds.length, shiftsWithEpisode: withEpisode.filter(Boolean).length, modelVersion: model?.modelVersion ?? null,
    method: `${seeds.length} синтетических смен (seed ${seeds[0]}–${seeds.at(-1)}); в ${withEpisode.filter(Boolean).length} из них один подъёмник деградирует (утечка или износ насоса, случайные начало и скорость), в остальных отказов нет. Каждая стратегия играет одни и те же смены: те же задания, дефекты, деградация и шум датчиков. Стратегии действуют только командами оператора и не видят скрытую причину. Затраты — синтетические тарифы: техник ${TARIFFS.technicianPerMinute} ${TARIFFS.currency}/мин, ${Object.values(STOCK_ITEMS).map(s => `${s.name} — ${s.cost}`).join(', ')}.`,
    policies: summary,
  };
}

function markdown(r) {
  const base = r.policies[0];
  const row = p => `| ${p.name} | ${p.accepted.mean} | ${p.accepted.p10}–${p.accepted.p90} | ${p.failures} | ${p.downtime.mean} | ${p.cost.mean} | ${p.lateOrders} | ${p.shiftsCarried} из ${r.shifts} | ${p.vsBaseline ? `${p.vsBaseline.better} / ${p.vsBaseline.same} / ${p.vsBaseline.worse} · ${p.vsBaseline.meanDelta > 0 ? '+' : ''}${p.vsBaseline.meanDelta} (в сменах с деградацией ${p.vsBaseline.meanDeltaWithEpisode > 0 ? '+' : ''}${p.vsBaseline.meanDeltaWithEpisode})` : 'база'} |`;
  return `# Смена без системы против смены с системой

Синтетические данные учебной симуляции; не результаты завода Allur.

${r.method}

| Стратегия | Принято, среднее | P10–P90 | Отказов подъёмника на смену | Простой постов, мин | Затраты, ${TARIFFS.currency} | Сорвано сроков заданий | Смен, где подъёмник остался неисправным | К «${base.name}»: лучше / так же / хуже · Δ машин |
|---|---|---|---|---|---|---|---|---|
${r.policies.map(row).join('\n')}

${r.policies.map(p => `- **${p.name}.** ${p.description}`).join('\n')}

Повторить: \`npm.cmd run policies\` (те же seed дают тот же отчёт).
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : undefined; };
  const model = loadRiskModel(path.join(root, 'models', 'lift-risk-v1.json'));
  if (!model) console.log('Модель риска не найдена (npm.cmd run train) — стратегия «модель риска» пропущена.');
  const t0 = Date.now();
  const r = comparePolicies({ shifts: arg('shifts') ?? 200, seed: arg('seed') ?? 9001, model, onProgress: (i, n) => { if (i % 20 === 0 || i === n) process.stdout.write(`  смен: ${i}/${n}\r`); } });
  mkdirSync(path.join(root, 'reports'), { recursive: true });
  writeFileSync(path.join(root, 'reports', 'policy-comparison.json'), JSON.stringify(r, null, 1));
  writeFileSync(path.join(root, 'reports', 'policy-comparison.md'), markdown(r));
  console.log(`\nСравнение за ${((Date.now() - t0) / 1000).toFixed(0)} с: ${r.shifts} смен, из них с деградацией подъёмника ${r.shiftsWithEpisode}.`);
  for (const p of r.policies) console.log(`  ${p.name}: принято ${p.accepted.mean}, отказов ${p.failures}, неисправен к концу смены в ${p.shiftsCarried} сменах, простой ${p.downtime.mean} мин, затраты ${p.cost.mean}${p.vsBaseline ? `, Δ ${p.vsBaseline.meanDelta} (лучше ${p.vsBaseline.better} / хуже ${p.vsBaseline.worse})` : ''}`);
  console.log('Отчёт: reports/policy-comparison.json, reports/policy-comparison.md');
}
