# Контракт передачи смены v1

`createHandover(snapshot)` экспортируется из `server/handover.mjs`. Вход — **один публичный `Workshop.snapshot()`**. Модуль не обращается к движку, `serialize`, хранилищу, реальным сохранениям, чату или AI. Все данные синтетические. Проекция не меняет вход и не сохраняет ссылки на его вложенные объекты.

## Верхний уровень

| Поле отчёта | Источник |
| --- | --- |
| `schemaVersion` | Константа `1` |
| `synthetic` | Константа `true` |
| `revision`, `elapsed`, `shift`, `shiftStart`, `finished` | Одноимённые поля снимка |
| `metrics.planTarget` | `snapshot.plan.target` |
| `metrics.referenceTotal` | `snapshot.plan.reference.total` |
| `metrics.forecast` | `snapshot.forecast.projected` |
| `metrics.forecastLow`, `metrics.forecastHigh` | `snapshot.forecast.low`, `snapshot.forecast.high` |
| `metrics.accepted`, `metrics.shipped`, `metrics.wip` | Одноимённые поля `snapshot.totals` |
| `metrics.firstPassYield` | `snapshot.quality.firstPassYield` (доля, без умножения на 100) |
| `counts.problems`, `counts.jobs`, `counts.tasks`, `counts.orders` | Длины соответствующих массивов **после фильтрации** |

Время и длительности сохраняются в модельных минутах; `shiftStart` — минуты от начала суток. Прогноз остаётся прогнозом симуляции, не фактом выпуска. Нулевые значения и `false` сохраняются. Отсутствующие/`undefined`/`null` значения становятся `null`; объект вместо скалярного поля и нечисловые `NaN`/Infinity также становятся `null`. Строки не преобразуются в HTML: экранирование в UI и защита CSV — ответственность потребителя.

## Массивы и вложенные поля

В каждой строке копируются только перечисленные поля (одноимённые источники, кроме явно указанных преобразований):

| Массив отчёта | Источник и фильтр | Поля строки |
| --- | --- | --- |
| `problems` | `snapshot.problems`, только `status` open/unresolved | `id`, `title`, `postId`, `postCode`, `vehicleIds`, `status`, `detectedAt` |
| `jobs` | `snapshot.jobs`, только `queued`/`running` | `id`, `title`, `postId`, `postCode`, `problemId`, `technicianId`, `status`, `remaining`, `createdAt` |
| `tasks` | Все текущие `snapshot.tasks`, без повторного вычисления | `id`, `category`, `categoryName`, `object: {type, id}`, `title`, `reason`, `status`, `since`, `postId`, `impact`, `next`, `certainty`, `certaintyText` |
| `orders` | `snapshot.orders`, кроме `state === 'completed'` | `id`, `modelId`, `quantity`, `accepted`, `shipped`, `state`, `dueMinute`, `overdue` |
| `resources.technicians` | `snapshot.technicians` | `id`, `name`, `jobId` |
| `resources.stock` | `snapshot.stock` | `id`, `name`, `onHand`, `reserved`, `available` (без пересчёта) |
| `resources.heldPosts` | `snapshot.holds` | `id` из элемента `holds`; `code` из `snapshot.posts` с таким `id`, иначе `null` |
| `events` | Последние 20 элементов `snapshot.events` | `minute`, `text`, `vehicleId`, `postId`, `problemId`, `jobId`, `orderId`; **`id` из `event.seq`, `kind` из `event.type`** |

`vehicleIds` — новая копия массива скалярных ссылок; если поле отсутствует, `null`. `object` всегда содержит только `type` и `id`, даже при отсутствии источника. Необязательные ссылки представлены `null`, если их нет в снимке. Отсутствующие массивы представлены `[]`.

Порядок массивов сохраняется из снимка, включая приоритет задач и хронологию событий. Фильтрация не меняет относительный порядок. Одинаковый снимок даёт побайтно одинаковый JSON: нет текущего системного времени, случайности, сортировки по локали или дополнительного чтения состояния.

Белый список исключает `chat`, CSRF, скрытые причины/health, гипотезы и измерения оборудования, результаты ремонтов и остальные неуказанные поля даже при их появлении в будущих версиях снимка. Это проекция доверенного публичного снимка, а не средство удаления произвольных секретов из разрешённых текстовых полей. В завершённой смене незакрытые проблемы имеют статус `unresolved` и остаются в отчёте для следующей смены, как и незавершённые работы и текущие задачи.

## Интеграция

Контракт потребителей: `GET /api/handover` возвращает объект напрямую; `?format=json` скачивает JSON; `?format=csv` скачивает UTF-8 CSV с типами строк/разделами и защищёнными текстовыми ячейками; неизвестный формат — 400. GET не меняет производство. HTTP, экспорт и экран `#handover` реализуются отдельными изменениями T8–T10; этот модуль не добавляет производственных команд.

Проверки: `node --test tests/handover.test.mjs`, `npm.cmd test`, `npm.cmd run build` при `AI_PROVIDER=local`. Тесты используют только синтетические снимки, проверяют начальную, активную и завершённую смену, фильтры, нули, ресурсы, детерминизм, отсутствие мутаций/общих ссылок и утечек лишних полей.
