import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext,runInContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { installPortableGraph } from '../battle-trace-portable.mjs';

const digest=text=>createHash('sha256').update(text).digest('hex');
async function realm(){
 const context=createContext({digest,isProxy:types.isProxy});
 runInContext(await readFile(new URL('../qualification-table-membrane.js',import.meta.url),'utf8'),context);
 runInContext('var membrane=installQualificationTableMembrane({digest:digest,isProxy:isProxy});',context);return context;
}
const json=(context,code)=>JSON.parse(runInContext(`JSON.stringify(${code})`,context));
test('lazy canonical proxies preserve ordinary JSON reads, reflection, aliases and clone results',async()=>{
 const c=await realm();
 runInContext('var shared={n:-0,deep:[1,{v:2}]};var raw={a:shared,b:shared,array:[shared,,null]};var table=membrane.wrap(raw,{name:"Example"});',c);
 assert.equal(c.membrane.stats().proxies,1);
 const result=json(c,`(function(){var a=table.a,d=Object.getOwnPropertyDescriptor(table,'a'),all=Object.getOwnPropertyDescriptors(table),copy=Object.assign({},table);function clone(e){var t=e.constructor?new e.constructor:{};for(var keys=Object.keys(e),i=0;i<keys.length;i++){var k=keys[i],v=e[k];t[k]=typeof v==='object'&&v?clone(v):v;}return t;}var cloned=clone(table);cloned.a.deep[1].v=9;return{aliases:a===table.b&&a===table.array[0]&&a===d.value&&a===all.a.value&&a===copy.a,array:Array.isArray(table.array),instance:table.array instanceof Array,constructor:table.constructor===Object&&table.array.constructor===Array,prototypes:Object.getPrototypeOf(table)===Object.prototype&&Object.getPrototypeOf(table.array)===Array.prototype,keys:Object.keys(table),descriptors:[d.writable,d.enumerable,d.configurable],string:Object.prototype.toString.call(table.array),valueOf:table.valueOf()===table,hole:!(1 in table.array),negativeZero:Object.is(a.n,-0),clone:cloned.a.deep[1].v===9&&table.a.deep[1].v===2&&cloned.a!==cloned.b};})()`);
 assert.deepEqual(result,{aliases:true,array:true,instance:true,constructor:true,prototypes:true,keys:['a','b','array'],descriptors:[true,true,true],string:'[object Array]',valueOf:true,hole:true,negativeZero:true,clone:true});
 assert.equal(c.membrane.assertClean(),true);
 const m=c.membrane.immutableMetadata(c.table.a);assert.deepEqual(Array.from(m.path),['a']);assert.equal(m.table,'Example');assert.match(m.sha256,/^[0-9a-f]{64}$/);
 assert.equal(c.membrane.immutableMetadata(c.raw),null);assert.equal(Object.isFrozen(m),true);assert.equal(Object.isFrozen(m.path),true);
});
test('get and descriptor paths never expose raw mutable children',async()=>{
 const c=await realm();runInContext('var raw={deep:{leaf:[{x:1}]}};var table=membrane.wrap(raw,{name:"T"});',c);
 const result=json(c,`(function(){var a=table.deep,b=Object.getOwnPropertyDescriptor(table,'deep').value,c=Object.getOwnPropertyDescriptors(table).deep.value,d=Reflect.get(table,'deep'),e=Object.values(table)[0];return{same:a===b&&a===c&&a===d&&a===e,wrapped:isProxy(a)&&isProxy(b.leaf)&&isProxy(Object.getOwnPropertyDescriptor(b.leaf,'0').value)};})()`);
 assert.deepEqual(result,{same:true,wrapped:true});
 assert.throws(()=>runInContext('Object.getOwnPropertyDescriptor(table.deep.leaf,"0").value.x=2',c),/membrane/);
 assert.equal(c.raw.deep.leaf[0].x,1);assert.throws(()=>c.membrane.assertClean(),/previous violation/);
});
test('every mutation operation throws, stays sticky after catches, and never stores fresh objects',async()=>{
 const actions=['table.a=9','table.fresh={literal:[1]}','Object.assign(table,{a:9})','Reflect.set(table,"a",9)','Object.defineProperty(table,"a",{value:9})','Reflect.defineProperty(table,"new",{value:{x:1}})','delete table.a','delete table.missing','Object.setPrototypeOf(table,Object.prototype)','Reflect.setPrototypeOf(table,null)','Object.preventExtensions(table)','Object.freeze(table)','table.array.push({x:1})','table.array[0].x=9','Object.getOwnPropertyDescriptor(table,"array").value[0]={x:9}'];
 for(const action of actions){const c=await realm();runInContext('var raw={a:1,array:[{x:2}]};var table=membrane.wrap(raw,{name:"T"});',c);
  assert.throws(()=>runInContext(`try{${action}}catch(e){};membrane.assertClean()`,c),/previous violation/,action);
  assert.equal(c.raw.a,1);assert.equal(c.raw.array[0].x,2);assert.equal(c.raw.array.length,1);assert.equal('fresh'in c.raw,false);assert.equal(Object.isExtensible(c.raw),true);
  assert.ok(c.membrane.stats().writes>=1);assert.throws(()=>c.membrane.immutableMetadata(c.table),/previous violation/);
 }
});
test('unsupported initial JSON shapes fail before any proxy publication',async()=>{
 const expressions=['Object.freeze({x:1})','Object.create(null)','({get x(){throw Error("invoked")}})','({x:undefined})','({x:function(){}})','({x:1n})','({[Symbol("x")]:1})','new Date(0)','Object.assign([],{extra:1})','(function(){var a={};a.self=a;return a})()','new Proxy({x:1},{})'];
 for(const expression of expressions){const c=await realm();assert.throws(()=>runInContext(`membrane.wrap(${expression},{name:'T'})`,c),/membrane/,expression);assert.equal(c.membrane.stats().proxies,0);assert.equal(c.membrane.stats().roots,0);}
});
test('root hashes cover raw bits, holes, keys and aliases; canonical paths ignore lazy access order',async()=>{
 const a=await realm(),b=await realm();for(const c of[a,b])runInContext('var child={n:-0};var raw={a:child,b:child,empty:[]};var table=membrane.wrap(raw,{name:"T"});',c);
 runInContext('table.b.n;table.empty.length',a);runInContext('table.empty.length;table.a.n',b);
 assert.equal(a.membrane.immutableMetadata(a.table.b).sha256,b.membrane.immutableMetadata(b.table.a).sha256);
 assert.deepEqual(Array.from(a.membrane.immutableMetadata(a.table.b).path),['a']);
 for(const expression of ['({a:{n:0},b:{n:0},empty:[]})','({a:{n:-0},b:{n:-0},empty:[]})','({a:{n:-0},empty:[],b:{n:-0}})','({a:{n:-0},b:{n:-0},empty:[,]})']){
  const c=await realm();runInContext(`var table=membrane.wrap(${expression},{name:'T'});`,c);assert.notEqual(c.membrane.immutableMetadata(c.table).sha256,a.membrane.immutableMetadata(a.table).sha256);
 }
});
test('registered immutable leaf hook retains proxy identity and blocks unregistered proxies',async()=>{
 const c=await realm();runInContext('var table=membrane.wrap({a:{x:-0},b:[1]},{name:"T"});',c);
 const capture=await installPortableGraph(c,{immutableReference:value=>c.membrane.immutableMetadata(value)});
 const graph=capture.snapshot({root:c.table,child:c.table.a,alias:c.table.a});
 assert.equal(graph.roots[1][1][1],graph.roots[2][1][1]);assert.equal(graph.nodes.length,0);
 assert.throws(()=>capture.snapshot({root:new Proxy({x:1},{})}),/Proxy/);
});
test('parse boundary creates no externally reachable raw table and preserves JSON output',async()=>{
 const c=await realm();runInContext('var table=membrane.parse(\'{"__proto__":{"safe":true},"constructor":{"tag":1},"array":[-0,1,{"x":2}]}\',{name:"Parsed"});',c);
 assert.equal(runInContext('JSON.stringify(table)',c),'{"__proto__":{"safe":true},"constructor":{"tag":1},"array":[0,1,{"x":2}]}');
 assert.equal(runInContext('Object.getPrototypeOf(table)===Object.prototype',c),true);
 assert.equal(runInContext('isProxy(table.__proto__)&&isProxy(table.constructor)&&Object.is(table.array[0],-0)',c),true);
 assert.throws(()=>runInContext('Object.getOwnPropertyDescriptor(table,"__proto__").value.safe=false',c),/membrane/);
});
test('cold table hashes distinguish NaN signs and payloads without JSON numeric normalization',async()=>{
 const hashes=[];
 for(const [hi,lo]of[[0x7ff80000,1],[0x7ff80000,2],[0xfff80000,1]]){
  const c=await realm();runInContext(`var d=new DataView(new ArrayBuffer(8));d.setUint32(0,${hi},false);d.setUint32(4,${lo},false);var table=membrane.wrap({n:d.getFloat64(0,false)},{name:'Bits'});`,c);hashes.push(c.membrane.immutableMetadata(c.table).sha256);
 }
 assert.equal(new Set(hashes).size,3);
});
test('named roots cannot mask cross-root aliases or reuse a name with different content',async()=>{
 const a=await realm();runInContext('var shared={x:1};var first=membrane.wrap({shared:shared},{name:"First"});',a);
 assert.throws(()=>runInContext('membrane.wrap({shared:shared},{name:"Second"})',a),/crosses named/);
 const b=await realm();runInContext('var first=membrane.parse("{}",{name:"T"});',b);
 assert.equal(runInContext('membrane.wrap(first,{name:"T"})===first',b),true);
 assert.throws(()=>runInContext('membrane.parse("{}",{name:"T"})',b),/name reused/);
});
