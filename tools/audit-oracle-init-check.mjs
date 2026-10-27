import assert from 'node:assert/strict';
import {runInContext} from 'node:vm';
import {writeFile,mkdir} from 'node:fs/promises';
import {createBootstrapRuntime} from './bootstrap-runtime.mjs';

const runtime=await createBootstrapRuntime(),{ed,context}=runtime;
assert.equal(runtime.sourceRecords.functionDeclarations.length,19);
for(const record of runtime.sourceRecords.functionDeclarations)assert.equal(typeof context[record.name],'function',record.name);
assert.equal(Object.keys(ed.attrib_names_x).length,47);assert.equal(Object.keys(ed.attrib_names_a).length,47);
for(const name of ed.attrib_names){assert.equal(ed.attrib_names_x[name],name+'.x');assert.equal(ed.attrib_names_a[name],name+'.a');}
const descriptor=Object.getOwnPropertyDescriptor(ed,'battleEngine');assert.equal(typeof descriptor.get,'function');assert.equal(typeof descriptor.set,'function');
const sentinel={probe:true};ed.battleEngine=sentinel;assert.equal(ed._battleEngineInstance,sentinel);assert.equal(ed.battleEngine,sentinel);
const script=context.CandleDog;assert.equal(Object.keys(script.BASIC_IMPACT_EFF).length,3);assert.equal(Object.keys(script.BASIC_IMPACT_SOUND).length,1);
function summonedAction(){let action;const owner=runtime.importValue({state:-1,walk_v:[2,3]});owner.setAction=value=>{action=value};ed.Unit.prototype.summon.call(owner);return {state:owner.state,action:action===undefined?'__undefined__':action};}
const stateMap=ed.state_to_string;ed.state_to_string={};const omittedStateMap=summonedAction();ed.state_to_string=stateMap;const originalStateMap=summonedAction();assert.equal(omittedStateMap.action,'__undefined__');assert.equal(originalStateMap.action,'Birth');assert.equal(originalStateMap.state,ed.emUnitState_Birth);
const protectedMutation=runInContext('(function(){var value=ed.createDataObj({list:[1]});try{value.list.push(2);return{threw:false,length:value.list.length};}catch(error){return{threw:true,message:error.message,length:value.list.length};}})',context);
const guarded=protectedMutation();assert.equal(guarded.threw,true);assert.equal(guarded.message,'不允许修改这个数组');assert.equal(guarded.length,1);
const percent=ed.Buff.prototype.applyPercentValue;
function applyPercent(){const buff=runtime.importValue({info:{'ATK.x':.5,'ATK.a':'ATK',AddSource:'owner'},owner:{attribs:{ATK:100},buff_effects:{}},caster_attribs:{ATK:50},attrib:['ATK']});percent.call(buff);return buff.owner.attribs.ATK;}
const x=ed.attrib_names_x,a=ed.attrib_names_a;ed.attrib_names_x={};ed.attrib_names_a={};const omittedPercentMaps=applyPercent();ed.attrib_names_x=x;ed.attrib_names_a=a;const originalPercentMaps=applyPercent();assert.equal(omittedPercentMaps,100);assert.equal(originalPercentMaps,150);
const report={version:1,status:'passed',functionDeclarations:runtime.sourceRecords.functionDeclarations.map(r=>r.name),attributeMapKeys:[Object.keys(x).length,Object.keys(a).length],engineDescriptor:true,candleDogEffects:3,candleDogSounds:1,gameplayEvidence:{summon:{omittedStateMap,originalStateMap},percentBuff:{omittedPercentMaps,originalPercentMaps}},readonlyArrayMutation:{threw:guarded.threw,message:guarded.message,length:guarded.length},postInitializers:runtime.sourceRecords.postInitializers.map(({source,...record})=>record),scope:'Initialization and exact original-method behavior probes; no whole-battle throughput claim'};
await mkdir('work',{recursive:true});await writeFile('work/oracle-init-repair-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
