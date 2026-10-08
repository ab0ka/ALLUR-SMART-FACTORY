import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Workshop } from '../server/simulation.mjs';
const source = readFileSync(new URL('../public/app/40-shift-lab.js', import.meta.url), 'utf8');
function render(snapshot) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, {innerHTML:'', querySelector:()=>({}), insertAdjacentHTML(_, html){this.innerHTML=html+this.innerHTML;}}); return elements.get(id); };
  const context = vm.createContext({state:snapshot,$:get,document:{activeElement:null},esc:v=>String(v??''),fmt:n=>String(n),pct:n=>`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n*100)}%`,clock:m=>`${String(Math.floor((480+m)/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,text:(id,v)=>{get(id).textContent=v;},POST_SHORT:{},JOB_STATUS:{},postLink:id=>id,aiRevision:null});
  vm.runInContext(source+'\nrenderShift();', context);
  return {get, context};
}
test('shift: zero denominators are unavailable, not measured 0% or 100%',()=>{
 const s=new Workshop({warmup:0}).snapshot();const {get,context}=render(s);
 assert.equal(s.posts[0].metrics.quality,1);
 assert.equal((get('oee-table').innerHTML.match(/aria-label="Нет данных для расчёта"/g)||[]).length,s.posts.length*3 + s.posts.filter(p=>['weld','paint','assembly'].includes(p.stage)).length);
 const p=structuredClone(s.posts[0]);p.stats.run=5;p.metrics.availability=.5;p.metrics.performance=0;p.metrics.quality=0;p.metrics.oee=0;context.state.elapsed=10;context.p=p;
 assert.equal(vm.runInContext("shiftOeeValue(p,'performance')",context),'0%','real zero must remain zero');
 assert.match(vm.runInContext("shiftOeeValue(p,'quality')",context),/Нет данных/);
 p.stats.completed=1;
 for(const metric of ['quality','oee'])assert.equal(vm.runInContext(`shiftOeeValue(p,'${metric}')`,context),'0%');
});
test('shift: start and end show server plan, reference, forecast and actual independently',()=>{
 const w=new Workshop({warmup:0});assert.throws(()=>w.setPlanTarget(0));
 for(const finished of [false,true]){
  if(finished)w.runToEnd();const s=w.snapshot();const {get}=render(s);const html=get('shift-summary').innerHTML;
  for(const [kind,value] of [['target',s.plan.target],['reference',s.plan.reference.total],['forecast',s.forecast.projected],['fact',s.totals.accepted]])assert.match(html,new RegExp(`metric-${kind}[^]*?<dd>${value} `));
  assert.ok(s.forecast && Array.isArray(s.forecast.trajectory));
  assert.doesNotMatch(get('shift-chart').innerHTML,/NaN|Infinity/);
  if(finished){assert.equal(s.forecast.projected,s.totals.accepted);assert.match(get('forecast-box').innerHTML,/Смена завершена/);}
 }
});
test('shift: absent reference is unavailable and retains a separate forecast',()=>{
 const s=new Workshop({warmup:0,plan:false}).snapshot();const {get}=render(s);
 assert.match(get('shift-summary').innerHTML,/Эталон недоступен/);
 assert.doesNotMatch(get('shift-chart').innerHTML,/class="chart-plan"/);
 assert.match(get('shift-chart').innerHTML,/class="chart-forecast"/);
});

test('shift: service-stage Q is a model constant and OEE exists before the first completed operation',()=>{
 const w=new Workshop({warmup:0});const pending=new Set(['quality','rework','shipping']);
 for(let minute=0;minute<480&&pending.size;minute++,w.advance(1)){
  const matches=Object.entries(w.posts).filter(([,p])=>p.stats.run>0&&p.stats.completed===0);
  if(!matches.length)continue;
  const s=w.snapshot();
  for(const p of s.posts.filter(p=>pending.has(p.stage)&&p.stats.run>0&&p.stats.completed===0)){
   const {context}=render(s);context.p=p;
   assert.equal(p.metrics.quality,1);
   assert.equal(vm.runInContext("shiftOeeValue(p,'quality')",context),'100%');
   assert.ok(p.metrics.oee>0);
   assert.equal(vm.runInContext("shiftOeeValue(p,'oee')",context),`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(p.metrics.oee*100)}%`);
   pending.delete(p.stage);
  }
 }
 assert.deepEqual([...pending],[], 'real engine must exercise all three service stages');
});
