import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = readFileSync(new URL('../public/app/55-vehicle-card.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const VIEW_RETURN'), source.indexOf('// ---------- Card blocks'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const p = await browser.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.setContent('<main id="legacy"><section class="view" id="view-handover"><button id="handover-refresh">Обновить</button><div id="items"></div></section><section id="side" hidden></section><section id="vehicle-passport" hidden></section></main><button id="chat-toggle">Чат</button>');
  await p.addScriptTag({ content: `
    var state = {}, ui = {}, view = 'handover', space = 'assembly';
    var $ = id => document.getElementById(id), esc = x => x, post = () => null;
    function fillLinks() { $('items').innerHTML = '<details><summary>Ещё</summary>' + ['orders/order/ORD-101','dispatcher/problem/PR-1','vehicles/vehicle/DEMO-008','workshop/post/A2'].map((route,i) => '<a data-focus-key="ref:'+i+'" href="#'+route+'">'+route+'</a>').join(' ') + '</details>'; }
    function setView(hash) {
      view = hash.split('/')[0]; ui.panel = ['dispatcher','workshop'].includes(view) ? {} : null;
      $('view-handover').hidden = view !== 'handover'; $('side').hidden = !ui.panel; $('vehicle-passport').hidden = view !== 'vehicles';
      if (view === 'handover') {
        const token = captureNavigationReturnFocus($('view-handover'));
        $('items').innerHTML = '';
        window.finishHandover = () => { fillLinks(); const hidden = $('items').querySelector('a').cloneNode(true); hidden.style.display = 'none'; $('items').prepend(hidden); restoreNavigationReturnFocus(token, $('handover-refresh')); };
      } else {
        (ui.panel ? $('side') : $('vehicle-passport')).innerHTML = '<h2 tabindex="-1">'+hash+'</h2>';
        if (view === 'orders') $('handover-refresh').blur();
      }
    }
    ${helpers}
    window.addEventListener('hashchange', () => { setView(location.hash.slice(1)); restoreNavigationFocus(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') backFromReference(); });
    history.replaceState(null, '', '#handover'); fillLinks();
  ` });
  for (let i=0;i<4;i++) {
    await p.locator('#items details').evaluate(el => { el.open = true; });
    const link = p.locator('#items details a').nth(i); const route = await link.getAttribute('href');
    await link.focus(); await link.press('Enter'); await p.waitForURL('about:blank'+route);
    assert.equal(await p.evaluate(() => history.state.ret.from), 'handover');
    await p.keyboard.press('Escape'); await p.waitForURL('about:blank#handover');
    await p.waitForFunction(() => document.querySelector('#items').children.length === 0);
    await p.evaluate(() => { finishHandover(); });
    await p.waitForFunction(i => document.activeElement?.dataset.focusKey === 'ref:'+i, i);
    assert.equal(await p.locator('#items details').getAttribute('open'), '');
  }
  await p.locator('#items details a').first().press('Enter'); await p.keyboard.press('Escape');
  await p.waitForURL('about:blank#handover'); await p.locator('#handover-refresh').focus();
  await p.evaluate(() => finishHandover()); assert.equal(await p.evaluate(() => document.activeElement.id), 'handover-refresh');
  assert.deepEqual(errors, []); console.log('PASS Edge: native Enter/Escape, four routes, async reload, details, stable focus, no focus stealing');
} finally { await browser.close(); }
