import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const reviewedCommit='bdc1c26';
const committed=file=>execFileSync('git',['show',reviewedCommit+':'+file],{encoding:'utf8'});
const comparator=committed('tools/battle-boundary-trace.mjs');
const {validateBattleBoundaryTrace,reconstructBattleBoundaryState}=await import('data:text/javascript;base64,'+Buffer.from(comparator).toString('base64'));
const root=resolve(import.meta.dirname,'..'),sha=value=>createHash('sha256').update(value).digest('hex');
const helperFile='tools/battle-boundary-state-trace.js',helper=committed(helperFile);
function fixture(extra=''){
 const context=createContext(constants.DONT_CONTEXTIFY);context.digest=value=>sha(value);
 runInContext(`var ed={Unit:function(){},rand:function(x){return x;},srand:function(){},_battleEngineInstance:{unit_list:[],dead_unit_list:[],pet_list:[]},clientCall_list:[]};var clientCall=function(cb){ed.clientCall_list.push(cb)};var runtime={ed:ed,callbacks:{sceneHost:{snapshot:function(){}}}};`+extra,context);
 runInContext(helper,context);runInContext('var trace=installBattleBoundaryStateTrace(runtime,{digest:digest});',context);return context;
}
function finish(context){return JSON.parse(runInContext('JSON.stringify(trace.stop({status:"completed"}))',context));}
const results=[];
{
 const context=fixture("Object.defineProperty(ed._battleEngineInstance,'__proto__',{value:-0,enumerable:true,configurable:true});");
 const trace=finish(context),state=reconstructBattleBoundaryState(trace,0);
 assert.equal(runInContext("Object.hasOwn(ed._battleEngineInstance,'__proto__')",context),true);
 assert.equal(Object.hasOwn(state.engine,'__proto__'),false);
 results.push({case:'own-enumerable-numeric-proto-key',actualSourceOwnValueBits:'8000000000000000',reconstructedOwnFieldPresent:false,validator:validateBattleBoundaryTrace(trace),finding:'primitiveState uses an ordinary output object and assignment, invoking the inherited __proto__ setter for an encoded numeric value instead of creating an own field. The selected numeric field is silently omitted.'});
}
{
 const emptyHash=sha('{}');
 const context=fixture(`var u={attribs:{$boundaryNode:${JSON.stringify(emptyHash)}},buff_effects:{},skill_list:[],buff_list:[]};ed._battleEngineInstance.unit_list=[u];`);
 const trace=finish(context),valid=validateBattleBoundaryTrace(trace),state=reconstructBattleBoundaryState(trace,0);
 assert.equal(valid.passed,true);assert.deepEqual(state.lists.unit_list[0].attributes,{});
 results.push({case:'reserved-reference-field-collision-with-existing-node',actualSourceAttributes:{$boundaryNode:emptyHash},reconstructedAttributes:state.lists.unit_list[0].attributes,validator:valid,finding:'A real primitive-field dictionary consisting only of $boundaryNode equal to another valid node hash is accepted as a reference and silently reconstructed as that other node. The marker namespace is not separated from captured data keys.'});
}
{
 const context=fixture("runtime.classManagerObserver={snapshot:function(){return{negativeZero:-0,notANumber:NaN}}};");
 const trace=finish(context),state=reconstructBattleBoundaryState(trace,0);
 assert.equal(Object.is(state.classManagerCounters.negativeZero,0),true);assert.equal(state.classManagerCounters.notANumber,null);
 results.push({case:'raw-class-manager-observer-number-fields',reconstructed:state.classManagerCounters,finding:'classManagerCounters is copied as raw JSON data rather than tagged f64 bits. Special numeric values lose sign/type information. Actual supplied observer counters may be source-bounded integers; this test establishes the format limitation, not actual fixture drift.'});
}
{
 const context=fixture("var deviceObserver=null;runtime.host={setTraceObserver:function(observer){deviceObserver=observer}};");
 runInContext('deviceObserver({negativeZero:-0,notANumber:NaN},0)',context);
 const trace=finish(context),payload=trace.events[0].payload;
 assert.equal(Object.is(payload.event.negativeZero,0),true);assert.equal(payload.event.notANumber,null);
 results.push({case:'raw-device-output-number-fields',payload,finding:'Device output payloads preserve raw event objects, so JSON loses special f64 bits. Clock entries and caller-provided record payloads similarly bypass atom encoding. Actual payload-domain impact requires a separate frozen-fixture audit.'});
}
const inputs={};for(const file of [helperFile,'tools/battle-boundary-trace.mjs','tools/tests/battle-boundary-state-trace.test.mjs','tools/run-battle-boundary-source.mjs','tools/prepare-battle-boundary-native.mjs','tools/review-battle-boundary-trace.mjs'])inputs[file]=sha(file==='tools/review-battle-boundary-trace.mjs'?await readFile(resolve(root,file)):committed(file));
assert.equal(inputs[helperFile],sha(helper),'Committed helper identity mismatch');
const report={version:1,reviewedCommit,reviewCompleted:true,candidateGenerallyFailClosed:false,actualFrozenFixtureImpact:'Not established by these isolated adversarial cases. Do not treat these tests as evidence that the in-flight frozen trace contains the problematic fields.',scope:'Independent historical review of bdc1c26 narrow boundary trace format and producers. Newer live helper revisions are deliberately outside this artifact. This deliberately records counterexamples against a broader own-primitive/f64 interpretation. It does not mutate the helper, qualify a battle trace, or claim a simulator mismatch.',inputs,cases:results,additionalProducerFindings:[
 'The inspected source producer records a loaded helper hash but lacks final unchanged-input checks for helper/emitter/producer/dependencies/tape/scenario. Frozen metadata scenario and host-tape declared hashes are not asserted before source execution.',
 'The inspected native preparation validates original units/compiler at entry but lacks a final immutable dependency check across long compilation. A separate final execution/archive gate must bind loaded helper, tape, producer and actual objects/DSO at start and finish.'
],recommendations:[
 'Use a typed field-entry representation or reject reserved captured keys before recording; a null-prototype output dictionary alone repairs __proto__ assignment but does not separate reference tags from literal data.',
 'Make numeric payload/observer domains explicit and either source-prove integer-only fields or tag every captured game Number with raw f64 bits.',
 'Inspect actual completed snapshot pools for reserved-key dictionaries before claiming a particular frozen fixture is affected; preserve the currently loaded helper bytes during in-flight runs.',
 'Keep whole-program, getter/unknown-Proxy, nested-object and actor/effect/view omissions explicit. Compare traced versus untraced original-source terminal reports and independently compare source/native ordered events and reconstructable nodes.'
],qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/battle-boundary-independent-review.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({reviewCompleted:true,counterexamples:results.length,candidateGenerallyFailClosed:false}));
