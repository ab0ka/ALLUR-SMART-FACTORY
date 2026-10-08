// Mobile-only presentation of the shared app-level card; routing stays with navigation.
const sheetMedia = matchMedia('(max-width: 760px)');
let sheetKey = null, sheetCollapsed = false, sheetFocusKey = null;
function resetSheet() {
  sheetKey = null; sheetCollapsed = false;
  $('side').classList.remove('sheet-collapsed');
}
function finishSheet(key, scroll) {
  const side = $('side');
  if (sheetKey !== key) {
    if (!sheetKey) sheetFocusKey = focusKey(document.activeElement);
    sheetCollapsed = false; sheetKey = key;
    if (sheetMedia.matches) requestAnimationFrame(() => side.querySelector('[data-sheet-toggle]')?.focus({ preventScroll: true }));
  }
  if (!side.querySelector('.sheet-content')) {
    const content = document.createElement('div');
    content.className = 'sheet-content'; content.id = 'sheet-content';
    while (side.firstChild) content.append(side.firstChild);
    side.append(content);
    side.insertAdjacentHTML('afterbegin', '<div class="sheet-bar"><span class="sheet-grip" aria-hidden="true"></span><button type="button" data-sheet-toggle="1" aria-controls="sheet-content"></button><button type="button" class="icon-btn" data-sheet-close="1" aria-label="Закрыть карточку">✕</button></div>');
  }
  side.classList.toggle('sheet-collapsed', sheetCollapsed);
  const toggle = side.querySelector('[data-sheet-toggle]');
  toggle.textContent = sheetCollapsed ? 'Развернуть' : 'Свернуть';
  toggle.setAttribute('aria-expanded', String(!sheetCollapsed));
  if (scroll !== undefined) side.querySelector('.sheet-content').scrollTop = scroll;
}
function closeMobileSheet() {
  closePanel();
  (sheetFocusKey && document.querySelector(sheetFocusKey) || document.querySelector('#menu summary')).focus({ preventScroll: true });
}
document.addEventListener('click', e => {
  if (!sheetMedia.matches) return;
  if (e.target.closest('#menu #chat-toggle')) $('menu').open = false;
  if (e.target.closest('[data-sheet-close]')) closeMobileSheet();
  if (e.target.closest('[data-sheet-toggle]')) {
    sheetCollapsed = !sheetCollapsed;
    finishSheet(sheetKey);
    $('side').querySelector('[data-sheet-toggle]').focus({ preventScroll: true });
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !sheetMedia.matches || !ui.panel || $('confirm').open || $('menu').open || ui.car3d) return;
  e.preventDefault(); e.stopImmediatePropagation(); closeMobileSheet();
}, true);
// Move secondary controls into the existing menu without cloning IDs or handlers.
const mobileTools = ['chat-toggle', 'alerts'].map(id => $(id)).concat(document.querySelector('.primary-nav'));
const mobileToolHomes = mobileTools.map(node => {
  const marker = document.createComment('mobile tool home'); node.before(marker); return marker;
});
for (const [id, label] of [['chat-toggle', 'Чат'], ['alerts', 'Проблемы']]) {
  const span = document.createElement('span'); span.className = 'mobile-tool-label'; span.textContent = label; $(id).append(span);
}
function placeMobileTools() {
  mobileTools.forEach((node, i) => sheetMedia.matches ? $('menu').querySelector('.menu-list').append(node) : mobileToolHomes[i].after(node));
}
sheetMedia.addEventListener('change', placeMobileTools);
placeMobileTools();
// Tables rendered by other feature owners keep their markup and get a keyboard
// scroll region at the shell boundary when one has not already been supplied.
function labelScrollTables(root) {
  const regions = [...root.querySelectorAll('.table-scroll')];
  if (root.matches?.('.table-scroll')) regions.unshift(root);
  for (const region of regions) {
    if (!region.hasAttribute('tabindex')) region.tabIndex = 0;
    if (!region.hasAttribute('role')) region.setAttribute('role', 'region');
    if (!region.hasAttribute('aria-label') && !region.hasAttribute('aria-labelledby')) {
      const title = region.querySelector('caption')?.textContent || region.closest('.panel,article')?.querySelector('h2,h3')?.textContent;
      region.setAttribute('aria-label', title?.trim() || 'Таблица данных');
    }
  }
}
labelScrollTables($('workarea'));
new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) labelScrollTables(node);
}).observe($('workarea'), {childList:true, subtree:true});
