import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {installBootstrapCallbacks} from '../bootstrap-callbacks.mjs';
import {comparePortableBattleTraces} from '../battle-trace-portable.mjs';

async function fixture({compact=true,skip=false,extraRng=false,scriptMutation=false,programState=false,globalMutation=false,lazyPrototype=false,lazyEngine=false}={}){
 const context=createContext({});
 runInContext(`var neverAssigned;var createdEngines=0;var random_seed=1,ed={},shared_global_counter=0;ed.rand=function(){random_seed=random_seed*25%34359738337;return random_seed/34359738337};ed.srand=function(n){random_seed=n;ed.init_battle_seed=n};
  ed.battlehero={Hero:{counter:0}};
  ed.Unit=class Unit{constructor(){this.hp=5;this.tid=1;this.info={Script:'Hero'}}setHp(n){this.hp=n}setMp(){}castSkill(){}onDied(){}terminate(){}};
  ed.BattleEngine=class BattleEngine{constructor(){createdEngines++;this.running=false;this.unit_list=[]}enterBattle(){this.running=true;this.unit_list=[new ed.Unit()]}update(){this.unit_list[0].setHp(4);this.running=false;this.result='victory';if(!skip)clientCall(()=>{ed.rand();if(extraRng)ed.rand();if(scriptMutation)ed.battlehero.Hero.counter++;if(globalMutation)shared_global_counter++;this.unit_list[0].setHp(3)})}};`,context);
 context.skip=skip;context.extraRng=extraRng;context.scriptMutation=scriptMutation;context.globalMutation=globalMutation;
 if(lazyPrototype)runInContext(`var active=new Set(),name='ed.Unit.prototype.hidden';Object.defineProperty(ed.Unit.prototype,'hidden',{enumerable:true,configurable:true,get:function(){if(active.has(name))throw new Error('Source dependency cycle at '+name);throw new Error('Missing original parent definition: '+name)}})`,context);
 if(lazyEngine)runInContext(`var lazyQueueReads=0;Object.defineProperty(ed,'battleEngine',{get:function(){return this._battleEngineInstance||(this._battleEngineInstance=new ed.BattleEngine),this._battleEngineInstance},set:function(e){this._battleEngineInstance=e},configurable:true});Object.defineProperty(ed,'clientCall_list',{get:function(){lazyQueueReads++;throw new Error('lazy queue getter must not run during capture')},set:function(value){Object.defineProperty(ed,'clientCall_list',{value:value,writable:true,enumerable:true,configurable:true})},enumerable:true,configurable:true})`,context);
 const runtime={ed:context.ed,context,callbacks:await installBootstrapCallbacks(context)};
 for(const name of ['battle-trace-portable.js','battle-trace-instrumentation.js'])runInContext(await readFile(new URL('../'+name,import.meta.url),'utf8'),context);
 context.runtime=runtime;context.compact=compact;context.programState=programState;
 const original=context.ed.rand;
 const instrumentation=runInContext('installBattleTraceInstrumentation(runtime,{compact:compact,programState:programState,definitionNames:["ed.Unit","ed.Unit.prototype.hidden"],globalNames:["shared_global_counter","neverAssigned"]})',context);
 instrumentation.record('diagnostic:initial',{});
 assert.equal(context.createdEngines,0,'capture must not invoke the original lazy engine getter');
 runInContext('ed.battleEngine=new ed.BattleEngine();ed.srand(12);ed.battleEngine.enterBattle()',context);
 instrumentation.record('battle:entered',{});
 instrumentation.beginFrame();runtime.callbacks.updateFrame(.125);instrumentation.endFrame();
 const trace=instrumentation.stop({status:'completed',running:context.ed.battleEngine.running,result:context.ed.battleEngine.result});
 assert.equal(context.ed.rand,original);
 return{trace,context};
}

test('shared instrumentation preserves callbacks and detects source mutation and RNG omission',async()=>{
 const a=await fixture(),b=await fixture();
 assert.equal(comparePortableBattleTraces(a.trace,b.trace).passed,true);
 assert.equal(a.context.ed.battleEngine.unit_list[0].hp,3);
 assert.equal(a.trace.events.filter(event=>event.kind==='callback:after').length,1);
 assert.equal(a.trace.events.filter(event=>event.kind==='rng:draw:after').length,1);
 for(const options of [{skip:true},{extraRng:true},{scriptMutation:true}])assert.equal(comparePortableBattleTraces(a.trace,(await fixture(options)).trace).passed,false);
});

test('compact shared instrumentation matches full graph event checksums',async()=>{
 const {portableGraphHash}=await import('../battle-trace-portable.mjs');
 const compact=await fixture(),full=await fixture({compact:false});
 assert.equal(compact.trace.events.length,full.trace.events.length);
 for(let i=0;i<compact.trace.events.length;i++)assert.equal(compact.trace.events[i].stateHash,portableGraphHash(full.trace.events[i].graph));
});

test('program-state roots detect global mutation outside the engine and require matching root contracts',async()=>{
 const reference=await fixture({programState:true}),same=await fixture({programState:true});
 assert.equal(comparePortableBattleTraces(reference.trace,same.trace).passed,true);
 const different=await fixture({programState:true,globalMutation:true});
 assert.equal(comparePortableBattleTraces(reference.trace,different.trace).passed,false);
 const selected=await fixture();
 assert.equal(comparePortableBattleTraces(reference.trace,selected.trace).difference.reason,'different_state_root_contract');
 assert.ok(selected.trace.boundaries.some(boundary=>boundary.includes('outside selected')));
});

test('loader identities include synthetic prototype path parents without invoking lazy source getters',async()=>{
 const result=await fixture({compact:false,lazyPrototype:true});
 assert.ok(result.trace.events.some(event=>event.graph.codeTable.some(code=>code.kind==='logical'&&code.identity==='source-loader:get:ed.Unit.prototype.hidden')));
});

test('program globals use actual VM bindings rather than the parent context wrapper',async()=>{
 const {context,trace}=await fixture({compact:false,programState:true});
 assert.equal(Object.getOwnPropertyDescriptor(context,'neverAssigned'),undefined);
 const actual=runInContext('Object.getOwnPropertyDescriptor(globalThis,"neverAssigned")',context);
 assert.equal(actual.configurable,false);assert.equal(actual.writable,true);
 const captured=trace.events.flatMap(event=>event.graph.nodes.flatMap(node=>node.properties)).find(property=>property.key[1]==='neverAssigned');
 assert.ok(captured);assert.equal(captured.configurable,false);assert.equal(captured.writable,true);assert.deepEqual(Array.from(captured.value),['undefined']);
});

test('initial source snapshots never instantiate the lazy battle engine or materialize lazy queue bindings',async()=>{
 const {context}=await fixture({lazyEngine:true});
 assert.equal(context.createdEngines,1,'only the actual driver constructed its engine');
 assert.equal(context.lazyQueueReads,0);
});
