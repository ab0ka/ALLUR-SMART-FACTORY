// 3D view of one vehicle: the body is the "Kia Sportage" model by karaman.arman (Sketchfab, CC BY 4.0), downloaded by
// the user into assets-src/kia-sportage. The file has no separate hood and an empty engine bay, so the viewer cuts the
// hood out along straight lines (clipping planes), puts it on a hinge, and places simplified training components in the
// bay. It is NOT a Kia or Allur CAD model and does not show the real engine bay of a Sportage.
// The viewer only draws what the server snapshot says (installed / missing / checked / faulty); it never changes state.
import * as THREE from './three.module.js';
import { OrbitControls } from './three-orbit-controls.js';

const BODY_COLORS = { A: 0xf1f3f5, B: 0x7db3e8, C: 0xd9c59c };
const HOOD_OPEN = 0.95; // rad, about the hinge axis across the car (Z)
// Camera presets: position and look-at target (metres; car front points to +X).
const VIEWS = {
  overview: { pos: [4.9, 2.5, 4.3], target: [0, 0.75, 0] },
  hood: { pos: [3.55, 2.55, 1.45], target: [1.45, 0.72, 0], hood: true },
  wheels: { pos: [2.2, 0.75, 2.75], target: [1.3, 0.38, 0.9] },
  cabin: { pos: [-1.05, 1.28, 0.38], target: [0.9, 1.02, 0.38] },
};
// Where each component sits: centre used for the camera focus and the label.
const ANCHORS = {
  engine: [1.45, 0.86, -0.05], battery: [1.8, 0.88, 0.42], radiator: [2.0, 0.9, 0], airbox: [1.32, 0.92, 0.36],
  coolant_tank: [1.3, 0.9, -0.5], washer_tank: [1.85, 0.84, -0.6], hoses: [1.7, 0.78, -0.25],
};

// ---------- Body: "Kia Sportage" by karaman.arman (Sketchfab, CC BY 4.0) ----------
// A minimal glTF 2.0 reader for this one file (float/uint attributes, uint indices, node matrices or TRS, factor
// materials). Textures and material extensions are not loaded; transmission is shown as plain transparency.
// The buffer is always requested from the fixed server route, never from a URI inside the file.
export const EXTERIOR = { gltf: '/models/kia-sportage/scene.gltf', bin: '/models/kia-sportage/scene.bin' };
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
async function fetchOk(url, kind) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 404 ? 'файлы модели не найдены: распакуйте kia_sportage.zip в assets-src/kia-sportage' : `HTTP ${r.status}`);
  return kind === 'json' ? r.json() : r.arrayBuffer();
}
export async function loadExterior(envMap, bodyColor = null) {
  const [g, bin] = await Promise.all([fetchOk(EXTERIOR.gltf, 'json'), fetchOk(EXTERIOR.bin, 'bin')]);
  if (g.asset?.version !== '2.0' || g.buffers?.length !== 1 || g.buffers[0].byteLength !== bin.byteLength) throw new Error('неожиданный формат glTF');
  const accessor = i => {
    const a = g.accessors[i], bv = g.bufferViews[a.bufferView], Ctor = ARRAYS[a.componentType], n = COMPONENTS[a.type];
    if (!Ctor || !n || a.sparse) throw new Error('неподдерживаемый accessor');
    const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), size = Ctor.BYTES_PER_ELEMENT, stride = bv.byteStride ?? n * size;
    if (stride === n * size) return { array: new Ctor(bin.slice(start, start + a.count * n * size)), n };
    const out = new Ctor(a.count * n), view = new Ctor(bin, bv.byteOffset ?? 0, bv.byteLength / size);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = view[((a.byteOffset ?? 0) + k * stride) / size + c];
    return { array: out, n };
  };
  const materials = (g.materials ?? []).map(m => {
    const pbr = m.pbrMetallicRoughness ?? {}, [r, gg, b, a] = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const mat = new THREE.MeshStandardMaterial({
      metalness: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? (pbr.metallicRoughnessTexture ? 0.5 : 1),
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide, envMap, envMapIntensity: 0.9,
    });
    mat.name = m.name ?? ''; mat.color.setRGB(r, gg, b); // glTF factors are linear, as is the working colour space
    if (bodyColor !== null && /Wolf_Gray/.test(m.name ?? '')) mat.color.setHex(bodyColor); // body paint follows the synthetic model A/B/C
    const glass = m.alphaMode === 'BLEND' || m.extensions?.KHR_materials_transmission;
    if (glass) Object.assign(mat, { transparent: true, opacity: Math.max(0.25, Math.min(0.6, a)), depthWrite: false });
    if (m.emissiveFactor) { mat.emissive.setRGB(...m.emissiveFactor); mat.emissiveIntensity = Math.min(1.5, m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1); }
    return mat;
  });
  const fallback = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const meshes = (g.meshes ?? []).map(m => m.primitives.filter(p => (p.mode ?? 4) === 4).map(p => {
    const geo = new THREE.BufferGeometry();
    for (const [attr, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) if (p.attributes[attr] !== undefined) { const { array, n } = accessor(p.attributes[attr]); geo.setAttribute(name, new THREE.BufferAttribute(array, n)); }
    if (p.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(accessor(p.indices).array, 1));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    return new THREE.Mesh(geo, materials[p.material] ?? fallback);
  }));
  const node = i => {
    const n = g.nodes[i], o = new THREE.Group();
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
    if (n.mesh !== undefined) for (const m of meshes[n.mesh]) o.add(m);
    for (const c of n.children ?? []) o.add(node(c));
    return o;
  };
  const model = new THREE.Group();
  for (const i of g.scenes[g.scene ?? 0].nodes) model.add(node(i));
  // The file has its front along +Z; the viewer's car points to +X. Scale to the training model length and stand on the floor.
  const holder = new THREE.Group(); holder.add(model); model.rotation.y = Math.PI / 2;
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3());
  holder.scale.setScalar(4.55 / size.x); holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const centre = box.getCenter(new THREE.Vector3());
  holder.position.set(-centre.x, -box.min.y, -centre.z);
  let triangles = 0; holder.traverse(o => { if (o.isMesh) triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; });
  holder.userData.triangles = Math.round(triangles);
  return holder;
}

export const HOOD = { x0: 1.15, x1: 2.32, y: 0.86, w: 0.72, hinge: [1.15, 1.09, 0] };
const inHood = p => p.x > HOOD.x0 && p.x < HOOD.x1 && p.y > HOOD.y && Math.abs(p.z) < HOOD.w;

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export function createCarViewer(container, { onPick, modelId = 'B' } = {}) {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const renderer = new THREE.WebGLRenderer({ antialias: !weak, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, weak ? 1 : 1.5));
  renderer.setClearColor(0xeef2f6);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  container.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  camera.position.set(...VIEWS.overview.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...VIEWS.overview.target);
  Object.assign(controls, { enableDamping: false, minDistance: 0.6, maxDistance: 11, maxPolarAngle: Math.PI * 0.49, enablePan: true });
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4cf, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 7, 5); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-5, 3, -4); scene.add(fill);

  const mat = { floor: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }) };

  // Floor with a soft shadow disc.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), mat.floor); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d'), grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(14,42,68,0.32)'); grad.addColorStop(1, 'rgba(14,42,68,0)'); sctx.fillStyle = grad; sctx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.8), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.005; scene.add(shadow);

  const car = new THREE.Group(); scene.add(car); // training components in the engine bay
  // ---------- Components: simplified training shapes, each with its own materials for highlighting ----------
  const parts = {};
  const pm = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...extra });
  const part = id => { const g = new THREE.Group(); g.userData.componentId = id; car.add(g); parts[id] = { group: g, materials: [] }; return g; };
  const add = (g, mesh) => { mesh.userData.componentId = g.userData.componentId; g.add(mesh); if (!parts[g.userData.componentId].materials.includes(mesh.material)) parts[g.userData.componentId].materials.push(mesh.material); return mesh; };
  const pbox = (g, w, h, d, m, x, y, z) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); return add(g, mesh); };
  const pcyl = (g, r, h, m, x, y, z, rx = 0, rz = 0) => { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), m); mesh.position.set(x, y, z); mesh.rotation.set(rx, 0, rz); return add(g, mesh); };
  {
    const g = part('engine'), block = pm(0x8a96a3, { metalness: 0.5 }), cover = pm(0x4a5866, { metalness: 0.4 }), dark = pm(0x3a4652);
    pbox(g, 0.62, 0.38, 0.6, block, 1.45, 0.6, -0.05); pbox(g, 0.56, 0.08, 0.5, cover, 1.45, 0.83, -0.05);
    for (const x of [1.26, 1.39, 1.52, 1.65]) pcyl(g, 0.035, 0.05, dark, x, 0.89, -0.05);
    pcyl(g, 0.05, 0.08, pm(0x2b3640), 1.66, 0.9, 0.12); // oil filler cap
  }
  {
    const g = part('battery'), casing = pm(0x22282e), plus = pm(0xd93a2f), minus = pm(0x14222e), label = pm(0x1f6fd1);
    pbox(g, 0.28, 0.22, 0.22, casing, 1.8, 0.76, 0.42); pbox(g, 0.2, 0.005, 0.14, label, 1.8, 0.875, 0.42);
    pcyl(g, 0.025, 0.05, plus, 1.72, 0.895, 0.49); pcyl(g, 0.025, 0.05, minus, 1.88, 0.895, 0.49);
  }
  {
    const g = part('radiator'), core = pm(0xb7c1cb, { metalness: 0.6 }), fan = pm(0x2b3640);
    pbox(g, 0.06, 0.4, 1.1, core, 2.04, 0.62, 0);
    const hub = pcyl(g, 0.05, 0.08, fan, 1.95, 0.62, 0, 0, Math.PI / 2);
    pcyl(g, 0.19, 0.02, fan, 1.97, 0.62, 0, 0, Math.PI / 2).material = fan;
    for (let i = 0; i < 5; i++) { const b = pbox(g, 0.02, 0.15, 0.06, fan, 1.94, 0.62, 0); b.geometry.translate(0, 0.09, 0); b.rotation.x = (i / 5) * Math.PI * 2; }
    hub.userData.fanHub = true;
  }
  {
    const g = part('airbox'), plastic = pm(0x2b3640), duct = pm(0x3a4652);
    pbox(g, 0.32, 0.17, 0.26, plastic, 1.32, 0.8, 0.4);
    pcyl(g, 0.06, 0.2, duct, 1.32, 0.8, 0.2, Math.PI / 2, 0);
  }
  {
    const g = part('coolant_tank'), shell = pm(0xf4f6f8, { transparent: true, opacity: 0.55 }), fluid = pm(0xe25a9a), cap = pm(0x2b3640);
    pbox(g, 0.2, 0.17, 0.16, shell, 1.3, 0.78, -0.5); pbox(g, 0.18, 0.08, 0.14, fluid, 1.3, 0.74, -0.5); pcyl(g, 0.04, 0.04, cap, 1.3, 0.88, -0.5);
  }
  {
    const g = part('washer_tank'), shell = pm(0xd8ecfb, { transparent: true, opacity: 0.6 }), fluid = pm(0x3f8fe0), cap = pm(0x1f6fd1);
    pbox(g, 0.2, 0.24, 0.16, shell, 1.85, 0.68, -0.58); pbox(g, 0.18, 0.14, 0.14, fluid, 1.85, 0.64, -0.58); pcyl(g, 0.04, 0.04, cap, 1.85, 0.82, -0.58);
  }
  {
    const g = part('hoses'), rubber = pm(0x14181c, { roughness: 0.9 });
    const tube = pts => add(g, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 24, 0.028, 8), rubber));
    tube([[2.0, 0.8, -0.3], [1.88, 0.84, -0.3], [1.76, 0.78, -0.25]]);
    tube([[2.0, 0.48, -0.4], [1.88, 0.44, -0.35], [1.76, 0.5, -0.3]]);
    tube([[1.3, 0.72, -0.42], [1.25, 0.7, -0.3], [1.2, 0.72, -0.2]]);
  }
  // Ghost outline shown where a component has been removed.
  for (const [id, p] of Object.entries(parts)) {
    const b = new THREE.Box3().setFromObject(p.group), size = b.getSize(new THREE.Vector3()), centre = b.getCenter(new THREE.Vector3());
    const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.02, size.y + 0.02, size.z + 0.02)), new THREE.LineDashedMaterial({ color: 0xe0a01f, dashSize: 0.04, gapSize: 0.03 }));
    ghost.computeLineDistances(); ghost.position.copy(centre); ghost.visible = false; car.add(ghost);
    p.ghost = ghost; p.home = p.group.position.clone();
  }

  // Text labels as sprites (canvas textures): no HTML positioning needed.
  function makeLabel() {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    sprite.scale.set(0.3, 0.075, 1); sprite.center.set(0.5, 0); sprite.renderOrder = 10; sprite.visible = false; scene.add(sprite);
    sprite.userData.draw = (title, sub, tone) => {
      const c = canvas.getContext('2d'); c.clearRect(0, 0, 512, 128);
      c.fillStyle = 'rgba(255,255,255,0.96)'; c.strokeStyle = { stop: '#D93A2F', ok: '#14A39A', warn: '#E39A00' }[tone] ?? '#1F6FD1'; c.lineWidth = 6;
      c.beginPath(); c.roundRect(4, 4, 504, 120, 24); c.fill(); c.stroke();
      c.fillStyle = '#14222E'; c.font = '700 40px "Segoe UI", system-ui, sans-serif'; c.fillText(title, 26, 54);
      c.fillStyle = { stop: '#B42318', ok: '#0B7A73', warn: '#8A5A00' }[tone] ?? '#1A5FB4'; c.font = '600 32px "Segoe UI", system-ui, sans-serif'; c.fillText(sub, 26, 100);
      tex.needsUpdate = true;
    };
    return sprite;
  }
  const label = makeLabel();

  // ---------- State, picking, animation ----------
  let hoodOpen = false, hoodAngle = 0, selected = null, components = [], raf = 0, disposed = false;
  const tweens = new Set();
  const render = () => { if (!disposed) renderer.render(scene, camera); };
  const loop = now => {
    raf = 0;
    for (const t of [...tweens]) { const f = Math.min(1, (now - t.t0) / t.dur), e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2; t.step(e); if (f >= 1) { tweens.delete(t); t.done?.(); } }
    controls.update(); render();
    if (tweens.size) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf && !disposed) raf = requestAnimationFrame(loop); };
  const tween = (dur, step) => new Promise(done => { if (reduced() || dur === 0) { step(1); render(); done(); return; } tweens.add({ t0: performance.now(), dur, step, done }); kick(); });
  controls.addEventListener('change', () => { if (!tweens.size) render(); });

  function setHood(open, instant = false) {
    if (!hood) { hoodOpen = false; return Promise.resolve(); }
    hoodOpen = open;
    const from = hoodAngle, to = open ? HOOD_OPEN : 0;
    return tween(instant ? 0 : 650, e => { hoodAngle = from + (to - from) * e; placeHood(); });
  }
  function moveCamera(pos, target, dur = 700) {
    const p0 = camera.position.clone(), t0 = controls.target.clone(), p1 = new THREE.Vector3(...pos), t1 = new THREE.Vector3(...target);
    return tween(dur, e => { camera.position.lerpVectors(p0, p1, e); controls.target.lerpVectors(t0, t1, e); });
  }
  function view(name) {
    const v = VIEWS[name] ?? VIEWS.overview;
    if (v.hood && !hoodOpen) setHood(true);
    return moveCamera(v.pos, v.target);
  }
  const stateText = { missing: ['снят / отсутствует', 'warn'], installed: ['установлен · не проверен', null], checked: ['проверен', 'ok'], faulty: ['неисправен', 'stop'] };
  function paint() {
    for (const c of components) {
      const p = parts[c.id]; if (!p) continue;
      const missing = c.state === 'missing';
      p.group.visible = !missing && !p.animating; p.ghost.visible = missing && !p.animating;
      for (const m of p.materials) {
        if (!m.userData.base) m.userData.base = { emissive: m.emissive.getHex(), intensity: m.emissiveIntensity };
        const sel = selected === c.id;
        m.emissive.setHex(sel ? 0x1f6fd1 : c.state === 'faulty' ? 0xd93a2f : m.userData.base.emissive);
        m.emissiveIntensity = sel ? 0.45 : c.state === 'faulty' ? 0.35 : m.userData.base.intensity;
      }
    }
    const c = components.find(x => x.id === selected);
    if (c) {
      const [txt, tone] = stateText[c.state] ?? [c.state, null];
      label.userData.draw(c.name, txt, tone); label.position.set(ANCHORS[c.id][0], ANCHORS[c.id][1] + 0.16, ANCHORS[c.id][2]); label.visible = true;
    } else label.visible = false;
    render();
  }
  function setComponents(list) { components = list ?? []; paint(); }
  function select(id, { focus = true } = {}) {
    selected = id; paint();
    if (id && focus && ANCHORS[id]) { if (!hoodOpen) setHood(true); const [x, y, z] = ANCHORS[id]; moveCamera([x + 1.1, y + 1.5, z + (z >= 0 ? 0.75 : -0.75)], [x, y, z]); }
  }
  // Short remove/install animation; the final visibility always follows the server state set afterwards.
  async function animatePart(id, kind) {
    const p = parts[id]; if (!p) return;
    p.animating = true; p.group.visible = true; p.ghost.visible = false;
    const up = new THREE.Vector3(0, 0.55, 0);
    await tween(700, e => { const k = kind === 'remove' ? e : 1 - e; p.group.position.copy(p.home).addScaledVector(up, k); });
    p.group.position.copy(p.home); p.animating = false; paint();
  }
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) { down = null; return; }
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    // Clipped fragments are invisible but still hit by the ray: skip them by the same hood region test.
    const shown = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    for (const h of ray.intersectObjects([car, ...(body ? [body] : []), ...(hood ? [hood] : [])], true)) {
      if (h.object.isLineSegments || h.object.isSprite || !shown(h.object)) continue;
      if (h.object.userData.componentId) { onPick?.({ componentId: h.object.userData.componentId }); return; }
      if (h.object.userData.kiaHood) { if (inHood(h.point.clone().applyMatrix4(hoodInverse))) { onPick?.({ hood: true }); return; } continue; }
      if (h.object.userData.kiaBody) { if (inHood(h.point)) continue; return; }
    }
  });

  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ---------- Body: Kia Sportage with a cut-out, hinged hood ----------
  let body = null, hood = null, hoodPivot = null, hoodInverse = new THREE.Matrix4(), envTex = null, bodyError = null;
  const plane = (x, y, z, c) => new THREE.Plane(new THREE.Vector3(x, y, z), c);
  // Body: clipped only inside the hood box (all planes). Hood copy: clipped outside it (any plane).
  const bodyPlanes = [plane(-1, 0, 0, HOOD.x0), plane(1, 0, 0, -HOOD.x1), plane(0, -1, 0, HOOD.y), plane(0, 0, 1, -HOOD.w), plane(0, 0, -1, -HOOD.w)];
  const hoodBase = [plane(1, 0, 0, -HOOD.x0), plane(-1, 0, 0, HOOD.x1), plane(0, 1, 0, -HOOD.y), plane(0, 0, -1, HOOD.w), plane(0, 0, 1, HOOD.w)];
  const hoodPlanes = hoodBase.map(p => p.clone());
  function placeHood() {
    if (!hoodPivot) return;
    hoodPivot.rotation.z = hoodAngle; hoodPivot.updateMatrixWorld(true);
    const m = hood.matrixWorld;
    hoodPlanes.forEach((p, i) => p.copy(hoodBase[i]).applyMatrix4(m));
    hoodInverse.copy(m).invert();
  }
  function studioEnvironment() {
    const env = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer);
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: 0x9aa6b2, side: THREE.BackSide })));
    for (const [x, y, z, c] of [[0, 8, 0, 0xffffff], [6, 3, 4, 0xf4f7fa], [-6, 2, -3, 0xdfe6ee]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); p.position.set(x, y, z); p.lookAt(0, 0, 0); env.add(p); }
    const tex = pmrem.fromScene(env, 0.04).texture;
    env.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); pmrem.dispose();
    return tex;
  }
  const hoodMatsOf = () => { const out = new Set(); hood?.traverse(o => { if (o.isMesh) out.add(o.material); }); return out; };
  const ready = (async () => {
    try {
      envTex = studioEnvironment();
      const holder = await loadExterior(envTex, BODY_COLORS[modelId] ?? BODY_COLORS.B);
      if (disposed) { holder.traverse(o => { o.geometry?.dispose(); }); return { ok: false, error: 'закрыто' }; }
      holder.updateMatrixWorld(true);
      const region = new THREE.Box3(new THREE.Vector3(HOOD.x0, HOOD.y, -HOOD.w), new THREE.Vector3(HOOD.x1, 9, HOOD.w));
      const hoodMats = new Map(), bodyMats = new Set();
      hoodPivot = new THREE.Group(); hoodPivot.position.set(...HOOD.hinge); scene.add(hoodPivot);
      hood = new THREE.Group(); hood.position.set(-HOOD.hinge[0], -HOOD.hinge[1], -HOOD.hinge[2]); hoodPivot.add(hood);
      holder.traverse(o => {
        if (!o.isMesh) return;
        o.userData.kiaBody = true;
        if (!bodyMats.has(o.material)) { bodyMats.add(o.material); Object.assign(o.material, { clippingPlanes: bodyPlanes, clipIntersection: true }); }
        if (!new THREE.Box3().setFromObject(o).intersectsBox(region)) return;
        if (!hoodMats.has(o.material)) hoodMats.set(o.material, Object.assign(o.material.clone(), { clippingPlanes: hoodPlanes, clipIntersection: false }));
        const c = new THREE.Mesh(o.geometry, hoodMats.get(o.material));
        c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); c.userData.kiaHood = true; hood.add(c);
      });
      body = holder; scene.add(body); placeHood(); render();
      return { ok: true, triangles: holder.userData.triangles };
    } catch (e) { bodyError = e.message || 'ошибка загрузки'; render(); return { ok: false, error: bodyError }; }
  })();

  function dispose() {
    disposed = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); tweens.clear(); envTex?.dispose();
    for (const m of hoodMatsOf()) m.dispose();
    const seen = new Set();
    scene.traverse(o => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      for (const m of [].concat(o.material ?? [])) if (!seen.has(m)) { seen.add(m); m.map?.dispose(); m.dispose(); }
    });
    shadowTex.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  return {
    setComponents, select, setHood, view, animatePart, dispose, ready,
    isHoodOpen: () => hoodOpen, hasBody: () => Boolean(body), bodyError: () => bodyError,
    resetCamera: () => view('overview'),
  };
}
