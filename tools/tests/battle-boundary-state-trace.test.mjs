import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext,constants} from 'node:vm';
import {createHash} from 'node:crypto';
import {validateBattleBoundaryTrace,reconstructBattleBoundaryState,compareBattleBoundaryTraces} from '../battle-boundary-trace.mjs';
const source=await readFile(new URL('../battle-boundary-state-trace.js',import.meta.url),'utf8');
function fixture(extra=''){
 const context=createContext(constants.DONT_CONTEXTIFY);context.digest=text=>createHash('sha256').update(text).digest('hex');
 runInContext(`var ed={Unit:function(){},rand:function(x){return x;},srand:function(){},_battleEngineInstance:{unit_list:[],dead_unit_list:[],pet_list:[]},clientCall_list:[]};var clientCall=function(cb){ed.clientCall_list.push(cb)};var runtime={ed:ed,callbacks:{sceneHost:{snapshot:function(){}}}};`+extra,context);
 runInContext(source,context);runInContext('var trace=installBattleBoundaryStateTrace(runtime,{digest:digest});',context);return context;
}
function finish(context){return JSON.parse(runInContext('JSON.stringify(trace.stop({status:"completed"}))',context));}
test('ordinary accessors and numeric-array accessors are never invoked; sparse numeric vectors preserve holes and f64 bits',()=>{
 const context=fixture(`var reads=0;Object.defineProperty(ed._battleEngineInstance,'trap',{enumerable:true,get:function(){reads++;throw Error('getter')}});var v=[-0,,NaN];ed._battleEngineInstance.vector=v;var a=[];Object.defineProperty(a,'0',{get:function(){reads++;throw Error('array getter')}});ed._battleEngineInstance.accessorVector=a;`);
 const trace=finish(context),state=reconstructBattleBoundaryState(trace,0);assert.equal(runInContext('reads',context),0);assert.equal(state.engine.vector[0].bits,'8000000000000000');assert.deepEqual(state.engine.vector[1],{kind:'hole'});assert.match(state.engine.vector[2].bits,/^[0-9a-f]{16}$/);assert.equal(Object.hasOwn(state.engine,'accessorVector'),false);assert.equal(validateBattleBoundaryTrace(trace).passed,true);
});
test('bigints and symbols terminate with explicit tags and distinct symbol identity',()=>{
 const context=fixture(`ed._battleEngineInstance.big=12345678901234567890n;var s=Symbol('same'),t=Symbol('same');ed._battleEngineInstance.s=s;ed._battleEngineInstance.t=t;`);
 const state=reconstructBattleBoundaryState(finish(context),0);assert.equal(state.engine.big.digits,'12345678901234567890');assert.notEqual(state.engine.s.identity,state.engine.t.identity);
});
test('selected list aliases preserve identity and cycles outside selected state are explicitly omitted',()=>{
 const context=fixture(`var u={position:[1,2],attribs:{ATK:2},buff_effects:{},skill_list:[],buff_list:[]};u.self=u;ed._battleEngineInstance.unit_list=[u,u];`);
 const state=reconstructBattleBoundaryState(finish(context),0);assert.deepEqual(state.lists.unit_list[0].identity,state.lists.unit_list[1].identity);assert.equal(Object.hasOwn(state.lists.unit_list[0].fields,'self'),false);
});
test('source functions execute once and exact exception identity is preserved',()=>{
 const context=fixture(`var calls=0,sentinel={message:'sentinel'};ed.rand=function(){calls++;throw sentinel};`);
 runInContext(`var caught=false;try{ed.rand()}catch(e){caught=e===sentinel}`,context);const trace=finish(context);assert.equal(runInContext('calls',context),1);assert.equal(runInContext('caught',context),true);assert.deepEqual(trace.events.map(e=>e.kind),['rng:draw:before','rng:draw:throw','battle:completed']);assert.equal(compareBattleBoundaryTraces(trace,structuredClone(trace)).passed,true);
});
test('missing snapshot nodes, changed bits, bad ordering and incomplete traces fail closed',()=>{
 const trace=finish(fixture('ed._battleEngineInstance.value=-0;'));
 for(const mutate of [t=>t.snapshots.pop(),t=>t.snapshots[0].value.changed=true,t=>t.events[0].sequence=7,t=>t.status='running']){const other=structuredClone(trace);mutate(other);assert.equal(compareBattleBoundaryTraces(trace,other).passed,false);}
});
