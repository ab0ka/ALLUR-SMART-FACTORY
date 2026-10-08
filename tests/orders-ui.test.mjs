import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Workshop} from '../server/simulation.mjs';
const source=readFileSync(new URL('../public/app/30-vehicles-orders.js',import.meta.url),'utf8');
function render(state){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',querySelector:()=>({})});return elements.get(id);};
 const context=vm.createContext({state,$,text:()=>{},vehicle:id=>state.vehicles.find(v=>v.id===id),esc:v=>String(v??''),clock:String,bar:n=>`<meter value="${n}"></meter>`,ORDER_STATES:{completed:'Выполнено',in_progress:'В работе',released:'Выпущено'},PRIORITY:{normal:'Обычный',high:'Высокий',low:'Низкий'},VEHICLE_STATES:{}});
 vm.runInContext(source+'\nrenderOrders();',context);return $('order-list').innerHTML;
}
const card=(html,id)=>html.split(`id="order-${id}"`)[1].split('</article>')[0];
test('orders: end-of-shift missed deadline is a fact, not a future prediction',()=>{
 const w=new Workshop();w.runToEnd();const s=w.snapshot();const o=s.orders.find(o=>o.dueMinute===s.elapsed&&o.accepted<o.quantity);assert.ok(o);
 const html=card(render(s),o.id);assert.match(html,/СРОК НЕ ВЫПОЛНЕН/);assert.doesNotMatch(html,/ПО ПРОГНОЗУ/);
 assert.match(html,new RegExp(`<strong>${o.accepted}/${o.quantity}</strong>`));
});
test('orders: completed late order is labelled in the past, counts stay accepted-based',()=>{
 const w=new Workshop({warmup:0,episode:false});w.releaseOrder({modelId:'A',quantity:1,priority:'high',dueMinute:1});w.runToEnd();const s=w.snapshot(),o=s.orders.at(-1);assert.equal(o.state,'completed');
 const html=card(render(s),o.id);assert.match(html,/ВЫПОЛНЕНО С ОПОЗДАНИЕМ/);assert.doesNotMatch(html,/ПО ПРОГНОЗУ/);assert.match(html,/<strong>1\/1<\/strong>/);
 const ontime=s.orders.find(o=>o.state==='completed'&&!s.forecast.lateOrders.includes(o.id));assert.ok(ontime);assert.doesNotMatch(card(render(s),ontime.id),/ОПОЗДАНИЕМ|СРОК НЕ ВЫПОЛНЕН/);
});
