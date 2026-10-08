// Fragment routes are also used for links opened in a fresh browser tab.
// Keep these helpers independent of the DOM and of the current UI state.
const ROUTE_SPACES = new Set(['enterprise', 'assembly', 'tests', 'diag', 'rework', 'ship', 'weld', 'paint']);
const ROUTE_PANELS = new Set(['vehicle', 'post', 'problem', 'compare', 'chat']);
const routeSpace = value => ROUTE_SPACES.has(value) ? value : 'assembly';

export function parseSpaceRoute(hash = '') {
  const fragment = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const queryAt = fragment.indexOf('?');
  const path = queryAt < 0 ? fragment : fragment.slice(0, queryAt);
  const query = queryAt < 0 ? '' : fragment.slice(queryAt + 1);
  const [name, space, type, encodedId] = path.split('/');
  const route = { space: 'assembly', panel: null, table: false };
  // Legacy views are handled by the caller, not interpreted as space routes.
  if (name && name !== 'space') return route;
  route.space = routeSpace(space);
  route.table = new URLSearchParams(query).get('mode') === 'table';
  if (!ROUTE_PANELS.has(type)) return route;
  if (type === 'chat') {
    route.panel = { type };
  } else if (encodedId) {
    try {
      route.panel = { type, id: decodeURIComponent(encodedId) };
    } catch {
      // An incomplete or malformed copied link still opens the requested space.
    }
  }
  return route;
}

export function spaceHash({ space = 'assembly', panel = null, table = false } = {}) {
  let hash = `#space/${routeSpace(space)}`;
  if (ROUTE_PANELS.has(panel?.type)) {
    if (panel.type === 'chat') hash += '/chat';
    else if (typeof panel.id === 'string' && panel.id) {
      try {
        hash += `/${panel.type}/${encodeURIComponent(panel.id)}`;
      } catch {
        // Invalid Unicode must not prevent navigation to the surrounding space.
      }
    }
  }
  return hash + (table === true ? '?mode=table' : '');
}
