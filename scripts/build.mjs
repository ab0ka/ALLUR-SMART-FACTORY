import { mkdir, copyFile, readFile, readdir, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_ASSETS = ['index.html', 'styles.css', 'app.js', 'scene.js', 'favicon.svg'];
// dist is built from an allowlist. Unknown entries are moved (not deleted) to a timestamped quarantine folder.
export async function buildDist({ publicDir = path.join(root, 'public'), distDir = path.join(root, 'dist'), quarantineRoot = path.join(root, 'build-quarantine'), now = new Date() } = {}) {
  await mkdir(distDir, { recursive: true });
  const strays = (await readdir(distDir)).filter(name => !PUBLIC_ASSETS.includes(name));
  let quarantineDir = null;
  if (strays.length) {
    quarantineDir = path.join(quarantineRoot, now.toISOString().replace(/[:.]/g, '-'));
    await mkdir(quarantineDir, { recursive: true });
    for (const name of strays) await rename(path.join(distDir, name), path.join(quarantineDir, name));
  }
  const secrets = [process.env.NVIDIA_API_KEY, process.env.OPENAI_API_KEY].map(s => s?.trim()).filter(Boolean);
  for (const file of PUBLIC_ASSETS) {
    const data = await readFile(path.join(publicDir, file), 'utf8');
    if (/(?:nvapi-|sk-)[A-Za-z0-9_-]{16,}/.test(data) || secrets.some(secret => data.includes(secret))) throw new Error(`Possible secret in client asset ${file}`);
    await copyFile(path.join(publicDir, file), path.join(distDir, file));
  }
  const result = (await readdir(distDir)).sort();
  if (result.join() !== [...PUBLIC_ASSETS].sort().join()) throw new Error(`Unexpected dist contents: ${result.join(', ')}`);
  return { files: result, strays, quarantineDir };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of ['public/app.js', 'public/scene.js', 'server/index.mjs', 'server/simulation.mjs', 'server/ai.mjs', 'server/ai-config.mjs', 'scripts/build.mjs']) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
  const { files, strays, quarantineDir } = await buildDist();
  if (strays.length) console.log(`Moved ${strays.length} unexpected dist entr${strays.length === 1 ? 'y' : 'ies'} to ${path.relative(root, quarantineDir)}: ${strays.join(', ')}`);
  console.log(`Build OK: ${files.length} public assets in dist (${files.join(', ')}); server and environment excluded.`);
}
