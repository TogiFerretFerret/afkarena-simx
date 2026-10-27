import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext,runInContext } from 'node:vm';
import { installFlatNumericCopyPrototype,sourceCopyFunction } from '../flat-numeric-copy.mjs';

async function fixture(mode){
 const source=await readFile(new URL('../../src/srcmodule/game_util.js',import.meta.url),'utf8'),start=source.indexOf('ed.copyObj=function(')+'ed.copyObj='.length,end=source.indexOf(',ed.wrapTable=',start),body=source.slice(start,end);
 assert.equal(body,sourceCopyFunction);
 const context=createContext({});runInContext(`var events=[],ed={copyObj:(${body})};`,context);
 const runtime={context,ed:context.ed},prototype=mode?installFlatNumericCopyPrototype(runtime,{mode}):null;
 return{...runtime,prototype};
}
const describe=`function describe(value){var d=new DataView(new ArrayBuffer(8));function number(n){d.setFloat64(0,n,false);return d.getUint32(0,false).toString(16).padStart(8,'0')+d.getUint32(4,false).toString(16).padStart(8,'0')}
 function walk(v){if(v===null)return['null'];var t=typeof v;if(t==='number')return['number',number(v)];if(t!=='object'&&t!=='function')return[t,String(v)];var p=Object.getPrototypeOf(v),r={kind:t,prototype:p===Object.prototype?'Object.prototype':p===Array.prototype?'Array.prototype':p===null?'null':String(p),extensible:Object.isExtensible(v),properties:[]};for(var key of Reflect.ownKeys(v)){var a=Object.getOwnPropertyDescriptor(v,key);r.properties.push([String(key),a.writable,a.enumerable,a.configurable,'value'in a?walk(a.value):['accessor']])}return r;}return JSON.stringify(walk(value));}`;
test('20k flat finite numeric clones match original key order, raw bits, descriptors and fresh identities',async()=>{
 const a=await fixture(),b=await fixture('specialize');for(const f of[a,b])runInContext(describe,f.context);
 let state=123456789;
 for(let i=0;i<20000;i++){
  state=(Math.imul(state,1664525)+1013904223)>>>0;const x=(state-2147483648)/1024;
  const code=`var input={};input.z=${i};input['10']=${x};input['2']=-0;input.a=${i%2?-Number.MIN_VALUE:Number.MAX_VALUE};var output=ed.copyObj(input);var again=ed.copyObj(input);var encoded=describe(output);var fresh=output!==again&&Object.getPrototypeOf(output)===Object.prototype;`;
  for(const f of[a,b])runInContext(code,f.context);
  assert.equal(b.context.encoded,a.context.encoded,`case ${i}`);assert.equal(b.context.fresh,true);
 }
 assert.equal(b.prototype.stats().fastCalls,40000);assert.equal(b.prototype.stats().originalCalls,0);
});
test('fallback preserves constructor twice, keys/getters, own flags, inherited setter and proto effects',async()=>{
 const cases=[
  `var input={x:2};Object.defineProperty(input,'constructor',{get:function(){events.push('ctor-get');return function C(){events.push('ctor-call')}}});`,
  `var input={};Object.defineProperty(input,'x',{get:function(){events.push('value-get');return 2},enumerable:true});`,
  `var input={};Object.defineProperty(input,'x',{value:-0,writable:false,enumerable:true,configurable:false});`,
  `var input=Object.freeze({x:3});`,
  `var input={};Object.defineProperty(input,'__proto__',{value:4,writable:true,enumerable:true,configurable:true});`,
  `var input={toString:3,x:4};`,
  `var input={x:2};Object.defineProperty(Object.prototype,'x',{set:function(v){events.push('setter:'+v)},configurable:true});`,
  `var input={x:Infinity,y:-Infinity,z:NaN};`,
  `var input={x:2};Object.defineProperty(Object.prototype,'constructor',{get:function(){events.push('prototype-ctor-get');return Object},configurable:true});`,
  `var input={x:2};Object.defineProperty(Object,'keys',{get:function(){events.push('keys-get');return function(v){events.push('keys-call');return ['x']}},configurable:true});`,
  `var input={x:2};var saved=Object;Object.defineProperty(globalThis,'Object',{get:function(){events.push('global-Object-get');return saved},configurable:true});`,
  `var input=new Proxy({x:2},{get:function(t,k,r){events.push('proxy-get:'+String(k));return Reflect.get(t,k,r)},ownKeys:function(t){events.push('proxy-keys');return Reflect.ownKeys(t)},getOwnPropertyDescriptor:function(t,k){events.push('proxy-desc:'+String(k));return Reflect.getOwnPropertyDescriptor(t,k)}});`,
  `var input={x:{a:1},y:[1,2]};`,
  `var input={};Object.defineProperty(input,'hidden',{get:function(){events.push('HIDDEN-GET');return 7}});`,
  `var d=new DataView(new ArrayBuffer(8));d.setUint32(0,0xfff80000,false);d.setUint32(4,17,false);var input={x:d.getFloat64(0,false)};`
 ];
 for(let i=0;i<cases.length;i++){
  const a=await fixture(),b=await fixture('specialize');for(const f of[a,b]){runInContext(describe,f.context);runInContext(cases[i]+`var output=ed.copyObj(input);var eventCopy=JSON.stringify(events);`,f.context);}
  // Describe after copying so reflection diagnostics cannot change recorded
  // source constructor/getter effects. Custom prototype conversion is matched.
  assert.equal(b.context.eventCopy,a.context.eventCopy,`effects ${i}`);
  for(const f of[a,b])runInContext('var encoded=describe(output)',f.context);
  assert.equal(b.context.encoded,a.context.encoded,`output ${i}`);assert.ok(b.prototype.stats().originalCalls>=1,`fallback ${i}`);
 }
});
test('observe mode calls original once per invocation and never invokes source accessors itself',async()=>{
 const f=await fixture('observe');runInContext(`var input={get x(){events.push('get-x');return 2},child:{n:3},array:[1]};var output=ed.copyObj(input);`,f.context);
 assert.equal(JSON.stringify(f.context.events),'["get-x"]');const stats=f.prototype.stats();assert.equal(stats.calls,3);assert.equal(stats.originalCalls,3);assert.equal(stats.fastCalls,0);assert.equal(stats.eligible,1);assert.equal(stats.reasons.accessor,1);
});
test('guard rejects revoked proxies before reflection and preserves original errors and callable keys',async()=>{
 const cases=[
  `var pair=Proxy.revocable({x:1},{});pair.revoke();var input=pair.proxy;`,
  `var input={x:2};Object.keys=function(value){events.push('replaced-keys');return ['x']};`,
  `var input={x:2};Object.defineProperty(input,'constructor',{get:function(){events.push('throw-ctor');throw new RangeError('exact-constructor-error')}});`,
  `var input={};Object.defineProperty(input,'x',{get:function(){events.push('throw-value');throw new TypeError('exact-value-error')},enumerable:true});`,
  `var input={x:2};input[Symbol('hidden')]=3;`,
  `var input=Object.create(null);input.x=-0;`,
  `function C(){events.push('custom-constructor')}var input=new C();input.x=2;events=[];`,
  `var input=function F(){};input.x=2;`,
  `var input=new Number(2);input.x=3;`
 ];
 for(let i=0;i<cases.length;i++){
  const a=await fixture(),b=await fixture('specialize');
  for(const f of[a,b]){runInContext(describe,f.context);runInContext(cases[i]+`var outcome;try{var output=ed.copyObj(input);outcome=['return',describe(output)]}catch(error){outcome=['throw',error.name,error.message]}var encoded=JSON.stringify([outcome,events]);`,f.context);}
  assert.equal(b.context.encoded,a.context.encoded,`case ${i}`);assert.equal(b.prototype.stats().fastCalls,0);
 }
});
test('installation refuses replaced intrinsics without invoking their accessors',async()=>{
 for(const code of[
  `Object=function Object(){events.push('fake-object')};Object.prototype.constructor=Object;`,
  `Object.defineProperty(globalThis,'Object',{get:function(){events.push('object-get');return function(){}},configurable:true});`,
  `Object.defineProperty(Object,'keys',{get:function(){events.push('keys-get');return function(){}},configurable:true});`
 ]){
  const f=await fixture();runInContext(code,f.context);
  assert.throws(()=>installFlatNumericCopyPrototype(f,{mode:'specialize'}),/Unmodified source-realm/);
  assert.equal(JSON.stringify(f.context.events),'[]');
 }
});
