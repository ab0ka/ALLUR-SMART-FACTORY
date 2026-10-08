import { clock } from './simulation.mjs';
import { AI_MODELS } from './ai-config.mjs';
const pct = n => `${Math.round(n * 100)}%`;
const num = n => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
// Recommendations are derived from state only: open problems, idle parallel posts and the limiting stage.
export function recommendations(s) {
  const out = [];
  for (const p of s.problems.filter(p => p.status === 'open')) {
    const post = s.posts.find(x => x.id === p.postId);
    const spare = s.posts.find(x => x.stage === post.stage && x.id !== post.id && !x.vehicleId && !['fault', 'maintenance'].includes(x.state) && !x.problemId && !x.hold);
    if (post.vehicleId && post.progress < 1 && spare && ['fault', 'maintenance'].includes(post.state)) out.push(`Перевести ${post.vehicleId} с ${post.code} на свободный ${spare.code}: остаток операции сохранится.`);
    if (p.kind === 'equipment') {
      const next = p.availableChecks.find(c => !c.done && c.ok);
      out.push(next ? `${p.id}: выполнить «${next.title.toLowerCase()}» (${next.duration} мин${next.stopsPost ? ', пост останавливается' : ', без остановки поста'}) и сравнить варианты в «Диспетчере смены».` : `${p.id}: сравнить варианты ремонта в «Диспетчере смены».`);
    } else out.push(`${p.id}: ${post.code} — назначить ремонт или сравнить варианты в «Диспетчере смены».`);
  }
  const f = s.forecast;
  if (f.limiting && !out.length) out.push(`Следить за участком «${f.limiting.name}»: загрузка до конца смены ${pct(f.limiting.utilization)}, он ограничивает выпуск.`);
  return out;
}
export function snapshotForAI(s) {
  return {
    synthetic: true, time: clock(s.elapsed), accepted: s.totals.accepted, planTarget: s.plan.target, referenceCapacity: s.plan.reference?.total ?? null, totals: s.totals, quality: s.quality,
    forecast: { projected: s.forecast.projected, expected: s.forecast.expected, low: s.forecast.low, high: s.forecast.high, gap: s.forecast.gap, limiting: s.forecast.limiting, lateOrders: s.forecast.lateOrders, scenarios: s.forecast.scenarios },
    problems: s.problems.filter(p => p.status !== 'resolved').map(p => ({ id: p.id, title: p.title, postCode: p.postCode, status: p.status, detectedAt: clock(p.detectedAt), vehicleIds: p.vehicleIds, orderIds: p.orderIds, hypotheses: p.hypotheses.map(h => ({ title: h.title, probability: h.probability, status: h.status })), checks: p.checks.map(c => ({ title: c.title, value: c.value, unit: c.unit, text: c.text })) })),
    queues: s.stages.map(st => ({ buffer: st.buffer.name, waiting: st.buffer.vehicleIds.length, capacity: st.buffer.capacity })),
    posts: s.posts.map(p => ({ code: p.code, state: p.state, vehicleId: p.vehicleId, availability: Math.round(p.metrics.availability * 100) })),
    recommendations: recommendations(s),
  };
}
export function localExplanation(s) {
  const f = s.forecast, t = s.totals, open = s.problems.filter(p => p.status !== 'resolved');
  const lines = ['Синтетические данные учебной мастерской, не показатели Allur.'];
  lines.push(`${clock(s.elapsed)}: принято контролем ${t.accepted} при плане смены ${s.plan.target} (план задан оператором; эталонная мощность симуляции — ${s.plan.reference?.total ?? '—'}). В работе ${t.inProcess}, из них на доработке ${t.rework}; не начаты ${t.notStarted}; отгружено ${t.shipped}.`);
  if (s.quality.firstInspections) lines.push(`Качество: с первого предъявления принято ${s.quality.firstPass} из ${s.quality.firstInspections}; после доработки принято ${s.quality.reworkedAccepted}.`);
  lines.push(s.finished ? `Смена завершена. Итог — ${t.accepted} принятых автомобилей; ${t.created - t.accepted} остаются незавершёнными.` : `Прогноз к 16:00 без новых вмешательств — ${f.projected} (${f.gap >= 0 ? 'запас' : 'дефицит'} ${Math.abs(f.gap)} к плану)${f.low < f.high ? `; по гипотезам причин — от ${f.low} до ${f.high}` : ''}.${f.lateOrders.length ? ` Под угрозой срок: ${f.lateOrders.join(', ')}.` : ''}`);
  if (f.limiting) lines.push(`Ограничивающий участок до конца смены — ${f.limiting.name.toLowerCase()}, загрузка ${pct(f.limiting.utilization)}.`);
  if (open.length) lines.push(open.map(p => `${p.id} ${p.title} (${p.status === 'unresolved' ? 'не устранена к концу смены' : `обнаружена в ${clock(p.detectedAt)}`})${p.hypotheses?.length && p.hypotheses[0].probability !== null ? `: гипотезы — ${p.hypotheses.map(h => `${h.title.toLowerCase()} ${pct(h.probability)}`).join(', ')}` : ''}.`).join('\n'));
  else lines.push('Открытых проблем нет.');
  const recs = recommendations(s);
  if (recs.length) lines.push('Рекомендации:\n' + recs.map(r => `— ${r}`).join('\n'));
  lines.push(`${f.method} ${f.assumption}`);
  return lines.join('\n\n');
}
const reasons = {
  missing_key: 'Ключ NVIDIA не настроен',
  auth_rejected: 'NVIDIA отклонила ключ (HTTP 401/403)',
  rate_limited: 'Лимит запросов NVIDIA исчерпан (HTTP 429)',
  server_error: 'Ошибка на стороне NVIDIA (HTTP 5xx)',
  http_error: 'NVIDIA вернула неожиданный HTTP-статус',
  timeout: 'NVIDIA не ответила за отведённое время',
  network: 'Сеть или NVIDIA недоступны',
  invalid_response: 'Некорректный ответ NVIDIA',
  busy: 'Ограничение частоты: повторите AI-запрос через несколько секунд',
  offline: 'Выбран локальный режим',
  invalid_configuration: 'Неизвестный AI-провайдер',
  unverified_numbers: 'Ответ NVIDIA отклонён: в нём были числа, которых нет в расчёте',
};
export function httpReason(status) {
  if (status === 401 || status === 403) return 'auth_rejected';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'http_error';
}
const providerName = provider => provider === 'openai' ? 'OpenAI' : provider === 'nvidia' ? 'NVIDIA' : 'AI';
export const providerLabel = providerName;
export const reasonText = (reason, provider) => (reasons[reason] || 'NVIDIA временно недоступна').replaceAll('NVIDIA', providerName(provider));
export function fallback(s, reason, provider = 'nvidia') { return { source: 'local', reason, message: `${reasonText(reason, provider)} · локальный разбор синтетических данных`, text: localExplanation(s), revision: s.revision, minute: s.elapsed, synthetic: true }; }
// One bounded vendor call shared by explanation and chat. Returns { ok, text } or { ok: false, reason }.
// Only server-built text is sent; the key stays in the Authorization header and is redacted from any output.
export async function callModel({ provider = 'nvidia', key = '', model = AI_MODELS[provider], fetchImpl = fetch, timeoutMs = provider === 'openai' ? 20000 : 8000 } = {}, { instructions, input, maxTokens = 900 }) {
  if (provider === 'local') return { ok: false, reason: 'offline' };
  if (!['openai', 'nvidia'].includes(provider)) return { ok: false, reason: 'invalid_configuration' };
  key = (key || '').trim();
  if (!key) return { ok: false, reason: 'missing_key' };
  const controller = new AbortController();
  let timer;
  try {
    const request = (async () => {
      const openai = provider === 'openai';
      const body = openai
        ? { model, instructions, input, max_output_tokens: maxTokens, store: false, stream: false }
        : { model, temperature: .2, max_tokens: Math.min(650, maxTokens), stream: false, messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }] };
      const response = await fetchImpl(openai ? 'https://api.openai.com/v1/responses' : 'https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST', signal: controller.signal, redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { ok: false, reason: httpReason(response.status) }; }
      // Bound vendor output before parsing. Never expose response errors or headers.
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, reason: 'invalid_response' };
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 65536) { await reader.cancel(); return { ok: false, reason: 'invalid_response' }; }
        chunks.push(value);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { ok: false, reason: 'invalid_response' }; }
      if (openai && (data?.status !== 'completed' || data?.error || !Array.isArray(data?.output))) return { ok: false, reason: 'invalid_response' };
      const content = openai
        ? data.output.filter(item => item?.type === 'message' && item.role === 'assistant' && Array.isArray(item.content))
          .flatMap(item => item.content).filter(part => part?.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n')
        : data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length < 10) return { ok: false, reason: 'invalid_response' };
      return { ok: true, text: content.split(key).join('[секрет скрыт]').replace(/(?:nvapi-|sk-)[A-Za-z0-9_-]+/g, '[секрет скрыт]').slice(0, 5000) };
    })();
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); });
    return await Promise.race([request, deadline]);
  } catch { return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' }; }
  finally { clearTimeout(timer); }
}
const EXPLAIN_INSTRUCTIONS = 'Ты помощник учебной производственной мастерской Allur Smart Factory. Все автомобили, посты, нормативы и события синтетические, не реальные данные Allur. Ответ по-русски, до 200 слов, обычный текст. Объясни только полученные числа выпуска, прогноза, очередей и проблем. Не пересчитывай и не изменяй их. Причины — гипотезы, не диагноз. Предложи 2 конкретных проверочных действия; не давай команды оборудованию. Не представляй сценарный диапазон как статистическую достоверность.';
export async function explain(s, options = {}) {
  const provider = options.provider ?? 'nvidia';
  const r = await callModel(options, { instructions: EXPLAIN_INSTRUCTIONS, input: JSON.stringify(snapshotForAI(s)), maxTokens: 900 });
  if (!r.ok) return fallback(s, r.reason, provider);
  return { source: provider, reason: null, message: `Объяснение ${providerName(provider)} по синтетическому снимку · проверьте по числам выше`, text: r.text, revision: s.revision, minute: s.elapsed, synthetic: true };
}
export { num as formatNumber };
