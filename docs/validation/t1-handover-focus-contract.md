# T1 ↔ T9/T10: возврат к ссылке передачи смены

## T10: разметка уже совместима

Оставить настоящие href #orders/order/<id>, #dispatcher/problem/<id>, #vehicles/vehicle/<id>, #workshop/post/<id> и стабильный data-focus-key на a. Ссылка должна быть внутри .view[id] (для центра — #view-handover). Ключ идентифицирует объект/роль ссылки, а не индекс сортировки. Новые data-object-* не нужны. Не добавлять role=button и отдельный keydown Enter.

T1 перехватывает обычный click этих ссылок; Enter браузер превращает в click. Модификаторы, средняя кнопка, download и target кроме _self сохраняют поведение браузера. Вызов navPush(hash, link) сохраняет исходную history.state с прежним ret и добавляет scroll/focus. Новая запись получает ret:{from,label}. focus источника не переносится в новую запись.

Пример исходного focus: #view-handover [data-focus-key="task:PR-1:vehicle"]. Возврат осуществляется history.back через существующий navBack/closePanel. Escape поддерживает также полноэкранный vehicle и order. При открытии ссылка переводит фокус на заголовок карточки.

## Точные изменения для владельца T9 (не внесены в его файлы)

В handoverRoute заменить вызов loadHandover() на:

```js
loadHandover({ returnFocus: captureNavigationReturnFocus($('view-handover')) });
```

Сигнатуру загрузки заменить на:

```js
async function loadHandover({ returnFocus = null } = {}) {
```

Текущий click-handler кнопки refresh может остаться: у MouseEvent нет returnFocus. Токен захватывать только при входе на маршрут; ручное обновление не должно повторно читать старый focus из history.

В finally, внутри уже существующей проверки актуальности generation и view, после включения кнопки refresh и aria-busy=false, заменить условие локального восстановления:

```js
if (returnFocus) {
  restoreNavigationReturnFocus(returnFocus, $('handover-refresh'));
} else if (focusKey && (document.activeElement === document.body || document.activeElement === focused)) {
  // Существующее локальное восстановление T9 при ручном обновлении — без изменений.
}
```

Существующее восстановление openDetails после handoverPaint сохранить. Helper при необходимости раскрывает все родительские details целевой ссылки. Он пропускает hidden/display:none-дубликаты, проверяет маршрут, selector и версию focusin, расходует токен один раз. Если объект исчез, после завершения загрузки используется refresh; если пользователь выбрал другой фокус или ушёл с маршрута, helper ничего не делает. При ошибке запроса finally также даёт доступную кнопку повторения.

T9 не должен вызывать общий restoreNavigationFocus повторно вместо этого токена: токен привязан к конкретному возврату, а не к произвольному последующему обновлению.

## Проверка

Unit-регрессии используют настоящие helpers и setView: четыре маршрута, ret/focus, модификаторы, async details, одноразовый токен, смена маршрута/фокуса и отложенный rAF. scripts/check-navigation-return.mjs проверяет реальный Enter/Escape и history в Microsoft Edge на изолированной DOM-фикстуре с реальными helpers T1. Скрипт не запускает сервер и не меняет производственные данные.

Полная интеграция с реальным API и renderer T9/T10 требует применения указанных строк владельцем T9 и прогона T11; DOM-фикстура не заменяет этот прогон.

Проверено 2026-10-08: 132/132 unit/integration tests; Edge DOM-контракт прошёл, включая CSS display:none-дубликат перед целью внутри details.
