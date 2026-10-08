// Pure, read-only handover renderer. T9 owns fetching, insertion and focus restoration.
function renderHandoverItems(report) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const present = value => value !== null && value !== undefined && value !== '';
  const display = value => escape(present(value) ? value : '—');
  const array = value => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : [];
  const compare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ru', { numeric: true });
  const sorted = value => array(value).slice().sort((a, b) => compare(a.id, b.id));
  const routes = { problem: 'dispatcher/problem', vehicle: 'vehicles/vehicle', post: 'workshop/post', order: 'orders/order' };
  const status = value => display(({ open: 'Открыта', unresolved: 'Не решена к концу смены', queued: 'В очереди', running: 'Выполняется', released: 'Выпущено', in_progress: 'В работе', completed: 'Выполнено', confirmed: 'Подтверждено', hypothesis: 'Гипотеза', forecast: 'Прогноз' })[value] ?? value);
  const link = (type, id, label, key) => {
    if (!Object.hasOwn(routes, type) || !present(id)) return display(label ?? id);
    return `<a class="handover-items-link" data-focus-key="${escape(key)}" href="#${routes[type]}/${escape(encodeURIComponent(String(id)))}">${display(label ?? id)}</a>`;
  };
  const field = (label, html) => `<div class="handover-items-field"><dt>${escape(label)}</dt><dd>${html}</dd></div>`;
  const fields = pairs => `<dl class="handover-items-fields">${pairs.map(([label, value]) => field(label, value)).join('')}</dl>`;
  const refs = (item, key) => [
    present(item.postId) ? link('post', item.postId, `Пост ${item.postCode ?? item.postId}`, `${key}:post`) : '',
    present(item.problemId) ? link('problem', item.problemId, `Проблема ${item.problemId}`, `${key}:problem`) : '',
    present(item.vehicleId) ? link('vehicle', item.vehicleId, `Автомобиль ${item.vehicleId}`, `${key}:vehicle`) : '',
  ].filter(Boolean).join(' · ');
  const vehicleRefs = (ids, key) => {
    const occurrences = new Map();
    return (Array.isArray(ids) ? ids : []).filter(present).map(id => {
      const identity = String(id), occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return link('vehicle', id, `Автомобиль ${id}`, `${key}:vehicle:${encodeURIComponent(identity)}:${occurrence}`);
    });
  };
  const card = (title, body, references = '') => `<div class="handover-items-title">${title}</div>${body}${references ? `<p class="handover-items-refs">${references}</p>` : ''}`;
  const section = (id, title, items, empty, render, note = '') => {
    const occurrences = new Map();
    const rows = items.map(item => {
      // Occurrence disambiguates duplicate/missing IDs while preserving stable keys for valid IDs.
      const baseIdentity = present(item.id) ? `id:${String(item.id)}` : 'missing';
      const identity = id === 'tasks' ? JSON.stringify([baseIdentity, item.object?.type ?? null, item.object?.id ?? null]) : baseIdentity;
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      const key = `handover-items:${id}:${encodeURIComponent(identity)}:${occurrence}`;
      return `<li class="handover-items-item">${render(item, key)}</li>`;
    });
    const list = subset => `<ul class="handover-items-list">${subset.join('')}</ul>`;
    return `<section class="handover-items-section" aria-labelledby="handover-items-${id}"><h3 id="handover-items-${id}">${escape(title)} <span class="handover-items-count">(${items.length})</span></h3>${note ? `<p class="handover-items-note">${escape(note)}</p>` : ''}${rows.length ? list(rows.slice(0, 5)) + (rows.length > 5 ? `<details class="handover-items-more"><summary data-focus-key="handover-items:${id}:more">${escape(title)}: ещё ${rows.length - 5}</summary>${list(rows.slice(5))}</details>` : '') : `<p class="handover-items-empty">${escape(empty)}</p>`}</section>`;
  };
  const data = report ?? {}, resources = data.resources ?? {};
  const problems = sorted(data.problems).filter(p => p.status === 'open' || p.status === 'unresolved');
  const jobs = sorted(data.jobs).filter(j => j.status === 'queued' || j.status === 'running');
  const events = array(data.events).slice().sort((a, b) => (Number(b.minute ?? -1) - Number(a.minute ?? -1)) || compare(b.id, a.id)).slice(0, 20);
  return `<div class="handover-items-grid">${[
    section('problems', 'Открытые проблемы', problems, 'Открытых проблем нет.', (p, key) => card(
      link('problem', p.id, p.title ?? p.id, `${key}:title`),
      fields([['Статус', status(p.status)], ['Обнаружена, мин', display(p.detectedAt)]]),
      [refs(p, key), ...vehicleRefs(p.vehicleIds, key)].filter(Boolean).join(' · '))),
    section('jobs', 'Работы техника', jobs, 'Работ в очереди или в исполнении нет.', (j, key) => card(
      display(j.title ?? j.id), fields([['Работа', display(j.id)], ['Статус', status(j.status)], ['Техник', display(j.technicianId)], ['Осталось, мин', display(j.remaining)], ['Создана, мин', display(j.createdAt)]]), refs(j, key))),
    section('tasks', 'Текущие задачи', sorted(data.tasks), 'Текущих задач нет.', (t, key) => card(
      link(t.object?.type, t.object?.id, t.title ?? t.id, `${key}:title`),
      fields([['Категория', display(t.categoryName ?? t.category)], ['Статус', status(t.status)], ['С момента, мин', display(t.since)], ['Причина', display(t.reason)], ['Влияние', display(t.impact)], ['Следующий шаг', display(t.next)], ['Достоверность', display(t.certaintyText ?? t.certainty)]]), refs(t, key))),
    section('orders', 'Невыполненные заказы', sorted(data.orders).filter(o => o.state !== 'completed'), 'Невыполненных заказов нет.', (o, key) => card(
      link('order', o.id, o.id, `${key}:title`), fields([['Модель', display(o.modelId)], ['Статус', status(o.state)], ['Количество', display(o.quantity)], ['Принято', display(o.accepted)], ['Отгружено', display(o.shipped)], ['Срок, мин', display(o.dueMinute)], ['Просрочен', o.overdue === true ? 'Да' : o.overdue === false ? 'Нет' : display(o.overdue)]]))),
    section('technicians', 'Ресурсы: техники', sorted(resources.technicians), 'Техники в снимке отсутствуют.', t => card(display(t.name ?? t.id), fields([['Техник', display(t.id)], ['Текущая работа', display(t.jobId)]]))),
    section('stock', 'Ресурсы: склад', sorted(resources.stock), 'Складские позиции в снимке отсутствуют.', s => card(display(s.name ?? s.id), fields([['Остаток', display(s.onHand)], ['Зарезервировано', display(s.reserved)], ['Доступно', display(s.available)]]))),
    section('held-posts', 'Ресурсы: посты без загрузки', sorted(resources.heldPosts), 'Постов, снятых с загрузки, нет.', (p, key) => card(link('post', p.id, p.code ?? p.id, `${key}:title`), '')),
    section('events', 'Последние события', events, 'Событий в снимке нет.', (e, key) => card(display(e.text), fields([['Минута', display(e.minute)], ['Тип', display(e.kind)]]), refs(e, key)), 'До 20 событий, сначала новые.'),
  ].join('')}</div>`;
}
