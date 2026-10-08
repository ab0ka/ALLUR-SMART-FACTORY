import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function client() {
  const navigation = readFileSync(new URL('../public/app/70-space-navigation.js', import.meta.url), 'utf8').split('// Camera:')[0];
  const routing = readFileSync(new URL('../public/app/90-routing-startup.js', import.meta.url), 'utf8').split('function focusKey')[0];
  const state = { vehicles: [{ id: 'DEMO-008' }], posts: [{ id: 'A2' }], problems: [{ id: 'PR-1' }], orders: [{ id: 'ORD-101' }], experiments: [{ id: 'EXP-1', problemId: 'PR-1' }, { id: 'EXP-2', problemId: 'PR-1' }], decisions: [{ id: 'DEC-1', problemId: 'PR-1' }], jobs: [{ id: 'JOB-1', problemId: 'PR-1' }], events: [{ seq: 7, vehicleId: 'DEMO-008' }] };
  const c = vm.createContext({ state, ui: { panel: null, selected: null }, chatContext: null, view: 'space', space: 'assembly', SPACES: { assembly: {} }, VIEWS: ['dispatcher'], location: { hash: '' }, history: { replaceState(_a, _b, hash) { c.location.hash = hash; } }, document: { querySelectorAll: () => [] }, $: () => ({ querySelector: () => null }), render() {}, renderRibbon() {}, updateSideChat() {}, narrow: () => false, requestAnimationFrame() {}, destroyScene() {}, problem: id => state.problems.find(p => p.id === id) });
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
