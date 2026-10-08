// Optional installed Edge/Playwright regression; no runtime dependencies or paid requests.
import assert from 'node:assert/strict';
import { Workshop } from '../server/simulation.mjs';
import { fullState } from '../server/index.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MOBILE_CHECK_URL || 'http://127.0.0.1:3029';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const sim = new Workshop(); for (let i=0;i<39;i++) sim.advance(5);
const snapshot = fullState(sim, {aiOptions:{provider:'local'}});
const pr = snapshot.problems.find(p=>p.status==='open');
pr.title += ' — длительное предупреждение о необходимости проверки оборудования';
const browser = await chromium.launch({channel:'msedge'});
try {
 for(const [width,height] of [[390,844],[414,896],[320,568],[640,320],[844,390],[1280,900],[1440,900]]) {
  const page=await browser.newPage({viewport:{width,height}}); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/state',r=>r.fulfill({json:snapshot}));
  await page.route('**/api/**',r=>r.request().method()==='POST'?r.abort():r.fallback());
  const sheet=page.locator('#side');
  async function go(route){await page.goto(`${base}/#${route}`);await page.locator('#clock').filter({hasText:/\d/}).waitFor();}
  async function reachable(selector){const el=page.locator(selector).last();await el.scrollIntoViewIfNeeded();assert(await el.evaluate(e=>{const r=e.getBoundingClientRect(),s=document.querySelector('#side').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${width}: clipped ${selector}`);}
  if(width===390||width===414){
   for(const route of ['space/enterprise','space/weld','space/paint','space/assembly','space/tests','space/rework','space/ship','space/diag','dispatcher','vehicles','orders','shift','lab']){
    await go(route);await page.locator('main details').evaluateAll(es=>es.forEach(e=>e.open=true));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,route);
    assert(await page.locator('.table-scroll').evaluateAll(es=>es.filter(e=>e.getClientRects().length).every(e=>e.tabIndex===0&&e.getAttribute('role')==='region'&&(e.hasAttribute('aria-label')||e.hasAttribute('aria-labelledby')))),route+' table accessibility');
   }
   await go('space/assembly');await page.locator('[data-mode=table]').click();
   assert.equal(await page.locator('#table-view .table-scroll').getAttribute('tabindex'),'0');
   assert.equal(await page.locator('#table-view .table-scroll').getAttribute('role'),'region');
  }
  if(width<=760){
   await go('space/assembly');await page.locator('#menu summary').click();await page.locator('#chat-toggle').click();
   await page.locator('#side-chat-input').waitFor();assert.equal(await page.locator('#menu').evaluate(e=>e.open),false,'menu closes when opening chat');
   await page.keyboard.press('Escape');
   assert(await page.locator('#play').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=40&&r.height>=40}));
   assert(await page.locator('.synthetic').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=12));
  }
  await go('space/assembly');await page.locator('[data-mode=scene]').click();await page.locator('#scene [data-vehicle]').first().waitFor();
  let id=await page.locator('#scene [data-vehicle]').evaluateAll(es=>es.find(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>100&&r.bottom<innerHeight-70&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})?.dataset.vehicle);
  if(width>760) id=await page.locator('#scene [data-vehicle]').first().getAttribute('data-vehicle');
  assert(id,'visible vehicle fixture');
  const selected=page.locator(`#scene [data-vehicle="${id}"]`).first();
  if(width>760){await selected.focus();await selected.press('Enter');}else await selected.click();
  await sheet.locator('h2').waitFor();
  if(width<=760){
   assert(await page.evaluate(id=>{const r=document.querySelector(`#scene [data-vehicle="${id}"]`).getBoundingClientRect(),s=document.querySelector('#scene').getBoundingClientRect(),card=document.querySelector('#side').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom+1&&r.bottom<card.top;},id),'selected vehicle above sheet');
   await page.locator('[data-sheet-toggle]').click();assert.equal(await page.locator('[data-sheet-toggle]').getAttribute('aria-expanded'),'false');assert(await page.locator('.sheet-content').isHidden());
   await page.locator('[data-ribbon=open]').click();assert(await page.locator('#ribbon .ribbon-list').isVisible());
   await page.locator('[data-ribbon=close]').click();await page.locator('[data-sheet-toggle]').click();
   await page.keyboard.press('Escape');assert(await sheet.isHidden());assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
  }
  for(const route of [`vehicle/${id}`,`post/${pr.postId}`,`problem/${pr.id}`,`compare/${pr.id}`,'chat']){
   await go('space/assembly/'+route);await sheet.locator('h2').waitFor();
   if(width<=1100)assert(await sheet.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   if(route==='chat'){await page.locator('#side-chat-input').fill('Синтетический черновик');await reachable('#side-chat-send');}
   else if(route.startsWith('problem')){
    await reachable('#side .side-foot [data-open-chat]');
    if(width===390){
     const scroll=await page.locator('.sheet-content').evaluate(e=>e.scrollTop);
     pr.title += ' · обновлено'; snapshot.revision++;
     await page.waitForFunction(()=>document.querySelector('#side h2')?.textContent.includes('обновлено'));
     assert(Math.abs(await page.locator('.sheet-content').evaluate(e=>e.scrollTop)-scroll)<2,'poll must retain sheet scroll');
    }
   }
   else if(route.startsWith('compare'))await reachable('#side [data-compare]');
   if(width<=760){await reachable('[data-sheet-close]');await page.locator('[data-sheet-close]').click();assert(await sheet.isHidden());}
  }
  await go(`space/assembly/vehicle/${id}`);await sheet.locator('h2').waitFor();
  if(width>=1280){assert.equal(await sheet.evaluate(e=>getComputedStyle(e).display),'flex');assert(await page.locator('.sheet-bar').isHidden());}
  if([390,414,1280,1440].includes(width))await page.screenshot({path:`screenshots/t2-v45-${width}.png`});
  assert.deepEqual(errors,[]); console.log(`${width}x${height}: pages, cards, actions, scene, sheet and focus PASS`);await page.close();
 }
}finally{await browser.close();}
