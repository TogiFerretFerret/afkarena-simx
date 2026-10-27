import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext,constants} from 'node:vm';
import {createHash} from 'node:crypto';
import {validateBattleBoundarySchema} from '../validate-battle-boundary-schema.mjs';
const source=await readFile(new URL('../battle-boundary-state-trace.js',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(){
 const context=createContext(constants.DONT_CONTEXTIFY);context.digest=value=>createHash('sha256').update(value).digest('hex');
 runInContext(`var calls=0,reads=0,sentinel={message:'same exception'},deviceObserver=null;var ed={Unit:function(){},rand:function(value){calls++;if(value==='throw')throw sentinel;return value;},srand:function(){},_battleEngineInstance:{unit_list:[],dead_unit_list:[],pet_list:[],n:-0,vector:[-0,,NaN]},clientCall_list:[]};var clientCall=function(cb){ed.clientCall_list.push(cb)};var runtime={ed:ed,callbacks:{sceneHost:{snapshot:function(){}}},classManagerObserver:{snapshot:function(){return{count:17}}},host:{setTraceObserver:function(f){deviceObserver=f}}};Object.defineProperty(ed._battleEngineInstance,'__proto__',{value:-0,enumerable:true});ed._battleEngineInstance.$boundaryNode='literal';Object.defineProperty(ed._battleEngineInstance,'getter',{enumerable:true,get:function(){reads++;throw Error('getter');}});var u={attribs:{ATK:3},buff_effects:{},skill_list:[],buff_list:[]};ed._battleEngineInstance.unit_list=[u,u];`,context);
 runInContext(source,context);runInContext(`var trace=installBattleBoundaryStateTrace(runtime,{digest:digest});trace.record('battle:entered',{});trace.beginFrame();ed.rand(-0);var caught=false;try{ed.rand('throw')}catch(e){caught=e===sentinel}var data={n:-0,a:NaN};data.self=data;deviceObserver(data,0);trace.endFrame();var result=trace.stop({status:'completed',running:false,ticks:1,result:'victory'});`,context);
 return{trace:JSON.parse(runInContext('JSON.stringify(result)',context)),context};
}
function rehashState(trace){for(const event of trace.events)event.stateHash=sha(event.state);}
function editEngine(trace,edit){const old=trace.events[0].state.engine.$boundaryNode,node=trace.snapshots.find(node=>node.hash===old);edit(node.value);node.hash=sha(node.value);for(const event of trace.events)if(event.state.engine.$boundaryNode===old)event.state.engine.$boundaryNode=node.hash;rehashState(trace);}
function rejects(trace,mutate){const altered=structuredClone(trace);mutate(altered);const result=validateBattleBoundarySchema(altered);assert.equal(result.passed,false,JSON.stringify(result));return result;}
test('typed roots, literal reserved names, sparse f64 vectors, cyclic payloads and source exactly-once exceptions pass',()=>{
 const {trace,context}=fixture(),result=validateBattleBoundarySchema(trace);assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.frames,1);assert.equal(runInContext('calls',context),2);assert.equal(runInContext('caught',context),true);assert.equal(runInContext('reads',context),0);
});
test('state:true and missing selected roots fail even with matching state hashes',()=>{
 const {trace}=fixture();rejects(trace,t=>{t.events[0].state=true;rehashState(t);});rejects(trace,t=>{delete t.events[0].state.pendingCallbacks;rehashState(t);});
});
test('rehashing malformed f64 tags and duplicate field keys does not make them valid',()=>{
 const {trace}=fixture();rejects(trace,t=>editEngine(t,node=>{node.entries.find(([key])=>key==='n')[1].bits='not-f64';}));rejects(trace,t=>editEngine(t,node=>{node.entries.push(node.entries[0]);}));rejects(trace,t=>editEngine(t,node=>{node.entries.find(([key])=>key==='vector')[1].values[0]=null;}));
});
test('event discriminants, sequence, frame boundaries and complete payload shape are strict',()=>{
 const {trace}=fixture();rejects(trace,t=>{t.events[0].kind='unregistered:event';});rejects(trace,t=>{t.events[0].sequence=3;});rejects(trace,t=>{t.events[1].frame=1.5;});rejects(trace,t=>{t.events.at(-1).payload.entries=t.events.at(-1).payload.entries.filter(([key])=>key!=='running');});rejects(trace,t=>{t.events.at(-1).payload.entries.find(([key])=>key==='ticks')[1]={bits:'7ff8000000000000'};});
});
test('missing nodes, wrong node types, malformed reference vocabulary and cyclic raw objects fail',()=>{
 const {trace}=fixture();rejects(trace,t=>{t.snapshots.pop();});rejects(trace,t=>{t.events[0].state.engine={$boundaryNode:t.events[0].state.lists.unit_list[0].$boundaryNode};rehashState(t);});rejects(trace,t=>{t.events[0].state.engine.extra=true;rehashState(t);});rejects(trace,t=>{t.snapshots[0].value.self=t.snapshots[0].value;});
});
test('payload graph cannot contain forward references, duplicate identities or duplicate literal keys',()=>{
 const {trace}=fixture();rejects(trace,t=>{t.events[0].payload={kind:'payload-ref',identity:1};});rejects(trace,t=>{t.events[0].payload.entries=[['same',null],['same',null]];});rejects(trace,t=>{const event=t.events.find(e=>e.kind==='device:output');event.payload.entries.find(([key])=>key==='event')[1].identity=1;});
});
test('return/throw pairs and wrapper argument payloads cannot be silently dropped or forged',()=>{
 const {trace}=fixture();rejects(trace,t=>{const i=t.events.findIndex(e=>e.kind==='rng:draw:before');t.events.splice(i,1);t.events.forEach((e,j)=>e.sequence=j);});rejects(trace,t=>{const event=t.events.find(e=>e.kind==='rng:draw:before');event.payload.entries.find(([key])=>key==='args')[1].entries=[];});
});
test('old untyped dictionaries and orphan malformed nodes fail supplemental typed schema',()=>{
 const {trace}=fixture();rejects(trace,t=>editEngine(t,node=>{delete node.kind;delete node.entries;node.old=-0;}));rejects(trace,t=>{const value={bits:'bad'};t.snapshots.push({hash:sha(value),value});});
});
