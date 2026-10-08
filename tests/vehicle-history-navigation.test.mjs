import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app/70-space-navigation.js', import.meta.url), 'utf8');
const navigation = source.slice(source.indexOf('function openPanel('), source.indexOf('const selectVehicle'))
  + source.slice(source.indexOf('function openVehicleEvent('), source.indexOf('// Returns true when'));

function fixture(space = 'assembly') {
  const calls = { renders: 0, routes: [], focus: 0, pushed: [] };
  const context = vm.createContext({
    ui: { panel: { type: 'vehicle', id: 'DEMO-008' }, selected: null, table: true },
    view: 'space', space, chatContext: null,
    location: { hash: `#space/${space}/vehicle/DEMO-008` },
    post: id => ({ id, stage: id === 'P1' ? 'paint' : 'assembly' }),
    vehicle: () => null,
    rememberPanelFocus: () => {},
    narrow: () => false,
    requestAnimationFrame: callback => callback(),
    $: () => ({ querySelector: () => ({ focus: () => calls.focus++ }) }),
    render: () => calls.renders++,
    syncHash: () => { context.location.hash = `#space/${context.space}/${context.ui.panel.type}/${context.ui.panel.id}`; },
    setView: hash => { calls.routes.push(hash); calls.renders++; },
    history: {
      pushState: (_state, _title, hash) => calls.pushed.push(hash),
      replaceState: (_state, _title, hash) => { context.location.hash = hash; },
    },
  });
  vm.runInContext(navigation, context);
  return { context, calls };
}

test('assembly history inside diagnostics keeps its diagnostic route and renders once', () => {
  const { context, calls } = fixture('diag');
  vm.runInContext('openVehicleEvent({ postId: "A2" })', context);
  assert.equal(context.location.hash, '#space/diag/post/A2');
  assert.equal(context.space, 'diag');
  assert.equal(context.ui.table, true);
  assert.equal(context.ui.selected.id, 'A2');
  assert.equal(context.chatContext.id, 'A2');
  assert.deepEqual(calls.routes, ['space/diag/post/A2']);
  assert.equal(calls.renders, 1);
  assert.equal(calls.focus, 1);
  assert.deepEqual(calls.pushed, ['#space/diag/vehicle/DEMO-008']);
});

test('history crosses to the event workshop through shared panel routing', () => {
  const { context, calls } = fixture('diag');
  vm.runInContext('openVehicleEvent({ postId: "P1" })', context);
  assert.equal(context.location.hash, '#space/paint/post/P1');
  assert.equal(context.space, 'paint');
  assert.equal(calls.renders, 1);
  assert.equal(calls.focus, 1);
  assert.deepEqual(calls.pushed, ['#space/diag/vehicle/DEMO-008']);
  vm.runInContext('openVehicleEvent({ postId: "P1" })', context);
  assert.equal(calls.pushed.length, 1, 'same target does not duplicate browser history');
});
