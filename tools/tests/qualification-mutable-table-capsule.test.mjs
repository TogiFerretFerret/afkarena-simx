import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext,runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { installPortableGraph } from '../battle-trace-portable.mjs';

const digest=text=>createHash('sha256').update(text).digest('hex');
async function realm(){const c=createContext({digest,isProxy:types.isProxy});runInContext(await readFile(new URL('../qualification-mutable-table-capsule.js',import.meta.url),'utf8'),c);runInContext(await readFile(new URL('../qualification-table-merkle-reference.js',import.meta.url),'utf8'),c);runInContext('var capsule=installQualificationMutableTableCapsule({digest:digest,isProxy:isProxy});function uncachedTableHash(value){return qualificationTableFullHash(value,digest)};',c);return c;}
function hashMatches(c){assert.equal(c.capsule.immutableMetadata(c.table).sha256,runInContext('uncachedTableHash(raw)',c));}
test('supported primitive stores match uncached actual descriptor graph after every write',async()=>{
 const c=await realm();runInContext('var shared={x:1},raw={left:{shared:shared},right:{shared:shared},other:{x:7},array:["0","","4"]};var table=capsule.wrap(raw,{name:"UnitPeriod"});',c);hashMatches(c);
 const actions=['table.left.shared.x=-0','table.left.shared.x=0','table.left.shared.x=Infinity','table.left.shared.x=-Infinity','table.left.shared.x=undefined','table.left.shared.x=null','table.left.shared.x="string"','table.left.shared.x=false','table.array[0]=parseInt(table.array[0])','table.array[1]=parseInt(table.array[1])','table.array[2]=parseInt(table.array[2])'];
 for(const action of actions){runInContext(action,c);hashMatches(c);assert.equal(runInContext('table.left.shared===table.right.shared&&Object.getOwnPropertyDescriptor(table.left,"shared").value===table.right.shared',c),true);}
 assert.equal(c.capsule.assertClean(),true);assert.equal(c.capsule.stats().mutations,actions.length);
});
test('only changed nodes and ancestors rehash; unchanged events never walk descriptors',async()=>{
 const c=await realm();runInContext('var leaf={x:1},raw={left:{leaf:leaf},right:{leaf:leaf},untouched:{x:2}};var table=capsule.wrap(raw,{name:"T"});',c);
 const initial=c.capsule.stats();assert.equal(initial.nodes,5);assert.equal(initial.hashNodeRecomputes,5);
 for(let i=0;i<1000;i++)c.capsule.immutableMetadata(c.table);
 assert.equal(c.capsule.stats().hashNodeRecomputes,5);assert.equal(c.capsule.stats().descriptors,initial.descriptors);
 runInContext('table.left.leaf.x=3',c);assert.equal(c.capsule.stats().hashNodeRecomputes,5);hashMatches(c);assert.equal(c.capsule.stats().hashNodeRecomputes,9);
 runInContext('table.left.leaf.x=3',c);hashMatches(c);assert.equal(c.capsule.stats().hashNodeRecomputes,9);assert.equal(c.capsule.stats().mutations,1);
});
test('AnimAtkFrame absent Type annotation is guarded, ordinary, ordered and rehashes',async()=>{
 const c=await realm();runInContext('var raw={"Mag.cha":{atk:{"0.5":{Cha:"Mag.cha",Action:"atk",Time:0.5,X:1,Y:2}}}};var table=capsule.wrap(raw,{name:"AnimAtkFrame"});',c);hashMatches(c);
 runInContext('table["Mag.cha"].atk["0.5"].Type="Attack"',c);hashMatches(c);
 assert.equal(runInContext('Object.keys(table["Mag.cha"].atk["0.5"]).join(",")',c),'Cha,Action,Time,X,Y,Type');
 assert.equal(c.capsule.stats().additions,1);assert.equal(runInContext('Object.getOwnPropertyDescriptor(table["Mag.cha"].atk["0.5"],"Type").writable',c),true);
 runInContext('table["Mag.cha"].atk["0.5"].Type="Later"',c);hashMatches(c);assert.equal(c.capsule.stats().additions,1);
});
test('unsupported writes fail before storing objects, invoking inherited setters or changing topology/flags',async()=>{
 const actions=['table.x={newObject:1}','table.child={x:9}','table.fresh=1','table.array[2]=1','table.array.length=1','delete table.x','Object.defineProperty(table,"x",{value:2})','Reflect.defineProperty(table,"x",{writable:false})','Object.setPrototypeOf(table,Object.prototype)','Object.preventExtensions(table)','Reflect.set(table,"x",2,{})','table[Symbol("new")]=1','table.x=1n'];
 for(const action of actions){const c=await realm();runInContext('var raw={x:1,child:{x:2},array:["1"]};var table=capsule.wrap(raw,{name:"UnitPeriod"});',c);const before=runInContext('JSON.stringify(raw)',c);
  assert.throws(()=>runInContext(`try{${action}}catch(e){};capsule.assertClean()`,c),/previous violation/,action);assert.equal(runInContext('JSON.stringify(raw)',c),before);assert.equal(Object.isExtensible(c.raw),true);
 }
 const c=await realm();runInContext('var calls=0,raw={"Mag.cha":{atk:{"0.5":{Cha:"Mag.cha",Action:"atk",Time:0.5}}}};var table=capsule.wrap(raw,{name:"AnimAtkFrame"});Object.defineProperty(Object.prototype,"Type",{set:function(){calls++},configurable:true});',c);
 assert.throws(()=>runInContext('table["Mag.cha"].atk["0.5"].Type="Attack"',c),/inherited/);assert.equal(c.calls,0);
});
test('noncanonical NaNs reject before mutation; positive canonical NaN and infinities preserve actual stored bits',async()=>{
 for(const hi of[0xfff80000,0x7ff80001]){const c=await realm();runInContext('var raw={x:1};var table=capsule.wrap(raw,{name:"T"});var d=new DataView(new ArrayBuffer(8));',c);
  runInContext(`d.setUint32(0,${hi},false);d.setUint32(4,17,false)`,c);assert.throws(()=>runInContext('table.x=d.getFloat64(0,false)',c),/NaN sign\/payload/);assert.equal(c.raw.x,1);
 }
 const c=await realm();runInContext('var raw={x:""};var table=capsule.wrap(raw,{name:"T"});table.x=parseInt(table.x);',c);hashMatches(c);
 assert.equal(runInContext('(function(){var d=new DataView(new ArrayBuffer(8));d.setFloat64(0,Object.getOwnPropertyDescriptor(raw,"x").value,false);return d.getUint32(0,false).toString(16)+":"+d.getUint32(4,false)})()',c),'7ff80000:0');
});
test('mutable leaf metadata changes on writes and preserves alias identity across graph captures',async()=>{
 const c=await realm();runInContext('var raw={child:{x:1}};var table=capsule.wrap(raw,{name:"T"});',c);
 const capture=await installPortableGraph(c,{immutableReference:v=>c.capsule.immutableMetadata(v)}),first=capture.snapshot({child:c.table.child,alias:c.table.child});
 runInContext('table.child.x=-0',c);const second=capture.snapshot({child:c.table.child,alias:c.table.child});
 assert.equal(first.roots[0][1][1],second.roots[0][1][1]);assert.equal(second.roots[0][1][1],second.roots[1][1][1]);assert.notEqual(JSON.stringify(first),JSON.stringify(second));
});
test('actual source resetSkillList matches raw table stored bits through repeated history',async()=>{
 const c=await realm(),source=await readFile(new URL('../../src/srcmodule/game_battle.js',import.meta.url),'utf8'),start=source.indexOf('resetSkillList:function(')+'resetSkillList:'.length,end=source.indexOf(',isHero:function',start);
 runInContext(`var resetSkillList=(${source.slice(start,end)});function unit(){var u={log:[],skill_list:[],rebuild:function(){this.log.push('rebuild')}};for(var i=0;i<5;i++)(function(slot){u.skill_list.push({info:{Slot:slot,MaxRange:100},pause:function(){u.log.push('pause:'+slot)},resume:function(){u.log.push('resume:'+slot)}})})(i);return u;}var raw={row:{BasicSlot:0,SlotList:['0','1','2','3','4','']}},normal={row:{BasicSlot:0,SlotList:['0','1','2','3','4','']}},table=capsule.wrap(raw,{name:'UnitPeriod'}),a=unit(),b=unit();`,c);
 for(let i=0;i<100;i++){
  runInContext('resetSkillList.call(a,normal.row);resetSkillList.call(b,table.row);',c);hashMatches(c);
  assert.equal(runInContext('JSON.stringify(a.log)',c),runInContext('JSON.stringify(b.log)',c));
  assert.equal(runInContext('uncachedTableHash(raw)',c),runInContext('uncachedTableHash(normal)',c));
  assert.equal(runInContext('a.attack_range===b.attack_range&&a.basic_skill.info.Slot===b.basic_skill.info.Slot',c),true);
 }
});
