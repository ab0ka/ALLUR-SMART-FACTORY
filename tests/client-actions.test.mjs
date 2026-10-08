import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
// Source: docs/tasks/tony-2026-10-08.md, T5 + common introduction.
const CHANGING = new Set(['release', 'priority', 'plan', 'fault', 'job', 'transfer', 'hold']);
const files = await readdir(new URL('../public/app/', import.meta.url));
const sources = new Map(await Promise.all(files.filter(f => f.endsWith('.js')).map(async f => [f, await readFile(new URL(`../public/app/${f}`, import.meta.url), 'utf8')])));
function objectEnd(s, start) {
  let depth = 0, quote = null;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if ('\'"`'.includes(ch)) { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return i + 1;
  }
  throw new Error('Unclosed command object');
}
function calls(s) {
  return [...s.matchAll(/\baction\(\s*\{|\bapi\('\/api\/decision',\s*\{/g)].map(m => {
    const start = m.index + m[0].lastIndexOf('{'), end = objectEnd(s, start), body = s.slice(start, end);
    const literal = body.match(/action:\s*'([^']+)'/)?.[1];
    const kind = m[0].startsWith('api') ? 'decision' : literal ?? (/\.\.\.p\.command/.test(body) ? 'proposal' : /action:\s*op\b/.test(body) ? 'vehicleOp' : 'control');
    return { start, end, body, kind, callStart: m.index };
  }).filter(c => CHANGING.has(c.kind) || ['decision', 'proposal', 'vehicleOp'].includes(c.kind));
}
function check(s, file) {
  const found = calls(s);
  for (const c of found) {
    assert.match(c.body, /requestId:\s*requestId\(\)/, `${file} ${c.kind}: requestId required`);
    const boundary = Math.max(s.lastIndexOf('addEventListener(', c.callStart), s.lastIndexOf('async function ', c.callStart));
    const handler = s.slice(boundary, c.callStart);
    assert.match(handler, /confirmAction\(/, `${file} ${c.kind}: confirmation in handler required`);
    if (c.kind === 'vehicleOp') assert.match(handler, /CONFIRM_OPS\.has\(op\)/);
  }
  return found;
}
test('all production calls have an id and confirmation in their handler', () => {
  const kinds = new Set();
  for (const [file, s] of sources) for (const c of check(s, file)) kinds.add(c.kind);
  for (const k of [...CHANGING, 'decision', 'proposal', 'vehicleOp']) assert.ok(kinds.has(k), `Missing coverage: ${k}`);
});
for (const [file, s] of sources) for (const [index, c] of calls(s).entries()) {
  test(`contract rejects removed requestId: ${file} ${c.kind} #${index}`, () => {
    const body = c.body.replace(/requestId:\s*requestId\(\)/, 'removedRequestId: undefined');
    assert.notEqual(body, c.body);
    assert.throws(() => check(s.slice(0, c.start) + body + s.slice(c.end), file), /requestId required/);
  });
}
