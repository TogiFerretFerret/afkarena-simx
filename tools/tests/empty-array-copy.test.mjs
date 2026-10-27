import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {installEmptyArrayCopyPrototype} from '../empty-array-copy.mjs';
import {sourceCopyFunction} from '../flat-numeric-copy.mjs';
function fixture(mode){const context=createContext({});runInContext(`var events=[],ed={copyObj:(${sourceCopyFunction})};`,context);const runtime={context,ed:context.ed};return{...runtime,guard:mode?installEmptyArrayCopyPrototype(runtime,{mode}):null};}
const descriptor=`function describe(value){return JSON.stringify({array:Array.isArray(value),length:value.length,prototype:Object.getPrototypeOf(value)===Array.prototype?'Array.prototype':Object.getPrototypeOf(value)===Object.prototype?'Object.prototype':'custom',keys:Reflect.ownKeys(value).map(String),descriptors:Reflect.ownKeys(value).map(function(k){var d=Object.getOwnPropertyDescriptor(value,k);return[k,d.writable,d.enumerable,d.configurable,'value'in d?typeof d.value+':'+String(d.value):'accessor']})})}`;
test('empty array cloning preserves fresh identities, prototype and own length descriptor',()=>{
 const f=fixture('specialize');runInContext(descriptor+`var input=[],a=ed.copyObj(input),b=ed.copyObj(input);var fresh=a!==b&&a!==input;var actual=describe(a),expected=describe([]);`,f.context);
 assert.equal(f.context.actual,f.context.expected);assert.equal(f.context.fresh,true);assert.equal(f.guard.stats().fastCalls,2);
});
test('recursive parent preserves duplicate-object cloning and function identity',()=>{
 const f=fixture('specialize');runInContext(`var child=[],fn=function(){},input={a:child,b:child,fn:fn},output=ed.copyObj(input);var correct=output!==input&&output.a!==output.b&&output.a!==child&&output.fn===fn;`,f.context);
 assert.equal(f.context.correct,true);assert.equal(f.guard.stats().fastCalls,2);assert.equal(f.guard.stats().originalCalls,1);
});
test('unsupported arrays preserve constructors twice, getter order, holes and output length',()=>{
 const cases=[
  `var input=new Array(8);`,
  `var input=[1,,3];input.length=8;`,
  `var input=[];Object.defineProperty(input,'constructor',{get:function(){events.push('constructor-get');return function(){events.push('constructor-call')}}});`,
  `var input=[];var index=0;Object.defineProperty(Array.prototype,'constructor',{get:function(){events.push('constructor-'+index++);return index===1?Array:function C(){events.push('second-constructor')}},configurable:true});`,
  `var input=[];input.extra=3;`,
  `var input=[];Object.defineProperty(input,'hidden',{get:function(){events.push('unexpected-hidden-get');return 4}});`,
  `var input=[];Object.defineProperty(input,'0',{get:function(){events.push('index-get');return 2},enumerable:true});`,
  `var input=[];Object.defineProperty(input,'length',{writable:false});`,
  `var input=Object.freeze([]);`,
  `var input=[];Object.keys=function(v){events.push('keys');return []};`,
  `var input=[];Object.defineProperty(Object,'keys',{get:function(){events.push('keys-get');return function(){events.push('keys-call');return []}},configurable:true});`,
  `var input=[];var saved=Object;Object.defineProperty(globalThis,'Object',{get:function(){events.push('Object-get');return saved},configurable:true});`,
  `var input=new Proxy([],{get:function(t,k,r){events.push('get:'+String(k));return Reflect.get(t,k,r)},ownKeys:function(t){events.push('ownKeys');return Reflect.ownKeys(t)},getOwnPropertyDescriptor:function(t,k){events.push('descriptor:'+String(k));return Reflect.getOwnPropertyDescriptor(t,k)}});`,
  `var pair=Proxy.revocable([],{});pair.revoke();var input=pair.proxy;`,
  `class A extends Array{constructor(){super();events.push('subclass-constructor')}}var input=new A();events=[];`,
  `var input=[];input[Symbol('x')]=4;`,
  `var input=[];Object.defineProperty(Array.prototype,'constructor',{get:function(){events.push('throw');throw new RangeError('ctor')},configurable:true});`
 ];
 for(let i=0;i<cases.length;i++){
  const a=fixture(),b=fixture('specialize');
  for(const f of[a,b])runInContext(descriptor+cases[i]+`var result;try{result=['return',describe(ed.copyObj(input))]}catch(error){result=['throw',error.name,error.message]}var encoded=JSON.stringify([result,events]);`,f.context);
  assert.equal(b.context.encoded,a.context.encoded,`case ${i}`);assert.equal(b.guard.stats().fastCalls,0,`fallback ${i}`);
 }
});
test('observer never skips original calls and array-global replacement alone is irrelevant',()=>{
 const f=fixture('observe');runInContext(`var input=[];Array=function(){events.push('wrong-global-Array')};var output=ed.copyObj(input);`,f.context);
 assert.equal(JSON.stringify(f.context.events),'[]');assert.equal(f.guard.stats().eligible,1);assert.equal(f.guard.stats().originalCalls,1);
});
