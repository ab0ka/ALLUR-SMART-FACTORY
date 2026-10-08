// Isometric scene of the «Сборка» shop and the enterprise map. Positions and statuses come only from server
// snapshots; the client only interpolates the picture between two snapshots and never changes engine state.
// No inline styles (CSP style-src 'self'): geometry uses SVG presentation attributes, colours use CSS classes.

const ISO = 'matrix(.866 .5 -.866 .5 0 0)';
const FACE_Y = (e, f) => `matrix(.866 .5 0 -1 ${e} ${f})`; // vertical face looking to +Y
const FACE_X = (e, f) => `matrix(-.866 .5 0 -1 ${e} ${f})`; // vertical face looking to +X
export const ORIGIN = [440, 80];
export const VIEW = { w: 1000, h: 660 };
export const iso = (x, y, z = 0) => [ORIGIN[0] + .866 * (x - y), ORIGIN[1] + .5 * (x + y) - z];
const r1 = n => Math.round(n * 10) / 10;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Geometry (world units; X runs to the lower right, Y to the lower left) ----------
export const BAY_Y = { A1: 60, A2: 215, A3: 370 }; // y of the car origin on each lift
const BAY_X = 255, LIFT_Z = 14;
export const SLOTS = { B2: [180, 255, 330].map(y => ({ x: 90, y })), B3: [230, 310].map(y => ({ x: 555, y })) }; // car centres
export const AISLE = { in: 185, out: 435 };
const GATE = { x: 640, y: 270 }, GATE_OUT = { x: 735, y: 270 };
export const TECH_HOME = { x: 150, y: 440 };
export const OBSTACLES = [
  ...Object.entries(BAY_Y).flatMap(([post, y]) => [
    { name: `${post}:стойка`, x0: 304, x1: 316, y0: y - 18, y1: y - 6 },
    { name: `${post}:верстак`, x0: 367, x1: 397, y0: y - 28, y1: y - 10 },
    { name: `${post}:стойка и насос`, x0: 304, x1: 335, y0: y + 56, y1: y + 70 },
  ]),
  { name: 'стеллаж', x0: 30, x1: 120, y0: 404, y1: 426 },
  { name: 'ворота 1', x0: 626, x1: 638, y0: 194, y1: 206 }, { name: 'ворота 2', x0: 626, x1: 638, y0: 314, y1: 326 },
];
// Lift arms: low parts (z 14…20) under the car on the lift. Cars drive over them, so they are not obstacles
// and are drawn as separate low objects, always beneath a car whose footprint covers them.
export const LIFT_ARMS = Object.entries(BAY_Y).flatMap(([post, y]) => [
  { name: `${post}:задняя лапа`, def: 'sc-arm-back', bayY: y, fp: { x0: 305, x1: 315, y0: y - 6, y1: y + 8 }, h: 20, low: true },
  { name: `${post}:передняя лапа`, def: 'sc-arm-front', bayY: y, fp: { x0: 305, x1: 315, y0: y + 42, y1: y + 56 }, h: 20, low: true },
]);
export const carFootprint =p => p.o === 'y' ? { x0: p.x - 25, x1: p.x + 25, y0: p.y - 55, y1: p.y + 55 } : { x0: p.x - 55, x1: p.x + 55, y0: p.y - 25, y1: p.y + 25 };
export const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// Where a snapshot puts a vehicle inside this shop (null = outside the shop).
export function placeOf(v, queues) {
  const l = v.location;
  if (!l || v.shipped) return null;
  if (l.type === 'post' && BAY_Y[l.id] !== undefined) return { kind: 'bay', id: l.id };
  if (l.type === 'buffer' && SLOTS[l.id]) {
    const i = queues[l.id]?.indexOf(v.id) ?? -1;
    if (i >= 0 && i < SLOTS[l.id].length) return { kind: l.id, index: i };
  }
  return null;
}
export function pointOf(place) {
  if (!place) return null;
  if (place.kind === 'bay') return { x: BAY_X + 55, y: BAY_Y[place.id] + 25, o: 'x', z: LIFT_Z };
  return { ...SLOTS[place.kind][place.index], o: 'x', z: 0 };
}
const same = (a, b) => a && b && a.kind === b.kind && a.id === b.id && a.index === b.index;
// Waypoints between two places. Cars run along X in bays and buffers and along Y in the aisles; turning
// happens on the spot (two points with the same centre). Paths never cross lift posts, benches or racks.
export function route(from, to) {
  const a = pointOf(from), b = pointOf(to);
  if (!a && !b) return [];
  if (!a) return [{ ...b, x: b.x - (to.kind === 'B2' ? 60 : 0), fade: 'in' }, b];
  const at = (x, y, o, z = 0) => ({ x, y, o, z });
  const via = (lane, y1, y2) => [at(lane, y1, 'x'), at(lane, y1, 'y'), at(lane, y2, 'y'), at(lane, y2, 'x')];
  if (!b) {
    if (from.kind === 'B2') return [a, { ...a, fade: 'out' }];
    const toGate = [at(GATE.x, GATE.y, 'x'), { ...at(GATE_OUT.x, GATE_OUT.y, 'x'), fade: 'out' }];
    if (from.kind === 'B3') return from.index ? [a, at(565, 285, 'x'), ...toGate] : [a, ...toGate];
    return [a, ...via(AISLE.out, a.y, SLOTS.B3[0].y), ...toGate];
  }
  if (same(from, to)) return [a];
  if (from.kind === to.kind && from.kind !== 'bay') return [a, b];
  if (from.kind === 'B2' && to.kind === 'bay') return [a, ...via(AISLE.in, a.y, b.y), b];
  if (from.kind === 'bay' && to.kind === 'bay') return [a, ...via(AISLE.in, a.y, b.y), b];
  if (from.kind === 'bay' && to.kind === 'B3') return [a, ...via(AISLE.out, a.y, b.y), b];
  return [{ ...a, fade: 'out' }, { ...b, fade: 'in' }];
}
export function techPoint(postId) {
  if (BAY_Y[postId] === undefined) return { ...TECH_HOME };
  return { x: 350, y: BAY_Y[postId] + 80 };
}
export function techRoute(fromPost, toPost) {
  const a = techPoint(fromPost), b = techPoint(toPost);
  if (a.x === b.x && a.y === b.y) return [a];
  return [a, { x: AISLE.in, y: a.y }, { x: AISLE.in, y: b.y }, b];
}

// ---------- Static models (local coordinates, origin = min corner of the car footprint on a lift) ----------
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"${extra}/>`;
function carModel(id, done) {
  const glass = done ? 'sc-glass' : 'sc-open';
  return `<g id="${id}">
  ${done ? '' : `<g transform="${FACE_Y(-36.37, 21)}">${rect(6, 0, 98, 8, 'sc-skid')}</g><g transform="${FACE_X(90.06, 52)}">${rect(8, 0, 34, 8, 'sc-skid2')}</g>`}
  <g transform="${FACE_Y(-43.3, 25)}">${rect(0, 8, 110, 20, 'sc-body', ' rx="3" fill="currentColor"')}${rect(0, 8, 110, 20, 'sc-shade1', ' rx="3"')}${done ? rect(0, 8, 110, 3, 'sc-sill') : ''}</g>
  <g transform="${FACE_X(95.26, 55)}">${rect(0, 8, 50, 20, 'sc-body', ' rx="3" fill="currentColor"')}${rect(0, 8, 50, 20, 'sc-shade2', ' rx="3"')}${done ? rect(4, 19, 10, 4.5, 'sc-lamp', ' rx="1.5"') + rect(36, 19, 10, 4.5, 'sc-lamp', ' rx="1.5"') : ''}</g>
  <g transform="translate(0 -28) ${ISO}">${rect(0, 0, 110, 50, 'sc-body', ' rx="6" fill="currentColor"')}</g>
  <g transform="${FACE_Y(-38.97, 22.5)}">${rect(26, 28, 58, 16, 'sc-body', ' fill="currentColor"')}${rect(31, 31, 22, 10, glass, ' rx="1.5"')}${rect(56, 31, 23, 10, glass, ' rx="1.5"')}</g>
  <g transform="${FACE_X(72.74, 42)}">${rect(5, 28, 40, 16, 'sc-body', ' fill="currentColor"')}${rect(5, 28, 40, 16, 'sc-shade2')}${rect(8, 30, 34, 12, glass, ' rx="2"')}</g>
  <g transform="translate(0 -44) ${ISO}">${rect(26, 5, 58, 40, 'sc-body', ' rx="5" fill="currentColor"')}</g>
  ${done ? `<g transform="${FACE_Y(-45.03, 26)}"><circle cx="24" cy="9" r="9" class="sc-tire"/><circle cx="24" cy="9" r="4" class="sc-hub"/><circle cx="86" cy="9" r="9" class="sc-tire"/><circle cx="86" cy="9" r="4" class="sc-hub"/></g>` : ''}
</g>`;
}
const DEFS = `<defs>
<pattern id="sc-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="sc-gridline"/></pattern>
<g id="sc-shadow"><g transform="${ISO}"><rect x="-9" y="-7" width="128" height="64" rx="22" class="sc-shadow"/><rect x="-3" y="-2" width="116" height="54" rx="14" class="sc-shadow"/></g></g>
${carModel('sc-car-body', false)}
${carModel('sc-car-done', true)}
<g id="sc-back">
  <g transform="${FACE_Y(5.2, -3)}">${rect(49, 0, 12, 76, 'sc-col')}</g><g transform="${FACE_X(52.83, 30.5)}">${rect(-18, 0, 12, 76, 'sc-col2')}</g><g transform="translate(0 -76) ${ISO}">${rect(49, -18, 12, 12, 'sc-colt')}</g>
</g>
<g id="sc-arm-back">
  <g transform="${FACE_Y(-6.93, 4)}">${rect(50, 14, 10, 6, 'sc-col')}</g><g transform="${FACE_X(51.96, 30)}">${rect(-6, 14, 14, 6, 'sc-col2')}</g><g transform="translate(0 -20) ${ISO}">${rect(50, -6, 10, 14, 'sc-colt')}</g>
</g>
<g id="sc-bench">
  <g transform="${FACE_Y(8.66, -5)}">${rect(112, 0, 30, 24, 'sc-bench')}${rect(115, 4, 11, 14, 'sc-drawer')}${rect(128, 4, 11, 14, 'sc-drawer')}</g>
  <g transform="${FACE_X(122.97, 71)}">${rect(-28, 0, 18, 24, 'sc-bench2')}</g>
  <g transform="translate(0 -24) ${ISO}">${rect(112, -28, 30, 18, 'sc-bencht')}${rect(115, -25, 9, 6, 'sc-tray')}</g>
  <g transform="${FACE_X(119.5, 69)}">${rect(-21, 24, 2, 5, 'sc-stand')}${rect(-26, 29, 12, 11, 'sc-screen', ' rx="1"')}${rect(-24.5, 31.5, 9, 2, 'sc-screenline')}</g>
</g>
<g id="sc-arm-front">
  <g transform="${FACE_Y(-48.5, 28)}">${rect(50, 14, 10, 6, 'sc-col')}</g><g transform="${FACE_X(51.96, 30)}">${rect(42, 14, 14, 6, 'sc-col2')}</g><g transform="translate(0 -20) ${ISO}">${rect(50, 42, 10, 14, 'sc-colt')}</g>
</g>
<g id="sc-front">
  <g transform="${FACE_Y(-58.89, 34)}">${rect(49, 0, 12, 76, 'sc-col')}${rect(51, 40, 8, 12, 'sc-panel', ' rx="1"')}</g><g transform="${FACE_X(52.83, 30.5)}">${rect(56, 0, 12, 76, 'sc-col2')}</g><g transform="translate(0 -76) ${ISO}">${rect(49, 56, 12, 12, 'sc-colt')}</g>
  <g transform="${FACE_Y(-60.62, 35)}">${rect(64, 0, 16, 26, 'sc-unit', ' rx="1"')}${rect(67, 14, 10, 7, 'sc-unit2', ' rx="1"')}</g><g transform="${FACE_X(69.28, 40)}">${rect(56, 0, 14, 26, 'sc-unit2')}</g><g transform="translate(0 -26) ${ISO}">${rect(64, 56, 16, 14, 'sc-unitt')}</g>
</g>
<g id="sc-tech">
  <ellipse cx="0" cy="0" rx="11" ry="4.5" class="sc-shadow"/>
  <rect x="-5" y="-14" width="4" height="14" rx="1.5" class="sc-legs"/><rect x="1" y="-14" width="4" height="14" rx="1.5" class="sc-legs"/>
  <rect x="-7.5" y="-29" width="15" height="17" rx="5" class="sc-vest"/><rect x="-7.5" y="-22" width="15" height="2.5" class="sc-stripe"/>
  <circle cx="0" cy="-34" r="5" class="sc-skin"/><path d="M-6 -35a6 6 0 0 1 12 0z" class="sc-helmet"/>
</g>
</defs>`;

function floorLayer() {
  const bays = Object.values(BAY_Y).map(y => `<rect x="220" y="${y - 30}" width="180" height="110" rx="4" class="sc-bay"/><rect x="300" y="${y - 22}" width="20" height="20" rx="2" class="sc-baseplate"/><rect x="300" y="${y + 52}" width="20" height="20" rx="2" class="sc-baseplate"/>`).join('');
  const slots = [...SLOTS.B2.map(s => [30, s.y - 30, 120]), ...SLOTS.B3.map(s => [490, s.y - 30, 130])].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="60" rx="6" class="sc-slot"/>`).join('');
  const chev = (x, y) => `M${x} ${y - 8}l16 8-16 8z`;
  const chevrons = Object.values(BAY_Y).flatMap(y => [chev(174, y + 25), chev(426, y + 25)]).concat([chev(4, 270), chev(608, 252)]).join('');
  const win = (x, w = 52) => `<rect x="${x}" y="34" width="${w}" height="18" rx="2" class="sc-window"/>`;
  return `<g transform="translate(${ORIGIN[0]} ${ORIGIN[1]})">
  <g transform="${FACE_Y(-415.7, 240)}"><rect x="0" y="-16" width="640" height="16" class="sc-slab1"/></g>
  <g transform="${FACE_X(554.2, 320)}"><rect x="0" y="-16" width="480" height="16" class="sc-slab2"/></g>
  <g transform="${ISO}">
    <rect x="0" y="0" width="640" height="480" class="sc-floor"/><rect x="0" y="0" width="640" height="480" fill="url(#sc-grid)"/>
    <rect x="160" y="14" width="50" height="452" class="sc-aisle"/><rect x="410" y="14" width="50" height="452" class="sc-aisle"/>
    <rect x="18" y="388" width="134" height="84" rx="6" class="sc-techzone"/>
    ${bays}${slots}
    <rect x="0" y="240" width="16" height="60" class="sc-threshold"/><rect x="622" y="206" width="18" height="108" class="sc-threshold"/>
    <path d="${chevrons}" class="sc-chevron"/>
    ${Object.entries(BAY_Y).map(([id, y], i) => `<text x="228" y="${y + 74}" class="sc-floortext">СБ-${i + 1}</text>`).join('')}
    <text x="34" y="143" class="sc-floortext sc-small sc-amber-text">B2 · ОЧЕРЕДЬ</text><text x="492" y="193" class="sc-floortext sc-small sc-amber-text">B3 · ОЧЕРЕДЬ</text>
    <text x="24" y="466" class="sc-floortext sc-small sc-teal-text">ТЕХ-ЗОНА</text>
  </g>
  <g transform="${FACE_Y(0, 0)}"><rect x="0" y="0" width="640" height="64" class="sc-wall"/><rect x="0" y="0" width="640" height="6" class="sc-skirting"/>${win(30)}${win(96)}${win(162)}${win(430)}${win(496)}${win(562)}</g>
  <text transform="matrix(.866 .5 0 1 0 0)" x="238" y="-24" class="sc-walltext">СБОРКА</text>
  <g transform="${FACE_X(0, 0)}"><rect x="0" y="0" width="480" height="64" class="sc-wall2"/><rect x="0" y="0" width="480" height="6" class="sc-skirting"/>${win(40, 48)}${win(104, 48)}${win(360, 48)}${win(420, 48)}<rect x="238" y="0" width="64" height="48" class="sc-door"/><rect x="243" y="0" width="54" height="43" class="sc-door2"/></g>
  <g transform="translate(0 -64) ${ISO}"><rect x="-12" y="-12" width="652" height="12" class="sc-walltop"/><rect x="-12" y="0" width="12" height="480" class="sc-walltop"/></g>
</g>`;
}
const RACK = `<g transform="translate(${ORIGIN[0]} ${ORIGIN[1]})">
  <g transform="${FACE_Y(-368.9, 213)}">${rect(30, 0, 90, 56, 'sc-rack')}${rect(30, 18, 90, 2.5, 'sc-shelf')}${rect(30, 37, 90, 2.5, 'sc-shelf')}${rect(36, 20.5, 18, 12, 'sc-unit', ' rx="1"')}${rect(62, 20.5, 12, 9, 'sc-box', ' rx="1"')}${rect(78, 20.5, 12, 9, 'sc-box', ' rx="1"')}${rect(40, 39.5, 20, 10, 'sc-box2', ' rx="1"')}</g>
  <g transform="${FACE_X(103.92, 60)}">${rect(404, 0, 22, 56, 'sc-rack2')}</g>
  <g transform="translate(0 -56) ${ISO}">${rect(30, 404, 90, 22, 'sc-rackt')}</g></g>`;
const GATE_POST = (y0, e, f) => `<g transform="translate(${ORIGIN[0]} ${ORIGIN[1]})"><g transform="${FACE_Y(e, f)}">${rect(626, 0, 12, 74, 'sc-col')}</g><g transform="${FACE_X(552.5, 319)}">${rect(y0, 0, 12, 74, 'sc-col2')}</g><g transform="translate(0 -74) ${ISO}">${rect(626, y0, 12, 12, 'sc-colt')}</g></g>`;
const GATE_BEAM = `<g transform="translate(${ORIGIN[0]} ${ORIGIN[1]})"><g transform="${FACE_Y(-282.3, 163)}">${rect(626, 74, 12, 10, 'sc-col')}</g><g transform="${FACE_X(552.5, 319)}">${rect(194, 74, 132, 10, 'sc-col2')}${rect(226, 75.5, 68, 7, 'sc-sign', ' rx="1"')}</g><g transform="translate(0 -84) ${ISO}">${rect(626, 194, 12, 132, 'sc-colt')}</g></g>`;

// ---------- Depth sorting of 3D objects (painter's order from footprints) ----------
function screenBox(fp, h) {
  const xs = [iso(fp.x0, fp.y1)[0], iso(fp.x1, fp.y0)[0]], top = iso(fp.x0, fp.y0, h)[1], bottom = iso(fp.x1, fp.y1)[1];
  return { l: xs[0], r: xs[1], t: top, b: bottom };
}
function behind(a, b) { // -1: a is drawn first
  const sx = a.fp.x1 <= b.fp.x0 ? -1 : b.fp.x1 <= a.fp.x0 ? 1 : 0, sy = a.fp.y1 <= b.fp.y0 ? -1 : b.fp.y1 <= a.fp.y0 ? 1 : 0;
  if (sx && sy && sx !== sy) return 0;
  if (sx || sy) return sx || sy;
  // Footprints overlap (a car over the lift arms, a car passing the technician in the aisle):
  // low parts go beneath, otherwise the object whose centre is nearer to the viewer goes on top.
  if (a.low !== b.low) return a.low ? -1 : 1;
  const d = (a.fp.x0 + a.fp.x1 + a.fp.y0 + a.fp.y1) - (b.fp.x0 + b.fp.x1 + b.fp.y0 + b.fp.y1);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}
export function depthOrder(objects) {
  const n = objects.length, boxes = objects.map(o => screenBox(o.fp, o.h)), indeg = new Array(n).fill(0), next = objects.map(() => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = boxes[i], B = boxes[j];
    if (A.r <= B.l || B.r <= A.l || A.b <= B.t || B.b <= A.t) continue;
    const c = behind(objects[i], objects[j]);
    if (c < 0) { next[i].push(j); indeg[j]++; } else if (c > 0) { next[j].push(i); indeg[i]++; }
  }
  const key = o => (o.fp.x0 + o.fp.x1 + o.fp.y0 + o.fp.y1) / 2;
  const ready = objects.map((o, i) => i).filter(i => !indeg[i]), out = [];
  while (ready.length) {
    ready.sort((i, j) => key(objects[i]) - key(objects[j]));
    const i = ready.shift(); out.push(objects[i]);
    for (const j of next[i]) if (--indeg[j] === 0) ready.push(j);
  }
  if (out.length < n) for (const o of objects.slice().sort((a, b) => key(a) - key(b))) if (!out.includes(o)) out.push(o);
  return out;
}

// ---------- Live scene ----------
const NS = 'http://www.w3.org/2000/svg';
const JOB_SHORT = { pump_check: 'замер тока', pressure_hold: 'тест давления', repair_pump: 'замена насоса', repair_seal: 'замена уплотнений', verify: 'проверка', repair_generic: 'аварийный ремонт', adjust: 'наладка' };
const MODEL_COLOR = { A: 'sc-model-a', B: 'sc-model-b', C: 'sc-model-c' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const lenOf = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);

export class AssemblyScene {
  constructor(svg, { onSelect } = {}) {
    this.svg = svg; this.onSelect = onSelect; this.cars = new Map(); this.raf = 0; this.cam = { s: 1, cx: 500, cy: 330 };
    svg.setAttribute('viewBox', `0 0 ${VIEW.w} ${VIEW.h}`);
    svg.innerHTML = `${DEFS}<g class="sc-cam">${floorLayer()}<g class="sc-rings"></g><g class="sc-objects"></g><g class="sc-overlay"></g></g>`;
    this.camEl = svg.querySelector('.sc-cam'); this.rings = svg.querySelector('.sc-rings'); this.objectsEl = svg.querySelector('.sc-objects'); this.overlay = svg.querySelector('.sc-overlay');
    this.statics = [];
    const addStatic = (markup, fp, h, low = false) => { const g = document.createElementNS(NS, 'g'); g.innerHTML = markup; this.objectsEl.append(g); this.statics.push({ el: g, fp, h, low }); };
    for (const arm of LIFT_ARMS) { const [sx, sy] = iso(BAY_X, arm.bayY); addStatic(`<use href="#${arm.def}" transform="translate(${r1(sx)} ${r1(sy)})"/>`, arm.fp, arm.h, true); }
    for (const [post, y] of Object.entries(BAY_Y)) {
      const [sx, sy] = iso(BAY_X, y);
      addStatic(`<use href="#sc-back" transform="translate(${r1(sx)} ${r1(sy)})"/>`, { x0: 304, x1: 316, y0: y - 18, y1: y - 6 }, 76);
      addStatic(`<use href="#sc-bench" transform="translate(${r1(sx)} ${r1(sy)})"/>`, { x0: 367, x1: 397, y0: y - 28, y1: y - 10 }, 40);
      addStatic(`<use href="#sc-front" transform="translate(${r1(sx)} ${r1(sy)})"/>`, { x0: 304, x1: 335, y0: y + 56, y1: y + 70 }, 76);
    }
    addStatic(RACK, { x0: 30, x1: 120, y0: 404, y1: 426 }, 56);
    addStatic(GATE_POST(194, -178.4, 103), { x0: 626, x1: 638, y0: 194, y1: 206 }, 74);
    addStatic(GATE_POST(314, -282.3, 163), { x0: 626, x1: 638, y0: 314, y1: 326 }, 74);
    this.tech = { el: document.createElementNS(NS, 'g'), post: null, pos: { ...TECH_HOME }, path: null };
    this.tech.el.setAttribute('class', 'sc-techman');
    this.tech.el.innerHTML = '<use href="#sc-tech"/><g class="sc-techbadge"></g>';
    this.objectsEl.append(this.tech.el);
    this.applyTech(); this.sortObjects(true); this.applyCamera();
    this.onVisible = () => { if (!document.hidden) this.snapAll(); };
    document.addEventListener('visibilitychange', this.onVisible);
  }
  destroy() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    document.removeEventListener('visibilitychange', this.onVisible);
    this.cars.clear(); this.svg.innerHTML = '';
  }
  // ----- camera -----
  applyCamera() {
    const { s, cx, cy } = this.cam;
    this.camEl.setAttribute('transform', `translate(${r1(VIEW.w / 2 - s * cx)} ${r1(VIEW.h / 2 - s * cy)}) scale(${s})`);
  }
  zoom(f, cx, cy) {
    this.cam.s = Math.min(2.6, Math.max(.7, this.cam.s * f));
    if (cx !== undefined) { this.cam.cx = cx; this.cam.cy = cy; }
    this.applyCamera();
  }
  pan(dx, dy) { this.cam.cx -= dx / this.cam.s; this.cam.cy -= dy / this.cam.s; this.cam.cx = Math.min(950, Math.max(50, this.cam.cx)); this.cam.cy = Math.min(620, Math.max(40, this.cam.cy)); this.applyCamera(); }
  home(minScale = 1) { this.cam = { s: minScale, cx: 500, cy: 330 }; this.applyCamera(); }
  focusVehicle(id, s) { const c = this.cars.get(id); if (!c) return; const [x, y] = iso(c.pos.x, c.pos.y); this.cam = { s: Math.max(s, this.cam.s), cx: x, cy: y - 30 }; this.applyCamera(); }
  focusPost(postId, s) { if (BAY_Y[postId] === undefined) return; const [x, y] = iso(310, BAY_Y[postId] + 25); this.cam = { s: Math.max(s, this.cam.s), cx: x + 60, cy: y - 20 }; this.applyCamera(); }

  // ----- snapshot update -----
  update(state, ui) {
    const stage = state.stages.find(s => s.id === 'assembly'), quality = state.stages.find(s => s.id === 'quality');
    const queues = { B2: stage.buffer.vehicleIds, B3: quality.buffer.vehicleIds };
    const seen = new Set(), animate = !this.firstDone ? false : true;
    for (const v of state.vehicles) {
      const place = placeOf(v, queues);
      if (!place) continue;
      seen.add(v.id);
      let car = this.cars.get(v.id);
      const assembled = v.route.some(r => r.stage === 'assembly' && r.status === 'done');
      if (!car) {
        car = this.createCar(v);
        const path = animate ? route(null, place) : [pointOf(place)];
        car.place = place; this.startMove(car, path);
      } else if (car.leaving) {
        car.leaving = false; car.place = place; this.startMove(car, [pointOf(place)]);
      } else if (!same(car.place, place)) {
        const path = route(car.place, place); car.place = place; this.startMove(car, path);
      }
      car.v = v;
      car.model.setAttribute('href', assembled ? '#sc-car-done' : '#sc-car-body');
      car.model.setAttribute('class', MODEL_COLOR[v.modelId] ?? 'sc-model-b');
      car.el.setAttribute('aria-label', `${v.id}, ${v.modelName}: ${v.status}`);
      car.el.classList.toggle('selected', ui.selected?.type === 'vehicle' && ui.selected.id === v.id);
      car.el.classList.toggle('problem', v.state === 'paused');
    }
    for (const [id, car] of this.cars) if (!seen.has(id) && !car.leaving) {
      car.leaving = true; this.startMove(car, route(car.place, null), true);
    }
    // Technician: at the post of the running job if it is a lift post, otherwise in the tech zone.
    const tech = state.technicians[0], job = tech?.jobId ? state.jobs.find(j => j.id === tech.jobId) : null;
    const jobType = job ? (job.kind === 'verify' ? 'check' : state.jobKinds.find(k => k.id === job.kind)?.type) : null;
    const post = job && BAY_Y[job.postId] !== undefined ? job.postId : null;
    if (post !== this.tech.post) { this.tech.path = this.makePath(techRoute(this.tech.post, post).map(p => ({ ...p, o: 'x', z: 0 })), animate); this.tech.post = post; this.kick(); }
    this.tech.el.querySelector('.sc-techbadge').innerHTML = !job || !post ? '' : jobType === 'check'
      ? '<circle cx="17" cy="-46" r="11" class="sc-badge-check"/><circle cx="15.5" cy="-47.5" r="4" class="sc-badge-glyph"/><path d="M18.5 -44.5l3.5 3.5" class="sc-badge-glyph"/>'
      : '<circle cx="17" cy="-46" r="11" class="sc-badge-repair"/><path d="M12.5 -41.5l6-6M18 -50a3 3 0 1 0 3 3" class="sc-badge-glyph"/>';
    this.firstDone = true;
    this.renderRings(state, ui); this.renderOverlay(state, ui);
    this.kick(); this.sortObjects();
  }
  createCar(v) {
    const el = document.createElementNS(NS, 'g');
    el.setAttribute('class', 'sc-car'); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.dataset.vehicle = v.id;
    el.innerHTML = `<g class="sc-orient"><g transform="${ISO}"><rect x="-14" y="-10" width="138" height="70" rx="14" class="sc-selring"/></g><use href="#sc-shadow"/><g class="sc-lift"><use class="sc-model-b" href="#sc-car-body"/></g></g>`;
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
    if (!car.pos) car.pos = { ...points[0] };
    else if (points.length) points[0] = { ...points[0], x: car.pos.x, y: car.pos.y, o: car.pos.o, z: car.pos.z };
    car.path = this.makePath(points, this.firstDone); car.leaving = leaving; this.kick();
  }
  snapAll() {
    for (const c of [...this.cars.values(), this.tech]) if (c.path) c.path.dur = 0;
    this.kick();
  }
  kick() { if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t)); }
  sample(path, now) {
    const f = path.dur ? Math.min(1, (now - path.t0) / path.dur) : 1;
    const e = f < .5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2, d = e * path.total;
    if (!path.segs.length) return { p: { ...path.points[0], op: path.points[0].fade === 'out' ? 0 : 1 }, done: f >= 1 };
    let seg = path.segs.find(s => d <= s.from + s.l) ?? path.segs.at(-1);
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
    if (this.tech.path) {
      const { p, done } = this.sample(this.tech.path, now);
      this.tech.pos = p; this.applyTech(); changed = true;
      if (done) this.tech.path = null; else moving = true;
    }
    if (changed) { this.sortObjects(); this.positionTag(); }
    if (moving) this.kick();
  }
  applyCar(car) {
    const p = car.pos, o = p.o === 'y';
    const [sx, sy] = iso(o ? p.x - 25 : p.x - 55, o ? p.y - 55 : p.y - 25);
    car.el.setAttribute('transform', `translate(${r1(sx)} ${r1(sy)})`);
    car.orient.setAttribute('transform', o ? 'scale(-1 1)' : 'scale(1 1)');
    car.lift.setAttribute('transform', `translate(0 ${r1(-(p.z ?? 0))})`);
    car.el.setAttribute('opacity', String(r1(p.op ?? 1)));
    car.fp = carFootprint(p);
  }
  applyTech() {
    const [sx, sy] = iso(this.tech.pos.x, this.tech.pos.y);
    this.tech.el.setAttribute('transform', `translate(${r1(sx)} ${r1(sy)})`);
  }
  sortObjects(force = false) {
    const objs = [...this.statics, { el: this.tech.el, fp: { x0: this.tech.pos.x - 5, x1: this.tech.pos.x + 5, y0: this.tech.pos.y - 5, y1: this.tech.pos.y + 5 }, h: 40 },
      ...[...this.cars.values()].filter(c => c.pos).map(c => ({ el: c.el, fp: c.fp ?? carFootprint(c.pos), h: 60 }))];
    for (const c of this.cars.values()) if (c.pos && !c.fp) this.applyCar(c);
    const order = depthOrder(objs).map(o => o.el);
    const current = [...this.objectsEl.children];
    if (!force && order.every((el, i) => current[i] === el)) return;
    for (const el of order) this.objectsEl.append(el);
  }
  positionTag() {
    const tag = this.overlay.querySelector('.sc-seltag');
    if (!tag) return;
    const car = this.cars.get(tag.dataset.for);
    if (!car?.pos) { tag.setAttribute('visibility', 'hidden'); return; }
    const [x, y] = iso(car.pos.x, car.pos.y, 58 + (car.pos.z ?? 0));
    tag.setAttribute('visibility', 'visible'); tag.setAttribute('transform', `translate(${r1(x)} ${r1(y)})`);
  }

  // ----- rings, plates, chips -----
  renderRings(state, ui) {
    let out = '';
    for (const [postId, y] of Object.entries(BAY_Y)) {
      const p = state.posts.find(q => q.id === postId);
      const stopped = p.state === 'fault' || (p.state === 'maintenance' && this.jobOn(state, postId)?.stopsPost);
      const g = inner => `<g transform="translate(${ORIGIN[0]} ${ORIGIN[1]}) ${ISO}">${inner}</g>`;
      if (stopped) out += g(`<rect x="222" y="${y - 28}" width="176" height="106" rx="4" class="sc-ring-stop"/>`);
      else if (p.problemId || p.state === 'slow' || p.state === 'blocked') out += g(`<rect x="224" y="${y - 27}" width="172" height="104" rx="14" class="sc-ring-warn"/>`);
      if (ui.selected?.type === 'post' && ui.selected.id === postId) out += g(`<rect x="219" y="${y - 32}" width="182" height="114" rx="8" class="sc-ring-sel"/>`);
    }
    this.rings.innerHTML = out;
  }
  jobOn(state, postId) {
    const job = state.jobs.find(j => j.postId === postId && j.status === 'running');
    if (!job) return null;
    const kind = state.jobKinds.find(k => k.id === job.kind);
    return { ...job, type: job.kind === 'verify' ? 'check' : kind?.type, stopsPost: job.kind === 'verify' ? true : kind?.stopsPost, short: JOB_SHORT[job.kind] ?? job.title.toLowerCase() };
  }
  plateState(state, p) {
    const job = this.jobOn(state, p.id);
    if (p.state === 'maintenance' && job) return job.type === 'check' ? ['check', 'Проверка'] : ['stop', 'Остановлен'];
    if (job && job.type === 'check') return ['check', 'Проверка'];
    return { working: ['ok', 'Работает'], idle: ['idle', 'Свободен'], slow: ['warn', p.problemId ? 'Отклонение' : 'Темп снижен'], blocked: ['warn', 'Ждёт место'], fault: ['stop', 'Неисправность'], maintenance: ['stop', 'Работы'], shift_over: ['idle', 'Смена окончена'] }[p.state] ?? ['idle', p.state];
  }
  renderOverlay(state, ui) {
    const anchors = { A1: [716, 196], A2: [620, 300], A3: [452, 412] };
    let out = GATE_BEAM;
    for (const [postId, y] of Object.entries(BAY_Y)) {
      const p = state.posts.find(q => q.id === postId), [sx, sy] = iso(BAY_X, y), [ax, ay] = anchors[postId];
      const [kind, label] = this.plateState(state, p), job = this.jobOn(state, postId);
      const eq = state.equipment.find(e => e.postId === postId);
      let sub = '';
      if (job) sub = `${job.id} · ${job.short} · ${Math.max(0, job.duration - job.remaining)}/${job.duration} мин`;
      else if (p.problemId) sub = `${p.problemId} · ${p.state === 'slow' ? 'темп снижен' : 'открыта'}`;
      else if (p.state === 'blocked') sub = 'B3 заполнен';
      else if (p.hold) sub = 'снят с загрузки';
      const diag = ui.diag && eq ? `Отклонение подъёмника ${(Math.round(eq.anomalyScore * 10) / 10).toString().replace('.', ',')} / 4,5` : '';
      const barY = sub ? 64 : 48, h = barY + 12 + (diag ? 18 : 0);
      const lampCls = { ok: 'sc-lamp-ok', idle: 'sc-lamp-idle', warn: 'sc-lamp-warn', check: 'sc-lamp-check', stop: 'sc-lamp-stop' }[kind];
      const [lx, ly] = [sx - 6, sy - 23.5];
      out += `<circle cx="${r1(lx)}" cy="${r1(ly)}" r="6" class="sc-postlamp ${lampCls}"/>`;
      if (p.problemId || kind === 'stop') out += `<ellipse cx="${r1(sx + 7.4)}" cy="${r1(sy + 56)}" rx="22" ry="24" class="sc-unitmark ${kind === 'stop' ? 'stop' : ''}"/>`;
      const [x0, y0] = [sx + 95.3, sy + 13];
      out += `<circle cx="${r1(x0)}" cy="${r1(y0)}" r="3" class="sc-leaderdot"/><path d="M${r1(x0)} ${r1(y0)}L${ax} ${ay + 26}" class="sc-leader"/>`;
      const sel = ui.selected?.type === 'post' && ui.selected.id === postId;
      out += `<g class="sc-plate ${kind}${sel ? ' selected' : ''}" role="button" tabindex="0" data-post="${postId}" aria-label="${esc(`${p.code}: ${label}${p.vehicleId ? `, ${p.vehicleId}, ${Math.round((p.progress ?? 0) * 100)}%` : ''}${sub ? `, ${sub}` : ''}`)}" transform="translate(${ax} ${ay})">
        <rect width="216" height="${h}" rx="10" class="sc-platebox"/>
        <text x="10" y="20" class="sc-plate-code">${esc(p.code)}</text>${icon(kind, 54, 9)}<text x="72" y="20" class="sc-plate-status ${kind}">${esc(label)}</text>
        <text x="10" y="38" class="sc-plate-line">${p.vehicleId ? `${esc(p.vehicleId)} · сборка ${Math.round((p.progress ?? 0) * 100)}%` : 'нет автомобиля'}</text>
        ${sub ? `<text x="10" y="54" class="sc-plate-sub ${kind}">${esc(sub.length > 34 ? sub.slice(0, 33) + '…' : sub)}</text>` : ''}
        <rect x="10" y="${barY}" width="196" height="4" rx="2" class="sc-barbg"/><rect x="10" y="${barY}" width="${r1(196 * (p.progress ?? 0))}" height="4" rx="2" class="sc-bar ${kind}"/>
        ${diag ? `<text x="10" y="${barY + 22}" class="sc-plate-sub ${eq.anomalyScore >= 4.5 && p.problemId ? 'warn' : 'ok'}">${esc(diag)}</text>` : ''}
      </g>`;
      if (p.problemId && !(ui.selected?.type === 'vehicle' && ui.selected.id === p.vehicleId)) {
        const [px, py] = [sx + 25.4, sy - 53 - (p.state === 'idle' ? -30 : 0)];
        out += `<g class="sc-pin" role="button" tabindex="0" data-problem="${esc(p.problemId)}" aria-label="${esc(`Проблема ${p.problemId} на ${p.code}`)}"><path d="M${r1(px)} ${r1(py + 14)}V${r1(py + 30)}" class="sc-pinstem"/><circle cx="${r1(px)}" cy="${r1(py)}" r="13" class="sc-pulse"/><circle cx="${r1(px)}" cy="${r1(py)}" r="13" class="sc-pinhead"/><rect x="${r1(px - 1.6)}" y="${r1(py - 8.5)}" width="3.2" height="10" rx="1" class="sc-pinmark"/><circle cx="${r1(px)}" cy="${r1(py + 6)}" r="1.9" class="sc-pinmark"/></g>`;
      }
    }
    const stock = Object.fromEntries(state.stock.map(s => [s.id, s]));
    const tech = state.technicians[0], tjob = tech?.jobId ? state.jobs.find(j => j.id === tech.jobId) : null;
    const b2 = state.stages.find(s => s.id === 'assembly').buffer, b3 = state.stages.find(s => s.id === 'quality').buffer;
    out += chip(30, 280, 230, `B2 · Буфер перед сборкой ${b2.vehicleIds.length}/${b2.capacity}`, b2.vehicleIds.length ? `${b2.vehicleIds[0]} ждёт свободный пост` : 'Очередь пуста', b2.vehicleIds.length ? 'wait' : 'muted', b2.vehicleIds[0] ? `data-vehicle="${esc(b2.vehicleIds[0])}"` : 'data-table="1"');
    out += chip(760, 524, 230, `B3 · Буфер перед контролем ${b3.vehicleIds.length}/${b3.capacity}`, b3.vehicleIds.length ? `${b3.vehicleIds[0]} ждёт свободный КК` : 'Очередь пуста', b3.vehicleIds.length ? 'wait' : 'muted', b3.vehicleIds[0] ? `data-vehicle="${esc(b3.vehicleIds[0])}"` : 'data-space="tests"');
    out += chip(20, 420, 250, tjob ? `ТЕХ-1 · ${tjob.id} на ${tjob.postCode ?? state.posts.find(p => p.id === tjob.postId)?.code}` : 'ТЕХ-1 · свободен', `Склад: уплотнения ${stock.seal_kit?.available ?? '—'} · насос ${stock.pump?.available ?? '—'}`, 'tech', tjob?.problemId ? `data-problem="${esc(tjob.problemId)}"` : 'data-table="1"');
    out += chip(818, 386, 176, 'Испытания: КК-1, КК-2 →', '', 'nav', 'data-space="tests"');
    out += chip(64, 172, 196, '← Вход из окраски', '', 'muted', 'data-space="paint"');
    const sel = ui.selected?.type === 'vehicle' ? ui.selected.id : null;
    if (sel && this.cars.has(sel)) out += `<g class="sc-seltag" data-for="${esc(sel)}" visibility="hidden"><path d="M0 0L-18 -40" class="sc-tagstem"/><rect x="-104" y="-70" width="150" height="28" rx="14" class="sc-tagbox"/><text x="-29" y="-51" class="sc-tagtext">${esc(sel)} · выбран</text></g>`;
    this.overlay.innerHTML = out;
    this.positionTag();
  }
}
function chip(x, y, w, title, sub, kind, data) {
  const h = sub ? 46 : 30;
  return `<g class="sc-chip ${kind}" role="button" tabindex="0" ${data} aria-label="${esc(`${title}${sub ? `. ${sub}` : ''}`)}" transform="translate(${x} ${y})"><rect width="${w}" height="${h}" rx="10" class="sc-chipbox"/><text x="11" y="19" class="sc-chip-title">${esc(title)}</text>${sub ? `<text x="11" y="36" class="sc-chip-sub">${esc(sub)}</text>` : ''}</g>`;
}
export function icon(kind, x, y) {
  const t = `transform="translate(${x} ${y}) scale(.8125)"`;
  if (kind === 'ok') return `<g ${t}><circle cx="8" cy="8" r="7" class="ic-ok"/><path d="M6.4 4.8v6.4L11.6 8z" class="ic-white"/></g>`;
  if (kind === 'warn') return `<g ${t}><path d="M8 1.2 15.3 14.3H.7z" class="ic-warn"/><rect x="7.1" y="5.6" width="1.8" height="4.6" rx=".6" class="ic-dark"/><circle cx="8" cy="12" r="1" class="ic-dark"/></g>`;
  if (kind === 'stop') return `<g ${t}><path d="M5 .8h6L15.2 5v6L11 15.2H5L.8 11V5z" class="ic-stop"/><rect x="4.2" y="7" width="7.6" height="2" class="ic-white"/></g>`;
  if (kind === 'check') return `<g ${t}><circle cx="8" cy="8" r="7.5" class="ic-check"/><circle cx="7.2" cy="7.2" r="3" class="ic-lens"/><path d="M9.4 9.4l2.4 2.4" class="ic-lens"/></g>`;
  if (kind === 'wait') return `<g ${t}><circle cx="8" cy="8" r="7" class="ic-warn"/><path d="M8 4v4.4l2.8 1.6" class="ic-hand"/></g>`;
  return `<g ${t}><circle cx="8" cy="8" r="6.5" class="ic-idle"/><rect x="5" y="7.2" width="6" height="1.6" class="ic-idlebar"/></g>`;
}

// ---------- Enterprise map ----------
const EO = [380, 100];
const eiso = (x, y, z = 0) => [EO[0] + .866 * (x - y), EO[1] + .5 * (x + y) - z];
export const SHOPS = [
  { id: 'weld', space: 'weld', name: 'Сварка', x0: 0, w: 140, posts: [['W1', 50, 26], ['W2', 50, 80]] },
  { id: 'paint', space: 'paint', name: 'Окраска', x0: 210, w: 140, posts: [['P1', 260, 26], ['P2', 260, 80]] },
  { id: 'assembly', space: 'assembly', name: 'Сборка', x0: 420, w: 180, posts: [['A1', 480, 14], ['A2', 480, 54], ['A3', 480, 94]] },
  { id: 'quality', space: 'tests', name: 'Испытания · контроль', x0: 670, w: 140, posts: [['Q1', 720, 26], ['Q2', 720, 80]] },
  { id: 'shipping', space: 'ship', name: 'Отгрузка', x0: 880, w: 120, posts: [['S1', 920, 52]] },
];
const REWORK_SHOP = { id: 'rework', space: 'rework', name: 'Доработка', posts: [['R1', 720, 246]] };
export function enterpriseSvg(state) {
  const post = id => state.posts.find(p => p.id === id);
  const lamp = p => ({ working: 'sc-lamp-ok', slow: 'sc-lamp-warn', blocked: 'sc-lamp-warn', fault: 'sc-lamp-stop', maintenance: p.problemId ? 'sc-lamp-stop' : 'sc-lamp-check' }[p.state] ?? 'sc-lamp-idle');
  const T = `translate(${EO[0]} ${EO[1]})`;
  let out = `<defs><pattern id="em-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="sc-gridline"/></pattern>
    <g id="em-post"><g transform="${FACE_Y(-31.18, 18)}">${rect(0, 0, 36, 20, 'sc-col')}</g><g transform="${FACE_X(31.18, 18)}">${rect(0, 0, 36, 20, 'sc-col2')}</g><g transform="translate(0 -20) ${ISO}">${rect(0, 0, 36, 36, 'sc-colt')}</g></g></defs>
  <g transform="${T}">
    <g transform="${FACE_Y(-294.44, 170)}"><rect x="-80" y="-16" width="1110" height="16" class="sc-slab1"/></g><g transform="${FACE_X(891.98, 515)}"><rect x="-20" y="-16" width="360" height="16" class="sc-slab2"/></g>
    <g transform="${ISO}"><rect x="-80" y="-20" width="1110" height="360" class="sc-floor"/><rect x="-80" y="-20" width="1110" height="360" fill="url(#em-grid)"/>
      <path d="M-15 70H0M140 70H210M350 70H420M600 70H670M810 70H880M720 140V210M770 210V140" class="em-route"/>
      <path d="M196 62l12 8-12 8zM406 62l12 8-12 8zM656 62l12 8-12 8zM866 62l12 8-12 8zM712 196l8 12 8-12zM762 154l8-12 8 12z" class="sc-chevron"/>
      ${[[-72, 30, 56, 80], [155, 40, 40, 60], [365, 40, 40, 60], [615, 40, 40, 60], [825, 40, 40, 60], [730, 160, 30, 36]].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" class="sc-slot"/>`).join('')}
      ${[[160, 'B1'], [370, 'B2'], [620, 'B3'], [830, 'FG']].map(([x, t]) => `<text x="${x}" y="94" class="sc-floortext sc-tiny sc-amber-text">${t}</text>`).join('')}<text x="-66" y="104" class="sc-floortext sc-tiny sc-amber-text">ВХОД</text>
    </g>`;
  for (const s of SHOPS) {
    const x1 = s.x0 + s.w, e = .866 * x1, f = .5 * x1, live = s.id === 'assembly';
    out += `<g transform="${FACE_Y(0, 0)}"><rect x="${s.x0}" y="14" width="${s.w}" height="30" class="sc-wall${live ? ' live' : ''}"/></g><g transform="${FACE_X(r1(.866 * s.x0), .5 * s.x0)}"><rect x="0" y="14" width="140" height="30" class="sc-wall2${live ? ' live' : ''}"/></g>`;
    out += `<g transform="${FACE_Y(-121.24, 70)}"><rect x="${s.x0}" y="0" width="${s.w}" height="14" class="sc-slab1"/></g><g transform="${FACE_X(r1(e), f)}"><rect x="0" y="0" width="140" height="14" class="sc-slab2"/></g>`;
    out += `<g transform="translate(0 -14) ${ISO}"><rect x="${s.x0}" y="0" width="${s.w}" height="140" class="em-shop${live ? ' live' : ''}"/><text x="${s.x0 + 8}" y="132" class="sc-floortext sc-small${live ? ' live' : ''}">${esc(s.name.split(' ')[0].toUpperCase())}</text></g>`;
  }
  out += `<g transform="${FACE_Y(-277.12, 160)}"><rect x="670" y="0" width="140" height="14" class="sc-slab1"/></g><g transform="${FACE_X(701.46, 405)}"><rect x="210" y="0" width="110" height="14" class="sc-slab2"/></g><g transform="translate(0 -14) ${ISO}"><rect x="670" y="210" width="140" height="110" class="em-shop"/><text x="678" y="312" class="sc-floortext sc-small">ДОРАБОТКА</text></g></g>`;
  for (const s of [...SHOPS, REWORK_SHOP]) for (const [id, x, y] of s.posts) {
    const [sx, sy] = eiso(x, y, 14), p = post(id);
    out += `<g class="em-post" role="button" tabindex="0" data-space="${s.space}" aria-label="${esc(`${p.code}: ${p.vehicleId ?? 'нет автомобиля'}`)}"><use href="#em-post" transform="translate(${r1(sx)} ${r1(sy)})"/><circle cx="${r1(sx)}" cy="${r1(sy - 16)}" r="5.5" class="sc-postlamp ${lamp(p)}"/></g>`;
  }
  const open = state.problems.find(p => p.status === 'open');
  if (open) {
    const sh = [...SHOPS, REWORK_SHOP].find(s => s.posts.some(([id]) => id === open.postId));
    const pp = sh?.posts.find(([id]) => id === open.postId);
    if (pp) { const [sx, sy] = eiso(pp[1], pp[2], 14); out += `<g class="sc-pin" role="button" tabindex="0" data-problem="${esc(open.id)}" aria-label="${esc(`Проблема ${open.id}`)}"><path d="M${r1(sx)} ${r1(sy - 36)}V${r1(sy - 22)}" class="sc-pinstem"/><circle cx="${r1(sx)}" cy="${r1(sy - 50)}" r="12" class="sc-pinhead"/><rect x="${r1(sx - 1.5)}" y="${r1(sy - 58)}" width="3" height="9" rx="1" class="sc-pinmark"/><circle cx="${r1(sx)}" cy="${r1(sy - 44.5)}" r="1.8" class="sc-pinmark"/></g>`; }
  }
  return out;
}
// Shop cards for the enterprise map: positions next to each block and live numbers.
export function enterpriseCards(state) {
  const post = id => state.posts.find(p => p.id === id), stage = id => state.stages.find(s => s.id === id);
  const busy = ids => ids.filter(id => post(id).vehicleId && !['fault', 'idle'].includes(post(id).state)).length;
  const q = state.quality, b = id => stage(id).buffer;
  const open = state.problems.filter(p => p.status === 'open');
  const probFor = st => open.filter(p => post(p.postId)?.stage === st);
  return [
    { space: 'weld', left: 360, top: 4, title: 'Сварка', later: true, lines: [`СВ-1, СВ-2 · заняты ${busy(['W1', 'W2'])} из 2`, `Входной буфер: ${b('weld').vehicleIds.length} кузовов`], problems: probFor('weld') },
    { space: 'paint', left: 542, top: 109, title: 'Окраска', later: true, lines: [`ОК-1, ОК-2 · заняты ${busy(['P1', 'P2'])} из 2`, `B1: ${b('paint').vehicleIds.length} из ${b('paint').capacity}`], problems: probFor('paint') },
    { space: 'assembly', left: 724, top: 206, title: 'Сборка', live: true, lines: [`СБ-1…СБ-3 · заняты ${busy(['A1', 'A2', 'A3'])} из 3 · B2: ${b('assembly').vehicleIds.length} из ${b('assembly').capacity}`], problems: probFor('assembly') },
    { space: 'tests', left: 940, top: 331, title: 'Испытания · контроль', later: true, lines: [`КК-1, КК-2 · заняты ${busy(['Q1', 'Q2'])} из 2 · B3: ${b('quality').vehicleIds.length} из ${b('quality').capacity}`, `С первого предъявления: ${q.firstInspections ? `${q.firstPass} из ${q.firstInspections}` : '—'}`, 'Испытательных стендов в модели нет'], problems: probFor('quality') },
    { space: 'ship', left: 1122, top: 444, title: 'Отгрузка', later: true, lines: [`ОТ-1 · ${post('S1').vehicleId ? `занят ${post('S1').vehicleId}` : 'свободен'} · FG: ${b('shipping').vehicleIds.length} из ${b('shipping').capacity}`, `Отгружено за смену: ${state.totals.shipped}`], problems: probFor('shipping') },
    { space: 'rework', left: 470, top: 556, title: 'Доработка', later: true, lines: [`ДР-1 · ${post('R1').vehicleId ? `занят ${post('R1').vehicleId}` : 'свободен'} · очередь ${state.rework.buffer.vehicleIds.length}`, `Приняты после доработки: ${q.reworkedAccepted}`], problems: probFor('rework') },
  ];
}
