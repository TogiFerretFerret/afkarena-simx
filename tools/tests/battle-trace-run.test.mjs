import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext,runInContext } from 'node:vm';
import { traceBattle } from '../battle-trace-run.mjs';

function fixture(){
 const context=createContext({});
 runInContext(`var random_seed=1;var ed={};
 ed.rand=function(){random_seed=random_seed*25%34359738337;return random_seed/34359738337};
 ed.srand=function(value){random_seed=value;ed.init_battle_seed=value};
 ed.Unit=class Unit{constructor(){this.tid=1;this.hp=5;this.mp=0}setHp(x){this.hp=x}setMp(x){this.mp=x}castSkill(){}onDied(){}terminate(){this.terminated=true}};
 ed.BattleEngine=class BattleEngine{constructor(){this.running=false;this.ticks=0;this.tick_interval=.125}enterBattle(){this.running=true;this.unit_list=[new ed.Unit()]}update(){this.ticks++;const u=this.unit_list[0];clientCall(()=>{u.setHp(u.hp-1);ed.rand();clientCall(()=>u.setMp(9))});this.running=false;this.result='victory'}};`,context);
 return {context,ed:context.ed};
}

test('source queue adapter and instrumentation retain callback bodies, nested enqueue and RNG calls',async()=>{
 const runtime=fixture(),wire={inputSha256:'test'};
 const result=await traceBattle(runtime,wire,{materialize:()=>({battleSeed:1,players:[],enemies:[],config:{},inputSha256:'test'}),keepDeltas:true});
 assert.equal(result.status,'completed');assert.equal(result.callbackCount,2);assert.equal(result.rngCount,1);
 assert.equal(runtime.ed.battleEngine.unit_list[0].hp,4);assert.equal(runtime.ed.battleEngine.unit_list[0].mp,9);
 assert.equal(result.events.filter(e=>e.kind==='callback:enqueue').length,2);
 assert.equal(result.events.filter(e=>e.kind==='callback:before').length,2);
 assert.equal(result.events.filter(e=>e.kind==='callback:after').length,2);
 assert.ok(result.events.findIndex(e=>e.kind==='frame:engine_updated')<result.events.findIndex(e=>e.kind==='callback:before'));
 assert.equal(runtime.ed.rand.toString().includes('record('),false);
});

test('source callback exceptions fail closed instead of counting a completed battle',async()=>{
 const runtime=fixture();
 runInContext(`ed.BattleEngine.prototype.update=function(){this.ticks++;clientCall(()=>{throw new Error('required host missing')});this.running=false;this.result='victory'}`,runtime.context);
 const result=await traceBattle(runtime,{inputSha256:'test'},{materialize:()=>({battleSeed:1,players:[],enemies:[],config:{}})});
 assert.equal(result.status,'failed');assert.equal(result.qualifiesForThroughputTarget,false);assert.match(result.error.message,/required host missing/);
 assert.equal(result.events.some(e=>e.kind==='battle:completed'),false);
});

test('independent source traces match and deliberate callback or RNG omission diverges',async()=>{
 const run=runtime=>traceBattle(runtime,{inputSha256:'test'},{materialize:()=>({battleSeed:1,players:[],enemies:[],config:{}})});
 const a=await run(fixture()),b=await run(fixture());
 const {firstTraceDifference}=await import('../battle-trace.mjs');
 assert.equal(firstTraceDifference(a.events,b.events),null);
 const changed=fixture();runInContext(`ed.BattleEngine.prototype.update=function(){this.ticks++;const u=this.unit_list[0];clientCall(()=>{u.setHp(u.hp-1);ed.rand();ed.rand();clientCall(()=>u.setMp(9))});this.running=false;this.result='victory'}`,changed.context);
 const extra=await run(changed);assert.notEqual(firstTraceDifference(a.events,extra.events),null);assert.equal(extra.rngCount,a.rngCount+1);
 const omitted=fixture();runInContext(`ed.BattleEngine.prototype.update=function(){this.ticks++;this.running=false;this.result='victory'}`,omitted.context);
 const skipped=await run(omitted);assert.notEqual(firstTraceDifference(a.events,skipped.events),null);assert.equal(skipped.callbackCount,0);
});

test('clock inputs and append-only device outputs interleave with callbacks and RNG without dropping ledger state',async()=>{
 const {readFile}=await import('node:fs/promises');const runtime=fixture();
 runInContext(await readFile(new URL('../bootstrap-host.js',import.meta.url),'utf8'),runtime.context);
 runInContext(await readFile(new URL('../oracle-clock.js',import.meta.url),'utf8'),runtime.context);
 runtime.host=runtime.context.bootstrapHost;let observer;
 runtime.context.__clockOptions={mode:'record',observe:(entry,ordinal)=>observer?.(entry,ordinal)};
 runtime.clock=runInContext('installOracleClock(__clockOptions)',runtime.context);
 runInContext(`ed.BattleEngine.prototype.update=function(){Date.now();this.ticks++;clientCall(()=>{cc.audioEngine.playEffect('sound.ogg',false);Date.now();ed.rand()});this.running=false;this.result='victory'}`,runtime.context);
 const trace=await traceBattle(runtime,{inputSha256:'test'},{materialize:()=>({battleSeed:1,players:[],enemies:[],config:{}}),subscribeClock(fn){observer=fn;return()=>{observer=null}}});
 assert.equal(trace.status,'completed');assert.equal(trace.coverage.includesHostDeviceState,true);
 const kinds=trace.events.map(e=>e.kind);
 assert.ok(kinds.indexOf('host:clock')<kinds.indexOf('callback:enqueue'));
 assert.ok(kinds.indexOf('callback:before')<kinds.indexOf('device:output'));
 assert.ok(kinds.indexOf('device:output')<kinds.lastIndexOf('host:clock'));
 assert.ok(kinds.lastIndexOf('host:clock')<kinds.indexOf('rng:draw'));
 assert.equal(trace.deviceLedger.length,runtime.host.events.length);assert.equal(runtime.clock.tape.length,2);
 runtime.clock.finish();
});
