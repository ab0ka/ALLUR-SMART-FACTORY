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
  const context = vm.createContext({ MutationObserver: class { observe() {} disconnect() {} }, document: { querySelectorAll: () => [], getElementById: element }, AbortSignal });
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

test('one confirmation must not approve two competing intents', async () => {
  const h = harness();
  const first = h.run("confirmAction('Ремонт', '<p>Ремонт</p>')");
  const second = h.run("confirmAction('Сброс', '<p>Сброс смены</p>')");
  h.element('confirm').clickValue('ok');
  const approvals = await Promise.all([first, second]);
  assert.equal(approvals.filter(Boolean).length, 1);
});


test('competing confirmation preserves the original consequences', async () => {
  const h = harness();
  const first = h.run("confirmAction('Original', '<p>Original effect</p>')");
  assert.equal(await h.run("confirmAction('Other', '<p>Other effect</p>')"), false);
  assert.equal(h.element('confirm-title').textContent, 'Original');
  assert.equal(h.element('confirm-body').innerHTML, '<p>Original effect</p>');
  h.element('confirm').clickValue('cancel');
  assert.equal(await first, false);
});

test('pending request does not open another confirmation', async () => {
  const h = harness();
  h.run('updating = true');
  assert.equal(await h.run("confirmAction('Other', '')"), false);
  assert.equal(h.element('confirm').open, false);
});

test('late close does not dismiss the next dialog before confirmation', async () => {
  const h = harness(), d = h.element('confirm');
  const first = h.run("confirmAction('First', '')");
  d.clickValue('ok');
  assert.equal(await first, true);
  d.open = false; // Native default closes the dialog; close event is queued.
  const second = h.run("confirmAction('Second', '')");
  d.dispatchEvent(new Event('close'));
  d.clickValue('ok');
  assert.equal(await second, true);
});

test('Escape cancels a newly opened confirmation', async () => {
  const h = harness();
  const result = h.run("confirmAction('Escape', '')");
  h.element('confirm').dispatchEvent(new Event('cancel'));
  assert.equal(await result, false);
});

test('busy controls restore their own labels and availability after replacement and error', async () => {
  const h = harness();
  const first = { disabled: false, textContent: 'Выпустить' }, unavailable = { disabled: true, textContent: 'Недоступно' };
  let buttons = [first, unavailable], reject;
  h.context.document.querySelectorAll = () => buttons;
  h.context.fetch = async () => new Promise((_ok, fail) => { reject = fail; });
  const pending = h.run("action({ action: 'release' })");
  assert.equal(first.disabled, true); assert.equal(first.textContent, 'Выполняется…');
  const replacement = { disabled: false, textContent: 'Перевести' }; buttons = [replacement];
  h.run('renderProductionBusy()'); assert.equal(replacement.disabled, true);
  reject(new Error('network failure')); assert.equal(await pending, false);
  assert.equal(first.disabled, false); assert.equal(first.textContent, 'Выпустить');
  assert.equal(unavailable.disabled, true); assert.equal(unavailable.textContent, 'Недоступно');
  assert.equal(replacement.disabled, false); assert.equal(replacement.textContent, 'Перевести');
});
