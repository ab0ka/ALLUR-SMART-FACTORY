// Optional Edge regression: build/start the local app, then supply PLAYWRIGHT_MODULE.
// Example: PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node scripts/check-mobile-cards.mjs
import assert from 'node:assert/strict';
import { Workshop } from '../server/simulation.mjs';
import { fullState } from '../server/index.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MOBILE_CHECK_URL || 'http://127.0.0.1:3029';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a local test server');
const sim = new Workshop(); for (let i = 0; i < 39; i++) sim.advance(5);
const snapshot = fullState(sim, { aiOptions: { provider: 'local' } });
const problem = snapshot.problems.find(p => p.status === 'open');
assert(problem, 'Synthetic fixture must contain a problem');
problem.title += ' — длительное предупреждение о снижении давления и необходимости проверки оборудования';
const browser = await chromium.launch({ channel: 'msedge' });
try {
  for (const [width, height] of [[320,568],[390,844],[414,736],[844,390],[640,320],[1440,900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route('**/api/state', route => route.fulfill({ json: snapshot }));
    // This geometry check must never send a production action or AI request.
    await page.route('**/api/**', route => route.request().method() === 'POST' ? route.abort() : route.fallback());
    const sheet = page.locator('#side');
    async function reachable(selector) {
      const target = page.locator(selector).last();
      await target.scrollIntoViewIfNeeded();
      assert(await target.evaluate(e => {
        const r = e.getBoundingClientRect(), s = document.querySelector('#side').getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        return r.top >= s.top && r.bottom <= s.bottom + 1 && e.contains(document.elementFromPoint(x, y));
      }), `${width}x${height}: ${selector} must be reachable, not clipped`);
    }
    for (const route of [`post/${problem.postId}`, `problem/${problem.id}`, `compare/${problem.id}`, 'chat']) {
      await page.goto(`${base}/#space/assembly/${route}`);
      await sheet.locator('h2').waitFor();
      assert(await sheet.evaluate(e => e.getBoundingClientRect().bottom <= innerHeight + 1));
      if (width <= 1100) assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `${width}: horizontal overflow in ${route}`);
      if (route.startsWith('problem/')) {
        await reachable('#side .side-foot [data-open-chat]');
        await page.locator('#side .side-foot [data-open-chat]').click();
        await page.locator('#side-chat-input').waitFor();
        assert((await page.url()).endsWith('/chat'));
      }
      if (route === 'chat' || route.startsWith('problem/')) {
        await page.locator('#side-chat-input').fill('Синтетический вопрос для проверки геометрии');
        await reachable('#side-chat-send');
        if (width === 640 && route === 'chat') await page.screenshot({ path: 'screenshots/t2-landscape-chat-after.png' });
      } else if (route.startsWith('compare/')) await reachable('#side [data-compare]');
      else await reachable('#side [data-hold]');
      await reachable('#side [data-close-panel]');
      await page.locator('#side [data-close-panel]').click();
      assert(await sheet.isHidden());
    }
    await page.goto(`${base}/#space/assembly/problem/${problem.id}`); await sheet.locator('h2').waitFor();
    if(width === 320) await page.screenshot({path:'screenshots/t2-mobile-long-warning.png'});
    if(width > 1100) assert.equal(await sheet.evaluate(e=>getComputedStyle(e).display),'flex');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    console.log(`${width}x${height}: cards, long title, scrolling, chat transition, close and desktop layout passed`);
    await page.close();
  }
} finally { await browser.close(); }
