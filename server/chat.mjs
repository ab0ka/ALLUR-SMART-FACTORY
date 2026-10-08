// Dispatcher chat. The server picks a whitelisted function by intent (read state, diagnostics, compare options,
// prepare a proposal), builds facts from the engine, and optionally lets OpenAI/NVIDIA phrase them. The model never
// gets files, SQL, shell or URLs, never executes commands, and a reply with numbers absent from the facts is rejected.
import { clock, POSTS, SimulationError, JOB_KINDS } from './simulation.mjs';
import { compareOptions, decisionReport } from './decisions.mjs';
import { callModel, providerLabel, reasonText } from './ai.mjs';
import { assessRisk } from './risk-model.mjs';
import { CHECKS } from './equipment.mjs';

export const CHAT_LIMITS = { message: 500, history: 40, modelHistory: 6, llmIntervalMs: 4000 };
export const SUGGESTED = [
  'Что сейчас угрожает плану?',
  'Почему задерживается этот автомобиль?',
  'Что делать с этой машиной?',
  'На чём основана гипотеза неисправности?',
  'Какую проверку выполнить?',
  'Сравни ремонт сейчас и продолжение работы',
  'Что даст перевод на другой пост?',
  'Почему результат отличается от прогноза?',
];
const CONTEXT_TYPES = ['post', 'vehicle', 'order', 'problem'];
const POST_BY_CODE = Object.fromEntries(POSTS.map(p => [p.code.toLowerCase(), p.id]));
const f1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const pct = p => `${Math.round(p * 100)}%`;
const sign = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${f1(Math.abs(n))}`;

function intentOf(text) {
  const t = text.toLowerCase();
  if (/что (мне )?делать|что дальше|следующ(ее|ий) (шаг|действие)|какое действие/.test(t)) return 'next_action';
  if (/отлича|расход|не совпа|почему результат|почему факт/.test(t)) return 'forecast_diff';
  if (/перев(од|ести|ед)|друг(ой|ом) пост|параллельн/.test(t)) return 'transfer';
  if (/сравн|вариант|ремонт сейчас|что лучше|продолжени/.test(t)) return 'compare';
  if (/как(ую|ие) провер|что провер|провер(ку|ить)|диагност/.test(t)) return 'which_check';
  if (/основан|гипотез|причин[аыу]? (неисправ|отказ|откл)|почему (подъ|пост|сб)/.test(t)) return 'basis';
  if (/задерж|почему.*(стоит|жд[её]т|пауз)|где (авто|demo)|demo-\d{3}/.test(t)) return 'vehicle_delay';
  if (/угрож|план|риск|сводк|что происходит|ситуац|итог/.test(t)) return 'threat';
  return 'unknown';
}
// Entity references come from the message, then the selected context; every id is validated against state.
function resolveContext(w, message, context) {
  const out = {};
  if (context !== undefined && context !== null) {
    if (typeof context !== 'object' || !CONTEXT_TYPES.includes(context.type) || typeof context.id !== 'string' || context.id.length > 24) throw new SimulationError('Некорректный контекст чата');
    const exists = { post: () => w.posts[context.id] && Object.hasOwn(w.posts, context.id), vehicle: () => w.vehicle(context.id), order: () => w.order(context.id), problem: () => w.problem(context.id) }[context.type]();
    if (!exists) throw new SimulationError('Объект контекста не найден', 404);
    out[context.type] = context.id;
  }
  const t = message.toUpperCase();
  const vehicle = t.match(/DEMO-\d{3}/)?.[0], order = t.match(/ORD-\d{3}/)?.[0], problem = t.match(/PR-\d{1,3}/)?.[0];
  if (vehicle && w.vehicle(vehicle)) out.vehicle = vehicle;
  if (order && w.order(order)) out.order = order;
  if (problem && w.problem(problem)) out.problem = problem;
  for (const [code, id] of Object.entries(POST_BY_CODE)) if (message.toLowerCase().includes(code)) out.post = id;
  if (!out.problem && out.post) out.problem = w.problems.find(p => p.postId === out.post && p.status === 'open')?.id ?? w.problems.find(p => p.postId === out.post)?.id;
  if (!out.problem && out.vehicle) { const v = w.vehicle(out.vehicle); if (v.location.type === 'post') out.problem = w.problems.find(p => p.postId === v.location.id && p.status === 'open')?.id; }
  if (!out.vehicle && out.post) out.vehicle = w.posts[out.post].vehicleId ?? undefined;
  if (!out.vehicle && out.problem) out.vehicle = w.posts[w.problem(out.problem).postId].vehicleId ?? undefined;
  if (!out.problem) out.problem = w.problems.find(p => p.status === 'open')?.id;
  return out;
}
const ref = (type, id, label = id) => ({ type, id, label });
const postCode = (w, id) => POSTS.find(p => p.id === id).code;

// ---------------- Whitelisted tools ----------------
function threat(w) {
  const s = w.snapshot(), f = s.forecast, open = s.problems.filter(p => p.status === 'open');
  const lines = [`${clock(s.elapsed)}. План смены (задан оператором): ${s.plan.target}. Прогноз без новых вмешательств: ${f.projected}${f.low < f.high ? ` (по гипотезам ${f.low}–${f.high})` : ''}; ${f.gap >= 0 ? 'запас' : 'дефицит'} ${Math.abs(f.gap)}. Эталонная мощность симуляции: ${s.plan.reference?.total ?? '—'}. Принято сейчас: ${s.totals.accepted}.`];
  if (f.lateOrders.length) lines.push(`Под угрозой срок: ${f.lateOrders.join(', ')}.`);
  if (open.length) lines.push(`Неисправности оборудования: ${open.map(p => `${p.id} — ${p.title} (${p.postCode})`).join('; ')}.`);
  else lines.push('Неисправностей оборудования нет.');
  const cars = s.tasks.filter(t => t.object.type === 'vehicle');
  if (cars.length) lines.push(`Задачи по автомобилям: ${cars.map(t => `${t.object.id} — ${t.status} (${t.next.toLowerCase()})`).join('; ')}.`);
  if (f.limiting) lines.push(`Ограничивающий участок: ${f.limiting.name.toLowerCase()}, загрузка ${pct(f.limiting.utilization)}.`);
  return { text: lines.join(' '), refs: [...open.map(p => ref('problem', p.id, `${p.id} ${p.postCode}`)), ...f.lateOrders.map(id => ref('order', id))], facts: { time: clock(s.elapsed), planTarget: s.plan.target, forecast: { projected: f.projected, low: f.low, high: f.high, gap: f.gap, lateOrders: f.lateOrders }, reference: s.plan.reference?.total, accepted: s.totals.accepted, problems: open.map(p => ({ id: p.id, title: p.title, post: p.postCode })) }, tools: ['read_state'] };
}
function vehicleDelay(w, ctx) {
  if (!ctx.vehicle) return { text: 'Выберите автомобиль (в разделе «Автомобили» или на карте) или укажите ID, например DEMO-008.', refs: [], facts: {}, tools: [] };
  const v = w.vehicleView(w.vehicle(ctx.vehicle)), refs = [ref('vehicle', v.id), ref('order', v.orderId)];
  const lines = [`${v.id} (${v.modelName}, ${v.orderId}): ${v.status}.`];
  if (v.location.type === 'post') {
    const post = w.postView(POSTS.find(p => p.id === v.location.id)); refs.push(ref('post', post.id, post.code));
    if (post.reason) lines.push(`Пост ${post.code}: ${post.reason}.`);
    if (post.problemId) { refs.push(ref('problem', post.problemId)); lines.push(`Связанная проблема: ${post.problemId}.`); }
    if (v.currentOperation && v.currentOperation.completedAt === null) lines.push(`Операция «${v.currentOperation.operation}» выполнена на ${pct(v.currentOperation.progress)}, осталось ${f1(v.currentOperation.remaining)} мин работы (норматив ${v.currentOperation.norm} мин).`);
  } else if (v.state === 'waiting' || v.state === 'not_started' || v.state === 'rework_wait') {
    const stage = w.snapshot().stages.find(s => s.buffer.id === v.location.id), posts = stage ? stage.postIds.map(id => w.postView(POSTS.find(p => p.id === id))) : [];
    if (posts.length) lines.push(`Посты участка «${stage.name}»: ${posts.map(p => `${p.code} — ${p.vehicleId ? `${p.vehicleId}, ${pct(p.progress ?? 0)}` : 'свободен'}${['fault', 'maintenance'].includes(p.state) ? ` (${p.state === 'fault' ? 'неисправность' : 'работы техника'})` : ''}`).join('; ')}.`);
    posts.filter(p => p.problemId).forEach(p => refs.push(ref('problem', p.problemId)));
  }
  const na = v.nextAction;
  lines.push(`Следующее действие: ${na.title}.${na.why ? ` ${na.why}` : ''}${na.blockers.length ? ` Мешает: ${na.blockers.join('; ')}.` : ''}`);
  if (na.target) refs.push(ref(na.target.type, na.target.id, na.target.type === 'post' ? postCode(w, na.target.id) : na.target.id));
  const failed = v.inspections.filter(i => i.result === 'fail');
  if (failed.length) lines.push(`Контроль: ${failed.map(i => `${clock(i.minute)} не пройден — ${i.defect}`).join('; ')}${v.reworked ? '; доработка выполнена' : ''}.`);
  const events = w.events.filter(e => e.vehicleId === v.id).slice(-3);
  for (const e of events) refs.push(ref('event', String(e.seq), `${clock(e.minute)} событие`));
  return { text: lines.join(' '), refs, facts: { vehicle: { id: v.id, status: v.status, state: v.state, order: v.orderId, operation: v.currentOperation && { name: v.currentOperation.operation, progress: v.currentOperation.progress, remaining: v.currentOperation.remaining } }, lastEvents: events.map(e => `${clock(e.minute)} ${e.text}`) }, tools: ['read_state', 'read_history'] };
}
// What to do now: the server's next action for a vehicle, or the first tasks of the shift.
function nextStep(w, ctx) {
  if (ctx.vehicle) return vehicleDelay(w, ctx);
  const tasks = w.tasks().slice(0, 4);
  if (!tasks.length) return { text: 'Активных задач нет: оборудование без отклонений, машин на доработке нет, рисков срока по прогнозу нет.', refs: [], facts: { tasks: 0 }, tools: ['read_state'] };
  return { text: `Задачи смены (${w.tasks().length}): ${tasks.map(t => `${t.title} — ${t.status}; дальше: ${t.next.toLowerCase()}`).join('. ')}.`, refs: tasks.map(t => ref(t.object.type, t.object.id, t.object.type === 'post' ? postCode(w, t.object.id) : t.object.id)), facts: { tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, next: t.next })) }, tools: ['read_state', 'tasks'] };
}
function problemFacts(w, id, riskModel) {
  const p = w.problemView(w.problem(id)), risk = assessRisk(w, riskModel).items?.find(i => i.postId === p.postId) ?? null;
  return { p, risk };
}
function basis(w, ctx, riskModel) {
  if (!ctx.problem) return { text: 'Открытых проблем нет — гипотез неисправности сейчас не рассматривается.', refs: [], facts: {}, tools: ['get_diagnostics'] };
  const { p, risk } = problemFacts(w, ctx.problem, riskModel), refs = [ref('problem', p.id), ref('post', p.postId, p.postCode)];
  const lines = [`${p.id} (${p.title}) обнаружена в ${clock(p.detectedAt)}. ${p.observations[0].text}.`];
  if (p.kind === 'equipment') {
    if (p.latest) lines.push(`Сейчас (среднее за 30 мин): ${Object.values(p.latest).map(c => `${c.name.toLowerCase()} ${f1(c.mean)} ${c.unit} при норме ${c.nominal}`).join(', ')}.`);
    lines.push(`Гипотезы: ${p.hypotheses.map(h => `${h.title.toLowerCase()} — ${pct(h.probability)}${h.status === 'confirmed' ? ', подтверждена проверкой' : h.status === 'rejected' ? ', исключена' : ''}`).join('; ')}. Веса получены из согласия измерений с моделью каждой причины; это не установленный диагноз.`);
    if (p.checks.length) lines.push(`Проверки: ${p.checks.map(c => `${c.title} в ${clock(c.minute)} — ${f1(c.value)} ${c.unit}: ${c.text}`).join('; ')}.`);
    else lines.push('Диагностических проверок ещё не было.');
    if (risk && risk.probability !== undefined && risk.probability !== null) lines.push(`Модель риска (синтетическое обучение) оценивает вероятность отказа в ближайшие 30 мин в ${pct(risk.probability)}.`);
  } else lines.push(p.hypotheses[0].basis + '.');
  for (const j of p.jobs.slice(-2)) refs.push(ref('job', j.id, `${j.id} ${j.title}`));
  return { text: lines.join(' '), refs, facts: { problem: { id: p.id, title: p.title, detectedAt: clock(p.detectedAt), latest: p.latest, hypotheses: p.hypotheses.map(h => ({ title: h.title, probability: h.probability, status: h.status })), checks: p.checks.map(c => ({ title: c.title, value: c.value, unit: c.unit, text: c.text })) }, risk: risk?.probability ?? null }, tools: ['get_diagnostics'] };
}
function whichCheck(w, ctx) {
  if (!ctx.problem) return { text: 'Открытых проблем нет — проверка не требуется.', refs: [], facts: {}, tools: ['get_diagnostics'] };
  const p = w.problemView(w.problem(ctx.problem)), refs = [ref('problem', p.id), ref('post', p.postId, p.postCode)];
  if (p.kind !== 'equipment') return { text: `${p.id}: для ручного сценария неисправности диагностика не моделируется; доступен аварийный ремонт (${JOB_KINDS.repair_generic.duration} мин).`, refs, facts: {}, tools: ['get_diagnostics'] };
  const describe = c => `${c.title} — ${c.duration} мин, ${c.stopsPost ? 'пост останавливается' : 'без остановки поста'}; ${c.kind === 'pump_check' ? `ток насоса выше 13,5 А подтверждает износ насоса, ниже 12,8 А — исключает` : `падение давления больше 7 бар за 5 мин подтверждает утечку, меньше 5 — исключает`}`;
  const pending = p.availableChecks.filter(c => !c.done);
  const lines = [`Доступные проверки для ${p.postCode}: ${p.availableChecks.map(c => `${describe(c)}${c.done ? ' (уже выполнена)' : !c.ok ? ` (сейчас недоступна: ${c.reason})` : ''}`).join('; ')}.`];
  const best = pending.find(c => c.ok && !c.stopsPost) ?? pending.find(c => c.ok);
  let proposal = null;
  if (best) {
    lines.push(`Рекомендация: «${best.title.toLowerCase()}» — при двух гипотезах однозначный результат различает их, ${best.stopsPost ? 'но пост на время проверки остановится' : 'а производство не останавливается'}. После проверки ремонт по результату назначается автоматически, если результат однозначен.`);
    proposal = { kind: 'command', title: `${best.title} на ${p.postCode} + ремонт по результату`, consequences: `Техник ТЕХ-1 будет занят ${best.duration} мин${best.stopsPost ? `, ${p.postCode} остановится на это время` : ''}. При однозначном результате автоматически запланируется ремонт с резервом запчасти.`, command: { action: 'job', postId: p.postId, kind: best.kind, followUp: 'repair_by_result' } };
  } else lines.push('Новых проверок сейчас нет: все выполнены или недоступны. Сравните варианты ремонта.');
  return { text: lines.join(' '), refs, proposal, facts: { checks: p.availableChecks.map(c => ({ title: c.title, duration: c.duration, stopsPost: c.stopsPost, done: c.done, available: c.ok })) }, tools: ['get_diagnostics', 'prepare_proposal'] };
}
function optionLine(o, base) {
  if (!o.available) return `${o.title}: недоступно — ${o.reason}`;
  const e = o.expected, late = Object.keys(e.lateOrderRisk);
  return `${o.title}: приёмка ${f1(e.accepted)}${o.id === 'continue' ? '' : ` (${sign(o.delta.accepted)})`}, диапазон ${o.range.accepted[0]}–${o.range.accepted[1]}, простой ${f1(e.downtime)} мин, техник ${f1(e.techMinutes)} мин, затраты ${Math.round(e.cost)} усл. ед.${late.length ? `, риск срока: ${late.join(', ')}` : ''}`;
}
function bestOption(exp) {
  return exp.options.filter(o => o.available && o.expected).reduce((a, o) => !a || o.expected.accepted > a.expected.accepted + .05 || (Math.abs(o.expected.accepted - a.expected.accepted) <= .05 && o.expected.cost < a.expected.cost) ? o : a, null);
}
function compare(w, ctx) {
  if (!ctx.problem || w.problem(ctx.problem).status !== 'open') return { text: 'Нет открытой проблемы для сравнения вариантов.', refs: [], facts: {}, tools: [] };
  const exp = compareOptions(w, ctx.problem), base = exp.options[0], best = bestOption(exp);
  const lines = [`Сравнение ${exp.id} на ${clock(exp.minute)} (копии одного снимка; сценарии причин: ${exp.scenarios.map(s => `${Math.round(s.weight * 100)}%`).join(' / ')}):`, ...exp.options.map(o => `— ${optionLine(o, base)}`)];
  let proposal = null;
  if (best && best.id !== 'continue') {
    lines.push(`Наибольшая ожидаемая приёмка: «${best.title}». Решение принимаете вы — кнопка ниже применит вариант после проверки актуальности снимка.`);
    proposal = { kind: 'decision', experimentId: exp.id, optionId: best.id, title: best.title, consequences: `Будут выполнены команды: ${best.commands.map(c => c.action === 'job' ? JOB_KINDS[c.kind].title : c.action === 'transfer' ? `перевод ${c.vehicleId}` : c.action === 'hold' ? `снять ${postCode(w, c.postId)} с загрузки` : `приоритет ${c.orderId}`).join(', ')}. Ожидаемая приёмка ${f1(best.expected.accepted)} против ${f1(base.expected.accepted)} без вмешательства — это расчёт, не гарантия.` };
  } else lines.push('Ни один вариант не превосходит продолжение работы по ожидаемой приёмке.');
  return { text: lines.join('\n'), refs: [ref('experiment', exp.id), ref('problem', exp.problemId)], proposal, facts: { experiment: exp.id, options: exp.options.map(o => ({ title: o.title, available: o.available, reason: o.reason, expected: o.expected && { accepted: o.expected.accepted, downtime: o.expected.downtime, cost: o.expected.cost, techMinutes: o.expected.techMinutes }, delta: o.delta?.accepted, range: o.range?.accepted })) }, tools: ['compare_options', 'prepare_proposal'] };
}
function transfer(w, ctx) {
  if (!ctx.problem || w.problem(ctx.problem).status !== 'open') return { text: 'Перевод имеет смысл для поста с открытой проблемой; сейчас таких нет.', refs: [], facts: {}, tools: [] };
  const exp = compareOptions(w, ctx.problem), t = exp.options.find(o => o.id === 'transfer'), base = exp.options[0];
  const refs = [ref('experiment', exp.id), ref('problem', exp.problemId)];
  if (!t.available) return { text: `Перевод сейчас невозможен: ${t.reason}. Эффект перевода на занятый пост не оценивается.`, refs, facts: { transfer: { available: false, reason: t.reason } }, tools: ['compare_options'] };
  return { text: `${optionLine(t, base)}. Для сравнения — без вмешательства: приёмка ${f1(base.expected.accepted)}.`, refs, proposal: { kind: 'decision', experimentId: exp.id, optionId: t.id, title: t.title, consequences: 'Автомобиль переедет на параллельный пост с сохранением остатка операции; освободившийся пост обслуживается техником.' }, facts: { transfer: { title: t.title, expected: t.expected.accepted, delta: t.delta.accepted, baseline: base.expected.accepted } }, tools: ['compare_options', 'prepare_proposal'] };
}
function forecastDiff(w) {
  const d = w.decisions.at(-1);
  if (!d) { const s = w.snapshot(); return { text: `Решений ещё не принималось. Текущий прогноз ${s.forecast.projected} отличается от плана ${s.plan.target} и эталонной мощности ${s.plan.reference?.total ?? '—'}, потому что учитывает открытые проблемы, фактические очереди и типовую долю брака. ${s.forecast.method}`, refs: [], facts: { forecast: s.forecast.projected, plan: s.plan.target }, tools: ['read_state'] }; }
  const r = decisionReport(w, d);
  return { text: `${d.id} («${d.title}», ${clock(d.appliedAt)}): ожидалась приёмка ${f1(d.expected.accepted)} к 16:00 (диапазон ${d.range.accepted[0]}–${d.range.accepted[1]}). ${r.observed.label}: принято ${r.observed.accepted}, простой ${r.observed.downtime} мин, техник ${r.observed.techMinutes} мин. ${r.notes.join(' ')}`, refs: [ref('decision', d.id), ref('problem', d.problemId)], facts: { decision: d.id, expected: d.expected.accepted, range: d.range.accepted, observed: { accepted: r.observed.accepted, final: r.observed.final, downtime: r.observed.downtime }, notes: r.notes }, tools: ['read_state', 'decision_report'] };
}
// Numbers in a model reply must already be present in the facts, the question or the reply's own entity ids.
export function numbersSupported(text, facts, question) {
  const allowed = new Set([...(JSON.stringify(facts) + ' ' + question).matchAll(/\d+(?:[.,]\d+)?/g)].map(m => m[0].replace(',', '.')).flatMap(x => [x, String(Number(x)), String(Math.round(Number(x) * 100))]));
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(m => m[0].replace(',', '.')).every(n => Number(n) <= 10 || allowed.has(n) || allowed.has(String(Number(n))));
}
export async function answerChat(w, body, { aiOptions = {}, llm = { busy: false, last: 0 }, riskModel = null } = {}) {
  // Credential-like strings typed by mistake are masked before use or storage.
  const message = typeof body?.message === 'string' ? body.message.trim().replace(/(?:sk-[A-Za-z0-9_-]{8,}|nvapi-[A-Za-z0-9_-]{8,}|Bearer\s+\S{8,})/g, '[скрыто]') : '';
  if (!message) throw new SimulationError('Пустое сообщение');
  if (message.length > CHAT_LIMITS.message) throw new SimulationError(`Сообщение длиннее ${CHAT_LIMITS.message} символов`);
  const ctx = resolveContext(w, message, body.context);
  const intent = intentOf(message);
  const handlers = { next_action: () => nextStep(w, ctx), threat: () => threat(w), vehicle_delay: () => vehicleDelay(w, ctx), basis: () => basis(w, ctx, riskModel), which_check: () => whichCheck(w, ctx), compare: () => compare(w, ctx), transfer: () => transfer(w, ctx), forecast_diff: () => forecastDiff(w) };
  const local = handlers[intent]?.() ?? null;
  const configured = aiOptions.provider && aiOptions.provider !== 'local' && aiOptions.key?.trim();
  let text = local?.text ?? null, source = 'local', note = null;
  const facts = local ? local.facts : { ...threat(w).facts, context: ctx };
  if (configured) {
    if (llm.busy || Date.now() - llm.last < CHAT_LIMITS.llmIntervalMs) note = `${providerLabel(aiOptions.provider)}: ограничение частоты — ответ сформирован локально`;
    else {
      llm.busy = true; llm.last = Date.now();
      try {
        const history = w.chat.slice(-CHAT_LIMITS.modelHistory).map(m => `${m.role === 'user' ? 'Оператор' : 'Ассистент'}: ${m.text.slice(0, 400)}`).join('\n');
        const r = await callModel(aiOptions, { maxTokens: 500,
          instructions: 'Ты ассистент диспетчера учебной мастерской Allur Smart Factory. Все данные синтетические. Отвечай по-русски, до 120 слов, обычным текстом. Используй только факты из JSON. Не придумывай числа, KPI, стоимость, точность моделей или результаты. Называй ID (DEMO-xxx, ORD-xxx, PR-x, СБ-x) как в фактах. Не выполняй и не обещай действий: применение решений делает оператор кнопкой подтверждения. Гипотезы не называй диагнозом.',
          input: `История:\n${history}\n\nВопрос: ${message}\n\nФакты (JSON):\n${JSON.stringify(facts)}` });
        if (r.ok && numbersSupported(r.text, facts, message)) { text = r.text; source = aiOptions.provider; }
        else note = `${reasonText(r.ok ? 'unverified_numbers' : r.reason, aiOptions.provider)} — ответ сформирован локально`;
      } finally { llm.busy = false; }
    }
  }
  if (!text) text = configured ? 'Свободный вопрос не удалось обработать моделью. Выберите один из предложенных вопросов — на них отвечает локальная логика по данным смены.' : 'Без подключённой модели (OpenAI/NVIDIA) свободные вопросы недоступны. Локально я отвечаю на предложенные вопросы: угрозы плану, задержка автомобиля, основания гипотез, выбор проверки, сравнение вариантов, перевод на другой пост, отличие результата от прогноза.';
  const refs = local?.refs ?? Object.entries(ctx).filter(([, v]) => v).map(([type, id]) => ref(type, id, type === 'post' ? postCode(w, id) : id));
  const now = w.minute;
  w.chat.push({ id: `MSG-${w.chat.length + 1}-${now}`, role: 'user', text: message, context: body.context ?? null, minute: now });
  const reply = { id: `MSG-${w.chat.length + 1}-${now}`, role: 'assistant', text, refs, proposal: local?.proposal ?? null, source, note, intent, tools: local?.tools ?? [], minute: now, revision: w.revision };
  w.chat.push(reply);
  while (w.chat.length > CHAT_LIMITS.history) w.chat.shift();
  w.recordVersion++;
  return reply;
}
export const CHECK_TITLES = Object.fromEntries(Object.entries(CHECKS).map(([k, c]) => [k, c.title]));
