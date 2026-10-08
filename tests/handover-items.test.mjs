import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app/46-handover-items.js', import.meta.url), 'utf8');
// No DOM, fetch or application state is supplied: rendering must be self-contained.
const render = vm.runInNewContext(`${source}\nrenderHandoverItems`);

test('handover items: all empty sections, no mutation controls or inline CSP violations', () => {
  for (const value of [undefined, null, {}, { resources: {}, problems: null }]) {
    const html = render(value);
    assert.equal((html.match(/<section /g) ?? []).length, 8);
    assert.equal((html.match(/class="handover-items-empty"/g) ?? []).length, 8);
    assert.doesNotMatch(html, /<button|<script|\sstyle=|\son\w+=|undefined|null/);
  }
});

test('handover items: escaped text, encoded links, Cyrillic and numeric zero IDs', () => {
  const attack = `<img src=x onerror="alert('x')">&`;
  const id = `ПР /#?"'&`;
  const html = render({
    problems: [{ id, title: attack, status: 'open', postId: 0, postCode: 'СБ-0', vehicleIds: [id], detectedAt: 0 }],
    tasks: [{ id: 'Т-0', title: attack, object: { type: 'order', id: 0 }, reason: attack, next: attack, certaintyText: attack, since: 0 }],
    orders: [{ id: 0, modelId: 'Кириллица', quantity: 0, accepted: 0, shipped: 0, dueMinute: 0, overdue: false }],
    resources: { stock: [{ id: 0, name: attack, onHand: 0, reserved: 0, available: 0 }] },
    events: [{ id: 0, minute: 0, text: attack, kind: attack, problemId: id, vehicleId: 0 }],
  });
  assert.doesNotMatch(html, /<img|<script|href="javascript:|<dd>undefined/);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;'));
  const encoded = encodeURIComponent(id).replaceAll("'", '&#39;');
  assert.ok(html.includes(`href="#dispatcher/problem/${encoded}"`));
  assert.ok(html.includes(`href="#vehicles/vehicle/${encoded}"`));
  assert.ok(html.includes('href="#workshop/post/0"'));
  assert.ok(html.includes('href="#orders/order/0"'));
  assert.ok(html.includes('Кириллица'));
  assert.ok((html.match(/<dd>0<\/dd>/g) ?? []).length >= 9);
  assert.ok(html.includes('<dd>Нет</dd>'));
  const keys = [...html.matchAll(/data-focus-key="([^"]*)"/g)].map(m => m[1]);
  assert.equal(new Set(keys).size, keys.length);
});

test('handover items: current work only, unresolved problems retained and latest 20 events', () => {
  const html = render({
    problems: [{ id: 'closed', status: 'closed' }, { id: 'unresolved', status: 'unresolved', title: 'Нерешённая' }],
    jobs: [{ id: 'done-job', status: 'done' }, { id: 'running-job', status: 'running', remaining: 0 }, { id: 'queued-job', status: 'queued' }],
    orders: [{ id: 'done-order', state: 'completed' }],
    events: Array.from({ length: 25 }, (_, id) => ({ id, minute: id, text: `EVENT-${id}!` })),
  });
  assert.doesNotMatch(html, /done-job|done-order|EVENT-0!/);
  for (const text of ['Нерешённая', 'running-job', 'queued-job']) assert.ok(html.includes(text));
  assert.ok(html.indexOf('EVENT-24!') < html.indexOf('EVENT-5!'));
  assert.equal((html.match(/EVENT-\d+!/g) ?? []).length, 20);
});

test('handover items: deterministic sorting, accessible overflow and stable unique focus keys', () => {
  const report = { problems: Array.from({ length: 8 }, (_, i) => ({ id: `PR-${8-i}`, status: 'open', postId: 'A1' })) };
  const before = JSON.stringify(report);
  const html = render(report);
  assert.equal(JSON.stringify(report), before);
  assert.equal(render(report), html);
  assert.ok(html.indexOf('PR-2</a>') < html.indexOf('PR-8</a>'));
  assert.match(html, /<summary data-focus-key="handover-items:problems:more">Открытые проблемы: ещё 3<\/summary>/);
  const keys = [...html.matchAll(/data-focus-key="([^"]*)"/g)].map(m => m[1]);
  assert.equal(new Set(keys).size, keys.length);
  const reversed = render({ problems: [...report.problems].reverse() });
  assert.equal(reversed, html);
});

test('handover items: missing IDs have no bogus links; unknown object types cannot create routes', () => {
  const html = render({ tasks: [{ title: 'Без ссылки', object: { type: 'javascript:', id: 'bad' } }], problems: [{ status: 'open', title: 'Без ID' }], resources: { heldPosts: [{ code: 'Без ID' }] } });
  assert.doesNotMatch(html, /<a\b|href=/);
  assert.match(html, /Без ссылки/);
});

test('handover items: duplicate, missing and special IDs have distinct escaped focus keys', () => {
  const html = render({ tasks: [undefined, null, ...[undefined, 'missing', 0, 0, `"<&'`].map(id => ({ id, object: { type: 'post', id: 0 }, postId: 0, title: 'Задача' }))] });
  const keys = [...html.matchAll(/data-focus-key="([^"]*)"/g)].map(m => m[1]);
  assert.equal(keys.length, 10);
  assert.equal(new Set(keys).size, keys.length);
  assert.doesNotMatch(html, /data-focus-key="[^"]*</);
});
