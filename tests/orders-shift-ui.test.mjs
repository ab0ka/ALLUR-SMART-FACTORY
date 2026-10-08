import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Workshop} from '../server/simulation.mjs';
function harness(state){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',clientWidth:320,addEventListener(){},setAttribute(){},insertAdjacentHTML(){},querySelector:()=>({})});return elements.get(id);};
 const pct=n=>`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n*100)}%`;
 const listeners={};
 const c=vm.createContext({state,$,window:{addEventListener(){}},document:{activeElement:null,addEventListener:(type,fn)=>{listeners[type]=fn;}},view:'shift',text:(id,v)=>{$(id).textContent=v;},vehicle:id=>state.vehicles.find(v=>v.id===id),post:id=>state.posts.find(p=>p.id===id),esc:v=>String(v??''),clock:String,bar:String,fmt:String,pct,postLink:String,aiRevision:null,TASK_GROUPS:[],JOB_STATUS:{},POST_SHORT:{working:'В работе',idle:'Свободен',shift_over:'Конец смены'},ORDER_STATES:{completed:'Выполнено',in_progress:'В работе',released:'Выпущено'},PRIORITY:{normal:'Обычный',high:'Высокий',low:'Низкий'},VEHICLE_STATES:{}});
 for(const name of ['30-vehicles-orders','40-shift-lab'])vm.runInContext(readFileSync(new URL(`../public/app/${name}.js`,import.meta.url),'utf8'),c);
 return {c,$,listeners,run:code=>vm.runInContext(code,c),pct};
}
test('T4 filters, actual deadlines, progress and shop links use real snapshot values',()=>{
 const w=new Workshop({warmup:0,episode:false});w.releaseOrder({modelId:'A',quantity:1,priority:'high',dueMinute:1});w.runToEnd();const s=w.snapshot(),h=harness(s);h.run('renderOrders()');
 const html=h.$('order-list').innerHTML;assert.match(html,/ВЫПОЛНЕНО С ОПОЗДАНИЕМ/);assert.doesNotMatch(html,/ПО ПРОГНОЗУ ОПОЗДАЕТ/);assert.match(html,/<strong>1\/1<\/strong>/);assert.match(html,/data-show-in-shop=/);
 for(const [key,expected] of [['all',s.orders.length],['active',s.orders.filter(o=>o.state==='in_progress').length],['completed',s.orders.filter(o=>o.state==='completed').length],['risk',s.orders.filter(o=>o.state!=='completed'&&(o.overdue||s.forecast.lateOrders.includes(o.id)||o.dueMinute<=s.elapsed)).length]]){
  h.run(`ordersFilter='${key}';renderOrders()`);assert.equal((h.$('order-list').innerHTML.match(/<article /g)||[]).length,expected);
 }
 const fresh=harness(new Workshop({warmup:0}).snapshot());fresh.run("ordersFilter='completed';renderOrders()");assert.match(fresh.$('order-list').innerHTML,/Нет заданий/);
 const end=new Workshop();end.runToEnd();const eh=harness(end.snapshot());eh.run('renderOrders()');assert.match(eh.$('order-list').innerHTML,/СРОК НЕ ВЫПОЛНЕН/);
});
test('T4 OEE distinguishes undefined metrics, real zero and model-defined service quality',()=>{
 const w=new Workshop({warmup:0,episode:false}),pending=new Set(['quality','rework','shipping']);
 const start=harness(w.snapshot());start.c.p=start.c.state.posts.find(p=>p.stage==='weld');assert.equal(start.run("shiftxValue(p,'quality')"),null);assert.equal(start.run("shiftxValue(p,'availability')"),null);
 start.c.p=start.c.state.posts.find(p=>p.stage==='shipping');assert.equal(start.run("shiftxMetric(p,'quality')"),'100%');assert.equal(start.run("shiftxValue(p,'oee')"),null);
 for(let i=0;i<480&&pending.size;i++,w.advance(1))for(const p of w.snapshot().posts.filter(p=>pending.has(p.stage)&&p.stats.run>0&&p.stats.completed===0)){
  const h=harness(w.snapshot());h.c.p=p;assert.equal(h.run("shiftxMetric(p,'quality')"),'100%');assert.equal(h.run("shiftxMetric(p,'oee')"),h.pct(p.metrics.oee));pending.delete(p.stage);
 }
 assert.equal(pending.size,0);
 const h=harness(new Workshop().snapshot()),p=h.c.state.posts.find(p=>p.stats.completed>0);p.metrics.quality=0;p.metrics.oee=0;h.c.p=p;assert.equal(h.run("shiftxMetric(p,'oee')"),'0%');
});
test('T4 OEE sorting uses numeric values, leaves undefined last and never reorders server state',()=>{
 const h=harness(new Workshop({warmup:113,episode:false}).snapshot());const before=h.c.state.posts.map(p=>p.id);
 for(const direction of [1,-1]){
  h.run(`shiftxSort={key:'oee',direction:${direction}}`);const rows=h.run('shiftxPosts().map(p=>({id:p.id,value:shiftxValue(p,"oee")}))');const valid=rows.filter(p=>p.value!==null);
  for(let i=1;i<valid.length;i++)assert.ok(direction*(valid[i].value-valid[i-1].value)>=0);
  assert.ok(rows.slice(valid.length).every(p=>p.value===null));
 }
 assert.deepEqual(h.c.state.posts.map(p=>p.id),before);
 h.run('renderShift()');assert.match(h.$('oee-table').innerHTML,/aria-sort="descending"/);assert.match(h.$('oee-table').innerHTML,/data-shiftx-sort="oee"/);
 assert.doesNotMatch(h.$('shift-chart').innerHTML,/NaN|Infinity/);
});
test('T4 first screen keeps four distinct metrics and preserves PR45 decision/task information',()=>{
 for(const options of [{warmup:0},{warmup:480},{warmup:0,plan:false}]){
  const h=harness(new Workshop(options).snapshot());h.run('renderShift()');const html=h.$('shift-first').innerHTML;
  for(const label of ['План смены (задан)','Эталонная мощность (симуляция)','Прогноз к 16:00','Факт','Результат решений','Задачи','Риск отказа'])assert.ok(html.includes(label));
  assert.equal((html.match(/class="shiftx-metric /g)||[]).length,4);
  if(options.plan===false)assert.match(html,/Эталон недоступен/);
 }
});

test('T4 an explicit order reference reveals a row hidden by the filter before shared navigation',()=>{
 const h=harness(new Workshop().snapshot());h.c.view='orders';h.run("ordersFilter='completed';renderOrders()");
 assert.match(h.$('order-list').innerHTML,/Нет заданий/);
 h.listeners.click({target:{closest:()=>({dataset:{refType:'order',refId:'ORD-101'}})}});
 assert.equal(h.run('ordersFilter'),'all');assert.match(h.$('order-list').innerHTML,/id="order-ORD-101"/);
});
