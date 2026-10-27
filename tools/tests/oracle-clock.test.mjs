import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {bits,fromBits} from '../rng-trace.mjs';
const script=await readFile(new URL('../oracle-clock.js',import.meta.url),'utf8');
function realm(){const context=createContext({});runInContext(script,context);return context}
const run=(context,source)=>runInContext(source,context);

test('record captures actual native observations with operation kinds and exact bits/string',()=>{
 const c=realm();const result=run(c,`var Original=Date, prototype=Date.prototype;var clock=installOracleClock({mode:'record'});
 var a=Date.now(),b=new Date(),s=Date({[Symbol.toPrimitive](){throw Error('must not coerce function arguments')}});
 ({a:a,b:b.getTime(),s:s,tape:clock.tape,stats:clock.finish()});`);
 assert.deepEqual(Array.from(result.tape,e=>e.kind),['Date.now','Date.construct','Date.call']);
 assert.equal(result.tape[0].bits,bits(result.a));assert.equal(result.tape[1].bits,bits(result.b));assert.equal(result.tape[2].value,result.s);
 assert.equal(result.stats.consumed,3);assert.equal(result.stats.remaining,0);assert.equal(result.stats.finished,true);
 run(c,'clock.restore()');assert.equal(run(c,'Date===Original&&Date.prototype===prototype&&Date.prototype.constructor===Original'),true);
});

test('replay uses only the supplied tape, including signed zero and exact Date() string',()=>{
 const c=realm();c.tape=[{kind:'Date.now',bits:bits(-0)},{kind:'Date.construct',bits:bits(1234567890123)},{kind:'Date.call',value:'reference host exact string'}];
 run(c,`var Native=Date;Date=new Proxy(Native,{apply(){throw Error('live Date call prohibited')},construct(target,args,newTarget){if(!args.length)throw Error('live noarg constructor prohibited');return Reflect.construct(target,args,newTarget)},get(target,key,receiver){if(key==='now')return function(){throw Error('live now prohibited')};return Reflect.get(target,key,receiver)}});var Original=Date;var clock=installOracleClock({mode:'replay',tape:tape});`);
 assert.equal(Object.is(run(c,'Date.now()'),-0),true);assert.equal(run(c,'new Date().getTime()'),1234567890123);assert.equal(run(c,'Date(Symbol())'),'reference host exact string');
 assert.equal(run(c,'clock.finish().consumed'),3);run(c,'clock.restore()');assert.equal(run(c,'Date===Original'),true);
});

test('constructors with arguments, parse and UTC do not consume clock inputs',()=>{
 const c=realm();run(c,`var Original=Date;var clock=installOracleClock({mode:'replay',tape:[]});`);
 assert.equal(run(c,'new Date(0).getTime()'),0);assert.equal(Object.is(run(c,'new Date(-0).getTime()'),0),true);
 assert.equal(Number.isNaN(run(c,'new Date(undefined).getTime()')),true);
 assert.equal(run(c,'new Date(2020,0,2).getTime()===new Original(2020,0,2).getTime()'),true);
 assert.equal(run(c,'Date.parse===Original.parse&&Date.UTC===Original.UTC'),true);
 assert.equal(run(c,'Date.parse("2020-01-02T00:00:00Z")===Date.UTC(2020,0,2)'),true);
 assert.throws(()=>run(c,'new Date(Symbol())'),{name:'TypeError'});
 assert.equal(run(c,'clock.finish().attempts'),0);run(c,'clock.restore()');
});

test('subclasses, new.target prototypes and Date internal slots remain native',()=>{
 const c=realm();c.tape=[{kind:'Date.construct',bits:bits(1700000000000)},{kind:'Date.construct',bits:bits(1700000000001)}];
 run(c,`var Original=Date;var clock=installOracleClock({mode:'replay',tape:tape});class Sub extends Date{}var sub=new Sub();function Other(){throw Error('constructor must not execute')}var other=Reflect.construct(Date,[],Other);`);
 assert.equal(run(c,'sub instanceof Sub&&sub instanceof Date&&sub instanceof Original'),true);
 assert.equal(run(c,'sub.constructor===Sub&&Object.getPrototypeOf(sub)===Sub.prototype'),true);
 assert.equal(run(c,'Object.getPrototypeOf(other)===Other.prototype'),true);
 assert.equal(run(c,'Original.prototype.getTime.call(other)'),1700000000001);
 assert.equal(run(c,'Object.prototype.toString.call(sub)'), '[object Date]');
 assert.equal(run(c,'Date.prototype===Original.prototype&&Date.prototype.constructor===Date'),true);
 assert.equal(run(c,'Date.name==="Date"&&Date.length===7&&Date.now.name==="now"&&Date.now.length===0'),true);
 assert.equal(run(c,'Object.getPrototypeOf(Date)===Object.getPrototypeOf(Original)'),true);
 assert.equal(run(c,'Object.getOwnPropertyDescriptor(Date,"prototype").writable'),false);
 assert.throws(()=>run(c,'new Date.now()'),{name:'TypeError'});assert.equal(run(c,'clock.finish().attempts'),2);run(c,'clock.restore()');
});

test('replay preserves raw Date.now bit patterns and native TimeClip for noarg Date',()=>{
 const c=realm();c.tape=[{kind:'Date.now',bits:'8000000000000000'},{kind:'Date.now',bits:'7ff8000000000011'},{kind:'Date.construct',bits:'8000000000000000'}];
 run(c,'var clock=installOracleClock({mode:"replay",tape:tape});');
 assert.equal(bits(run(c,'Date.now()')),'8000000000000000');assert.equal(Number.isNaN(run(c,'Date.now()')),true);
 assert.equal(Object.is(run(c,'new Date().getTime()'),0),true);assert.equal(run(c,'clock.finish().consumed'),3);run(c,'clock.restore()');
 assert.equal(Number.isNaN(fromBits('7ff8000000000011')),true);
});

test('wrong operation kind and extra observations fail closed and remain failed',()=>{
 const c=realm();c.tape=[{kind:'Date.construct',bits:bits(1)}];run(c,'var Original=Date;var clock=installOracleClock({mode:"replay",tape:tape});');
 assert.throws(()=>run(c,'Date.now()'),/kind mismatch/);assert.throws(()=>run(c,'clock.finish()'),/kind mismatch/);
 assert.throws(()=>run(c,'clock.restore()'),/kind mismatch/);assert.equal(run(c,'Date===Original'),true);
 const d=realm();run(d,'var clock=installOracleClock({mode:"replay",tape:[]});');assert.throws(()=>run(d,'new Date()'),/exhausted/);assert.throws(()=>run(d,'clock.finish()'),/exhausted/);
});

test('missing consumption fails finish and cleanup restores host even on failure',()=>{
 const c=realm();c.tape=[{kind:'Date.now',bits:bits(1)}];run(c,'var Original=Date;var clock=installOracleClock({mode:"replay",tape:tape});');
 assert.throws(()=>run(c,'clock.finish()'),/unconsumed/);assert.throws(()=>run(c,'clock.restore()'),/unconsumed/);assert.equal(run(c,'Date===Original'),true);
});

test('replay snapshots its input and rejects invalid tapes or nested installations',()=>{
 const c=realm();c.tape=[{kind:'Date.now',bits:bits(42)}];run(c,'var clock=installOracleClock({mode:"replay",tape:tape});');c.tape[0].bits=bits(9);
 assert.equal(run(c,'Date.now()'),42);assert.throws(()=>run(c,'installOracleClock({mode:"record"})'),/already installed/);run(c,'clock.restore()');
 for(const bad of [[{kind:'bad',bits:bits(1)}],[{kind:'Date.now',bits:'1'}],[{kind:'Date.call',value:1}]]){c.bad=bad;assert.throws(()=>run(c,'installOracleClock({mode:"replay",tape:bad})'),/invalid/)}
 assert.throws(()=>run(c,'installOracleClock({mode:"record",tape:[1]})'),/empty output tape/);
});

test('clock calls after finish reject rather than silently appending unmeasured work',()=>{
 const c=realm();run(c,'var Original=Date;var clock=installOracleClock({mode:"record"});clock.finish();');
 assert.throws(()=>run(c,'Date.now()'),/after finish/);assert.throws(()=>run(c,'clock.restore()'),/after finish/);assert.equal(run(c,'Date===Original'),true);
});

test('argument coercion can consume clock inputs without inventing a constructor observation',()=>{
 const c=realm();c.tape=[{kind:'Date.now',bits:bits(42)}];run(c,'var clock=installOracleClock({mode:"replay",tape:tape});');
 assert.equal(run(c,'new Date({[Symbol.toPrimitive](){return Date.now()}}).getTime()'),42);
 assert.equal(run(c,'clock.finish().attempts'),1);run(c,'clock.restore()');
});

test('observers interleave exact clock events with source operations in both modes',()=>{
 const c=realm();const seen=[];c.observe=(entry,index)=>seen.push([entry.kind,index,entry.bits??entry.value]);
 const recorded=run(c,'var clock=installOracleClock({mode:"record",observe:observe});var a=Date.now();var b=new Date().getTime();var s=Date();clock.finish();clock.tape;');
 assert.deepEqual(seen.map(e=>e[0]),['Date.now','Date.construct','Date.call']);assert.deepEqual(seen.map(e=>e[1]),[0,1,2]);
 assert.equal(seen[0][2],recorded[0].bits);assert.equal(seen[2][2],recorded[2].value);run(c,'clock.restore()');
 const d=realm();const interleaved=[];d.tape=recorded;d.observe=(entry,index)=>interleaved.push(`clock:${entry.kind}:${index}`);d.source=kind=>interleaved.push(kind);
 run(d,'var clock=installOracleClock({mode:"replay",tape:tape,observe:observe});source("before");Date.now();source("between");new Date();Date();source("after");clock.finish();clock.restore();');
 assert.deepEqual(interleaved,['before','clock:Date.now:0','between','clock:Date.construct:1','clock:Date.call:2','after']);
});

test('observer errors or reentrant source-clock reads invalidate the run',()=>{
 const c=realm();c.fail=()=>{throw new Error('trace failed')};run(c,'var clock=installOracleClock({mode:"record",observe:fail});');
 assert.throws(()=>run(c,'Date.now()'),/trace failed/);assert.throws(()=>run(c,'clock.finish()'),/observer threw/);assert.throws(()=>run(c,'clock.restore()'),/observer threw/);
 const d=realm();run(d,'var clock=installOracleClock({mode:"record",observe:function(){Date.now()}});');
 assert.throws(()=>run(d,'Date.now()'),/must not consume/);assert.throws(()=>run(d,'clock.finish()'),/must not consume/);
 const e=realm();assert.throws(()=>run(e,'installOracleClock({mode:"record",observe:1})'),/must be a function/);
});
