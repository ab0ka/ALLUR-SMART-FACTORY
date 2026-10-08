// Isometric scenes of the other shops (welding, painting, quality control, car repair, shipping) and the live
// enterprise map. Same rules as scene.js: positions and statuses come only from server snapshots; the client only
// moves the picture between two snapshots. No inline styles (CSP): SVG attributes, CSS classes and CSSOM only.
// Cars are the isometric sprites of the "Kia Sportage" model (karaman.arman, CC BY 4.0), see docs/ASSETS.md.
import { iso, depthOrder, icon, SHOPS } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const ISO = 'matrix(.866 .5 -.866 .5 0 0)';
const FACE_Y = (e, f) => `matrix(.866 .5 0 -1 ${e} ${f})`;
const FACE_X = (e, f) => `matrix(-.866 .5 0 -1 ${e} ${f})`;
const r1 = n => Math.round(n * 10) / 10;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const lenOf = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
const CAR_SPRITE = { x: -45.2, y: -41, w: 142.37, h: 122.94 }; // same frame as scene.js (scripts/render-car-sprites.mjs)
const modelKey = m => ['a', 'b', 'c'].includes(String(m).toLowerCase()) ? String(m).toLowerCase() : 'b';
const carDefs = prefix => ['a', 'b', 'c'].flatMap(m => ['done', 'body'].map(st => `<g id="${prefix}-${m}-${st}"><image href="/car-kia-${m}-${st}.webp" x="${CAR_SPRITE.x}" y="${CAR_SPRITE.y}" width="${CAR_SPRITE.w}" height="${CAR_SPRITE.h}" preserveAspectRatio="none"/></g>`)).join('');
const bufferIds = (state, id) => id === 'RWQ' ? state.rework.buffer.vehicleIds : state.stages.find(s => s.buffer.id === id)?.buffer.vehicleIds ?? [];
const bufferOf = (state, id) => id === 'RWQ' ? state.rework.buffer : state.stages.find(s => s.buffer.id === id)?.buffer;
const assembled = v => v.route.some(r => r.stage === 'assembly' && r.status === 'done');

// An isometric box as three polygons (top, +Y face, +X face); classes follow scene.js (sc-col / sc-col2 / sc-colt).
function box(x, y, w, d, h, cls = ['sc-col', 'sc-col2', 'sc-colt'], z = 0) {
  const P = (...pts) => pts.map(([a, b, c]) => iso(a, b, c).map(r1).join(',')).join(' ');
  return `<polygon points="${P([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h])}" class="${cls[0]}"/>`
    + `<polygon points="${P([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h])}" class="${cls[1]}"/>`
    + `<polygon points="${P([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h])}" class="${cls[2]}"/>`;
}

// ---------- Layouts (world units; floor 640 × 480 like the assembly shop) ----------
export const SHOP_LAYOUTS = {
  weld: { stage: 'weld', wall: 'СВАРКА', kind: 'weld', op: 'сварка', posts: ['W1', 'W2'], input: { buffer: 'BACKLOG', label: 'Входной буфер кузовов', slots: 4 }, outputs: [{ buffer: 'B1', label: 'B1 · в окраску', slots: 3, space: 'paint' }], body: true },
  paint: { stage: 'paint', wall: 'ОКРАСКА', kind: 'paint', op: 'окраска', posts: ['P1', 'P2'], input: { buffer: 'B1', label: 'B1 · из сварки', slots: 3, space: 'weld' }, outputs: [{ buffer: 'B2', label: 'B2 · в сборку', slots: 3, space: 'assembly' }] },
  quality: { stage: 'quality', wall: 'КОНТРОЛЬ', kind: 'quality', op: 'контроль', posts: ['Q1', 'Q2'], input: { buffer: 'B3', label: 'B3 · из сборки', slots: 2, space: 'assembly' }, outputs: [{ buffer: 'FG', label: 'Принят → FG, отгрузка', slots: 2, space: 'ship' }, { buffer: 'RWQ', label: 'Дефект → ремонт', slots: 2, space: 'rework' }] },
  rework: { stage: 'rework', wall: 'РЕМОНТ', kind: 'rework', op: 'доработка', posts: ['R1'], input: { buffer: 'RWQ', label: 'Очередь доработки', slots: 3, space: 'tests' }, outputs: [{ buffer: 'B3', label: 'B3 · на повторный контроль', slots: 2, space: 'tests' }], lift: 14 },
  shipping: { stage: 'shipping', wall: 'ОТГРУЗКА', kind: 'ship', op: 'отгрузка', posts: ['S1'], input: { buffer: 'FG', label: 'FG · готовые автомобили', slots: 4, space: 'tests' }, outputs: [], exit: true },
};
const BAY_X = 255, AISLE_IN = 185, AISLE_OUT = 435;
const spread = (n, mid, step) => Array.from({ length: n }, (_, i) => mid + (i - (n - 1) / 2) * step);
export function geometry(L) {
  const postY = Object.fromEntries(L.posts.map((id, i, a) => [id, a.length === 1 ? 215 : a.length === 2 ? [110, 320][i] : [60, 215, 370][i]]));
  const inSlots = spread(L.input.slots, 255, L.input.slots > 3 ? 72 : 75).map(y => ({ x: 90, y }));
  const outs = L.outputs.length === 2 ? [spread(L.outputs[0].slots, 150, 80), spread(L.outputs[1].slots, 360, 80)] : L.outputs.map(o => spread(o.slots, 255, 80));
  return { postY, inSlots, outSlots: Object.fromEntries(L.outputs.map((o, i) => [o.buffer, outs[i].map(y => ({ x: 555, y }))])) };
}

// ---------- Camera shared by both scenes ----------
class Camera {
  constructor(svg, w, h, home) { this.svg = svg; this.viewW = w; this.viewH = h; this.homeAt = home; this.cam = { s: 1, ...home }; svg.setAttribute('viewBox', `0 0 ${w} ${h}`); }
  applyCamera() { const { s, cx, cy } = this.cam; this.camEl.setAttribute('transform', `translate(${r1(this.viewW / 2 - s * cx)} ${r1(this.viewH / 2 - s * cy)}) scale(${s})`); }
  zoom(f, cx, cy) { this.atHome = false; this.cam.s = Math.min(2.6, Math.max(.6, this.cam.s * f)); if (cx !== undefined) { this.cam.cx = cx; this.cam.cy = cy; } this.applyCamera(); }
  pan(dx, dy) { this.atHome = false; this.cam.cx = Math.min(this.viewW - 50, Math.max(50, this.cam.cx - dx / this.cam.s)); this.cam.cy = Math.min(this.viewH - 40, Math.max(40, this.cam.cy - dy / this.cam.s)); this.applyCamera(); }
  fitScale() { const w = this.svg.clientWidth, h = this.svg.clientHeight; if (!w || !h) return 1; const base = Math.min(w / this.viewW, h / this.viewH); return Math.min(2.4, Math.max(1, Math.min(w / (this.viewW * .98), h / (this.viewH * .9)) / base)); }
  home(s = this.fitScale()) { this.cam = { s, ...this.homeAt }; this.atHome = true; this.applyCamera(); }
}

// ---------- Shop scene ----------
export class ShopScene extends Camera {
  constructor(svg, layout) {
    super(svg, 1000, 660, { cx: 509, cy: 338 });
    this.L = layout; this.G = geometry(layout); this.cars = new Map(); this.raf = 0; this.statics = [];
    svg.innerHTML = `<defs><pattern id="ss-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="sc-gridline"/></pattern>${carDefs('ss-car')}<g id="ss-shadow"><g transform="${ISO}"><rect x="-9" y="-7" width="128" height="64" rx="22" class="sc-shadow"/><rect x="-3" y="-2" width="116" height="54" rx="14" class="sc-shadow"/></g></g></defs>
      <g class="sc-cam">${this.floor()}<g class="sc-rings"></g><g class="sc-objects"></g><g class="sc-overlay"></g></g>`;
    this.camEl = svg.querySelector('.sc-cam'); this.rings = svg.querySelector('.sc-rings'); this.objectsEl = svg.querySelector('.sc-objects'); this.overlay = svg.querySelector('.sc-overlay');
    for (const [id, y] of Object.entries(this.G.postY)) for (const s of this.equipment(id, y)) this.addStatic(s);
    if (layout.exit) this.addStatic({ svg: box(612, 196, 12, 12, 78) + box(612, 324, 12, 12, 78) + box(612, 196, 12, 140, 10, ['sc-col', 'sc-col2', 'sc-colt'], 78), fp: { x0: 612, x1: 624, y0: 196, y1: 336 }, h: 88 });
    this.applyCamera(); this.sortObjects(true);
    this.onVisible = () => { if (!document.hidden) this.snapAll(); };
    document.addEventListener('visibilitychange', this.onVisible);
  }
  destroy() { cancelAnimationFrame(this.raf); this.raf = 0; document.removeEventListener('visibilitychange', this.onVisible); this.cars.clear(); this.svg.innerHTML = ''; }
  addStatic({ svg, fp, h }) { const g = document.createElementNS(NS, 'g'); g.innerHTML = svg; this.objectsEl.append(g); this.statics.push({ el: g, fp, h }); }
  floor() {
    const { postY, inSlots, outSlots } = this.G, L = this.L;
    const bays = Object.values(postY).map(y => `<rect x="220" y="${y - 30}" width="180" height="110" rx="4" class="sc-bay"/>`).join('');
    const slot = (s, x, w) => `<rect x="${x}" y="${s.y - 30}" width="${w}" height="60" rx="6" class="sc-slot"/>`;
    const slots = inSlots.map(s => slot(s, 30, 120)).join('') + Object.values(outSlots).flat().map(s => slot(s, 490, 130)).join('');
    const chev = (x, y) => `M${x} ${y - 8}l16 8-16 8z`;
    const chevrons = Object.values(postY).flatMap(y => [chev(174, y + 25), chev(426, y + 25)]).join('');
    const win = (x, w = 52) => `<rect x="${x}" y="34" width="${w}" height="18" rx="2" class="sc-window"/>`;
    const labels = Object.entries(postY).map(([id, y]) => `<text x="228" y="${y + 74}" class="sc-floortext">${esc(id)}</text>`).join('');
    const outLabels = L.outputs.map(o => `<text x="492" y="${outSlots[o.buffer][0].y - 38}" class="sc-floortext sc-small sc-amber-text">${esc(o.buffer)}</text>`).join('');
    return `<g transform="translate(${440} ${80})">
      <g transform="${FACE_Y(-415.7, 240)}"><rect x="0" y="-16" width="640" height="16" class="sc-slab1"/></g>
      <g transform="${FACE_X(554.2, 320)}"><rect x="0" y="-16" width="480" height="16" class="sc-slab2"/></g>
      <g transform="${ISO}"><rect x="0" y="0" width="640" height="480" class="sc-floor"/><rect x="0" y="0" width="640" height="480" fill="url(#ss-grid)"/>
        <rect x="160" y="14" width="50" height="452" class="sc-aisle"/><rect x="410" y="14" width="50" height="452" class="sc-aisle"/>
        ${bays}${slots}<path d="${chevrons}" class="sc-chevron"/>${labels}
        <text x="34" y="${inSlots[0].y - 38}" class="sc-floortext sc-small sc-amber-text">${esc(L.input.buffer)} · ВХОД</text>${outLabels}
        <rect x="0" y="225" width="16" height="60" class="sc-threshold"/><rect x="622" y="206" width="18" height="108" class="sc-threshold"/></g>
      <g transform="${FACE_Y(0, 0)}"><rect x="0" y="0" width="640" height="64" class="sc-wall"/><rect x="0" y="0" width="640" height="6" class="sc-skirting"/>${win(30)}${win(96)}${win(162)}${win(430)}${win(496)}${win(562)}</g>
      <text transform="matrix(.866 .5 0 1 0 0)" x="238" y="-24" class="sc-walltext">${esc(L.wall)}</text>
      <g transform="${FACE_X(0, 0)}"><rect x="0" y="0" width="480" height="64" class="sc-wall2"/><rect x="0" y="0" width="480" height="6" class="sc-skirting"/>${win(40, 48)}${win(104, 48)}${win(360, 48)}${win(420, 48)}</g>
      <g transform="translate(0 -64) ${ISO}"><rect x="-12" y="-12" width="652" height="12" class="sc-walltop"/><rect x="-12" y="0" width="12" height="480" class="sc-walltop"/></g></g>`;
  }
  // Equipment of one post by shop kind: simplified training shapes, not real Allur equipment.
  equipment(id, y) {
    const k = this.L.kind, unit = ['sc-unit', 'sc-unit2', 'sc-unit2'], glass = ['ss-glass', 'ss-glass2', 'ss-glass2'];
    if (k === 'weld') {
      const robot = (x, yy) => ({ svg: box(x, yy, 18, 18, 14, unit) + box(x + 5, yy + 5, 8, 8, 42, ['sc-col', 'sc-col2', 'sc-colt'], 14) + box(x - 10, yy + 4, 22, 10, 8, ['ss-arm', 'ss-arm2', 'ss-arm2'], 56), fp: { x0: x - 10, x1: x + 18, y0: yy, y1: yy + 18 }, h: 64 });
      return [robot(268, y - 26), robot(332, y + 60), { svg: box(222, y - 34, 176, 4, 20, ['ss-fence', 'ss-fence2', 'ss-fence2']), fp: { x0: 222, x1: 398, y0: y - 34, y1: y - 30 }, h: 20 }];
    }
    if (k === 'paint') return [
      { svg: box(222, y - 36, 176, 6, 72, ['sc-wall', 'sc-wall2', 'sc-walltop']), fp: { x0: 222, x1: 398, y0: y - 36, y1: y - 30 }, h: 72 },
      { svg: box(216, y - 36, 6, 118, 72, ['sc-wall', 'sc-wall2', 'sc-walltop']), fp: { x0: 216, x1: 222, y0: y - 36, y1: y + 82 }, h: 72 },
      { svg: box(222, y + 76, 6, 6, 72) + box(392, y + 76, 6, 6, 72) + box(222, y + 76, 176, 6, 8, glass, 64), fp: { x0: 222, x1: 398, y0: y + 76, y1: y + 82 }, h: 72 },
      { svg: box(400, y - 20, 22, 26, 34, unit), fp: { x0: 400, x1: 422, y0: y - 20, y1: y + 6 }, h: 34 },
    ];
    if (k === 'quality') return [
      { svg: box(296, y - 34, 10, 10, 70) + box(296, y - 34, 10, 120, 8, ['ss-light', 'ss-light2', 'ss-light2'], 70), fp: { x0: 296, x1: 306, y0: y - 34, y1: y - 24 }, h: 78 },
      { svg: box(296, y + 76, 10, 10, 70), fp: { x0: 296, x1: 306, y0: y + 76, y1: y + 86 }, h: 70 },
      { svg: box(368, y - 28, 30, 18, 40, ['sc-bench', 'sc-bench2', 'sc-bencht']), fp: { x0: 368, x1: 398, y0: y - 28, y1: y - 10 }, h: 40 },
    ];
    if (k === 'rework') return [
      { svg: box(304, y - 18, 12, 12, 76), fp: { x0: 304, x1: 316, y0: y - 18, y1: y - 6 }, h: 76 },
      { svg: box(304, y + 56, 12, 12, 76) + box(318, y + 58, 16, 10, 26, unit), fp: { x0: 304, x1: 335, y0: y + 56, y1: y + 70 }, h: 76 },
      { svg: box(367, y - 28, 30, 18, 40, ['sc-bench', 'sc-bench2', 'sc-bencht']), fp: { x0: 367, x1: 397, y0: y - 28, y1: y - 10 }, h: 40 },
    ];
    return [{ svg: box(230, y - 26, 20, 16, 30, unit), fp: { x0: 230, x1: 250, y0: y - 26, y1: y - 10 }, h: 30 }];
  }
  // ----- where a vehicle is in this shop -----
  placeOf(v, state) {
    const l = v.location, L = this.L;
    if (!l || v.shipped) return null;
    if (l.type === 'post' && L.posts.includes(l.id)) return { kind: 'post', id: l.id };
    if (l.type !== 'buffer') return null;
    if (l.id === L.input.buffer) { const i = bufferIds(state, l.id).indexOf(v.id); return i >= 0 && i < this.G.inSlots.length ? { kind: 'in', index: i } : null; }
    if (this.G.outSlots[l.id]) { const i = bufferIds(state, l.id).indexOf(v.id); return i >= 0 && i < this.G.outSlots[l.id].length ? { kind: 'out', id: l.id, index: i } : null; }
    return null;
  }
  pointOf(p) {
    if (!p) return null;
    if (p.kind === 'post') return { x: BAY_X + 55, y: this.G.postY[p.id] + 25, o: 'x', z: this.L.lift ?? 0 };
    if (p.kind === 'in') return { ...this.G.inSlots[p.index], o: 'x', z: 0 };
    return { ...this.G.outSlots[p.id][p.index], o: 'x', z: 0 };
  }
  route(from, to) {
    const a = this.pointOf(from), b = this.pointOf(to), at = (x, y, o, z = 0) => ({ x, y, o, z });
    const via = (lane, y1, y2) => [at(lane, y1, 'x'), at(lane, y1, 'y'), at(lane, y2, 'y'), at(lane, y2, 'x')];
    if (!a && !b) return [];
    if (!a) return [{ ...b, x: b.x - 80, fade: 'in' }, b];
    if (!b) return [a, { ...a, x: a.x + 110, fade: 'out' }];
    if (from.kind === to.kind && from.kind !== 'post') return [a, b];
    if (from.kind === 'in' && to.kind === 'post') return [a, ...via(AISLE_IN, a.y, b.y), b];
    if (from.kind === 'post' && to.kind === 'out') return [a, ...via(AISLE_OUT, a.y, b.y), b];
    if (from.kind === 'post' && to.kind === 'post') return [a, ...via(AISLE_IN, a.y, b.y), b];
    return [{ ...a, fade: 'out' }, { ...b, fade: 'in' }];
  }
  // ----- snapshot update -----
  update(state, ui) {
    const seen = new Set(), animate = Boolean(this.firstDone);
    for (const v of state.vehicles) {
      const place = this.placeOf(v, state);
      if (!place) continue;
      seen.add(v.id);
      let car = this.cars.get(v.id);
      if (!car) { car = this.createCar(v); car.place = place; this.startMove(car, animate ? this.route(null, place) : [this.pointOf(place)]); }
      else if (car.leaving) { car.leaving = false; car.place = place; this.startMove(car, [this.pointOf(place)]); }
      else if (!sameP(car.place, place)) { const path = this.route(car.place, place); car.place = place; this.startMove(car, path); }
      car.v = v;
      car.model.setAttribute('href', `#ss-car-${modelKey(v.modelId)}-${assembled(v) ? 'done' : 'body'}`);
      car.el.setAttribute('aria-label', `${v.id}, ${v.modelName}: ${v.status}`);
      car.el.classList.toggle('selected', ui.selected?.type === 'vehicle' && ui.selected.id === v.id);
      car.el.classList.toggle('problem', v.state === 'paused');
    }
    for (const [id, car] of this.cars) if (!seen.has(id) && !car.leaving) { car.leaving = true; this.startMove(car, this.route(car.place, null), true); }
    this.firstDone = true;
    this.renderRings(state, ui); this.renderOverlay(state, ui); this.kick(); this.sortObjects();
  }
  createCar(v) {
    const el = document.createElementNS(NS, 'g');
    el.setAttribute('class', 'sc-car'); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.dataset.vehicle = v.id;
    el.innerHTML = `<g class="sc-orient"><g transform="${ISO}"><rect x="-14" y="-10" width="138" height="70" rx="14" class="sc-selring"/></g><use href="#ss-shadow"/><g class="sc-lift"><use href="#ss-car-b-body"/></g></g>`;
    this.objectsEl.append(el);
    const car = { el, orient: el.firstChild, lift: el.querySelector('.sc-lift'), model: el.querySelector('.sc-lift use'), pos: null, path: null, v };
    this.cars.set(v.id, car);
    return car;
  }
  makePath(points, animate = true) {
    if (!points.length) return null;
    const segs = []; let total = 0;
    for (let i = 1; i < points.length; i++) { const l = lenOf(points[i - 1], points[i]) || (points[i].fade || points[i - 1].fade ? 30 : 0); segs.push({ a: points[i - 1], b: points[i], l, from: total }); total += l; }
    const instant = !animate || reduceMotion() || document.hidden || total === 0;
    return { points, segs, total, t0: performance.now(), dur: instant ? 0 : Math.min(1300, Math.max(320, total / .5)) };
  }
  startMove(car, points, leaving = false) {
    if (!points.length) return;
    if (!car.pos) car.pos = { ...points[0] };
    else points[0] = { ...points[0], x: car.pos.x, y: car.pos.y, o: car.pos.o, z: car.pos.z };
    car.path = this.makePath(points, this.firstDone); car.leaving = leaving; this.kick();
  }
  snapAll() { for (const c of this.cars.values()) if (c.path) c.path.dur = 0; this.kick(); }
  kick() { if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t)); }
  sample(path, now) {
    const f = path.dur ? Math.min(1, (now - path.t0) / path.dur) : 1, e = f < .5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2, d = e * path.total;
    if (!path.segs.length) return { p: { ...path.points[0], op: path.points[0].fade === 'out' ? 0 : 1 }, done: f >= 1 };
    const seg = path.segs.find(s => d <= s.from + s.l) ?? path.segs.at(-1);
    const t = seg.l ? Math.min(1, Math.max(0, (d - seg.from) / seg.l)) : 1, a = seg.a, b = seg.b;
    const op = b.fade === 'out' ? 1 - t : a.fade === 'in' ? t : 1;
    return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t, o: t >= 1 || a.o === b.o ? b.o : (seg.l ? a.o : b.o), op }, done: f >= 1 };
  }
  frame(now) {
    this.raf = 0; let moving = false, changed = false;
    for (const [id, car] of this.cars) {
      if (!car.path) continue;
      const { p, done } = this.sample(car.path, now);
      car.pos = p; this.applyCar(car); changed = true;
      if (done) { car.path = null; if (car.leaving) { car.el.remove(); this.cars.delete(id); } } else moving = true;
    }
    if (changed) this.sortObjects();
    if (moving) this.kick();
  }
  applyCar(car) {
    const p = car.pos, o = p.o === 'y';
    const [sx, sy] = iso(o ? p.x - 25 : p.x - 55, o ? p.y - 55 : p.y - 25);
    car.el.setAttribute('transform', `translate(${r1(sx)} ${r1(sy)})`);
    car.orient.setAttribute('transform', o ? 'scale(-1 1)' : 'scale(1 1)');
    car.lift.setAttribute('transform', `translate(0 ${r1(-(p.z ?? 0))})`);
    car.el.setAttribute('opacity', String(r1(p.op ?? 1)));
    car.fp = o ? { x0: p.x - 25, x1: p.x + 25, y0: p.y - 55, y1: p.y + 55 } : { x0: p.x - 55, x1: p.x + 55, y0: p.y - 25, y1: p.y + 25 };
  }
  sortObjects(force = false) {
    for (const c of this.cars.values()) if (c.pos && !c.fp) this.applyCar(c);
    const objs = [...this.statics, ...[...this.cars.values()].filter(c => c.pos).map(c => ({ el: c.el, fp: c.fp, h: 60 }))];
    const order = depthOrder(objs).map(o => o.el), current = [...this.objectsEl.children];
    if (!force && order.every((el, i) => current[i] === el)) return;
    for (const el of order) this.objectsEl.append(el);
  }
  focusVehicle(id, s) { const c = this.cars.get(id); if (!c?.pos) return; const [x, y] = iso(c.pos.x, c.pos.y); this.cam = { s: Math.max(s, this.cam.s), cx: x, cy: y - 30 }; this.applyCamera(); }
  focusPost(postId, s) { const y = this.G.postY[postId]; if (y === undefined) return; const [x, yy] = iso(310, y + 25); this.cam = { s: Math.max(s, this.cam.s), cx: x + 60, cy: yy - 20 }; this.applyCamera(); }
  // ----- rings, plates, chips -----
  renderRings(state, ui) {
    let out = '';
    for (const [postId, y] of Object.entries(this.G.postY)) {
      const p = state.posts.find(q => q.id === postId), g = inner => `<g transform="translate(440 80) ${ISO}">${inner}</g>`;
      if (p.state === 'fault' || p.state === 'maintenance') out += g(`<rect x="222" y="${y - 28}" width="176" height="106" rx="4" class="sc-ring-stop"/>`);
      else if (p.problemId || p.state === 'slow' || p.state === 'blocked' || p.state === 'diagnosis') out += g(`<rect x="224" y="${y - 27}" width="172" height="104" rx="14" class="sc-ring-warn"/>`);
      if (ui.selected?.type === 'post' && ui.selected.id === postId) out += g(`<rect x="219" y="${y - 32}" width="182" height="114" rx="8" class="sc-ring-sel"/>`);
    }
    this.rings.innerHTML = out;
  }
  renderOverlay(state, ui) {
    const L = this.L; let out = '';
    const STATE = { working: ['ok', 'Работает'], idle: ['idle', 'Свободен'], slow: ['warn', 'Темп снижен'], blocked: ['warn', 'Ждёт место'], fault: ['stop', 'Неисправность'], maintenance: ['stop', 'Работы техника'], diagnosis: ['warn', 'Ждёт оператора'], shift_over: ['idle', 'Конец смены'] };
    for (const [postId, y] of Object.entries(this.G.postY)) {
      const p = state.posts.find(q => q.id === postId), [kind, label] = STATE[p.state] ?? ['idle', p.state];
      const [ax, ay] = iso(410, y + 6, 0), px = r1(ax + 24), py = r1(ay - 92);
      const sub = p.problemId ? `${p.problemId} · открыта` : p.hold ? 'снят с загрузки' : p.state === 'blocked' ? 'следующий буфер заполнен' : p.state === 'diagnosis' ? 'нужны операции на посту' : '';
      const sel = ui.selected?.type === 'post' && ui.selected.id === postId, h = sub ? 76 : 60, barY = h - 14;
      out += `<path d="M${r1(ax)} ${r1(ay)}L${px} ${r1(py + h)}" class="sc-leader"/><circle cx="${r1(ax)}" cy="${r1(ay)}" r="3" class="sc-leaderdot"/>`;
      out += `<g class="sc-plate ${kind}${sel ? ' selected' : ''}" role="button" tabindex="0" data-post="${postId}" aria-label="${esc(`${p.code}: ${label}${p.vehicleId ? `, ${p.vehicleId}, ${Math.round((p.progress ?? 0) * 100)}%` : ''}${sub ? `, ${sub}` : ''}`)}" transform="translate(${px} ${py})">
        <rect width="206" height="${h}" rx="10" class="sc-platebox"/><text x="10" y="20" class="sc-plate-code">${esc(p.code)}</text>${icon(kind, 54, 9)}<text x="72" y="20" class="sc-plate-status ${kind}">${esc(label)}</text>
        <text x="10" y="38" class="sc-plate-line">${p.vehicleId ? `${esc(p.vehicleId)} · ${esc(L.op)} ${Math.round((p.progress ?? 0) * 100)}%` : 'нет автомобиля'}</text>
        ${sub ? `<text x="10" y="54" class="sc-plate-sub ${kind}">${esc(sub)}</text>` : ''}
        <rect x="10" y="${barY}" width="186" height="4" rx="2" class="sc-barbg"/><rect x="10" y="${barY}" width="${r1(186 * (p.progress ?? 0))}" height="4" rx="2" class="sc-bar ${kind}"/></g>`;
      if (p.problemId) { const [sx, sy] = iso(310, y + 25, 70); out += `<g class="sc-pin" role="button" tabindex="0" data-problem="${esc(p.problemId)}" aria-label="${esc(`Проблема ${p.problemId} на ${p.code}`)}"><circle cx="${r1(sx)}" cy="${r1(sy)}" r="13" class="sc-pinhead"/><rect x="${r1(sx - 1.6)}" y="${r1(sy - 8)}" width="3.2" height="10" rx="1" class="sc-pinmark"/></g>`; }
    }
    const chip = (x, y, w, title, sub, kind, data = '') => `<g class="sc-chip ${kind}" role="button" tabindex="0" ${data} aria-label="${esc(`${title}${sub ? `. ${sub}` : ''}`)}" transform="translate(${x} ${y})"><rect width="${w}" height="${sub ? 46 : 30}" rx="10" class="sc-chipbox"/><text x="11" y="19" class="sc-chip-title">${esc(title)}</text>${sub ? `<text x="11" y="36" class="sc-chip-sub">${esc(sub)}</text>` : ''}</g>`;
    const inB = bufferOf(state, L.input.buffer), inIds = inB?.vehicleIds ?? [], more = Math.max(0, inIds.length - this.G.inSlots.length);
    out += chip(24, 486, 250, `${L.input.label} · ${inIds.length}${inB?.capacity ? `/${inB.capacity}` : ''}`, more ? `и ещё ${more} в очереди` : inIds.length ? `${inIds[0]} — следующий` : 'Очередь пуста', inIds.length ? 'wait' : 'idle', L.input.space ? `data-space="${L.input.space}"` : '');
    L.outputs.forEach((o, i) => { const b = bufferOf(state, o.buffer), n = b?.vehicleIds.length ?? 0; out += chip(770, L.outputs.length === 2 ? [330, 500][i] : 470, 220, `${o.label} · ${n}${b?.capacity ? `/${b.capacity}` : ''}`, '', 'nav', `data-space="${o.space}"`); });
    if (L.exit) out += chip(770, 470, 220, `Отгружено за смену: ${state.totals.shipped}`, `принято: ${state.totals.accepted}`, 'ok');
    this.overlay.innerHTML = out;
  }
}
const sameP = (a, b) => a && b && a.kind === b.kind && a.id === b.id && a.index === b.index;

// ---------- Live enterprise map: the static map from scene.js plus moving car markers ----------
const EO = [380, 100];
const eiso = (x, y, z = 0) => [EO[0] + .866 * (x - y), EO[1] + .5 * (x + y) - z];
const E_BUFFERS = { BACKLOG: [-72, 30, 56, 80], B1: [155, 40, 40, 60], B2: [365, 40, 40, 60], B3: [615, 40, 40, 60], FG: [825, 40, 40, 60], RWQ: [730, 160, 30, 36] };
const E_POSTS = Object.fromEntries([...SHOPS.flatMap(s => s.posts), ['R1', 720, 246]].map(([id, x, y]) => [id, [x, y]]));
export class EnterpriseScene extends Camera {
  constructor(svg, { cards } = {}) {
    super(svg, 1440, 836, { cx: 720, cy: 418 });
    this.cards = cards; this.markers = new Map();
    svg.innerHTML = `<defs>${carDefs('em-car')}</defs><g class="sc-cam"><g class="em-static"></g><g class="em-cars"></g></g>`;
    this.camEl = svg.querySelector('.sc-cam'); this.staticEl = svg.querySelector('.em-static'); this.carsEl = svg.querySelector('.em-cars');
    this.applyCamera();
  }
  destroy() { this.markers.clear(); this.svg.innerHTML = ''; }
  fitScale() { return 1; } // the whole map fits the view; zoom in with the camera buttons
  pointOf(v, state) {
    const l = v.location; if (!l || v.shipped) return null;
    if (l.type === 'post' && E_POSTS[l.id]) { const [x, y] = E_POSTS[l.id]; return eiso(x + 18, y + 18, 14); }
    const r = E_BUFFERS[l.id]; if (!r) return null;
    const i = bufferIds(state, l.id).indexOf(v.id); if (i < 0 || i > 3) return null;
    return eiso(r[0] + r[2] / 2, r[1] + 12 + i * Math.min(16, (r[3] - 16) / 3));
  }
  update(state, ui) {
    this.staticEl.innerHTML = this.cards(state);
    const seen = new Set(), S = .26;
    for (const v of state.vehicles) {
      const pt = this.pointOf(v, state); if (!pt) continue;
      seen.add(v.id);
      let m = this.markers.get(v.id);
      if (!m) {
        m = document.createElementNS(NS, 'g'); m.setAttribute('class', 'em-car'); m.setAttribute('role', 'button'); m.setAttribute('tabindex', '0'); m.dataset.vehicle = v.id;
        m.innerHTML = '<use/>'; this.carsEl.append(m); this.markers.set(v.id, m);
      }
      m.firstChild.setAttribute('href', `#em-car-${modelKey(v.modelId)}-${assembled(v) ? 'done' : 'body'}`);
      m.setAttribute('aria-label', `${v.id}, ${v.modelName}: ${v.status}`);
      m.classList.toggle('selected', ui.selected?.type === 'vehicle' && ui.selected.id === v.id);
      m.classList.toggle('reduced', reduceMotion());
      m.style.transform = `translate(${r1(pt[0] - 26 * S)}px, ${r1(pt[1] - 40 * S)}px) scale(${S})`; // CSSOM, animated by the .em-car transition
    }
    for (const [id, m] of this.markers) if (!seen.has(id)) { m.remove(); this.markers.delete(id); }
  }
  focusVehicle() {} focusPost() {}
}
