import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpaceRoute, spaceHash } from '../public/app/55-space-route.js';

const defaultRoute = { space: 'assembly', panel: null, table: false };

test('existing object links keep their space and selection in scene mode', () => {
  assert.deepEqual(parseSpaceRoute('#space/assembly/vehicle/DEMO-008'), {
    space: 'assembly', panel: { type: 'vehicle', id: 'DEMO-008' }, table: false,
  });
  assert.deepEqual(parseSpaceRoute('space/diag/problem/PR-1'), {
    space: 'diag', panel: { type: 'problem', id: 'PR-1' }, table: false,
  });
});

test('table query is separate from the selected object id', () => {
  const route = parseSpaceRoute('#space/assembly/vehicle/DEMO-008?mode=table');
  assert.equal(route.panel.id, 'DEMO-008');
  assert.equal(route.table, true);
  assert.equal(spaceHash(route), '#space/assembly/vehicle/DEMO-008?mode=table');
});

test('all known spaces and panel kinds round trip without browser globals', () => {
  for (const space of ['enterprise', 'assembly', 'tests', 'diag', 'rework', 'ship', 'weld', 'paint']) {
    for (const panel of [null, { type: 'chat' }, ...['vehicle', 'post', 'problem', 'compare'].map(type => ({ type, id: 'object-1' }))]) {
      for (const table of [false, true]) {
        const route = { space, panel, table };
        assert.deepEqual(parseSpaceRoute(spaceHash(route)), route);
      }
    }
  }
});

test('encoded object identifiers cannot become route or query separators', () => {
  const route = { space: 'assembly', panel: { type: 'vehicle', id: 'Авто / A?mode=scene#1 & 2%' }, table: true };
  assert.deepEqual(parseSpaceRoute(spaceHash(route)), route);
  assert.equal(spaceHash({ panel: { type: 'post', id: 'A/2' } }), '#space/assembly/post/A%2F2');
});

test('reload and history restoration depend only on the supplied URL', () => {
  const sceneLink = '#space/assembly/vehicle/DEMO-008';
  const tableLink = '#space/diag/problem/PR-1?mode=table';
  const tableRoute = parseSpaceRoute(tableLink);
  tableRoute.panel.id = 'changed-locally';
  assert.equal(parseSpaceRoute(sceneLink).table, false);
  assert.deepEqual(parseSpaceRoute(tableLink), { space: 'diag', panel: { type: 'problem', id: 'PR-1' }, table: true });
  assert.deepEqual(parseSpaceRoute('#space/assembly'), defaultRoute);
});

test('closing a panel or changing space can preserve the chosen mode', () => {
  const route = parseSpaceRoute('#space/assembly/vehicle/DEMO-008?mode=table');
  assert.equal(spaceHash({ ...route, panel: null }), '#space/assembly?mode=table');
  assert.equal(spaceHash({ ...route, space: 'enterprise', panel: null }), '#space/enterprise?mode=table');
  assert.equal(spaceHash({ ...route, table: false }), '#space/assembly/vehicle/DEMO-008');
});

test('missing and unknown paths have a safe default route', () => {
  for (const hash of ['', '#', 'space', '#space/', '#space/not-a-space', '#space/__proto__', '#vehicles?mode=table', null, 12]) {
    assert.deepEqual(parseSpaceRoute(hash), defaultRoute);
  }
  assert.deepEqual(parseSpaceRoute('#space/not-a-space/post/A2?mode=table'), {
    space: 'assembly', panel: { type: 'post', id: 'A2' }, table: true,
  });
  assert.equal(spaceHash(), '#space/assembly');
  assert.equal(spaceHash({ space: 'constructor', table: true }), '#space/assembly?mode=table');
});

test('unknown query fields and modes cannot change selection or create a route', () => {
  assert.deepEqual(parseSpaceRoute('#space/diag/problem/PR-1?other=%2Fpost%2FA1&mode=table'), {
    space: 'diag', panel: { type: 'problem', id: 'PR-1' }, table: true,
  });
  for (const mode of ['', 'scene', 'TABLE', 'unknown', '%broken']) {
    assert.equal(parseSpaceRoute(`#space/assembly?mode=${mode}`).table, false);
  }
  assert.equal(spaceHash(parseSpaceRoute('#space/assembly?unknown=value')), '#space/assembly');
});

test('incomplete, unknown and malformed panels never throw or leave partial ids', () => {
  for (const suffix of ['vehicle', 'post/', 'unknown/A2', 'vehicle/%', 'vehicle/%E0%A4%A', 'vehicle/%ED%A0%80']) {
    assert.deepEqual(parseSpaceRoute(`#space/diag/${suffix}?mode=table`), { space: 'diag', panel: null, table: true });
  }
  for (const panel of [{ type: 'unknown', id: 'A2' }, { type: 'post' }, { type: 'post', id: '' }, { type: 'post', id: '\uD800' }]) {
    assert.equal(spaceHash({ space: 'diag', panel, table: true }), '#space/diag?mode=table');
  }
});

test('chat routes have no object id and preserve table mode', () => {
  assert.deepEqual(parseSpaceRoute('#space/assembly/chat?mode=table'), {
    space: 'assembly', panel: { type: 'chat' }, table: true,
  });
  assert.equal(spaceHash({ panel: { type: 'chat', id: 'ignored' }, table: true }), '#space/assembly/chat?mode=table');
});
