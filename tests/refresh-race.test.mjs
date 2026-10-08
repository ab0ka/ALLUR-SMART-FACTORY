import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
const core = (await readFile(new URL('../public/app/00-core.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/m, '');
const dispatcher = await readFile(new URL('../public/app/10-dispatcher-chat.js', import.meta.url), 'utf8');
const routing = await readFile(new URL('../public/app/90-routing-startup.js', import.meta.url), 'utf8');
const refresh = routing.slice(routing.indexOf('async function refresh()'), routing.indexOf('await refresh();'));
function harness() {
  const elements = new Map();
  const context = vm.createContext({ MutationObserver: class { observe() {} disconnect() {} }, AbortSignal, crypto: webcrypto, document: { querySelectorAll: () => [], getElementById: id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true, open: false, scrollIntoView() {} });
    return elements.get(id);
  } } });
  vm.runInContext(`${core}\n${dispatcher}\n${refresh}\nfunction render() {}\nview = 'dispatcher'; const ui = {}; function syncHash() {}`, context);
  return { context, run: s => vm.runInContext(s, context), elements };
}
const original = () => ({ revision: 10, recordVersion: 2, csrf: 'synthetic', jobs: [], posts: [], problems: [], jobKinds: [], experiments: [{ id: 'EXP-1', problemId: 'PR-1', options: [{ id: 'continue', commands: [], expected: {} }] }] });
const response = state => ({ ok: true, json: async () => state });
for (const kind of ['release', 'reset', 'decision']) test(`slow poll cannot replace completed ${kind}`, async () => {
  const h = harness(), old = original();
  // Reset deliberately decreases revision: ordering cannot be inferred from revision alone.
  const latest = { ...original(), revision: kind === 'reset' ? 1 : 11, marker: kind };
  h.context.initial = old; h.run('state = initial');
  let finishPoll;
  h.context.fetch = async (url, options) => options.method === 'POST'
    ? response(url === '/api/decision' ? { state: latest } : latest)
    : new Promise(resolve => { finishPoll = resolve; });
  const poll = h.run('refresh()');
  await h.run(kind === 'decision' ? "applyDecision('EXP-1', 'continue', true)" : `action({ action: '${kind}' })`);
  assert.equal(h.run('state'), latest);
  finishPoll(response(old)); await poll;
  assert.equal(h.run('state'), latest);
  assert.equal(h.run('fetching'), false);
});

test('failed old poll cannot display a connection error after successful action', async () => {
  const h = harness(); h.context.initial = original(); h.run('state = initial');
  let failPoll;
  h.context.fetch = async (_url, options) => options.method === 'POST'
    ? response({ ...original(), revision: 11 }) : new Promise((_resolve, reject) => { failPoll = reject; });
  const poll = h.run('refresh()');
  await h.run("action({ action: 'release' })");
  failPoll(new Error('old GET disconnected')); await poll;
  assert.equal(h.elements.get('error').hidden, true);
});

test('uncontested polls still accept snapshots, including a restarted server', async () => {
  const h = harness(); h.context.initial = original(); h.run('state = initial');
  const next = { ...original(), revision: 1, csrf: 'restarted-server' };
  h.context.fetch = async () => response(next);
  await h.run('refresh()'); assert.equal(h.run('state'), next);
  h.context.fetch = async () => { throw new Error('offline'); };
  await h.run('refresh()'); assert.equal(h.elements.get('error').hidden, false);
});

test('stale decision is invalidated immediately and cannot be resent', async () => {
  const h = harness(); h.context.initial = original(); h.run('state = initial');
  let posts = 0;
  h.context.fetch = async () => { posts++; return { ok: false, json: async () => ({ code: 'stale', error: 'server conflict' }) }; };
  await h.run("applyDecision('EXP-1', 'continue', true)");
  assert.equal(h.run("rejectedComparisons.has('EXP-1')"), true);
  assert.equal(h.run('ui.panel.type'), 'compare');
  assert.match(h.elements.get('error').textContent, /Снимок устарел/);
  assert.equal(h.run('productionPending'), false);
  await h.run("applyDecision('EXP-1', 'continue', true)");
  assert.equal(posts, 1);
});
