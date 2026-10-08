import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the real shared client functions without a browser or a paid AI call.
const source = (await readFile(new URL('../public/app/00-core.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/m, '');
function harness() {
  const nodes = new Map();
  class Element extends EventTarget {
    textContent = ''; innerHTML = ''; hidden = false; open = false; returnValue = '';
    focus() {}
    showModal() { this.open = true; }
    clickValue(value) {
      const event = new Event('click');
      Object.defineProperty(event, 'target', { value: { closest: () => ({ value }) } });
      this.dispatchEvent(event);
    }
    close(value = 'cancel') { this.returnValue = value; this.open = false; this.dispatchEvent(new Event('close')); }
  }
  const element = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const context = vm.createContext({ document: { getElementById: element }, AbortSignal });
  vm.runInContext(`${source}\nfunction render() {}\nstate = { csrf: 'synthetic-test-token' };`, context);
  return { element, run: code => vm.runInContext(code, context), context };
}

test('confirmation cancels on Cancel and on dialog close', async () => {
  for (const close of [d => d.clickValue('cancel'), d => d.close()]) {
    const h = harness(), result = h.run("confirmAction('Проверка', '<p>Последствия</p>')");
    close(h.element('confirm'));
    assert.equal(await result, false);
  }
});

test('confirmation settles from the button even before the close event arrives', async () => {
  const h = harness(), result = h.run("confirmAction('Ремонт', '<p>Остановка поста</p>')");
  h.element('confirm').clickValue('ok');
  assert.equal(await result, true);
  h.element('confirm').close('cancel');
  assert.equal(await result, true);
});

test('a pending action suppresses another command and preserves requestId', async () => {
  const h = harness(), requests = [];
  let complete;
  h.context.fetch = (url, options) => { requests.push({ url, options }); return new Promise(resolve => { complete = resolve; }); };
  const first = h.run("action({ action: 'job', requestId: 'synthetic-job-1' })");
  assert.equal(await h.run("action({ action: 'job', requestId: 'synthetic-job-2' })"), false);
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].options.body).requestId, 'synthetic-job-1');
  assert.equal(requests[0].options.headers['X-CSRF-Token'], 'synthetic-test-token');
  complete({ ok: true, json: async () => ({ csrf: 'synthetic-test-token' }) });
  assert.equal(await first, true);
  assert.equal(h.run('updating'), false);
});

test('an unsuccessful action releases the lock and reports its error', async () => {
  const h = harness();
  h.context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Пост занят', code: 'conflict' }) });
  assert.equal(await h.run("action({ action: 'job' })"), false);
  assert.equal(h.run('updating'), false);
  assert.equal(h.element('error').textContent, 'Пост занят');
  h.context.fetch = async () => ({ ok: true, json: async () => ({ csrf: 'synthetic-test-token' }) });
  assert.equal(await h.run("action({ action: 'job' })"), true);
});

// Deliberate TODO regression: execute the assertion so the baseline gap remains visible.
// Remove TODO when wave 3 implements the guard; do not treat this as acceptance.
test('one confirmation must not approve two competing intents', { todo: 'T5 wave 3: guard dialog reentry before registering listeners' }, async () => {
  const h = harness();
  const first = h.run("confirmAction('Ремонт', '<p>Ремонт</p>')");
  const second = h.run("confirmAction('Сброс', '<p>Сброс смены</p>')");
  h.element('confirm').clickValue('ok');
  const approvals = await Promise.all([first, second]);
  assert.equal(approvals.filter(Boolean).length, 1);
});
