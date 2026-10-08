import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function client() {
  const navigation = readFileSync(new URL('../public/app/70-space-navigation.js', import.meta.url), 'utf8').split('// Camera:')[0];
  const routingSource = readFileSync(new URL('../public/app/90-routing-startup.js', import.meta.url), 'utf8');
  const routing = routingSource.split('function focusKey')[0] + routingSource.slice(routingSource.indexOf('function openOrder('), routingSource.indexOf('function openRef('));
  const state = { vehicles: [{ id: 'DEMO-008' }], posts: [{ id: 'A2' }], problems: [{ id: 'PR-1' }], orders: [{ id: 'ORD-101' }], experiments: [{ id: 'EXP-1', problemId: 'PR-1' }, { id: 'EXP-2', problemId: 'PR-1' }], decisions: [{ id: 'DEC-1', problemId: 'PR-1' }], jobs: [{ id: 'JOB-1', problemId: 'PR-1' }], events: [{ seq: 7, vehicleId: 'DEMO-008' }] };
  const c = vm.createContext({ state, ui: { panel: null, selected: null }, chatContext: null, view: 'space', space: 'assembly', SPACES: { assembly: {} }, VIEWS: ['dispatcher', 'orders'], location: { hash: '' }, history: { pushState(_a, _b, hash) { c.location.hash = hash; } }, document: { querySelectorAll: () => [] }, $: () => ({ querySelector: () => null }), render() {}, renderRibbon() {}, updateSideChat() {}, narrow: () => false, requestAnimationFrame() {}, destroyScene() {}, problem: id => state.problems.find(p => p.id === id) });
  vm.runInContext(navigation + routing, c);
  return c;
}

test('chat link restores the selected vehicle after reload and sends no stale context for bare chat', async () => {
  const c = client();
  vm.runInContext("selectVehicle('DEMO-008')", c);
  await c.spaceClick(null, { openChat: '1' });
  assert.equal(c.location.hash, '#space/assembly/chat/vehicle/DEMO-008');
  const fresh = client(); fresh.setView(c.location.hash.slice(1));
  assert.equal(fresh.chatContext.id, 'DEMO-008');
  assert.equal(fresh.ui.selected.id, 'DEMO-008');
  fresh.setView('space/assembly/chat');
  assert.equal(fresh.chatContext, null);
  assert.equal(fresh.ui.selected, null);
});

test('chat context supports every server context type and clearing updates its link', async () => {
  const c = client();
  for (const [type, id] of [['vehicle', 'DEMO-008'], ['post', 'A2'], ['problem', 'PR-1'], ['order', 'ORD-101']]) {
    c.setView(`space/assembly/chat/${type}/${id}`);
    assert.equal(c.chatContext.type, type);
    assert.equal(c.chatContext.id, id);
  }
  for (const route of ['vehicle/MISSING', 'vehicle/%ZZ', 'unknown/DEMO-008', '__proto__/DEMO-008']) {
    c.setView(`space/assembly/chat/${route}`);
    assert.equal(c.chatContext, null);
  }
  await c.spaceClick(null, { chatClear: '1' });
  assert.equal(c.location.hash, '#space/assembly/chat');
});

test('reply references retain the exact entity ID, including older comparisons and events', () => {
  const c = client();
  for (const [type, id] of [['vehicle', 'DEMO-008'], ['post', 'A2'], ['problem', 'PR-1'], ['experiment', 'EXP-1'], ['decision', 'DEC-1'], ['job', 'JOB-1'], ['event', '7']]) {
    c.openRefSpace(type, id);
    assert.equal(c.ui.panel.type, type);
    assert.equal(c.ui.panel.id, id);
    const fresh = client(); fresh.setView(c.location.hash.slice(1));
    assert.equal(fresh.ui.panel.type, type);
    assert.equal(fresh.ui.panel.id, id);
  }
  c.view = 'dispatcher'; c.openRefSpace('experiment', 'EXP-1');
  assert.equal(c.location.hash, 'space/assembly/experiment/EXP-1');
});


test('plain space and invalid object routes cannot inherit the previous chat context', async () => {
  const c = client();
  for (const route of ['space/assembly', 'space/assembly/vehicle/MISSING', 'space/assembly/vehicle', 'space/assembly/post/%ZZ']) {
    c.setView('space/assembly/chat/vehicle/DEMO-008');
    c.setView(route);
    assert.equal(c.chatContext, null);
    assert.equal(c.ui.selected, null);
    await c.spaceClick(null, { openChat: '1' });
    assert.equal(c.chatContext, null);
  }
});

test('old ID-only chat links resolve existing unique objects and never fall back to a previous selection', () => {
  const c = client();
  for (const [id, type] of [['DEMO-008', 'vehicle'], ['A2', 'post'], ['PR-1', 'problem'], ['ORD-101', 'order']]) {
    c.setView(`space/assembly/chat/${id}`);
    assert.equal(c.chatContext.type, type);
    assert.equal(c.chatContext.id, id);
  }
  for (const route of ['MISSING', '%ZZ', 'vehicle', 'vehicle/', 'vehicle/DEMO-008/extra']) {
    c.setView('space/assembly/chat/vehicle/DEMO-008');
    c.setView(`space/assembly/chat/${route}`);
    assert.equal(c.chatContext, null);
  }
});

test('card/chat navigation adds history entries without duplicates and restores contexts in both directions', async () => {
  const c = client(), entries = [];
  c.history.pushState = (_a, _b, hash) => { entries.push(hash); c.location.hash = hash; };
  vm.runInContext("selectVehicle('DEMO-008')", c);
  await c.spaceClick(null, { openChat: '1' });
  c.openRefSpace('post', 'A2');
  await c.spaceClick(null, { openChat: '1' });
  await c.spaceClick(null, { openChat: '1' });
  assert.equal(entries.length, 4);
  for (const i of [2, 1, 0, 1, 2, 3]) {
    c.setView(entries[i].slice(1));
    assert.equal(c.chatContext.id, i < 2 ? 'DEMO-008' : 'A2');
  }
});

test('a delayed chat reply preserves a different object draft and its context', async () => {
  const source = readFileSync(new URL('../public/app/10-dispatcher-chat.js', import.meta.url), 'utf8');
  const askSource = source.slice(source.indexOf('async function ask('), source.indexOf('async function applyProposal('));
  let finish, submitted;
  const firstInput = { value: 'Original question' }, secondInput = { value: 'New vehicle question' };
  let activeInput = firstInput;
  const button = {}, count = {};
  const c = vm.createContext({ chatBusy: false, chatContext: { type: 'vehicle', id: 'DEMO-008' }, state: {}, LEGACY_CHAT: { input: 'input', send: 'send', count: 'count' }, $: id => id === 'input' ? activeInput : id === 'send' ? button : count, api: (_path, body) => { submitted = body; return new Promise(resolve => { finish = resolve; }); }, error() {}, render() {} });
  vm.runInContext(askSource, c);
  const pending = c.ask(firstInput.value);
  c.chatContext = { type: 'vehicle', id: 'DEMO-007' }; activeInput = secondInput;
  finish({ state: { chat: [] } }); await pending;
  assert.equal(submitted.context.id, 'DEMO-008');
  assert.equal(c.chatContext.id, 'DEMO-007');
  assert.equal(secondInput.value, 'New vehicle question');
  const next = c.ask(secondInput.value); finish({ state: {} }); await next;
  assert.equal(secondInput.value, '');
});


test('order reply links restore the exact order on Back/Forward and a fresh page', () => {
  const c = client();
  const original = 'space/assembly/chat/vehicle/DEMO-008';
  c.setView(original);
  c.openRefSpace('order', 'ORD-101');
  assert.equal(c.location.hash, 'orders/ORD-101');
  c.setView(c.location.hash);
  assert.equal(c.chatContext.type, 'order');
  assert.equal(c.chatContext.id, 'ORD-101');
  c.setView(original);
  assert.equal(c.chatContext.id, 'DEMO-008');
  c.setView('orders/ORD-101');
  assert.equal(c.chatContext.id, 'ORD-101');
  const fresh = client(); fresh.setView('orders/ORD-101');
  assert.equal(fresh.chatContext.id, 'ORD-101');
  fresh.openPanel({ type: 'chat' }, null, fresh.chatContext);
  assert.equal(fresh.location.hash, 'space/assembly/chat/order/ORD-101');
  fresh.setView(fresh.location.hash);
  assert.equal(fresh.chatContext.id, 'ORD-101');
});

test('bare and invalid order routes clear earlier vehicle and order chat contexts', () => {
  const c = client();
  for (const route of ['orders', 'orders/', 'orders/MISSING', 'orders/%ZZ', 'orders/ORD-101/extra']) {
    for (const prior of ['space/assembly/chat/vehicle/DEMO-008', 'orders/ORD-101']) {
      c.setView(prior); c.setView(route);
      assert.equal(c.chatContext, null);
    }
  }
});
