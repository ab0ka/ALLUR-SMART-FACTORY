// Decision centre: build alternative actions for a problem, evaluate each on independent copies of one snapshot,
// apply the chosen one with staleness and idempotency checks, then compare expected and observed results.
// All numbers come from the engine. All data is synthetic.
import { SimulationError, JOB_KINDS, POSTS, clock, SHIFT } from './simulation.mjs';
import { HYPOTHESES } from './equipment.mjs';

const POST = Object.fromEntries(POSTS.map(p => [p.id, p]));
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const NUMERIC = ['accepted', 'ordersOnTime', 'downtime', 'wip', 'notStarted', 'techMinutes', 'cost'];

function diagnoseStep(w, problem) {
  const cause = w.indicatedCause(problem);
  if (cause) {
    const kind = HYPOTHESES[cause].repair;
    return { id: 'repair_confirmed', title: `Ремонт по установленной причине: ${JOB_KINDS[kind].title.toLowerCase()}`, commands: [{ action: 'job', postId: problem.postId, kind }], check: w.jobAvailability(problem.postId, kind) };
  }
  // Prefer the check that does not stop the post; with two hypotheses either check is decisive when unambiguous.
  const kind = ['pump_check', 'pressure_hold'].find(k => !problem.checks.some(c => c.kind === k));
  if (!kind) return { id: 'diagnose_repair', title: 'Проверки выполнены, причина не установлена', commands: [], check: { ok: false, reason: 'Обе проверки выполнены; результат неоднозначен — выберите ремонт вручную' } };
  return { id: 'diagnose_repair', title: `${JOB_KINDS[kind].title}, затем ремонт по результату`, commands: [{ action: 'job', postId: problem.postId, kind, followUp: 'repair_by_result' }], check: w.jobAvailability(problem.postId, kind) };
}
// Options are concrete server commands. Unavailable options keep a specific reason and are never evaluated.
export function buildOptions(w, problem) {
  const options = [{ id: 'continue', title: 'Продолжить без нового вмешательства', description: 'Базовый вариант: уже запланированные работы выполняются, новых действий нет.', commands: [], available: true }];
  const add = (id, title, description, commands, check) => options.push({ id, title, description, commands, available: check.ok, reason: check.ok ? null : check.reason });
  const post = POST[problem.postId], vehicleId = w.posts[problem.postId].vehicleId, exec = vehicleId ? w.execution(w.posts[problem.postId].executionId) : null;
  const siblings = POSTS.filter(p => p.stage === post.stage && p.id !== post.id);
  let fix;
  if (problem.kind === 'equipment') {
    fix = diagnoseStep(w, problem);
    add(fix.id, fix.title, fix.id === 'repair_confirmed' ? 'Причина подтверждена проверкой; ремонт с последующей проверкой восстановления.' : 'Техник выполняет проверку; ремонт назначается автоматически, только если результат однозначно указывает причину.', fix.commands, fix.check);
    if (!w.indicatedCause(problem)) for (const [cause, h] of Object.entries(HYPOTHESES)) {
      const kind = h.repair;
      add(`repair_${cause}_now`, `${JOB_KINDS[kind].title} сразу, без проверки`, `Ремонт в расчёте на гипотезу «${h.title.toLowerCase()}». Если причина другая, ремонт не поможет, а запчасть будет израсходована.`, [{ action: 'job', postId: problem.postId, kind }], w.jobAvailability(problem.postId, kind));
    }
  } else {
    const kind = w.postIncident(problem.postId)?.kind === 'slowdown' ? 'adjust' : 'repair_generic';
    fix = { id: 'repair_now', title: JOB_KINDS[kind].title, commands: [{ action: 'job', postId: problem.postId, kind }], check: w.jobAvailability(problem.postId, kind) };
    add(fix.id, `${fix.title} сейчас`, `Техник выполняет «${fix.title.toLowerCase()}» (${JOB_KINDS[kind].duration} мин).`, fix.commands, fix.check);
  }
  // Transfer only to a free, working parallel post. The reason lists every sibling when none qualifies.
  if (exec && exec.completedAt === null) {
    const checks = siblings.map(s => ({ post: s, check: w.transferAvailability(vehicleId, s.id) })), target = checks.find(c => c.check.ok);
    const commands = target ? [{ action: 'transfer', vehicleId, postId: target.post.id }, ...(fix.check.ok ? fix.commands : [])] : [];
    add('transfer', target ? `Перевести ${vehicleId} на ${target.post.code}${fix.check.ok ? ` и выполнить: ${fix.title.toLowerCase()}` : ''}` : `Перевести ${vehicleId} на параллельный пост`,
      'Остаток операции сохраняется; освободившийся пост обслуживается техником.', commands, target ? { ok: true } : { ok: false, reason: checks.length ? checks.map(c => c.check.reason).join('; ') : 'Параллельных постов нет' });
  } else add('transfer', 'Перевести автомобиль на параллельный пост', '', [], { ok: false, reason: vehicleId ? `${vehicleId} уже завершил операцию на ${post.code}` : `На ${post.code} нет автомобиля` });
  // Resequencing not-started work: stop loading the affected post, or speed up an order whose due time is at risk.
  if (siblings.length) {
    const hold = w.holds[problem.postId] ? { ok: false, reason: `${post.code} уже снят с загрузки` } : siblings.every(s => w.holds[s.id]) ? { ok: false, reason: 'Нельзя снять нагрузку с последнего поста участка' } : { ok: true };
    add('hold', `Не загружать ${post.code} новыми автомобилями${fix.check.ok ? ` + ${fix.title.toLowerCase()}` : ''}`, 'Следующие автомобили из очереди идут на параллельные посты; текущая операция продолжается.', [{ action: 'hold', postId: problem.postId, on: true }, ...(fix.check.ok ? fix.commands : [])], hold);
  }
  const late = w.forecast().lateOrders.map(id => w.order(id)).filter(o => o && o.priority !== 'high' && o.vehicleIds.some(id => w.vehicle(id).startedAt === null));
  add('priority', late.length ? `Поднять приоритет ${late[0].id} (срок ${clock(late[0].dueMinute)} под угрозой)` : 'Поднять приоритет задания под угрозой срока',
    'Меняется только очередь ещё не начатых операций; начатые не прерываются.', late.length ? [{ action: 'priority', orderId: late[0].id, priority: 'high' }] : [],
    late.length ? { ok: true } : { ok: false, reason: 'По прогнозу нет задания со сроком в смене, у которого остались неначатые автомобили и приоритет ниже высокого' });
  return options;
}
function aggregate(runs) {
  const expected = Object.fromEntries(NUMERIC.map(k => [k, round(runs.reduce((a, r) => a + r.weight * r.outcome[k], 0), 2)]));
  const late = new Map(); for (const r of runs) for (const id of r.outcome.lateOrders) late.set(id, round((late.get(id) || 0) + r.weight, 3));
  const parts = {}; for (const r of runs) for (const [k, n] of Object.entries(r.outcome.parts)) parts[k] = round((parts[k] || 0) + r.weight * n, 2);
  return { expected: { ...expected, ordersDue: runs[0].outcome.ordersDue, lateOrderRisk: Object.fromEntries(late), parts }, range: { accepted: [Math.min(...runs.map(r => r.outcome.accepted)), Math.max(...runs.map(r => r.outcome.accepted))] }, perScenario: runs.map(r => ({ label: r.label, weight: round(r.weight, 3), ...r.outcome })) };
}
// Each option runs on its own copy of the same belief scenarios: identical start state, sensor noise and defect draws.
export function compareOptions(w, problemId) {
  if (w.finished) throw new SimulationError('Смена завершена — сравнение вариантов недоступно', 409);
  const problem = typeof problemId === 'string' ? w.problem(problemId) : null;
  if (!problem) throw new SimulationError('Проблема не найдена', 404);
  if (problem.status !== 'open') throw new SimulationError('Проблема уже закрыта', 409);
  const scenarios = w.beliefScenarios(), start = w.counters(), options = buildOptions(w, problem);
  for (const option of options) {
    if (!option.available) continue;
    try {
      const runs = scenarios.map(s => { const copy = s.workshop.clone(); for (const cmd of option.commands) copy.command(cmd, 'operator'); copy.runToEnd(); return { label: s.label, weight: s.weight, outcome: copy.outcomeFrom(start) }; });
      Object.assign(option, aggregate(runs));
    } catch (e) { option.available = false; option.reason = e.expose ? e.message : 'Вариант не выполним в текущем состоянии'; }
  }
  const base = options[0].expected;
  for (const o of options.filter(o => o.expected)) o.delta = Object.fromEntries(NUMERIC.map(k => [k, round(o.expected[k] - base[k], 2)]));
  const hyp = problem.kind === 'equipment' ? w.hypothesisView(problem).map(h => ({ id: h.id, title: h.title, probability: h.probability, status: h.status, estimate: h.estimate })) : [];
  const experiment = { id: `EXP-${++w.experimentSeq}`, problemId: problem.id, minute: w.minute, baseRevision: w.revision, scenarios: scenarios.map(s => ({ label: s.label, weight: round(s.weight, 3) })), hypotheses: hyp, options,
    method: 'Каждый вариант применяется к своей копии одного снимка и прогоняется тем же движком до 16:00. Все варианты используют одинаковые сценарии причин (веса из наблюдений), одинаковый шум датчиков и одинаковые допущения о браке. Рабочая смена, её журнал и генератор не меняются.' };
  w.experiments.push(experiment); if (w.experiments.length > 20) w.experiments.shift();
  w.recordVersion++;
  return experiment;
}
export function applyOption(w, { experimentId, optionId, requestId } = {}) {
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new SimulationError('Некорректный requestId');
  const existing = w.decisions.find(d => d.requestId === requestId);
  if (existing) return { duplicate: true, decision: existing };
  const exp = typeof experimentId === 'string' ? w.experiments.find(e => e.id === experimentId) : null;
  if (!exp) throw new SimulationError('Сравнение не найдено — пересчитайте варианты', 404);
  const option = typeof optionId === 'string' ? exp.options.find(o => o.id === optionId) : null;
  if (!option) throw new SimulationError('Вариант не найден', 404);
  if (w.decisions.some(d => d.experimentId === exp.id)) throw new SimulationError('По этому сравнению решение уже принято', 409);
  if (exp.baseRevision !== w.revision) throw Object.assign(new SimulationError(`Снимок устарел: сравнение сделано в ${clock(exp.minute)}, смена с тех пор изменилась. Пересчитайте варианты.`, 409), { code: 'stale' });
  if (!option.available) throw new SimulationError(`Вариант недоступен: ${option.reason}`, 409);
  const problem = w.problem(exp.problemId);
  if (!problem || problem.status !== 'open') throw new SimulationError('Проблема уже закрыта — пересчитайте варианты', 409);
  const id = `DEC-${w.decisionSeq + 1}`;
  const commands = option.commands.map(c => c.action === 'job' ? { ...c, decisionId: id } : c);
  const test = w.clone(); for (const cmd of commands) test.command(cmd, 'operator'); // all-or-nothing: validate on a copy first
  w.decisionSeq++;
  const atApply = { minute: w.minute, counters: w.counters(), accepted: w.acceptedCount() };
  for (const cmd of commands) w.command(cmd, 'operator');
  const baseline = exp.options[0];
  const decision = { id, requestId, experimentId: exp.id, problemId: problem.id, optionId: option.id, title: option.title, appliedAt: w.minute, atApply, commands,
    hypothesesAtDecision: exp.hypotheses, expected: option.expected, range: option.range, perScenario: option.perScenario,
    baseline: option.id === 'continue' ? null : { title: baseline.title, expected: baseline.expected, range: baseline.range },
    alternatives: exp.options.filter(o => o.id !== option.id && o.expected).map(o => ({ optionId: o.id, title: o.title, expected: o.expected, range: o.range })) };
  w.decisions.push(decision); problem.decisionIds.push(id);
  problem.observations.push({ minute: w.minute, text: `Принято решение ${id}: ${option.title}` });
  w.log('decision_applied', `${id}: ${option.title} (по сравнению ${exp.id}; ожидаемая приёмка к 16:00 — ${option.expected.accepted})`, { problemId: problem.id, postId: problem.postId }, 'operator');
  decision.eventSeq = w.eventSeq;
  w.touch(); w.recordVersion++;
  return { duplicate: false, decision };
}
// Observed result of the chosen branch (from the real shift) vs simulated expectations. Alternatives stay "simulated".
export function decisionReport(w, d) {
  const observed = w.outcomeFrom(d.atApply.counters), problem = w.problem(d.problemId);
  const notes = [];
  if (problem?.kind === 'equipment') {
    const confirmed = Object.entries(problem.hypothesisStatus).filter(([, s]) => s.status === 'confirmed').map(([h]) => HYPOTHESES[h].title.toLowerCase());
    const weights = (d.hypothesesAtDecision || []).map(h => `${h.title.toLowerCase()} — ${Math.round(h.probability * 100)}%`).join(', ');
    if (weights) notes.push(`На момент решения причина не была известна: веса гипотез ${weights}. Ожидание — среднее по этим сценариям.`);
    if (confirmed.length) notes.push(`Позже проверкой подтверждено: ${confirmed.join(', ')}.`);
  }
  const fails = w.inspections.filter(i => i.result === 'fail' && i.minute >= d.appliedAt).length;
  notes.push(`После решения на контроле выявлено дефектов: ${fails}; в расчёте использовалась типовая доля брака 15%, а не скрытые дефекты.`);
  const later = w.events.filter(e => e.actor === 'operator' && e.seq > d.eventSeq).length;
  if (later) notes.push(`После решения оператор выполнил ещё ${later} действи${later === 1 ? 'е' : later < 5 ? 'я' : 'й'} — они тоже влияют на фактический результат.`);
  return { observed: { ...observed, final: w.finished, label: w.finished ? 'Наблюдаемый итог выбранной ветки (факт смены)' : `Наблюдается на ${clock(w.minute)}: смена продолжается, итог ещё не известен` },
    expectedLabel: 'Прогноз выбранного варианта на момент решения (симуляция)', alternativesLabel: 'Альтернативы — только симуляция на момент решения, не наблюдавшийся факт', notes };
}
export const decisionEndMinute = SHIFT;
