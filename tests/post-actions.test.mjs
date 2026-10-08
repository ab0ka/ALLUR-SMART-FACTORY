import test from 'node:test';
import assert from 'node:assert/strict';
import { Workshop, POSTS } from '../server/simulation.mjs';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const actions = (w, id) => w.postView(POSTS.find(p => p.id === id)).actions;
const transfer = (w, from, to) => actions(w, from).find(a => a.kind === 'transfer' && a.payload.postId === to);
function freePair() {
  const w = new Workshop({ episode: false });
  for (let i=0;i<200;i++,w.advance(1)) for (const p of POSTS) {
    const v=w.posts[p.id].vehicleId, ex=v&&w.execution(w.vehicle(v).currentExecutionId);
    const q=POSTS.find(q=>q.stage===p.stage&&q.id!==p.id&&!w.posts[q.id].vehicleId);
    if(ex&&ex.completedAt===null&&q){w.injectIncident(p.id,'breakdown');return {w,from:p.id,to:q.id,v,ex};}
  }
  throw new Error('No natural free target');
}
test('11:10 post actions expose checks and exact occupied-target reasons',()=>{
  const w=new Workshop();w.advance(10);
  for(const kind of ['pump_check','pressure_hold']) assert.equal(actions(w,'A2').find(a=>a.payload.kind===kind).ok,true);
  for(const id of ['A1','A3']) {const a=transfer(w,'A2',id);assert.equal(a.ok,false);assert.match(a.reason,/занят: DEMO-/);}
});
test('repair stock and duplicate jobs are checked by the same server availability',()=>{
  const w=new Workshop();w.stock.pump.onHand=0;
  const a=actions(w,'A2').find(a=>a.payload.kind==='repair_pump');assert.equal(a.ok,false);assert.match(a.reason,/Нет на складе/);
  const before=w.serialize();assert.throws(()=>w.command(a.payload),e=>e.message===a.reason);assert.deepEqual(w.serialize(),before);
  w.injectIncident('W1','breakdown');w.createJob({postId:'W1',kind:'repair_generic'});
  const duplicate=actions(w,'W1').find(a=>a.payload.kind==='repair_generic');assert.equal(duplicate.ok,false);assert.match(duplicate.reason,/уже запланирована/);
});
test('hold actions and commands share last-post, return, shift and validation rules',()=>{
  const w=new Workshop();w.setHold('A1',true);w.setHold('A3',true);
  const a=actions(w,'A2').find(a=>a.kind==='hold');assert.equal(a.ok,false);assert.match(a.reason,/последнего поста/);
  assert.throws(()=>w.command(a.payload),e=>e.message===a.reason);
  const back=actions(w,'A1').find(a=>a.kind==='hold');assert.equal(back.ok,true);w.command(back.payload);assert.equal(Boolean(w.holds.A1),false);
  for(const [id,on] of [['bad',true],['A1','yes']]) {const av=w.holdAvailability(id,on);assert.equal(av.ok,false);assert.throws(()=>w.setHold(id,on),e=>e.message===av.reason&&e.status===av.status);}
  w.runToEnd();assert.ok(actions(w,'A2').every(a=>!a.ok));
});
test('transfer actions recheck targets and preserve execution and remaining work once',()=>{
  const {w,from,to,v,ex}=freePair();const a=transfer(w,from,to);assert.equal(a.ok,true);
  const stale=freePair();stale.w.setHold(stale.to,true);const denied=transfer(stale.w,stale.from,stale.to);assert.match(denied.reason,/снят с загрузки/);assert.throws(()=>stale.w.command(transfer(w,from,to).payload),e=>e.message===denied.reason);
  const remaining=ex.remaining,id=ex.id,cmd={...a.payload,requestId:'t3-v45-transfer-1'};w.command(cmd);w.command(cmd);
  assert.equal(w.vehicle(v).location.id,to);assert.equal(w.vehicle(v).currentExecutionId,id);assert.equal(ex.remaining,remaining);assert.equal(w.events.filter(e=>e.type==='vehicle_transferred').length,1);assert.deepEqual(w.checkIntegrity(),[]);
});
test('all card renderers use server reasons; technician queue and lift stock stay visible',()=>{
  const {w,from,to,v}=freePair();w.setHold(to,true);
  w.createJob({postId:'A1',kind:'pump_check'});w.createJob({postId:'A2',kind:'pressure_hold'});
  const s=w.snapshot(),detail={innerHTML:''};
  const c=vm.createContext({state:s,post:id=>s.posts.find(p=>p.id===id),vehicle:id=>s.vehicles.find(v=>v.id===id),selectedPost:from,$:()=>detail,esc:String,fmt:String,pct:String,clock:String,bar:()=>'',ico:()=>'',POST_KIND:()=>'',POST_STATES:{},POST_SHORT:{},TASK_ICON:{},history:{state:null},runningJob:()=>null,problemLink:String,vehicleLink:String,PRIORITY:{normal:'Обычный',high:'Высокий',low:'Низкий'}});
  vm.runInContext(readFileSync(new URL('../public/app/60-ribbon-side-panels.js',import.meta.url),'utf8'),c);
  const card=readFileSync(new URL('../public/app/55-vehicle-card.js',import.meta.url),'utf8');vm.runInContext(card.slice(card.indexOf('function transferRow('),card.indexOf('function overviewBody(')),c);
  vm.runInContext(readFileSync(new URL('../public/app/20-workshop-map.js',import.meta.url),'utf8')+'\nrenderPostDetail();',c);
  for(const html of [detail.innerHTML,vm.runInContext(`panelPost(post('${from}'))`,c),vm.runInContext(`transferRow(vehicle('${v}'))`,c)]) {assert.ok(html.includes(transfer(w,from,to).reason));assert.ok(!html.includes(`data-to="${to}"`));assert.match(html,/disabled aria-describedby/);}
  const resource=vm.runInContext("postResources(post('A2'))",c);assert.match(resource,/занят: JOB-1/);assert.match(resource,/JOB-2/);assert.match(resource,/Склад/);assert.match(resource,/резерв/);
});
