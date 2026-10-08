// Local persistence of the synthetic shift: versioned format, SHA-256 checksum, atomic write, integrity check on load.
// The state never contains API keys or authorization headers; the saver additionally refuses anything that looks like one.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Workshop } from './simulation.mjs';

export const STATE_FORMAT = 'allur-workshop-state';
export const STATE_VERSION = 2;
const SECRET = /(?:sk-[A-Za-z0-9_-]{16,}|nvapi-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})/;
const digest = text => createHash('sha256').update(text).digest('hex');

export function saveState(file, workshop, extraSecrets = []) {
  const data = JSON.stringify(workshop.serialize());
  if (SECRET.test(data) || extraSecrets.filter(Boolean).some(s => data.includes(s))) throw new Error('Refusing to save state that contains a credential-like value');
  const payload = JSON.stringify({ format: STATE_FORMAT, version: STATE_VERSION, savedAt: new Date().toISOString(), sha256: digest(data), data: JSON.parse(data) });
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, payload, 'utf8'); renameSync(tmp, file);
}
// Returns { workshop } on success, or { error } after moving a bad file aside.
// A failed move throws so startup cannot overwrite the only rejected state file.
export function loadState(file) {
  if (!existsSync(file)) return { error: 'missing' };
  let reason;
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    if (payload.format !== STATE_FORMAT) reason = 'unknown format';
    else if (payload.version !== STATE_VERSION) reason = `unsupported version ${payload.version}`;
    else if (digest(JSON.stringify(payload.data)) !== payload.sha256) reason = 'checksum mismatch';
    else {
      const workshop = Workshop.restore(payload.data), errors = workshop.checkIntegrity();
      if (!errors.length) return { workshop, savedAt: payload.savedAt };
      reason = `integrity: ${errors.slice(0, 3).join('; ')}`;
    }
  } catch { reason = 'unreadable'; }
  const aside = `${file}.rejected-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { renameSync(file, aside); } catch (cause) {
    throw new Error('Cannot quarantine rejected shift state; refusing to start a new shift', { cause });
  }
  return { error: reason, movedTo: aside };
}
