import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../public/app/${name}`, import.meta.url), 'utf8');
const navigation = read('55-vehicle-card.js');
const contexts = read('56-context-routes.js');
const panelSource = read('60-ribbon-side-panels.js');
const contextState = panelSource.slice(panelSource.indexOf('let chatDraft'), panelSource.indexOf('function chatPanelShell'));
const cards = read('70-space-navigation.js').split('// Camera:')[0];
const routing = read('90-routing-startup.js').split('function renderNavigation')[0];
const chatSource = read('10-dispatcher-chat.js');
const asking = chatSource.slice(chatSource.indexOf('const SIDE_CHAT'), chatSource.indexOf('async function applyProposal'));

function client() {
  const state = { vehicles: [{ id: 'DEMO-008' }, { id: 'DEMO-007' }], posts: [{ id: 'A2', code: 'СБ-2' }, { id: 'Q2', code: 'КК-2' }], problems: [{ id: 'PR-1', postId: 'A2' }], orders: [{ id: 'ORD-101' }], experiments: [{ id: 'EXP-1', problemId: 'PR-1' }], decisions: [{ id: 'DEC-1', problemId: 'PR-1' }], jobs: [{ id: 'JOB-1', problemId: 'PR-1', postId: 'A2' }, { id: 'JOB-2', postId: 'Q2' }], events: [{ seq: 7, vehicleId: 'DEMO-008' }], tasks: [], chat: [] };
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, { value: '', scrollTop: 0, querySelector: () => null, focus() {}, scrollIntoView() {} }); return elements.get(id); };
  const entries = [{ hash: 'space/assembly', state: null }]; let at = 0;
  const c = vm.createContext({ state, ui: {}, chatContext: null, chatBusy: false, view: 'space', space: 'assembly', selectedVehicle: null, currentTask: null, vehicleFilter: 'all', SPACES: { assembly: { short: 'Сборка' } }, VIEWS: ['vehicles', 'orders', 'dispatcher'], scrollY: 0, CSS: { escape: x => x },
    location: { get hash() { return '#' + entries[at].hash; } },
    history: { get state() { return entries[at].state; }, replaceState(state, _, hash) { entries[at] = { state, hash: hash ? hash.slice(1) : entries[at].hash }; }, pushState(state, _, hash) { entries.splice(at + 1); entries.push({ state, hash: hash.slice(1) }); at++; }, back() { if (at) { at--; c.setView(entries[at].hash); } }, forward() { if (at + 1 < entries.length) { at++; c.setView(entries[at].hash); } } },
    document: { addEventListener() {}, activeElement: null, body: {}, querySelectorAll: () => [], querySelector: () => null, getElementById: el }, $: el, text: (id, value) => { el(id).textContent = value; }, requestAnimationFrame: f => f(), scrollTo() {}, render() {}, renderNavigation() {}, renderRibbon() {}, updateSideChat() {}, renderVehicles() {}, destroyScene() {}, narrow: () => false, matchMedia: () => ({ matches: false }), filterOf: { all: () => true }, error() {}, post: id => state.posts.find(x => x.id === id), vehicle: id => state.vehicles.find(x => x.id === id), problem: id => state.problems.find(x => x.id === id), car3dClick: () => false });
  vm.runInContext(navigation + contexts + contextState + cards + routing + asking, c);
  return { c, entries, elements };
}

test('T1 direct links resolve ID, post code, colon and slash formats from the snapshot', () => {
  const { c } = client();
  for (const [suffix, type, id] of [['DEMO-008', 'vehicle', 'DEMO-008'], ['PR-1', 'problem', 'PR-1'], ['ORD-101', 'order', 'ORD-101'], ['A2', 'post', 'A2'], [encodeURIComponent('СБ-2'), 'post', 'A2'], ['Q2', 'post', 'Q2'], ['vehicle%3ADEMO-007', 'vehicle', 'DEMO-007'], ['vehicle/DEMO-008', 'vehicle', 'DEMO-008']]) {
    c.setView('space/assembly/problem/PR-1');
    c.setView(`space/assembly/chat/${suffix}`);
    assert.deepEqual({ ...c.chatContext }, { type, id }); assert.equal(c.ui.chatMissing, false);
  }
});

test('invalid or missing route IDs never inherit the previous context or throw on bad URI encoding', () => {
  const { c } = client();
  for (const suffix of ['MISSING', '%ZZ', 'vehicle:MISSING', '__proto__:DEMO-008', 'vehicle/', 'vehicle/DEMO-008/extra']) {
    c.setView('space/assembly/chat/DEMO-008'); c.setView(`space/assembly/chat/${suffix}`);
    assert.equal(c.chatContext, null); assert.equal(c.ui.chatMissing, true);
  }
  c.setView('orders/chat'); assert.equal(c.ui.panel.type, 'chat');
  for (const route of ['space/assembly/chat', 'orders/chat', 'space/assembly', 'orders', 'orders/order/MISSING', 'orders/order/%ZZ', 'space/assembly/vehicle/MISSING']) {
    c.setView('space/assembly/chat/DEMO-008'); c.setView(route); assert.equal(c.chatContext, null);
  }
  assert.doesNotThrow(() => c.labelForHash('space/assembly/vehicle/%ZZ'));
});

test('chat transitions, clearing and order references round-trip through Back/Forward and reload', async () => {
  const { c, entries } = client();
  c.navPush('space/assembly/vehicle/DEMO-008'); c.openChat({});
  const chatHash = c.location.hash;
  await c.cardClick({ chatClear: '1' }); assert.equal(c.chatContext, null);
  c.history.back(); assert.equal(c.chatContext.id, 'DEMO-008');
  c.history.forward(); assert.equal(c.chatContext, null);
  c.navPush(chatHash.slice(1)); c.openRef('order', 'ORD-101');
  assert.equal(c.location.hash, '#orders/order/ORD-101');
  c.history.back(); assert.equal(c.chatContext.id, 'DEMO-008');
  c.history.forward(); assert.equal(c.chatContext.id, 'ORD-101');
  c.openChat({}); assert.equal(c.location.hash, '#orders/chat/order%3AORD-101');
  const fresh = client().c; fresh.setView(c.location.hash.slice(1)); assert.equal(fresh.chatContext.id, 'ORD-101');
  const length = entries.length; c.openChat({}); assert.equal(entries.length, length, 'opening the same chat does not duplicate history');
});

test('all eight reply reference types keep their specified destination', () => {
  const { c } = client();
  const expected = { vehicle: ['DEMO-008', '#space/assembly/vehicle/DEMO-008'], post: ['A2', '#space/assembly/post/A2'], problem: ['PR-1', '#space/assembly/problem/PR-1'], order: ['ORD-101', '#orders/order/ORD-101'], experiment: ['EXP-1', '#space/assembly/compare/PR-1'], decision: ['DEC-1', '#dispatcher/decision/DEC-1'], job: ['JOB-1', '#space/assembly/problem/PR-1'], event: ['7', '#space/assembly/event/7'] };
  for (const [type, [id, hash]] of Object.entries(expected)) {
    c.navPush('space/assembly/chat/DEMO-008'); c.openRef(type, id); assert.equal(c.location.hash, hash, type);
  }
  assert.equal(c.ui.ribbonOpen, true); assert.equal(c.ui.routeRef.id, '7');
  c.openRef('job', 'JOB-2'); assert.equal(c.ui.panel.id, 'Q2');
  c.navPush('vehicles/chat/DEMO-008'); c.openRef('vehicle', 'DEMO-007');
  assert.equal(c.location.hash, '#vehicles/vehicle/DEMO-007'); assert.equal(c.ui.panel, null);
});

test('a late answer cannot erase another object draft or the context-change notice', async () => {
  const { c, elements } = client(); let finish, sent;
  c.api = (_path, body) => { sent = body; return new Promise(resolve => { finish = resolve; }); };
  c.setView('space/assembly/chat/DEMO-008'); const input = c.$('side-chat-input'); input.value = 'Original question';
  vm.runInContext("chatDraft = 'Original question'", c);
  const pending = c.ask(input.value);
  c.setView('space/assembly/chat/DEMO-007'); input.value = 'New question'; vm.runInContext("chatDraft = 'New question'; chatDraftVersion++", c);
  finish({ state: c.state }); await pending;
  assert.equal(sent.context.id, 'DEMO-008'); assert.equal(c.chatContext.id, 'DEMO-007'); assert.equal(input.value, 'New question');
  assert.equal(vm.runInContext('chatDraft', c), 'New question'); assert.equal(vm.runInContext('chatPrevContext.id', c), 'DEMO-008');
  const next = c.ask(input.value); finish({ state: c.state }); await next;
  assert.equal(input.value, ''); assert.equal(vm.runInContext('chatDraft', c), ''); assert.equal(elements.get('side-chat-count').textContent, '0/500');
});


test('return focus selects the visible initiating link, including a new handover screen', () => {
  const { c } = client(); let focused = false;
  c.VIEWS.push('handover'); c.navPush('handover');
  const hidden = { disabled: false, getClientRects: () => [], focus() { assert.fail('hidden duplicate focused'); } };
  const opener = { id: '', tagName: 'BUTTON', attributes: [{ name: 'data-vehicle', value: 'DEMO-008' }], disabled: false, getClientRects: () => [{}], closest: () => ({}), focus() { focused = true; } };
  c.document.activeElement = opener; c.document.querySelectorAll = selector => selector.startsWith('button[data-vehicle') ? [hidden, opener] : []; c.getComputedStyle = () => ({ visibility: 'visible' });
  c.openCard('vehicle', 'DEMO-008'); assert.equal(c.view, 'handover');
  c.closePanel(); c.restoreNavigationFocus();
  assert.equal(c.location.hash, '#handover'); assert.equal(focused, true);
});

