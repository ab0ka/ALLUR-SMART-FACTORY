import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/app/75-mobile-sheet.js', import.meta.url), 'utf8').split('// Move secondary controls')[0];
function keyboard({mobile=true, dialog=false, menu=false}={}) {
 const handlers={}, focus=[], closed=[];
 const elements={confirm:{open:dialog},menu:{open:menu}};
 const context=vm.createContext({matchMedia:()=>({matches:mobile}), ui:{panel:{type:'chat'}}, $:id=>elements[id], document:{addEventListener:(name,fn)=>handlers[name]=fn,querySelector:selector=>({focus:()=>focus.push(selector)})},closePanel:()=>closed.push(true)});
 vm.runInContext(source,context);
 const event={key:'Escape',preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};
 handlers.keydown(event);
 return {event,closed,focus};
}
test('Escape from the mobile composer closes the sheet and restores a visible focus target',()=>{
 const {event,closed,focus}=keyboard();assert.equal(closed.length,1);assert.deepEqual(focus,['#menu summary']);assert(event.prevented&&event.stopped);
});
test('mobile Escape leaves confirmation dialogs and an open menu to their own handlers',()=>{
 for(const opts of [{dialog:true},{menu:true}]){const r=keyboard(opts);assert.equal(r.closed.length,0);assert(!r.event.prevented);}
});
test('desktop Escape remains owned by the existing navigation handler',()=>{
 const r=keyboard({mobile:false});assert.equal(r.closed.length,0);assert(!r.event.stopped);
});
