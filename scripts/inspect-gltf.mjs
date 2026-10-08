// Inspects a glTF/GLB file without dependencies: format, size, node hierarchy, meshes and triangles, materials,
// textures, animations and nodes whose names look like separate body parts (hood, doors, engine, wheels...).
// Usage: node scripts/inspect-gltf.mjs assets-src/kia-sportage/scene.gltf   (or a .glb file)
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('Укажите путь к .glb или .gltf'); process.exit(1); }
const buf = readFileSync(file), size = statSync(file).size;
let json, binSize = 0;
if (buf.readUInt32LE(0) === 0x46546c67) { // 'glTF'
  const jsonLen = buf.readUInt32LE(12);
  json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  binSize = buf.length > 20 + jsonLen ? buf.readUInt32LE(20 + jsonLen) : 0;
} else json = JSON.parse(buf.toString('utf8'));

const acc = json.accessors ?? [], meshes = json.meshes ?? [], nodes = json.nodes ?? [];
const tris = m => (m.primitives ?? []).reduce((n, p) => n + ((p.mode ?? 4) === 4 ? Math.floor((p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count) / 3) : 0), 0);
const total = meshes.reduce((n, m) => n + tris(m), 0);
console.log(`Файл: ${path.basename(file)} · ${(size / 1048576).toFixed(1)} МБ · ${buf.readUInt32LE(0) === 0x46546c67 ? 'GLB' : 'glTF (JSON)'} · генератор: ${json.asset?.generator ?? '—'}`);
if (json.buffers?.some(b => b.uri && !b.uri.startsWith('data:'))) console.log('Внешние буферы:', json.buffers.map(b => b.uri).join(', '));
console.log(`Узлов: ${nodes.length} · мешей: ${meshes.length} · треугольников: ${total.toLocaleString('ru-RU')} · материалов: ${(json.materials ?? []).length} · текстур: ${(json.textures ?? []).length} · изображений: ${(json.images ?? []).length} · анимаций: ${(json.animations ?? []).length}`);
if (binSize) console.log(`Бинарный блок GLB: ${(binSize / 1048576).toFixed(1)} МБ`);

const PART = /(hood|bonnet|капот|door|двер|trunk|boot|tailgate|багаж|engine|motor|двиг|battery|аккум|radiator|радиат|wheel|tire|tyre|(?<![a-z])rims?(?![a-z])|колес|interior|seat|салон|dash|steer)/i;
// «WO_Wheels» (without wheels) в именах экспорта Sketchfab — не колесо; убираем перед проверкой.
const isPart = name => PART.test(name.replace(/W(ith)?_?O(ut)?_+Wheels/gi, ''));
const parents = new Map(); nodes.forEach((n, i) => (n.children ?? []).forEach(c => parents.set(c, i)));
const roots = (json.scenes?.[json.scene ?? 0]?.nodes) ?? nodes.map((_, i) => i).filter(i => !parents.has(i));
const lines = [];
const walk = (i, depth) => {
  const n = nodes[i], m = n.mesh !== undefined ? meshes[n.mesh] : null;
  if (depth < 6) lines.push(`${'  '.repeat(depth)}- ${n.name || `node ${i}`}${m ? ` [меш «${m.name ?? n.mesh}», ${tris(m).toLocaleString('ru-RU')} тр., материалы: ${[...new Set(m.primitives.map(p => json.materials?.[p.material]?.name ?? p.material))].join(', ')}]` : ''}${isPart(n.name ?? '') ? '  ← похоже на отдельную деталь' : ''}`);
  for (const c of n.children ?? []) walk(c, depth + 1);
};
roots.forEach(r => walk(r, 0));
console.log('\nИерархия (до 6 уровней):'); console.log(lines.slice(0, 400).join('\n')); if (lines.length > 400) console.log(`… и ещё ${lines.length - 400} строк`);
const named = nodes.map((n, i) => [i, n.name ?? '']).filter(([, nm]) => isPart(nm));
console.log(`\nУзлы с «говорящими» именами (${named.length}):`, named.slice(0, 60).map(([i, nm]) => `${nm}#${i}`).join(', ') || 'нет');
console.log('Материалы:', (json.materials ?? []).map(m => m.name).join(', '));
