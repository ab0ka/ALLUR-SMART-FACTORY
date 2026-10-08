// CSV v1 uses one rectangular table: section, row (1-based), field, value.
// Nested report values are JSON text; null is empty and numeric zero stays numeric.
export function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  // Quote alone does not prevent spreadsheet formulas. Protect textual prefixes,
  // including control/whitespace prefixes that spreadsheet importers may discard.
  if (/^[=+@\-\s\u0000-\u001f\u007f-\u009f]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const sections = [
  ['report', ['schemaVersion', 'synthetic', 'shiftEpoch', 'revision', 'elapsed', 'shift', 'shiftStart', 'finished']],
  ['metrics', ['planTarget', 'referenceTotal', 'forecast', 'forecastLow', 'forecastHigh', 'accepted', 'shipped', 'wip', 'firstPassYield']],
  ['counts', ['problems', 'jobs', 'tasks', 'orders']],
  ['problems', ['id', 'title', 'postId', 'postCode', 'vehicleIds', 'status', 'detectedAt']],
  ['jobs', ['id', 'title', 'postId', 'postCode', 'problemId', 'technicianId', 'status', 'remaining', 'createdAt']],
  ['tasks', ['id', 'category', 'categoryName', 'object', 'title', 'reason', 'status', 'since', 'postId', 'impact', 'next', 'certainty', 'certaintyText']],
  ['orders', ['id', 'modelId', 'quantity', 'accepted', 'shipped', 'state', 'dueMinute', 'overdue']],
  ['technicians', ['id', 'name', 'jobId']],
  ['stock', ['id', 'name', 'onHand', 'reserved', 'available']],
  ['heldPosts', ['id', 'code']],
  ['events', ['id', 'minute', 'text', 'kind', 'vehicleId', 'postId', 'problemId', 'jobId', 'orderId']],
];
export function handoverCsv(report) {
  const rows = [['section', 'row', 'field', 'value']];
  for (const [section, fields] of sections) {
    const source = section === 'report' ? report : (report[section] ?? report.resources?.[section]);
    const items = Array.isArray(source) ? source : source == null ? [] : [source];
    // An empty section remains visible without inventing an entity.
    if (!items.length) rows.push([section, null, null, null]);
    items.forEach((item, index) => {
      for (const field of fields) rows.push([section, index + 1, field, item[field]]);
    });
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function formatHandover(report, format = null) {
  if (format !== null && format !== 'json' && format !== 'csv') {
    throw Object.assign(new Error('Неизвестный формат передачи смены'), { status: 400, expose: true });
  }
  return {
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(format === null ? {} : { 'Content-Disposition': `attachment; filename="allur-handover.${format}"` }),
    },
    body: format === 'csv' ? handoverCsv(report) : JSON.stringify(report),
  };
}
