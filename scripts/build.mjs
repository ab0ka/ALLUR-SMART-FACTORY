import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CAR_SPRITES = ["car-kia-a-done.webp", "car-kia-a-body.webp", "car-kia-b-done.webp", "car-kia-b-body.webp", "car-kia-c-done.webp", "car-kia-c-body.webp"]; // scripts/render-car-sprites.mjs
export const PUBLIC_ASSETS = ['index.html', 'styles.css', 'app.js', 'scene.js', 'viewer3d.js', 'three.module.js', 'three-orbit-controls.js', 'favicon.svg', ...CAR_SPRITES];
// The client script is kept as ordered parts in public/app/ (NN-name.js) so several people can work on different
// screens without editing one large file. The build joins them in name order into a single dist/app.js.
export const APP_PART = /^\d{2}-[a-z0-9-]+\.js$/;
export async function assembleApp(publicDir) {
  const dir = path.join(publicDir, 'app');
  const parts = (await readdir(dir)).filter(name => APP_PART.test(name)).sort();
  if (!parts.length) throw new Error('No client parts in public/app');
  // A newline ends trailing // comments; a semicolon prevents expressions from spanning files.
  return { parts, code: (await Promise.all(parts.map(name => readFile(path.join(dir, name), 'utf8')))).join('\n;\n') };
}
// dist is built from an allowlist. Unknown entries are moved (not deleted) to a timestamped quarantine folder.
export async function buildDist({ publicDir = path.join(root, 'public'), distDir = path.join(root, 'dist'), quarantineRoot = path.join(root, 'build-quarantine'), now = new Date() } = {}) {
  // Validate the complete source snapshot before touching the previous build or its quarantine.
  const assets = await Promise.all(PUBLIC_ASSETS.map(async file => ({
    file, data: file === 'app.js' ? (await assembleApp(publicDir)).code : await readFile(path.join(publicDir, file), file.endsWith('.webp') ? undefined : 'utf8'),
  })));
  const secrets = [process.env.NVIDIA_API_KEY, process.env.OPENAI_API_KEY].map(s => s?.trim()).filter(Boolean);
  for (const { file, data } of assets) {
    if (file.endsWith('.webp')) continue; // Preserve opaque binary assets; inspect text assets for credentials.
    if (/(?:nvapi-|sk-)[A-Za-z0-9_-]{16,}/.test(data) || secrets.some(secret => data.includes(secret))) throw new Error(`Possible secret in client asset ${file}`);
  }
  for (const { file, data } of assets.filter(asset => asset.file.endsWith('.js'))) {
    try {
      execFileSync(process.execPath, ['--check', '--input-type=module'], { input: data, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      throw new Error(`Invalid JavaScript in client asset ${file}\n${error.stderr || error.message}`);
    }
  }
  await mkdir(distDir, { recursive: true });
  const strays = (await readdir(distDir)).filter(name => !PUBLIC_ASSETS.includes(name));
  let quarantineDir = null;
  if (strays.length) {
    quarantineDir = path.join(quarantineRoot, now.toISOString().replace(/[:.]/g, '-'));
    await mkdir(quarantineDir, { recursive: true });
    for (const name of strays) await rename(path.join(distDir, name), path.join(quarantineDir, name));
  }
  for (const { file, data } of assets) await writeFile(path.join(distDir, file), data);
  const result = (await readdir(distDir)).sort();
  if (result.join() !== [...PUBLIC_ASSETS].sort().join()) throw new Error(`Unexpected dist contents: ${result.join(', ')}`);
  return { files: result, strays, quarantineDir };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of ['server/index.mjs', 'server/simulation.mjs', 'server/ai.mjs', 'server/ai-config.mjs', 'scripts/build.mjs']) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
  const { files, strays, quarantineDir } = await buildDist();
  const { parts } = await assembleApp(path.join(root, 'public'));
  if (strays.length) console.log(`Moved ${strays.length} unexpected dist entr${strays.length === 1 ? 'y' : 'ies'} to ${path.relative(root, quarantineDir)}: ${strays.join(', ')}`);
  console.log(`Build OK: ${files.length} public assets in dist (${files.join(', ')}); app.js assembled from ${parts.length} parts; server and environment excluded.`);
}
