// Vehicle workflow on top of the engine state: which rework procedure a detected defect needs, whether an operation
// is allowed right now (with a human reason), the single "next action" for a vehicle and the unified task list.
// Everything is computed from the authoritative state; nothing here is a separate simulation. All data is synthetic.
import { COMPONENTS, COMPONENT_IDS, DOOR_GAP, START_SYMPTOM, doorMeasure, doorGapAfterAdjust, doorSide, doorGapInitial } from './components.mjs';

// Rework procedure by detected defect origin. Manual procedures wait for the operator on the rework post;
// automatic ones are done by the rework post in its norm time and are explained, never silently "fixed".
export const PROCEDURES = {
  start: { type: 'start', title: 'Диагностика запуска', category: 'Диагностика автомобиля' },
  assembly: { type: 'door', title: 'Регулировка зазора двери', category: 'Дефект качества' },
  weld: { type: 'auto', title: 'Доработка сварного шва', work: 'зачистка и подварка шва силами поста доработки', category: 'Дефект качества' },
  paint: { type: 'auto', title: 'Локальное исправление покрытия', work: 'шлифовка и локальная подкраска силами поста доработки', category: 'Дефект качества' },
};
const OPS = ['component_check', 'component_remove', 'component_install', 'start_test', 'door_measure', 'door_adjust'];
const n0 = n => String(Math.round(n * 10) / 10).replace('.', ',');

export function installWorkflow(Workshop, { POST, DIAG_POST, REWORK, STAGES, SHIFT, clock, SimulationError, MODELS }) {
  const code = id => POST[id].code;
  const methods = {
    lastFailInspection(v) { return [...this.inspections].reverse().find(i => i.vehicleId === v.id && i.result === 'fail') ?? null; },
    // The procedure exists only for a defect that quality control has actually found on this vehicle.
    reworkProcedure(v) {
      if (v.accepted) return null;
      const fail = this.lastFailInspection(v);
      if (!fail || !fail.origin) return null;
      if (!v.hidden.defect && !v.reworked) return null;
      return PROCEDURES[fail.origin] ?? null;
    },
    // Door data appears when quality control finds the door defect; older saves get it on first use.
    ensureDoor(v) {
      if (v.door || this.lastFailInspection(v)?.origin !== 'assembly') return v.door ?? null;
      v.hidden.doorGap ??= doorGapInitial(this.seed, v.id);
      v.door = { side: doorSide(this.seed, v.id), checks: [], adjustments: 0 };
      return v.door;
    },
    awaitingManual(v) {
      if (!v || !this.manualRework || !v.hidden.defect) return false;
      const p = PROCEDURES[v.hidden.defect]?.type;
      return (p === 'start' && !v.startPassed) || (p === 'door' && !v.doorOk);
    },
    atReworkPost(v) {
      if (v.location.type !== 'post' || v.location.id !== DIAG_POST) return false;
      const exec = this.execution(v.currentExecutionId);
      return Boolean(exec && exec.completedAt === null);
    },
    // Single source of truth for operations on a vehicle. Commands call it and throw its reason; views show it.
    opAvailability(v, op, componentId) {
      const no = (reason, status = 409) => ({ ok: false, reason, status });
      if (!OPS.includes(op)) return no('Неизвестная операция', 400);
      if (this.finished) return no('Смена завершена');
      if (!this.atReworkPost(v)) {
        if (v.location.type === 'buffer' && v.location.id === REWORK.buffer.id) return no(`${v.id} в очереди на ${code(DIAG_POST)} (${this.queueOrder(REWORK.buffer.id).indexOf(v.id) + 1}-й); операции выполняются только на посту`);
        if (v.location.type === 'post' && v.location.id === DIAG_POST) return no(`Работы с ${v.id} на ${code(DIAG_POST)} уже завершены`);
        return no(`Операции доработки выполняются на посту ${code(DIAG_POST)}; ${v.id} сейчас не на нём`);
      }
      if (op.startsWith('door_')) {
        const proc = this.reworkProcedure(v);
        this.ensureDoor(v);
        if (proc?.type !== 'door') return no(`У ${v.id} нет дефекта двери — регулировка зазора не требуется`);
        if (v.doorOk) return no('Зазор уже в допуске — доработка завершается');
        if (op === 'door_adjust') {
          const last = v.door?.checks.at(-1);
          if (!last) return no('Сначала измерьте зазор: регулировать без замера нельзя');
          if (last.afterAdjustment < v.door.adjustments) return no('После регулировки нужен повторный замер');
          if (last.ok) return no('Зазор в допуске — регулировка не нужна');
        }
        return { ok: true };
      }
      if (!this.ensureComponents(v)) return no(`${v.id}: узлы ещё не установлены — сборка не завершена`);
      if (op === 'start_test') {
        const missing = COMPONENT_IDS.filter(id => COMPONENTS[id].required && v.components[id].status === 'missing');
        return missing.length ? no(`Нельзя выполнить проверку запуска: не установлены — ${missing.map(id => COMPONENTS[id].name.toLowerCase()).join(', ')}`) : { ok: true };
      }
      if (typeof componentId !== 'string' || !Object.hasOwn(COMPONENTS, componentId)) return no('Неизвестный узел', 400);
      const spec = COMPONENTS[componentId], c = v.components[componentId];
      if (op === 'component_check') return c.status === 'missing' ? no(`Нельзя проверить отсутствующий узел: ${spec.name.toLowerCase()} снят`) : { ok: true };
      if (op === 'component_remove') {
        if (!spec.removable) return no(`Снятие узла «${spec.name}» в учебной симуляции не предусмотрено — доступна только проверка`);
        return c.status === 'missing' ? no(`${spec.name} уже снят`) : { ok: true };
      }
      if (c.status === 'installed') return no(`${spec.name} уже установлен`);
      if (c.removed?.scrapped && spec.stockItem) { const st = this.stock[spec.stockItem]; if (!st || st.onHand - st.reserved < 1) return no(`Нет исправного узла «${spec.name}» на складе`); }
      return { ok: true };
    },
    requireOp(vehicleId, op, componentId) {
      const v = typeof vehicleId === 'string' ? this.vehicle(vehicleId) : null;
      if (!v) throw new SimulationError('Автомобиль не найден', 404);
      const a = this.opAvailability(v, op, componentId);
      if (!a.ok) throw new SimulationError(a.reason, a.status);
      return v;
    },
    measureDoor(vehicleId, actor = 'operator') {
      const v = this.requireOp(vehicleId, 'door_measure');
      const n = ++this.componentCheckSeq, m = doorMeasure(v.hidden.doorGap, this.seed, v.id, n);
      const check = { id: `DG-${n}`, minute: this.minute, value: m.value, deviation: m.deviation, ok: m.ok, afterAdjustment: v.door.adjustments, text: m.text };
      v.door.checks.push(check);
      this.log('door_measured', `${v.id}: замер зазора ${v.door.side} двери — ${m.text}`, { vehicleId: v.id, postId: DIAG_POST }, actor);
      if (m.ok) {
        v.doorOk = true;
        const exec = this.execution(v.currentExecutionId); exec.remaining = Math.min(exec.remaining, 5);
        this.log('door_ok', `${v.id}: зазор в допуске — доработка завершается (до 5 мин), затем повторный контроль`, { vehicleId: v.id, postId: DIAG_POST }, actor);
      }
      this.touch();
      return check.id;
    },
    adjustDoor(vehicleId, actor = 'operator') {
      const v = this.requireOp(vehicleId, 'door_adjust');
      v.hidden.doorGap = doorGapAfterAdjust(v.hidden.doorGap, this.seed, v.id, ++this.componentCheckSeq);
      v.door.adjustments++;
      this.log('door_adjusted', `${v.id}: регулировка петель и замка ${v.door.side} двери выполнена; нужен повторный замер`, { vehicleId: v.id, postId: DIAG_POST }, actor);
      this.touch();
    },
    // Steps of the procedure with their status, for the card and the task list.
    procedureView(v) {
      const proc = this.reworkProcedure(v);
      if (!proc) return null;
      const fail = this.lastFailInspection(v), atPost = this.atReworkPost(v), inQueue = v.location.id === REWORK.buffer.id;
      const recheck = v.reworked && !v.accepted;
      const done = st => st ? 'done' : 'todo';
      let steps;
      const base = { type: proc.type, title: proc.title, category: proc.category, defect: fail.defect, inspectionId: fail.id, detectedAt: fail.minute, inspectionPost: code(fail.postId), inQueue, atPost, manual: proc.type !== 'auto' && this.manualRework };
      if (proc.type === 'start') {
        const b = v.components?.battery, checks = (v.componentChecks ?? []).filter(k => k.component === 'battery');
        const faultFound = checks.some(k => k.result === 'fault'), replaced = (b?.installSeq ?? 1) > 1, newChecked = checks.some(k => k.installSeq > 1 && k.result === 'ok');
        steps = [['detect', `Симптом «${START_SYMPTOM}» зафиксирован контролем ${base.inspectionPost}`, 'done'], ['check', 'Проверить аккумулятор (замер напряжения под нагрузкой)', done(checks.length)], ['replace', faultFound ? 'Снять неисправный аккумулятор и установить исправный со склада' : 'Заменить узел, если проверка подтвердит неисправность', done(replaced || (checks.length > 0 && !faultFound))], ['recheck', 'Проверить установленный узел', done(newChecked || (checks.length > 0 && !faultFound))], ['start', 'Проверка запуска', done(v.startPassed)], ['control', 'Повторный контроль качества', done(v.accepted)]];
      } else if (proc.type === 'door') {
        const d = this.ensureDoor(v) ?? { checks: [], adjustments: 0 };
        steps = [['detect', `Дефект «${fail.defect}» выявлен контролем ${base.inspectionPost}`, 'done'], ['measure', `Измерить ${DOOR_GAP.name.toLowerCase()} (${v.door?.side ?? ''} двери)`, done(d.checks.length)], ['adjust', 'Отрегулировать петли и замок двери', done(d.adjustments > 0 || v.doorOk)], ['remeasure', 'Повторно измерить зазор после регулировки', done(v.doorOk)], ['control', 'Повторный контроль качества', done(v.accepted)]];
        base.door = { side: d.side, nominal: DOOR_GAP.nominal, tolerance: DOOR_GAP.tolerance, unit: DOOR_GAP.unit, name: DOOR_GAP.name, adjustments: d.adjustments, ok: Boolean(v.doorOk), checks: d.checks.map(c => ({ ...c })) };
      } else {
        const exec = atPost ? this.execution(v.currentExecutionId) : null;
        base.auto = { work: proc.work, remaining: exec ? Math.ceil(exec.remaining) : REWORK.norm, norm: REWORK.norm, running: Boolean(exec) };
        steps = [['detect', `Дефект «${fail.defect}» выявлен контролем ${base.inspectionPost}`, 'done'], ['auto', `${proc.title}: ${proc.work}, ${REWORK.norm} мин`, done(v.reworked)], ['control', 'Повторный контроль качества', done(v.accepted)]];
      }
      const firstTodo = steps.findIndex(s => s[2] === 'todo');
      base.steps = steps.map(([id, label, status], i) => ({ id, label, status: i === firstTodo ? 'current' : status }));
      base.recheck = recheck;
      return base;
    },
    // One recommended next step, derived from state and process rules. AI may explain it but never decides it.
    nextAction(v) {
      const r = (kind, title, why, extra = {}) => ({ kind, title, why, expected: extra.expected ?? null, blockers: extra.blockers ?? [], op: extra.op ?? null, component: extra.component ?? null, target: extra.target ?? null });
      if (v.shipped) return r('none', 'Действий не требуется: автомобиль отгружен', `Принят контролем в ${clock(v.acceptedAt)}, отгружен в ${clock(v.shippedAt)}.`);
      if (v.accepted) return r('none', 'Действий не требуется: принят, ждёт отгрузки', `Годный выпуск засчитан в ${clock(v.acceptedAt)}.`);
      if (this.finished) return r('none', 'Смена завершена: действий в этой смене нет', 'Автомобиль остаётся на своём месте до следующей смены.');
      const proc = this.reworkProcedure(v), exec = v.currentExecutionId ? this.execution(v.currentExecutionId) : null;
      const opOf = (op, comp) => { const a = this.opAvailability(v, op, comp); return a.ok ? [] : [a.reason]; };
      if (proc && v.location.id === REWORK.buffer.id) {
        const pos = this.queueOrder(REWORK.buffer.id).indexOf(v.id) + 1, r1 = this.posts[DIAG_POST].vehicleId;
        const busy = r1 ? `${code(DIAG_POST)} занят: ${r1}${this.awaitingManual(this.vehicle(r1)) ? ' — ждёт ручной операции оператора' : ''}` : null;
        return r('wait', `Дождаться свободного поста ${code(DIAG_POST)}: машина в очереди (${pos}-я)`, `Контроль выявил: ${proc.title.toLowerCase()} требуется после дефекта «${this.lastFailInspection(v).defect}».`, { blockers: busy ? [busy] : [], expected: `На ${code(DIAG_POST)} начнётся «${proc.title.toLowerCase()}».`, target: busy && r1 ? { type: 'vehicle', id: r1 } : null });
      }
      if (proc && this.atReworkPost(v)) {
        if (proc.type === 'auto' || !this.manualRework) return r('wait', `Действий не требуется: выполняется «${proc.title.toLowerCase()}»`, `${proc.work ?? 'Доработка'} — осталось ${n0(exec.remaining)} мин; затем повторный контроль качества.`, { expected: 'Машина вернётся в буфер перед контролем и пройдёт повторную проверку.' });
        if (proc.type === 'start') {
          if (v.startPassed) return r('wait', 'Завершение доработки, затем повторный контроль', `Проверка запуска пройдена; осталось до ${n0(exec.remaining)} мин.`, { expected: 'Повторный контроль на КК-1/КК-2.' });
          const b = v.components.battery, checks = v.componentChecks.filter(k => k.component === 'battery' && k.installSeq === b.installSeq), last = checks.at(-1);
          if (b.status === 'missing') return r('op', 'Установить исправный аккумулятор со склада', 'Неисправный узел снят; без аккумулятора запуск невозможен.', { op: 'component_install', component: 'battery', blockers: opOf('component_install', 'battery'), expected: 'Узел установлен; затем его нужно проверить.' });
          if (!last) return r('op', b.installSeq > 1 ? 'Проверить установленный аккумулятор' : `Проверить питание: двигатель не запускается`, b.installSeq > 1 ? 'После установки узел нужно проверить измерением.' : 'Симптом «Не запускается». Первая гипотеза — аккумулятор не держит пусковой ток; это предположение, его проверяет измерение.', { op: 'component_check', component: 'battery', blockers: opOf('component_check', 'battery'), expected: 'Напряжение покоя и под нагрузкой: измерение подтвердит или исключит неисправность.' });
          if (last.result === 'fault') return r('op', 'Снять неисправный аккумулятор', last.text, { op: 'component_remove', component: 'battery', blockers: opOf('component_remove', 'battery'), expected: 'Узел уйдёт в утиль; затем установите исправный со склада.' });
          return r('op', 'Выполнить проверку запуска', `Аккумулятор проверен: ${last.text}`, { op: 'start_test', blockers: opOf('start_test'), expected: 'Если запуск пройдёт, доработка завершится и машина пойдёт на повторный контроль.' });
        }
        const d = this.ensureDoor(v), last = d.checks.at(-1);
        if (v.doorOk) return r('wait', 'Завершение доработки, затем повторный контроль', `Зазор в допуске; осталось до ${n0(exec.remaining)} мин.`, { expected: 'Повторный контроль на КК-1/КК-2.' });
        if (!last) return r('op', 'Измерить зазор двери', `Контроль выявил: «${this.lastFailInspection(v).defect}» (${d.side} дверь). Нужен фактический замер.`, { op: 'door_measure', blockers: opOf('door_measure'), expected: `Фактический зазор и отклонение от нормы ${n0(DOOR_GAP.nominal)} ± ${n0(DOOR_GAP.tolerance)} мм.` });
        if (last.afterAdjustment < d.adjustments) return r('op', 'Проверить зазор двери после регулировки', 'Регулировка выполнена; результат нужно подтвердить замером.', { op: 'door_measure', blockers: opOf('door_measure'), expected: 'Если зазор в допуске — доработка завершится и будет повторный контроль.' });
        return r('op', 'Отрегулировать дверь: петли и замок', last.text, { op: 'door_adjust', blockers: opOf('door_adjust'), expected: 'Зазор изменится; затем нужен повторный замер.' });
      }
      if (v.location.type === 'post') {
        const p = this.postView(POST[v.location.id]), problem = p.problemId ? this.problem(p.problemId) : null;
        if (exec?.completedAt !== null && exec) return r('wait', 'Операция выполнена: ждёт места в следующем буфере', p.reason ?? '', { blockers: [p.reason].filter(Boolean) });
        if (['fault', 'maintenance'].includes(p.state)) return r('navigate', `Машина исправна, но ждёт ремонта поста ${p.code}`, p.reason ?? '', { blockers: [p.reason].filter(Boolean), target: problem ? { type: 'problem', id: problem.id } : { type: 'post', id: p.id }, expected: 'После ремонта поста операция продолжится с сохранённым остатком.' });
        if (problem) return r('navigate', `Операция идёт медленнее: ${problem.title.toLowerCase()}`, `Машина исправна; на посту ${p.code} открыта проблема ${problem.id}.`, { target: { type: 'problem', id: problem.id }, expected: 'Решение по посту — в карточке проблемы.' });
        const second = POST[v.location.id].stage === 'quality' && this.inspections.some(i => i.vehicleId === v.id);
        return r('none', `Действий не требуется: ${second ? 'идёт повторный контроль' : 'операция выполняется'}`, `${exec.operation} · ${p.code} · ${Math.round((1 - exec.remaining / exec.work) * 100)}%`);
      }
      const bid = v.location.id, pos = this.queueOrder(bid).indexOf(v.id) + 1;
      if (bid === 'BACKLOG') return r('wait', `Ожидает запуска в сварку (${pos}-й во входной очереди)`, 'Порядок: приоритет задания, затем время поступления.');
      const stage = STAGES.find(s => s.buffer.id === bid), stageName = stage?.name ?? '';
      const recheck = bid === 'B3' && this.inspections.some(i => i.vehicleId === v.id);
      return r('wait', recheck ? `Повторный контроль: ждёт поста контроля (${pos}-я в очереди)` : `Дождаться свободного поста участка «${stageName}» (${pos}-я в очереди)`, recheck ? 'Доработка завершена; годной машина станет только после повторного контроля.' : 'Все посты участка заняты или машина впереди по приоритету.');
    },
    // Unified task list: equipment problems, vehicle defects and waiting diagnostics, long blockages and forecast risks.
    // Ids come from existing entities, so polling never creates duplicates.
    tasks() {
      const out = [];
      for (const p of this.problems.filter(p => p.status === 'open')) {
        const view = this.problemView(p), jobs = this.jobs.filter(j => j.problemId === p.id && ['queued', 'running'].includes(j.status));
        const confirmed = Object.values(p.hypothesisStatus).some(s => s.status === 'confirmed');
        const next = jobs.length ? `Дождаться: ${jobs[0].title.toLowerCase()} (${jobs[0].status === 'running' ? `осталось ${jobs[0].remaining} мин` : 'в очереди техника'})` : p.kind === 'equipment' ? (view.availableChecks.find(c => !c.done && c.ok) ? `Выполнить проверку: ${view.availableChecks.find(c => !c.done && c.ok).title.toLowerCase()}` : 'Сравнить решения и назначить ремонт') : 'Назначить ремонт поста';
        out.push({ id: `TASK-${p.id}`, category: p.kind === 'equipment' ? 'equipment' : 'incident', categoryName: p.kind === 'equipment' ? 'Неисправность оборудования' : 'Неисправность поста (ручной сценарий)',
          certainty: p.kind === 'equipment' ? (confirmed ? 'confirmed' : 'hypothesis') : 'confirmed', certaintyText: p.kind === 'equipment' ? (confirmed ? 'причина подтверждена проверкой' : 'отклонение измерено, причина — гипотеза') : 'неисправность зафиксирована',
          object: { type: 'problem', id: p.id }, title: `${p.id} · ${p.title}`, reason: p.observations[0].text, status: jobs.length ? (jobs[0].status === 'running' ? 'идут работы' : 'работа в очереди') : 'открыта',
          since: p.detectedAt, postId: p.postId, impact: view.vehicleIds.length ? `${code(p.postId)}: затронуты ${view.vehicleIds.join(', ')}` : `${code(p.postId)}`, next });
      }
      const late = new Set(this.forecast().lateOrders);
      for (const v of this.vehicles) {
        const proc = this.reworkProcedure(v);
        if (!proc) continue;
        const fail = this.lastFailInspection(v), na = this.nextAction(v), order = this.order(v.orderId), pv = this.procedureView(v);
        const status = pv.recheck ? 'повторный контроль' : pv.inQueue ? `в очереди на ${code(DIAG_POST)}` : pv.atPost ? (proc.type === 'auto' || !this.manualRework ? 'автоматическая доработка' : this.awaitingManual(v) ? 'ждёт оператора' : 'завершение доработки') : 'в пути';
        out.push({ id: `TASK-${fail.id}`, category: proc.type === 'start' ? 'diagnosis' : 'defect', categoryName: proc.category,
          certainty: proc.type === 'start' && !(v.componentChecks ?? []).some(k => k.result === 'fault') && !v.startPassed ? 'hypothesis' : 'confirmed',
          certaintyText: proc.type === 'start' ? ((v.componentChecks ?? []).some(k => k.result === 'fault') ? 'неисправность подтверждена измерением' : v.startPassed ? 'устранено, ждёт повторного контроля' : 'симптом подтверждён контролем, причина — гипотеза') : `выявлено контролем ${code(fail.postId)}`,
          object: { type: 'vehicle', id: v.id }, title: `${v.id} · ${fail.defect}`, reason: `Контроль ${code(fail.postId)} в ${clock(fail.minute)}: ${fail.defect}`, status, since: fail.minute, postId: v.location.type === 'post' ? v.location.id : null,
          impact: `Задание ${v.orderId}${order.dueMinute <= SHIFT ? `, срок ${clock(order.dueMinute)}${late.has(order.id) ? ' — по прогнозу опоздает' : ''}` : ', срок — следующая смена'}${this.awaitingManual(v) && this.atReworkPost(v) ? `; ${code(DIAG_POST)} занят до выполнения операции` : ''}`,
          next: na.title });
      }
      for (const def of Object.values(POST)) {
        const post = this.posts[def.id], exec = post.executionId ? this.execution(post.executionId) : null;
        if (!exec || exec.completedAt === null || this.finished || this.minute - exec.completedAt < 10) continue;
        const pv = this.postView(def);
        out.push({ id: `TASK-BLOCK-${def.id}-${exec.id}`, category: 'delay', categoryName: 'Блокировка потока', certainty: 'confirmed', certaintyText: 'наблюдается сейчас',
          object: { type: 'post', id: def.id }, title: `${def.code} · ждёт места ${this.minute - exec.completedAt} мин`, reason: pv.reason, status: 'блокирован', since: exec.completedAt, postId: def.id,
          impact: `${exec.vehicleId} не может перейти дальше; пост не принимает следующий автомобиль`, next: 'Освободить следующий буфер: проверьте посты следующего участка' });
      }
      if (!this.finished) for (const id of late) {
        const o = this.order(id);
        out.push({ id: `TASK-RISK-${id}`, category: 'risk', categoryName: 'Риск срока задания', certainty: 'forecast', certaintyText: 'прогноз симуляции, не факт',
          object: { type: 'order', id }, title: `${id} · ${MODELS[o.modelId].name} × ${o.quantity}: срок ${clock(o.dueMinute)} под угрозой`, reason: 'Прогон копии текущего состояния до 16:00 без новых вмешательств', status: 'прогноз', since: this.minute, postId: null,
          impact: `Принято ${o.vehicleIds.filter(x => this.vehicle(x).accepted).length} из ${o.quantity}`, next: 'Разобрать задачи, которые задерживают машины задания' });
      }
      const rank = { equipment: 0, incident: 0, diagnosis: 1, defect: 2, delay: 3, risk: 4 };
      return out.sort((a, b) => rank[a.category] - rank[b.category] || a.since - b.since);
    },
  };
  Object.assign(Workshop.prototype, methods);
}
