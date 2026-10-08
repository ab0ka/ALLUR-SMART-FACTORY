// Synthetic hydraulic lift model for assembly posts. One model links degradation, sensor readings, failure,
// diagnostic checks and ML features. Nothing here describes real Allur equipment.
export const LIFT_MODEL_VERSION = 'lift-degradation-v1';
export const SAMPLE_EVERY = 5;
export const FEATURE_WINDOW = 30;
export const CHANNELS = ['pressure', 'temperature', 'cycle'];
export const NOMINAL = { pressure: 180, temperature: 45, cycle: 42, current: 12 };
export const NOISE = { pressure: 3, temperature: 1.5, cycle: 2 };
export const UNITS = { pressure: 'бар', temperature: '°C', cycle: 'с', current: 'А' };
export const CHANNEL_NAMES = { pressure: 'Давление гидросистемы', temperature: 'Температура масла', cycle: 'Время цикла подъёма', current: 'Ток насоса' };
// Online signatures are deliberately similar: monitoring alone rarely separates the two causes.
export const EFFECT = {
  leak: { pressure: -30, temperature: 3, cycle: 20 },
  wear: { pressure: -24, temperature: 9, cycle: 22 },
};
export const HYPOTHESES = {
  leak: { title: 'Утечка в гидроцилиндре подъёмника', repair: 'repair_seal' },
  wear: { title: 'Износ гидронасоса подъёмника', repair: 'repair_pump' },
};
export const liftSpeed = d => Math.max(.55, 1 - .45 * d);
export const clamp01 = x => Math.max(0, Math.min(1, x));

// Deterministic noise from (seed, key, minute, channel): no shared PRNG stream, so copies of a state
// that take different actions still observe identical sensor noise (common random numbers).
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
export const hashUniform = (...parts) => (hash32(parts.join('|')) + .5) / 4294967296;
export function hashNormal(...parts) {
  const u1 = hashUniform(...parts, 'a'), u2 = hashUniform(...parts, 'b');
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
// Hidden degradation at a minute: d = base + rate·(t − t0), clamped to [0, 1]. cause null means healthy.
export const degradationAt = (hidden, minute) => !hidden?.cause ? 0 : clamp01(hidden.base + hidden.rate * Math.max(0, minute - hidden.t0));

export function reading({ seed, equipmentId, minute, d, cause, active }) {
  const out = { minute };
  for (const c of CHANNELS) {
    if (c === 'cycle' && !active) { out.cycle = null; continue; }
    const value = NOMINAL[c] + (cause ? EFFECT[cause][c] * d : 0) + NOISE[c] * hashNormal(seed, equipmentId, minute, c);
    out[c] = Math.round(value * 10) / 10;
  }
  return out;
}

// Diagnostic checks. Results are measurements with noise; interpretation thresholds are fixed and documented.
export const CHECKS = {
  pressure_hold: {
    title: 'Тест удержания давления', measure: 'Падение давления за 5 мин', unit: 'бар',
    value: (cause, d, z) => (cause === 'leak' ? 3 + 28 * d : cause === 'wear' ? 2 + 2 * d : 2) + z,
    interpret: v => v > 7 ? { leak: 'confirmed', wear: 'rejected', text: 'давление не удерживается — утечка подтверждена' } : v < 5 ? { leak: 'rejected', text: 'давление удерживается — утечка исключена' } : { text: 'результат в серой зоне 5–7 бар — неоднозначно' },
  },
  pump_check: {
    title: 'Замер тока и температуры насоса', measure: 'Ток насоса под нагрузкой', unit: 'А',
    value: (cause, d, z) => (cause === 'wear' ? 12 + 8 * d : cause === 'leak' ? 12 + .5 * d : 12) + .4 * z,
    interpret: v => v > 13.5 ? { wear: 'confirmed', text: 'ток повышен — износ насоса подтверждён' } : v < 12.8 ? { wear: 'rejected', text: 'ток в норме — износ насоса исключён' } : { text: 'ток в серой зоне 12,8–13,5 А — неоднозначно' },
  },
};

// Features at minute t use only readings with minute ≤ t inside the last FEATURE_WINDOW minutes.
export const FEATURES = ['pressure_mean', 'pressure_slope', 'temperature_mean', 'temperature_slope', 'cycle_mean', 'cycle_slope', 'cycle_missing'];
function slope(points) {
  if (points.length < 2) return 0;
  const mx = points.reduce((a, p) => a + p[0], 0) / points.length, my = points.reduce((a, p) => a + p[1], 0) / points.length;
  const sxx = points.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return sxx ? points.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx : 0;
}
export function features(readings, t) {
  const win = readings.filter(r => r.minute <= t && r.minute > t - FEATURE_WINDOW);
  if (win.length < 4) return null;
  const f = {};
  for (const c of CHANNELS) {
    const pts = win.filter(r => r[c] !== null && r[c] !== undefined).map(r => [r.minute, r[c]]);
    if (c === 'cycle') f.cycle_missing = 1 - pts.length / win.length;
    if (!pts.length) { // no cycle observed in window: fall back to the last known value or nominal
      const last = readings.filter(r => r.minute <= t && r[c] !== null && r[c] !== undefined).at(-1);
      f[`${c}_mean`] = last ? last[c] : NOMINAL[c]; f[`${c}_slope`] = 0; continue;
    }
    f[`${c}_mean`] = pts.reduce((a, p) => a + p[1], 0) / pts.length; f[`${c}_slope`] = slope(pts);
    f[`_${c}_n`] = pts.length;
  }
  return f;
}
export const featureVector = f => FEATURES.map(k => f[k]);

// Online anomaly score: largest one-sided z-score of window means against the healthy model.
export function anomalyScore(f) {
  if (!f) return 0;
  const z = c => (f[`${c}_mean`] - NOMINAL[c]) / (NOISE[c] / Math.sqrt(f[`_${c}_n`] || 1));
  return Math.max(-z('pressure'), z('temperature'), f._cycle_n ? z('cycle') : 0);
}
// Hypothesis weights from observations only: per-hypothesis least-squares degradation and tempered likelihood.
export function hypothesisEvidence(f) {
  const out = {};
  for (const h of Object.keys(EFFECT)) {
    let num = 0, den = 0;
    for (const c of CHANNELS) { const n = f[`_${c}_n`] || 0; if (!n) continue; const w = n / NOISE[c] ** 2; num += w * EFFECT[h][c] * (f[`${c}_mean`] - NOMINAL[c]); den += w * EFFECT[h][c] ** 2; }
    const d = Math.max(0, den ? num / den : 0);
    let ll = 0; for (const c of CHANNELS) { const n = f[`_${c}_n`] || 0; if (!n) continue; ll -= .5 * n / NOISE[c] ** 2 * (f[`${c}_mean`] - NOMINAL[c] - EFFECT[h][c] * d) ** 2; }
    out[h] = { d, ll };
  }
  return out;
}
