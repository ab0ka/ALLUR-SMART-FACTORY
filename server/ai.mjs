import { clock } from './simulation.mjs';
const pct = n => `${Math.round(n * 100)}%`;
// Recommendations are derived from state only: incidents, idle parallel posts and the limiting stage.
export function recommendations(s) {
  const out = [];
  for (const i of s.incidents.filter(i => i.status === 'active')) {
    const post = s.posts.find(p => p.id === i.postId);
    const spare = s.posts.find(p => p.stage === post.stage && p.id !== post.id && !p.vehicleId && p.state !== 'fault');
    if (i.kind === 'breakdown' && post.vehicleId && post.progress < 1 && spare) out.push(`Перевести ${post.vehicleId} с ${post.code} на свободный ${spare.code}: остаток операции сохранится.`);
    else out.push(`${post.code}: ${i.advice}`);
  }
  const f = s.forecast;
  if (f.limiting && !out.length) out.push(`Следить за участком «${f.limiting.name}»: загрузка до конца смены ${pct(f.limiting.utilization)}, он ограничивает выпуск.`);
  return out;
}
export function snapshotForAI(s) {
  return {
    synthetic: true, time: clock(s.elapsed), accepted: s.totals.accepted, plan: s.plan?.total, planNow: s.plan?.now, totals: s.totals,
    forecast: { projected: s.forecast.projected, low: s.forecast.low, high: s.forecast.high, gap: s.forecast.gap, limiting: s.forecast.limiting, constraints: s.forecast.constraints, scenarios: s.forecast.scenarios },
    incidents: s.incidents.filter(i => i.status !== 'resolved').map(({ id, title, postCode, stageName, status, start, expires, cause, vehicleId }) => ({ id, title, postCode, stageName, status, start: clock(start), expectedRecovery: clock(expires), cause, vehicleId })),
    queues: s.stages.map(st => ({ buffer: st.buffer.name, waiting: st.buffer.vehicleIds.length, capacity: st.buffer.capacity })),
    posts: s.posts.map(p => ({ code: p.code, state: p.state, vehicleId: p.vehicleId, availability: Math.round(p.metrics.availability * 100) })),
    recommendations: recommendations(s),
  };
}
export function localExplanation(s) {
  const f = s.forecast, t = s.totals, open = s.incidents.filter(i => i.status !== 'resolved');
  const lines = ['Синтетические данные учебной мастерской, не показатели Allur.'];
  lines.push(`${clock(s.elapsed)}: принято контролем ${t.accepted} из плана смены ${f.plan} (по эталонному прогону к этому времени — ${s.plan.now}). В работе ${t.inProcess}, ещё не начаты ${t.notStarted}, отгружено ${t.shipped}.`);
  lines.push(s.finished ? `Смена завершена. Итог — ${t.accepted} принятых автомобилей; ${t.created - t.accepted} остаются незавершёнными.` : `Прогноз к 16:00 — ${f.projected} (${f.gap >= 0 ? 'запас' : 'дефицит'} ${Math.abs(f.gap)} к плану)${f.low < f.projected ? `; если активные инциденты не устранят до конца смены — ${f.low}` : ''}.`);
  if (f.limiting) lines.push(`Ограничивающий участок до конца смены — ${f.limiting.name.toLowerCase()}, загрузка ${pct(f.limiting.utilization)}.`);
  if (open.length) lines.push(open.map(i => `${i.title} (${i.status === 'unresolved' ? 'не устранён к концу смены' : `до ${clock(i.expires)}`}): ${i.cause}.`).join('\n'));
  else lines.push('Активных инцидентов нет.');
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
};
export function httpReason(status) {
  if (status === 401 || status === 403) return 'auth_rejected';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'http_error';
}
export function fallback(s, reason) { return { source: 'local', reason, message: `${reasons[reason] || 'NVIDIA временно недоступна'} · локальный разбор синтетических данных`, text: localExplanation(s), revision: s.revision, minute: s.elapsed, synthetic: true }; }
export async function explain(s, { key = '', model = 'meta/llama-3.3-70b-instruct', fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!key.trim()) return fallback(s, 'missing_key');
  const controller = new AbortController();
  let timer;
  try {
    const request = (async () => {
      const response = await fetchImpl('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: .2, max_tokens: 650, stream: false,
          messages: [
            { role: 'system', content: 'Ты помощник учебной производственной мастерской Allur Smart Factory. Все автомобили, посты, нормативы и события синтетические, не реальные данные Allur. Ответ по-русски, до 200 слов, обычный текст. Объясни только полученные числа выпуска, прогноза, очередей и инцидентов. Не пересчитывай и не изменяй их. Причины — гипотезы сценария, не диагноз. Предложи 2 конкретных проверочных действия; не давай команды оборудованию. Не представляй эвристический диапазон как статистическую достоверность.' },
            { role: 'user', content: JSON.stringify(snapshotForAI(s)) },
          ] }),
      });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return fallback(s, httpReason(response.status)); }
      // Bound vendor output before parsing. Never expose response errors or headers.
      const reader = response.body?.getReader();
      if (!reader) return fallback(s, 'invalid_response');
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 65536) { await reader.cancel(); return fallback(s, 'invalid_response'); }
        chunks.push(value);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fallback(s, 'invalid_response'); }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length < 10) return fallback(s, 'invalid_response');
      const safe = content.split(key).join('[секрет скрыт]').replace(/nvapi-[A-Za-z0-9_-]+/g, '[секрет скрыт]');
      return { source: 'nvidia', reason: null, message: 'Объяснение NVIDIA по синтетическому снимку · проверьте по числам выше', text: safe.slice(0, 5000), revision: s.revision, minute: s.elapsed, synthetic: true };
    })();
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); });
    return await Promise.race([request, deadline]);
  } catch { return fallback(s, controller.signal.aborted ? 'timeout' : 'network'); }
  finally { clearTimeout(timer); }
}
