import assert from 'node:assert/strict';
import {types} from 'node:util';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {runInContext} from 'node:vm';
import {createBootstrapRuntime} from './bootstrap-runtime.mjs';
import {instantiateScenario} from './scenario-factory.mjs';
import {sourceCopyFunction} from './flat-numeric-copy.mjs';
import {binary64,createHostRandomTape} from './battle-trace.mjs';
const root=resolve(import.meta.dirname,'..'),sha=x=>createHash('sha256').update(x).digest('hex');
const policy=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,policy.node);assert.equal(process.versions.v8,policy.v8);assert.deepEqual(process.execArgv,policy.rawBitReferenceFlags);assert.equal(process.env.NODE_OPTIONS??'','');
const scenarioPath=process.argv[2]??'config/scenario-example-2026.json';
const wire=JSON.parse(await readFile(resolve(root,scenarioPath),'utf8')),entropy=createHostRandomTape();
const inputs=['tools/profile-copy-arrays.mjs','tools/bootstrap-runtime.mjs','tools/bootstrap-host.js','tools/bootstrap-render-host.js','tools/bootstrap-render-scene.mjs','tools/bootstrap-callbacks.mjs','tools/scenario-factory.mjs','tools/oracle-clock.js','tools/flat-numeric-copy.mjs',scenarioPath,...(await readdir(resolve(root,'src/srcmodule'))).filter(p=>p.endsWith('.js')).sort().map(p=>'src/srcmodule/'+p)];
const hashes=async()=>Object.fromEntries(await Promise.all(inputs.map(async p=>[p,sha(await readFile(resolve(root,p)))])));
const inputHashes=await hashes();
const runtime=await createBootstrapRuntime({eagerBattle:true,hostRandom:entropy.random,hostClock:{mode:'record'}});
const arrayPrototype=Reflect.getPrototypeOf(runInContext('[]',runtime.context)),original=runtime.ed.copyObj;
assert.equal(Function.prototype.toString.call(original),sourceCopyFunction);
const stats={calls:0,arrays:0,proxies:0,holes:0,accessors:0,nonstandardDescriptors:0,customPrototype:0,ownConstructors:0,symbolKeys:0,extraStringKeys:0,objectChildren:0,repeatedObjectChildren:0},lengths={},shapes={},elementTypes={},examples={};
const bump=(map,key)=>map[key]=(map[key]??0)+1;
runtime.ed.copyObj=function(value){
 stats.calls++;
 if(types.isProxy(value))stats.proxies++;
 else if(Array.isArray(value)){
  stats.arrays++;const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),length=descriptors.length.value;
  bump(lengths,length);if(Reflect.getPrototypeOf(value)!==arrayPrototype)stats.customPrototype++;
  let numeric=0,finite=0,primitive=0,accessors=0,objects=0,extras=0,standard=true;const seen=new Set(),typesHere=new Set();
  if(Object.hasOwn(descriptors,'constructor'))stats.ownConstructors++;
  for(const key of keys){if(key==='length')continue;if(typeof key==='symbol'){stats.symbolKeys++;continue;}
   const index=String(Number(key))===key&&Number(key)>=0&&Number(key)<4294967295&&Number.isInteger(Number(key));
   if(index)numeric++;else{extras++;stats.extraStringKeys++;}
   const d=descriptors[key];if(!('value'in d)){stats.accessors++;accessors++;continue;}
   if(!d.writable||!d.enumerable||!d.configurable){standard=false;stats.nonstandardDescriptors++;}
   const type=d.value===null?'null':typeof d.value;typesHere.add(type);bump(elementTypes,type);
   if(type==='number'&&Number.isFinite(d.value))finite++;
   if(type!=='object')primitive++;else{stats.objectChildren++;objects++;if(seen.has(d.value))stats.repeatedObjectChildren++;seen.add(d.value);}
  }
  if(numeric<length)stats.holes++;
  const shape=accessors?'accessor':objects?'object_children':numeric<length?'holes':extras?'extra_keys':!standard?'nonstandard_descriptor':finite===length?'dense_finite_numbers':primitive===length?'dense_primitives':'other';
  bump(shapes,shape);examples[shape]??={length,types:[...typesHere],keys:keys.map(String).slice(0,12)};
 }
 return Reflect.apply(original,this,[value]);
};
const scenario=instantiateScenario(runtime,wire),engine=new runtime.ed.BattleEngine();runtime.ed.battleEngine=engine;runtime.ed.srand(scenario.battleSeed);engine.enterBattle(scenario.players,scenario.enemies,scenario.config);
let frames=0,callbacks=0;while(engine.running&&frames<20000){callbacks+=runtime.callbacks.updateFrame(0.125).executed;frames++;}assert.ok(!engine.running);runtime.ed.copyObj=original;runtime.clock.finish();
assert.deepEqual(await hashes(),inputHashes);
const report={version:1,qualifiesFor10000Target:false,scenario:scenarioPath,reference:policy,inputHashes,result:{outcome:engine.result,ticks:engine.ticks,frames,callbacks,rngBits:binary64(runtime.context.random_seed)},stats,lengths,shapes,elementTypes,examples,clock:runtime.clock.stats(),limitations:['Read-only descriptor classification before the unchanged original copyObj; this observer is not a speed benchmark.','Single frozen callback-only scenario; no full actor/effect lifecycle or whole-event differential claim.','Source reads constructor twice when truthy, then Object.keys, then values in ordered enumerable string-key order; nested non-null objects recurse, functions retain identity.','Array source constructs new Array() with initial length zero; trailing source holes are not retained unless an enumerable own index assignment raises output length.']};
await writeFile(resolve(root,'benchmarks/validation/copy-array-shapes.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
