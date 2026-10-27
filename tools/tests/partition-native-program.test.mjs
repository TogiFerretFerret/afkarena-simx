import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext,runInContext,constants } from 'node:vm';
import { partitionNativeProgram } from '../partition-native-program.mjs';
function run(source,partitioned){
  const context=createContext(constants.DONT_CONTEXTIFY);
  runInContext('var observations=[];function record(value){observations.push(value)}',context);
  const units=partitioned?partitionNativeProgram(source,{bodyUnits:7}).units:[{source}];
  let error=null;try{for(const unit of units)runInContext(unit.source,context);}catch(e){error={name:e.name,message:e.message};}
  return{observations:JSON.parse(JSON.stringify(context.observations)),error};
}
function same(source){assert.deepEqual(run(source,true),run(source,false));}
test('global hoisting, duplicate functions, raw source, descriptors and initialization order survive partitioning',()=>{
  same(`record([typeof later, f(), Object.keys(globalThis).slice(-7)]);
  var first=record('first'), blank, later=-0;
  function f(){return 1} function f(){return 2}
  record([1/later,Object.getOwnPropertyDescriptor(globalThis,'later'), f.toString()]);
  var anonymous=function () { return later; };
  var arrow=()=>later;record([anonymous.name,anonymous.toString(),arrow.name,arrow.toString()]);
  record('last');`);
});
test('later var declarations cannot recreate deleted configurable global bindings or reset reassigned functions',()=>{
  same(`record(typeof later);Object.defineProperty(globalThis,'later',{value:1,writable:true,configurable:true});
  delete globalThis.later;f=12;
  record([typeof later,typeof f]);var later;function f(){};record([typeof later,f]);`);
});
test('var declarations in loops and branches preserve side effects and skipped initialization',()=>{
  same(`record(typeof x);for(var i=0,j=1;i<3;i++)record(i+j);
  if(false)var skipped=record('wrong');else var chosen=record('chosen');
  for(var x in {b:2,a:1})record(x);for(var y of [3,4])record(y);
  record([i,j,x,y,typeof skipped,chosen]);`);
});
test('comma expressions, source failures, strictness and non-prologue string statements remain ordered',()=>{
  same(`'use strict';var x=1;record('start');(record(x++),record(x++),record(x));
  'use strict';record((function(){return this})());throw new TypeError('stop');record('wrong');`);
  same(`var x=1;'use strict';record((function(){return this===globalThis})());record(x);`);
});
test('unsupported global lexical and Annex B scopes fail closed',()=>{
  for(const source of['let x=1;','const x=1;','class X {}','if(true){function f(){}}','var {x}={x:1};','var C=class { static { var hidden=1; } };'])assert.throws(()=>partitionNativeProgram(source));
});
test('unit count is bounded and every original function body remains byte identical',()=>{
  const source=Array.from({length:30},(_,i)=>`var v${i}=function () { return ${i}; }; record(v${i}.toString());`).join('\n');
  const result=partitionNativeProgram(source);assert.ok(result.units.length<=8);assert.equal(result.units[0].kind,'declaration-prelude');
  same(source);assert.throws(()=>partitionNativeProgram(source,{bodyUnits:8}));
});

test('declaration source-order matrix retains first property insertion and last function wins',()=>{
  for(let seed=0;seed<100;seed++){
    let state=seed+1;const declarations=[];
    for(let i=0;i<12;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;const name='v'+(state%5);declarations.push((state&16)?`function ${name}(){return ${i}}`:`var ${name};`);}
    same(`record(Object.keys(globalThis).filter(k=>/^v[0-9]$/.test(k)));record([${Array.from({length:5},(_,i)=>`typeof v${i}==='function'?v${i}():typeof v${i}`).join(',')}]);`+declarations.join('\n'));
  }
});

test('anonymous class names and catch-shadowed var initializers retain their evaluation scope',()=>{
  same(`record(typeof caught);var C=class { method(){ return 1; } };record([C.name,C.toString(),new C().method()]);
  try {throw 7} catch(caught){var caught=record(['catch',caught]);record(caught)}
  record(['global',typeof caught,caught]);`);
});
