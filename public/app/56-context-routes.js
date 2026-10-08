// Context IDs are resolved against the current snapshot, never inferred from the previous selection.
function decodeRoutePart(value) {
  try { return value ? decodeURIComponent(value) : undefined; } catch { return undefined; }
}
function validChatContext(type, id) {
  if (typeof id !== 'string' || !id) return null;
  const rows = { vehicle: state.vehicles, post: state.posts, problem: state.problems, order: state.orders };
  if (!Object.hasOwn(rows, type)) return null;
  const item = (rows[type] ?? []).find(x => x.id === id || (type === 'post' && (x.id === id.toUpperCase() || x.code === id.toUpperCase())));
  return item ? { type, id: item.id } : null;
}
function chatRouteContext(parts) {
  if (!parts.length || (parts.length === 1 && !parts[0])) return { context: null, missing: false };
  const decoded = parts.map(decodeRoutePart);
  let context = null;
  if (decoded.every(Boolean)) {
    if (decoded.length === 2) context = validChatContext(decoded[0], decoded[1]);
    else if (decoded.length === 1) {
      const value = decoded[0], colon = value.indexOf(':');
      if (colon >= 0) context = validChatContext(value.slice(0, colon), value.slice(colon + 1));
      else {
        const matches = ['vehicle', 'problem', 'order', 'post'].map(type => validChatContext(type, value)).filter(Boolean);
        if (matches.length === 1) context = matches[0];
      }
    }
  }
  return { context, missing: !context };
}
function recordChatContext(item) {
  for (const type of ['problem', 'vehicle', 'post', 'order']) {
    const ctx = validChatContext(type, item?.[`${type}Id`]);
    if (ctx) return ctx;
  }
  return null;
}
