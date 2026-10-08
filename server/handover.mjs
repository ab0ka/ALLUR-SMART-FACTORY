// Pure projection of one public Workshop.snapshot(); no engine or storage access.
const scalar = value => typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
const rows = value => Array.isArray(value) ? value : [];
const pick = (source, fields) => Object.fromEntries(fields.map(key => [key, scalar(source?.[key])]));

export function createHandover(snapshot) {
  const s = snapshot ?? {};
  const problems = rows(s.problems).filter(p => ['open', 'unresolved'].includes(p?.status)).map(p => {
    const problem = pick(p, ['id', 'title', 'postId', 'postCode', 'status', 'detectedAt']);
    problem.vehicleIds = Array.isArray(p.vehicleIds) ? p.vehicleIds.map(scalar) : null;
    return problem;
  });
  const jobs = rows(s.jobs).filter(j => ['queued', 'running'].includes(j?.status))
    .map(j => pick(j, ['id', 'title', 'postId', 'postCode', 'problemId', 'technicianId', 'status', 'remaining', 'createdAt']));
  const tasks = rows(s.tasks).map(t => {
    const task = pick(t, ['id', 'category', 'categoryName', 'title', 'reason', 'status', 'since', 'postId', 'impact', 'next', 'certainty', 'certaintyText']);
    task.object = pick(t?.object, ['type', 'id']);
    return task;
  });
  const orders = rows(s.orders).filter(o => o?.state !== 'completed')
    .map(o => pick(o, ['id', 'modelId', 'quantity', 'accepted', 'shipped', 'state', 'dueMinute', 'overdue']));
  const posts = new Map(rows(s.posts).map(p => [p?.id, p]));
  return {
    schemaVersion: 1,
    synthetic: true,
    shiftEpoch: scalar(s.shiftEpoch),
    revision: scalar(s.revision), elapsed: scalar(s.elapsed), shift: scalar(s.shift),
    shiftStart: scalar(s.shiftStart), finished: scalar(s.finished),
    metrics: {
      planTarget: scalar(s.plan?.target), referenceTotal: scalar(s.plan?.reference?.total),
      forecast: scalar(s.forecast?.projected), forecastLow: scalar(s.forecast?.low), forecastHigh: scalar(s.forecast?.high),
      accepted: scalar(s.totals?.accepted), shipped: scalar(s.totals?.shipped), wip: scalar(s.totals?.wip),
      firstPassYield: scalar(s.quality?.firstPassYield),
    },
    counts: { problems: problems.length, jobs: jobs.length, tasks: tasks.length, orders: orders.length },
    problems, jobs, tasks, orders,
    resources: {
      technicians: rows(s.technicians).map(t => pick(t, ['id', 'name', 'jobId'])),
      stock: rows(s.stock).map(item => pick(item, ['id', 'name', 'onHand', 'reserved', 'available'])),
      heldPosts: rows(s.holds).map(id => ({ id: scalar(id), code: scalar(posts.get(id)?.code) })),
    },
    events: rows(s.events).slice(-20).map(e => {
      const event = pick(e, ['minute', 'text', 'vehicleId', 'postId', 'problemId', 'jobId', 'orderId']);
      event.id = scalar(e?.seq);
      event.kind = scalar(e?.type);
      return event;
    }),
  };
}
