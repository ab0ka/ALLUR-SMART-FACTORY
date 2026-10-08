// Shop KPIs in the shape of the organiser's test data (case #2 Allur) and the case targets.
// Computed from the same engine state as every other number; read-only, additive to the snapshot.
// The targets are the case's stated inputs; every production number here stays synthetic.
import { STAGES, POSTS } from './simulation.mjs';

export const CASE_TARGETS = Object.freeze({
  oee: 0.85, defectRate: 0.02, criticalDowntimePerDay: 60, shiftsPerDay: 2, shiftHours: 8, monthlyPlan: 5500,
  source: 'Вводные кейса №2 Allur (тестовые данные организатора): OEE не ниже 85 %, брак не выше 2 %, простой критического оборудования не больше 60 мин в сутки, 2 смены по 8 ч, план не меньше 5 500 автомобилей в месяц.',
});
// Where a quality-control finding was caused: the defect origin maps to the stage that made it.
const ORIGIN_STAGE = { weld: 'weld', paint: 'paint', assembly: 'assembly', start: 'assembly' };
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function stageKpis(w) {
  const elapsed = w.minute;
  const stages = STAGES.map(st => {
    const posts = POSTS.filter(p => p.stage === st.id).map(p => w.posts[p.id].stats);
    const planned = elapsed * posts.length, sum = k => posts.reduce((a, s) => a + s[k], 0);
    const run = sum('run'), nominal = sum('nominal'), completed = sum('completed'), downtime = sum('fault') + sum('maintenance');
    const defects = w.inspections.filter(i => i.result === 'fail' && ORIGIN_STAGE[i.origin] === st.id).length;
    const makesDefects = Object.values(ORIGIN_STAGE).includes(st.id);
    const availability = planned > 0 ? run / planned : 0, performance = run > 0 ? Math.min(1, nominal / run) : 0;
    const quality = makesDefects && completed > 0 ? (completed - defects) / completed : 1;
    const defectRate = makesDefects && completed > 0 ? defects / completed : null;
    return {
      id: st.id, name: st.name, posts: posts.length, completed, defects: makesDefects ? defects : null, defectRate: defectRate === null ? null : round(defectRate),
      load: round(availability), oee: round(availability * performance * quality), downtime,
      flags: { oee: completed > 0 && availability * performance * quality < CASE_TARGETS.oee, defects: defectRate !== null && completed >= 5 && defectRate > CASE_TARGETS.defectRate },
    };
  });
  // Critical equipment in this model: the assembly lifts (the line bottleneck). Downtime is per shift; the case limit is per day.
  const critical = POSTS.filter(p => p.stage === 'assembly').reduce((a, p) => a + w.posts[p.id].stats.fault + w.posts[p.id].stats.maintenance, 0);
  const perShiftBudget = CASE_TARGETS.criticalDowntimePerDay / CASE_TARGETS.shiftsPerDay;
  return {
    targets: CASE_TARGETS, elapsed, stages,
    criticalDowntime: { minutes: critical, perShiftBudget, over: critical > perShiftBudget, equipment: 'гидроподъёмники постов СБ-1…СБ-3' },
  };
}
