import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {installBootstrapCallbacks} from '../bootstrap-callbacks.mjs';
import {comparePortableBattleTraces} from '../battle-trace-portable.mjs';

async function fixture({compact=true,skip=false,extraRng=false,scriptMutation=false}={}){
 const context=createContext({});
 runInContext(`var random_seed=1,ed={};ed.rand=function(){random_seed=random_seed*25%34359738337;return random_seed/34359738337};ed.srand=function(n){random_seed=n;ed.init_battle_seed=n};
  ed.battlehero={Hero:{counter:0}};
  ed.Unit=class Unit{constructor(){this.hp=5;this.tid=1;this.info={Script:'Hero'}}setHp(n){this.hp=n}setMp(){}castSkill(){}onDied(){}terminate(){}};
  ed.BattleEngine=class BattleEngine{constructor(){this.running=false;this.unit_list=[]}enterBattle(){this.running=true;this.unit_list=[new ed.Unit()]}update(){this.unit_list[0].setHp(4);this.running=false;this.result='victory';if(!skip)clientCall(()=>{ed.rand();if(extraRng)ed.rand();if(scriptMutation)ed.battlehero.Hero.counter++;this.unit_list[0].setHp(3)})}};`,context);
 context.skip=skip;context.extraRng=extraRng;context.scriptMutation=scriptMutation;
 const runtime={ed:context.ed,context,callbacks:await installBootstrapCallbacks(context)};
 for(const name of ['battle-trace-portable.js','battle-trace-instrumentation.js'])runInContext(await readFile(new URL('../'+name,import.meta.url),'utf8'),context);
 context.runtime=runtime;context.compact=compact;
 const original=context.ed.rand;
 const instrumentation=runInContext('installBattleTraceInstrumentation(runtime,{compact:compact})',context);
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
