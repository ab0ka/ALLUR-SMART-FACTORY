// ---------- Video analytics: playback of pre-computed analysis results (not a live stream) ----------
// Local files stay in the browser (object URL for the video, File.text() for the JSON). Every number comes from
// video-analytics.js; this part only draws it and keeps the picture in step with the video time.
import * as VA from './video-analytics.js';
const va = { data: null, rows: [], series: [], videoUrl: null, videoFile: '', t: 0, playing: false, raf: 0, last: 0, track: null, demoTried: false, msgs: { errors: [], warnings: [] } };
const vaVideo = $('va-video'), VA_ZONE_CLASSES = 4, VA_MAX_JSON = 50 * 1024 * 1024;
const vaHasVideo = () => Boolean(va.videoUrl) && vaVideo.readyState >= 1;
const vaDuration = () => va.data?.source.durationSec ?? 0;
const vaNow = () => vaHasVideo() ? vaVideo.currentTime : va.t;

function renderVideo() {
  // Stable address for demo recordings: #video/demo opens the synthetic fixture.
  if (location.hash === '#video/demo' && !va.demoTried) { va.demoTried = true; vaLoadDemo(); }
  vaHeaderLabel();
}
// The header badge «Синтетические данные» describes the factory simulation; next to an external recording it would
// contradict the screen's own «Не данные Allur» label, so it is hidden while such a recording is shown.
function vaHeaderLabel() { const b = document.querySelector('.topbar .synthetic'); if (b) b.hidden = view === 'video' && Boolean(va.data) && !va.data.source.synthetic; }
function vaMessages() {
  const { errors, warnings } = va.msgs;
  $('va-messages').innerHTML = (va.videoError ? `<div class="va-errors" role="alert">${esc(va.videoError)}</div>` : '')
    + (errors.length ? `<div class="va-errors" role="alert"><b>Файл результатов не принят.</b>${va.data ? ` Ниже по-прежнему показаны ранее загруженные результаты «${esc(va.data.source.title)}».` : ''}<ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '')
    + (warnings.length ? `<ul class="va-warnings">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '');
}
function vaAccept(result, origin) {
  va.msgs = { errors: result.errors, warnings: [...result.warnings] };
  if (!result.data) { vaMessages(); return false; }
  vaPause();
  va.data = result.data; va.rows = VA.visitRows(va.data); va.series = VA.occupancySeries(va.data); va.track = null; va.t = 0;
  if (origin) va.msgs.warnings.unshift(origin);
  vaCheckVideo(); vaMessages(); vaRenderAll(); vaSeek(0); vaHeaderLabel();
  return true;
}
async function vaLoadDemo() {
  try { const r = await fetch('/video-fixture.json', { signal: AbortSignal.timeout(8000) }); vaAccept(VA.parseResults(await r.text()), 'Загружена синтетическая фикстура: это пример формата, а не результат компьютерного зрения.'); }
  catch (e) { va.msgs = { errors: [`Не удалось открыть фикстуру: ${e.message}`], warnings: [] }; vaMessages(); }
}
$('va-demo').addEventListener('click', vaLoadDemo);
$('va-json-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > VA_MAX_JSON) { va.msgs = { errors: [`Файл ${file.name} больше 50 МБ`], warnings: [] }; vaMessages(); return; }
  vaAccept(VA.parseResults(await file.text()), null);
});
$('va-video-file').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  vaPause();
  if (va.videoUrl) URL.revokeObjectURL(va.videoUrl);
  va.videoUrl = URL.createObjectURL(file); va.videoFile = file.name;
  vaVideo.src = va.videoUrl; vaVideo.hidden = false; $('va-stage').classList.remove('no-video');
});
vaVideo.addEventListener('loadedmetadata', () => { va.videoError = ''; vaCheckVideo(); vaMessages(); vaSeek(va.t); });
vaVideo.addEventListener('error', () => { if (!va.videoUrl) return; va.videoError = `Браузер не может воспроизвести видео «${va.videoFile}». Попробуйте MP4 (H.264) или WebM.`; vaMessages(); });
// The loaded video and the results must describe the same recording; mismatches are shown, never hidden.
function vaCheckVideo() {
  if (!va.data || !va.videoUrl) return;
  const s = va.data.source, w = va.msgs.warnings.filter(x => !x.startsWith('Видео:'));
  if (va.videoFile && va.videoFile !== s.fileName) w.push(`Видео: выбран файл «${va.videoFile}», а результаты относятся к «${s.fileName}».`);
  if (vaVideo.readyState >= 1) {
    if (Number.isFinite(vaVideo.duration) && Math.abs(vaVideo.duration - s.durationSec) > 1) w.push(`Видео: длительность ${VA.fmtSec(vaVideo.duration)}, в результатах ${VA.fmtSec(s.durationSec)} — рамки могут не совпадать с кадром.`);
    if (vaVideo.videoWidth && Math.abs(vaVideo.videoWidth / vaVideo.videoHeight - s.width / s.height) > .01) w.push(`Видео: пропорции кадра ${vaVideo.videoWidth}×${vaVideo.videoHeight} отличаются от результатов ${s.width}×${s.height}.`);
  }
  va.msgs.warnings = w;
}

// ----- static parts: source, delays, chart, tables (redrawn only when the data changes) -----
const vaHead = '<thead><tr><th>Объект</th><th>Зона</th><th>Начало</th><th>Конец</th><th>Наблюдаемая длительность</th><th>Порог</th><th>Превышение</th><th>Статус</th></tr></thead>';
const vaObserved = r => `${r.lowerBound ? '≥ ' : ''}${VA.fmtSec(r.observedSec)}`;
const vaExceed = r => r.exceeded ? `${r.lowerBound ? '≥ ' : '+'}${VA.fmtSec(r.exceedSec)}` : '—';
function vaRenderAll() {
  const d = va.data, s = d.source, a = d.analysis, sum = VA.summarize(va.rows), url = s.url && VA.safeUrl(s.url);
  $('va-body').hidden = false; $('va-seek').max = String(s.durationSec);
  $('va-source').innerHTML = `<div class="va-badges"><span class="va-badge replay">Воспроизведение результатов анализа</span><span class="va-badge ${s.synthetic ? 'synthetic' : 'external'}">${esc(VA.dataLabel(d))}</span><span class="va-badge mode">${esc(VA.MODES[a.mode])}</span></div>
    <h2 class="panel-title">${esc(s.title)}</h2>
    <dl class="va-meta"><dt>Файл</dt><dd>${esc(s.fileName)}</dd><dt>Источник</dt><dd>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` : 'не указан'}</dd><dt>Лицензия</dt><dd>${esc(s.license)}</dd>
    <dt>Запись</dt><dd>${VA.fmtSec(s.durationSec)} · ${s.width}×${s.height}</dd><dt>Анализ</dt><dd>${a.mode === 'model' ? `модель ${esc(a.model ?? 'не указана')}` : a.mode === 'manual' ? 'ручная разметка' : 'синтетические данные, не компьютерное зрение'} · ${String(a.sampleFps).replace('.', ',')} кадр/с${a.processingSec != null ? ` · обработка ${VA.fmtSec(a.processingSec)}` : ''}</dd>
    <dt>Зоны</dt><dd>${d.zones.map((z, i) => `<span class="va-zone-key z${i % VA_ZONE_CLASSES}">${esc(z.name)}: порог ${VA.fmtSec(z.thresholdSec)} (${esc(VA.thresholdLabel(z))})</span>`).join(' ')}</dd></dl>
    <p class="va-sum">Посещений: <b>${sum.visits}</b> · завершено: <b>${sum.finished}</b> · незавершено: <b>${sum.unfinished}</b> · с превышением порога: <b>${sum.exceeded}</b>${sum.exceeded ? ` · наибольшее: <b>${VA.fmtSec(sum.maxExceedSec)}</b>` : ''}</p>`;
  const dl = VA.delays(va.rows);
  $('va-delays').innerHTML = dl.length ? dl.map(r => `<li class="va-delay${r.lowerBound ? ' open' : ''}" data-visit="${esc(r.id)}"><p>${esc(r.text)}</p><p class="fine-print">${esc(r.caveat)}</p><p class="fine-print">Возможные причины (гипотезы, не подтверждены данными): ${r.hypotheses.map(esc).join('; ')}.</p>
    <div class="va-delay-actions"><button type="button" class="link" data-va-seek="${r.startSec}" data-va-track="${esc(r.trackId)}">К началу ${VA.fmtClock(r.startSec)}</button><button type="button" class="link" data-va-seek="${r.startSec + r.thresholdSec}" data-va-track="${esc(r.trackId)}">К моменту превышения ${VA.fmtClock(r.startSec + r.thresholdSec)}</button></div></li>`).join('')
    : '<li class="fine-print">Превышений порога в результатах нет.</li>';
  const row = r => `<tr data-visit="${esc(r.id)}" class="${r.exceeded ? 'exceeded' : ''}"><td><button type="button" class="link" data-va-seek="${r.startSec}" data-va-track="${esc(r.trackId)}" aria-label="Перейти к объекту ${esc(r.trackId)} на ${VA.fmtClock(r.startSec)}">${esc(r.trackId)}</button></td><td>${esc(r.zoneName)}</td><td>${VA.fmtClock(r.startSec)}</td><td>${r.endSec == null ? '—' : VA.fmtClock(r.endSec)}</td><td>${vaObserved(r)}</td><td>${VA.fmtSec(r.thresholdSec)}</td><td>${vaExceed(r)}</td><td>${esc(VA.STATUS[r.status])}</td></tr>`;
  const done = va.rows.filter(r => r.finished), open = va.rows.filter(r => !r.finished);
  $('va-visits').innerHTML = vaHead + `<tbody>${done.map(row).join('') || '<tr><td colspan="8">Завершённых посещений нет</td></tr>'}</tbody>`;
  $('va-open').innerHTML = vaHead + `<tbody>${open.map(row).join('') || '<tr><td colspan="8">Незавершённых посещений нет</td></tr>'}</tbody>`;
  vaRenderChart(); vaRenderReport();
}
const VA_CHART = { x0: 44, x1: 890, y0: 170, y1: 14 };
function vaRenderChart() {
  const d = va.data, dur = vaDuration(), C = VA_CHART, max = Math.max(1, ...va.series.map(s => s.max));
  const X = t => C.x0 + (C.x1 - C.x0) * t / dur, Y = n => C.y0 - (C.y0 - C.y1) * n / max;
  let out = '';
  for (let n = 0; n <= max; n++) out += `<line x1="${C.x0}" x2="${C.x1}" y1="${Y(n).toFixed(1)}" y2="${Y(n).toFixed(1)}" class="va-gridline"/><text x="${C.x0 - 8}" y="${(Y(n) + 4).toFixed(1)}" class="va-axis end">${n}</text>`;
  const step = dur > 600 ? 120 : dur > 120 ? 30 : 10;
  for (let t = 0; t <= dur + 1e-6; t += step) out += `<text x="${X(t).toFixed(1)}" y="${C.y0 + 18}" class="va-axis mid">${VA.fmtClock(t).replace(/\.\d$/, '')}</text>`;
  va.series.forEach((s, i) => {
    let path = '', pen = false;
    for (const p of s.points) {
      if (p.n == null) { pen = false; continue; }
      if (!pen) { path += `M${X(p.t).toFixed(1)} ${Y(p.n).toFixed(1)}`; pen = true; }
      else path += `H${X(p.t).toFixed(1)}V${Y(p.n).toFixed(1)}`;
    }
    out += `<path d="${path}" class="va-line z${i % VA_ZONE_CLASSES}"/>`;
  });
  out += `<rect x="${C.x0}" y="${C.y1}" width="${C.x1 - C.x0}" height="${C.y0 - C.y1}" class="va-hit"/><line id="va-cursor" x1="${C.x0}" x2="${C.x0}" y1="${C.y1}" y2="${C.y0}" class="va-cursor"/>`;
  $('va-chart').innerHTML = out;
  $('va-chart-legend').innerHTML = d.zones.map((z, i) => `<span class="va-key z${i % VA_ZONE_CLASSES}">— ${esc(z.name)}</span>`).join('');
}
$('va-chart').addEventListener('click', e => {
  if (!va.data) return;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform($('va-chart').getScreenCTM().inverse());
  vaSeek(Math.min(1, Math.max(0, (p.x - VA_CHART.x0) / (VA_CHART.x1 - VA_CHART.x0))) * vaDuration());
});

// ----- time-dependent picture: overlay, cursor, highlighted rows (a pure function of the current time) -----
function vaDraw() {
  if (!va.data) return;
  const d = va.data, t = vaNow(), st = VA.stateAt(d, t), W = d.source.width, H = d.source.height, fs = Math.round(H * .032);
  const svg = $('va-overlay');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  let out = vaHasVideo() ? '' : `<rect width="${W}" height="${H}" class="va-blank"/><text x="${W / 2}" y="${H - fs}" font-size="${fs}" class="va-blank-text">Видео не загружено — показаны только результаты анализа</text>`;
  d.zones.forEach((z, i) => {
    const pts = z.polygon.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(' '), n = st.counts[z.id];
    out += `<polygon points="${pts}" class="va-zone z${i % VA_ZONE_CLASSES}"/><text x="${(z.polygon[0][0] * W + fs * .4).toFixed(1)}" y="${(z.polygon[0][1] * H + fs * 1.2).toFixed(1)}" font-size="${fs}" class="va-zone-label z${i % VA_ZONE_CLASSES}">${esc(z.name)} · ${n == null ? 'нет данных' : `видно: ${n}`}</text>`;
  });
  const limit = VA.staleAfter(d);
  if (st.frame && (!st.stale || st.ageSec <= limit * 3)) for (const o of st.objects) {
    const [x, y, w, h] = o.bbox, sel = va.track === o.trackId;
    out += `<g class="va-box${st.stale ? ' stale' : ''}${sel ? ' selected' : ''}"><rect x="${(x * W).toFixed(1)}" y="${(y * H).toFixed(1)}" width="${(w * W).toFixed(1)}" height="${(h * H).toFixed(1)}"/><text x="${(x * W).toFixed(1)}" y="${Math.max(fs, y * H - fs * .3).toFixed(1)}" font-size="${fs}">${esc(o.trackId)} · ${esc(o.className)}${o.confidence != null ? ` ${Math.round(o.confidence * 100)}%` : ''}</text></g>`;
  }
  svg.innerHTML = out;
  const note = !st.frame ? 'До первого проанализированного кадра наблюдений нет.' : st.stale
    ? `Нет свежих наблюдений: последний проанализированный кадр ${VA.fmtSec(st.ageSec)} назад${st.ageSec > limit * 3 ? ', рамки скрыты' : ', рамки помечены как устаревшие'}. Отсутствие видимости не означает завершения работы.`
    : `Кадр анализа ${VA.fmtClock(st.frame.t)} · объектов на кадре: ${st.objects.length}`;
  if ($('va-frame-note').textContent !== note) text('va-frame-note', note);
  text('va-time', `${VA.fmtClock(t)} / ${VA.fmtClock(vaDuration())}`);
  if (document.activeElement !== $('va-seek')) $('va-seek').value = String(t);
  const cur = $('va-cursor'); if (cur) { const x = (VA_CHART.x0 + (VA_CHART.x1 - VA_CHART.x0) * t / vaDuration()).toFixed(1); cur.setAttribute('x1', x); cur.setAttribute('x2', x); }
  const now = new Set(VA.visitsAt(va.rows, t).map(r => r.id));
  for (const el of document.querySelectorAll('#view-video [data-visit]')) el.classList.toggle('va-now', now.has(el.dataset.visit));
  $('va-play').textContent = vaPlaying() ? '❚❚' : '▶'; $('va-play').setAttribute('aria-label', vaPlaying() ? 'Пауза' : 'Воспроизвести');
}
const vaPlaying = () => vaHasVideo() ? !vaVideo.paused && !vaVideo.ended : va.playing;
// A ~30 fps timer rather than requestAnimationFrame: the overlay keeps up with the video even where frames are not painted.
function vaLoop() {
  va.raf = 0;
  const now = performance.now();
  if (!vaHasVideo() && va.playing) { va.t = Math.min(vaDuration(), va.t + (now - va.last) / 1000); va.last = now; if (va.t >= vaDuration()) va.playing = false; }
  vaDraw();
  if (vaPlaying() && view === 'video') va.raf = setTimeout(vaLoop, 33);
}
const vaKick = () => { if (!va.raf) va.raf = setTimeout(vaLoop, 0); };
// After a seek the whole picture is recomputed from the new time; nothing carries over from before.
function vaSeek(t) {
  if (!va.data) return;
  const x = Math.min(vaDuration(), Math.max(0, Number(t) || 0));
  if (vaHasVideo()) vaVideo.currentTime = Math.min(x, vaVideo.duration || x); else va.t = x;
  vaDraw();
}
function vaPause() { va.playing = false; if (vaHasVideo()) vaVideo.pause(); }
$('va-play').addEventListener('click', () => {
  if (!va.data) return;
  if (vaHasVideo()) { if (vaVideo.paused) vaVideo.play(); else vaVideo.pause(); }
  else { if (!va.playing && va.t >= vaDuration()) va.t = 0; va.playing = !va.playing; va.last = performance.now(); }
  vaKick(); vaDraw();
});
$('va-seek').addEventListener('input', e => vaSeek(e.target.value));
for (const ev of ['play', 'pause', 'seeked', 'timeupdate', 'ended']) vaVideo.addEventListener(ev, () => { vaDraw(); if (ev === 'play') vaKick(); });
document.addEventListener('click', e => {
  const b = e.target.closest('#view-video [data-va-seek]'); if (!b) return;
  va.track = b.dataset.vaTrack ?? null; vaSeek(b.dataset.vaSeek); $('va-stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#video')) { vaPause(); const b = document.querySelector('.topbar .synthetic'); if (b) b.hidden = false; }
  else if (location.hash === '#video/demo' && !va.data) vaLoadDemo();
});
window.addEventListener('resize', () => { if (va.data && view === 'video') vaDraw(); });

// ----- export -----
$('va-csv').addEventListener('click', () => {
  if (!va.data) return;
  const blob = new Blob([VA.visitsCsv(va.data, va.rows)], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `video-visits-${va.data.source.id.replace(/[^\w.-]+/g, '_')}.csv`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
function vaRenderReport() {
  const d = va.data, s = d.source, a = d.analysis, sum = VA.summarize(va.rows), dl = VA.delays(va.rows);
  const rows = list => list.map(r => `<tr><td>${esc(r.trackId)}</td><td>${esc(r.zoneName)}</td><td>${VA.fmtClock(r.startSec)}</td><td>${r.endSec == null ? '—' : VA.fmtClock(r.endSec)}</td><td>${vaObserved(r)}</td><td>${VA.fmtSec(r.thresholdSec)}</td><td>${vaExceed(r)}</td><td>${esc(VA.STATUS[r.status])}</td></tr>`).join('');
  let rep = $('va-report');
  if (!rep) { rep = document.createElement('section'); rep.id = 'va-report'; rep.className = 'va-report'; $('view-video').append(rep); }
  rep.innerHTML = `<h1>Отчёт видеоанализа</h1>
    <p><b>${esc(VA.dataLabel(d))}</b> · Воспроизведение результатов анализа, не прямой эфир · ${esc(VA.MODES[a.mode])}</p>
    <p>Запись: ${esc(s.title)} (${esc(s.fileName)}), ${VA.fmtSec(s.durationSec)}, ${s.width}×${s.height}. Лицензия: ${esc(s.license)}.${s.url ? ` Источник: ${esc(s.url)}.` : ''}</p>
    <p>Анализ: ${a.mode === 'model' ? `модель ${esc(a.model ?? 'не указана')}` : a.mode === 'manual' ? 'ручная разметка' : 'синтетические данные'}, ${String(a.sampleFps).replace('.', ',')} кадр/с. Отчёт сформирован ${esc(new Date().toLocaleString('ru-RU'))}.</p>
    <p>Зоны и пороги: ${d.zones.map(z => `${esc(z.name)} — ${VA.fmtSec(z.thresholdSec)} (${esc(VA.thresholdLabel(z))})`).join('; ')}.</p>
    <p>Посещений: ${sum.visits}; завершено: ${sum.finished}; незавершено: ${sum.unfinished}; с превышением порога: ${sum.exceeded}.</p>
    <h2>Завершённые посещения</h2><table>${vaHead}<tbody>${rows(va.rows.filter(r => r.finished)) || '<tr><td colspan="8">нет</td></tr>'}</tbody></table>
    <h2>Незавершённые посещения</h2><table>${vaHead}<tbody>${rows(va.rows.filter(r => !r.finished)) || '<tr><td colspan="8">нет</td></tr>'}</tbody></table>
    <h2>Возможные задержки</h2>${dl.length ? `<ol>${dl.map(r => `<li>${esc(r.text)} ${esc(r.caveat)} Возможные причины — гипотезы, не подтверждены: ${r.hypotheses.map(esc).join('; ')}.</li>`).join('')}</ol>` : '<p>Превышений порога нет.</p>'}
    <h2>Ограничения</h2><ul><li>Наблюдаемая длительность — время видимости объекта в зоне на записи, а не подтверждённое время операции.</li><li>Если объект потерян из виду или остался в зоне на конце записи, время и превышение — нижняя оценка; завершение не подтверждено.</li><li>Число объектов в зоне не является длиной очереди.</li><li>OEE, брак и вероятность поломки по рамкам видео не рассчитываются.</li><li>Пороги с пометкой «демонстрационный норматив» не являются нормативами Allur.</li></ul>`;
}
$('va-print').addEventListener('click', () => {
  if (!va.data) return;
  vaRenderReport(); document.body.classList.add('va-printing'); window.print();
});
window.addEventListener('afterprint', () => document.body.classList.remove('va-printing'));
