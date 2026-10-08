import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual route/render functions without a WebGL or HTTP dependency.
const source = (await readFile(new URL('../public/app/90-routing-startup.js', import.meta.url), 'utf8')).split("window.addEventListener('hashchange'")[0];
function harness() {
  const elements = new Map(), calls = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: true, open: false, value: '', textContent: '', contains: () => false });
    return elements.get(id);
  };
  const c = vm.createContext({
    VIEWS: ['dispatcher', 'workshop', 'vehicles', 'orders', 'shift', 'lab'],
    SPACES: { assembly: { short: 'Сборка' }, ship: { short: 'Отгрузка' } },
    view: 'space', space: 'assembly', state: {}, lab: {}, chatContext: null, selectedVehicle: null,
    ui: { panel: { type: 'vehicle', id: 'DEMO-001' }, selected: { type: 'vehicle', id: 'DEMO-001' }, car3d: 'DEMO-001', ribbonOnlySelected: true },
    c3: { viewer: {}, loading: false },
    $: element, text: (id, value) => { element(id).textContent = value; },
    document: { querySelectorAll: () => [], activeElement: null, body: {} },
    destroyScene() {}, loadLab() {}, renderChrome() {},
    renderCar3d() { calls.push('dispose3d'); c.c3.viewer = null; },
  });
  for (const name of ['renderSpace', 'renderThreat', 'renderTasks', 'renderDecisions', 'renderSide', 'renderActiveProblems', 'renderMap', 'renderPostDetail', 'renderPostBoard', 'renderVehicles', 'renderOrders', 'renderShift', 'renderLab']) c[name] = () => calls.push(name);
  vm.runInContext(source, c);
  return { c, elements, calls };
}

test('changing shop clears the previous vehicle card and selection', () => {
  const { c } = harness();
  c.setView('space/ship');
  assert.equal(c.space, 'ship');
  assert.equal(c.ui.panel, null);
  assert.equal(c.ui.selected, null);
  assert.equal(c.ui.car3d, null);
  assert.equal(c.ui.ribbonOnlySelected, false);
});

test('explicit vehicle and 3D deep links still open the requested card', () => {
  const { c } = harness();
  c.setView('space/assembly/vehicle/DEMO-002');
  assert.equal(c.ui.panel.id, 'DEMO-002');
  assert.equal(c.ui.selected.id, 'DEMO-002');
  c.setView('space/assembly/car3d/DEMO-003');
  assert.equal(c.ui.car3d, 'DEMO-003');
  assert.equal(c.ui.panel, null);
});

test('leaving 3D renders the destination in the same cycle', () => {
  const { c, calls, elements } = harness();
  c.setView('vehicles');
  assert.deepEqual(calls, ['renderVehicles', 'renderSide', 'dispose3d']);
  assert.equal(c.ui.car3d, null);
  assert.equal(elements.get('shop-navigation').hidden, true);
  assert.equal(elements.get('manage-navigation').hidden, true);
  assert.equal(elements.get('analytics-navigation').hidden, true);
});

test('secondary navigation is scoped to management or analytics', () => {
  const { c, elements } = harness();
  c.setView('orders');
  assert.equal(elements.get('manage-navigation').hidden, false);
  assert.equal(elements.get('analytics-navigation').hidden, true);
  c.setView('lab');
  assert.equal(elements.get('manage-navigation').hidden, true);
  assert.equal(elements.get('analytics-navigation').hidden, false);
});

test('cards, 3D and chat deep links work on every screen, not only in shops', () => {
  const { c } = harness();
  c.setView('dispatcher/vehicle/DEMO-003');
  assert.equal(c.view, 'dispatcher'); assert.equal(c.ui.panel.type, 'vehicle'); assert.equal(c.ui.panel.id, 'DEMO-003');
  c.setView('vehicles/car3d/DEMO-004');
  assert.equal(c.view, 'vehicles'); assert.equal(c.ui.car3d, 'DEMO-004'); assert.equal(c.selectedVehicle, 'DEMO-004', 'the list keeps the vehicle selected under the 3D view');
  c.setView('vehicles/vehicle/DEMO-002');
  assert.equal(c.ui.panel, null, 'in the vehicle list the vehicle is the full card, not a side panel'); assert.equal(c.selectedVehicle, 'DEMO-002');
  c.setView('shift/chat/vehicle:DEMO-005');
  assert.equal(c.ui.panel.type, 'chat'); assert.deepEqual({ ...c.chatContext }, { type: 'vehicle', id: 'DEMO-005' });
});

// The return path: opening a card is a history step that remembers the screen; a direct link falls back to its screen.
const cardSource = await readFile(new URL('../public/app/55-vehicle-card.js', import.meta.url), 'utf8');
function navHarness(hash) {
  const entries = [{ hash, state: null }]; let at = 0; const seen = [];
  const c = vm.createContext({
    SPACES: { assembly: { short: 'Сборка' }, rework: { short: 'Ремонт автомобилей' }, enterprise: { short: 'Предприятие' } },
    view: 'vehicles', space: 'assembly', scrollY: 640, state: {},
    post: id => ({ R1: { code: 'ДР-1' } }[id]), $: () => null, requestAnimationFrame: f => f(), scrollTo() {},
    document: { addEventListener() {} },
    location: { get hash() { return `#${entries[at].hash}`; } },
    history: {
      get state() { return entries[at].state; }, get length() { return entries.length; },
      replaceState(st, _, url) { entries[at] = { hash: url ? url.slice(1) : entries[at].hash, state: st }; },
      pushState(st, _, url) { entries.splice(at + 1); entries.push({ hash: url.slice(1), state: st }); at++; },
      back() { if (at > 0) { at--; seen.push(entries[at].hash); } },
    },
    setView: h => seen.push(`set:${h}`),
  });
  vm.runInContext(cardSource, c);
  return { c, entries, seen, at: () => at };
}
test('vehicle list → 3D → back returns to the same list with its scroll', () => {
  const { c, entries, seen, at } = navHarness('vehicles/vehicle/DEMO-003');
  c.navPush('vehicles/car3d/DEMO-003');
  assert.equal(at(), 1); assert.equal(c.history.state.ret.label, 'К списку автомобилей');
  assert.equal(entries[0].state.scroll.win, 640, 'scroll of the list is stored in its history entry');
  c.navBack();
  assert.equal(at(), 0); assert.equal(seen.at(-1), 'vehicles/vehicle/DEMO-003');
});
test('a direct link without history falls back to its own screen with a clear label', () => {
  const { c, seen } = navHarness('space/rework/car3d/DEMO-005');
  c.view = 'space'; c.space = 'rework';
  assert.equal(vm.runInContext('returnLabel()', c), 'К цеху «Ремонт автомобилей»');
  c.navBack();
  assert.equal(seen.at(-1), 'set:space/rework');
  assert.equal(c.labelForHash('dispatcher'), 'К задачам смены');
  assert.equal(c.labelForHash('space/assembly/vehicle/DEMO-002'), 'К карточке DEMO-002');
  assert.equal(c.labelForHash('space/rework/post/R1'), 'К посту ДР-1');
});
