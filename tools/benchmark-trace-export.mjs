import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { runInContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { instantiateScenario } from './scenario-factory.mjs';

const root=resolve(import.meta.dirname,'..'),frames=Number(process.argv[2]??20);
if(!Number.isSafeInteger(frames)||frames<1||frames>1000)throw Error('Usage: node tools/benchmark-trace-export.mjs [frames<=1000]');
let source=await readFile(resolve(root,'tools/battle-trace-portable.js'),'utf8');
const descriptorExperiment=process.argv[3]==='descriptors',brandExperiment=process.argv[3]==='brands';
let baseline=source;
if(brandExperiment){
 const {gunzipSync}=await import('node:zlib');
 source=gunzipSync(await readFile(resolve(root,'benchmarks/validation/trace-brand-memo/lazy-trail.js.gz'))).toString('utf8');
}else if(descriptorExperiment){
 source=source.replace('var descriptor = Object.getOwnPropertyDescriptor;','var descriptor = Object.getOwnPropertyDescriptor;\n    var descriptorsOf = Object.getOwnPropertyDescriptors;').replace('var keys = ownKeys(value);\n                for (var ki = 0; ki < keys.length; ki++) {\n                    var key = keys[ki], propertyDescriptor = descriptor(value, key);','var descriptorMap = descriptorsOf(value), keys = ownKeys(descriptorMap);\n                for (var ki = 0; ki < keys.length; ki++) {\n                    var key = keys[ki], propertyDescriptor = descriptorMap[key];');
}else{
for(const [from,to] of [['previous=propertyCache.get(key)','previous=null'],['previousNode=nodeCaches.get(value)','previousNode=null'],['cached=identityHashes.get(node)','cached=null']]){
 assert.equal(baseline.split(from).length,2);baseline=baseline.replace(from,to);
}
const begin=baseline.indexOf('    // Number Map equality'),end=baseline.indexOf('    var typedArrayBrand',begin);
assert.ok(begin>=0&&end>begin);
baseline=baseline.slice(0,begin)+`    function bits(value){data.setFloat64(0,value,false);return data.getUint32(0,false).toString(16).padStart(8,'0')+data.getUint32(4,false).toString(16).padStart(8,'0');}\n`+baseline.slice(end);
}
const runtime=await createBootstrapRuntime(),wire=JSON.parse(await readFile(resolve(root,'config/scenario-example-2026.json'),'utf8'));
const {ed,context}=runtime,materialized=instantiateScenario(runtime,wire),engine=new ed.BattleEngine();ed.battleEngine=engine;
ed.srand(materialized.battleSeed);engine.enterBattle(materialized.players,materialized.enemies,materialized.config);
const digest=text=>createHash('sha256').update(text).digest('hex');
context.__traceBenchmarkOptions={compact:true,digest};
runInContext(baseline,context,{filename:'trace-export-uncached-baseline.js'});
const reference=runInContext('installPortableBattleTrace(__traceBenchmarkOptions)',context);
runInContext(source,context,{filename:'tools/battle-trace-portable.js'});
const candidate=runInContext('installPortableBattleTrace(__traceBenchmarkOptions)',context);delete context.__traceBenchmarkOptions;
const hashes=[],samples=[];
for(let frame=-2;frame<frames;frame++){
 if(frame>=0&&engine.running)runtime.callbacks.updateFrame(0.125);
 const roots={engine,host:runtime.host,randomSeed:context.random_seed};
 // Alternate order to reduce consistent cache/CPU-frequency advantage.
 const order=frame%2===0?[[reference,'reference'],[candidate,'candidate']]:[[candidate,'candidate'],[reference,'reference']],times={},events={};
 for(const [recorder,name]of order){const start=performance.now();events[name]=recorder.record('sample',{frame},roots);times[name]=performance.now()-start;}
 assert.equal(events.candidate.stateHash,events.reference.stateHash,`complete Merkle graph frame ${frame}`);
 if(frame>=0){samples.push({frame,...times});hashes.push(events.candidate.stateHash);}
}
const sum=name=>samples.reduce((total,sample)=>total+sample[name],0);
const report={version:1,kind:'diagnostic-exporter-comparison',qualifiesForThroughputTarget:false,scenario:wire.inputSha256,frames,node:process.version,
 sourceSha256:digest(source),baselineSha256:digest(baseline),execArgv:process.execArgv,baseline:brandExperiment?'production descriptor walker without experimental per-snapshot prototype-brand memoization':descriptorExperiment?'same cached walker using individual descriptor reads':'same complete descriptor walker with property/node/hash reuse disabled and uncached DataView bits',
 referenceMs:sum('reference'),candidateMs:sum('candidate'),ratio:sum('reference')/sum('candidate'),samples,stateHashes:hashes,
 limitations:['Samples one partial realistic battle; no battle completion or throughput qualification','Each sampled graph covers engine,host and source RNG; this is not the complete ordered battle event gate','Only diagnostic serialization/representation reuse differs; source callbacks are executed normally between samples','Other concurrent processes may affect elapsed times','Returned graph records are exporter-owned immutable representations; consumers must not mutate them']};
await mkdir(resolve(root,'benchmarks/results'),{recursive:true});const stamp=new Date().toISOString().replaceAll(':','-');
await writeFile(resolve(root,`benchmarks/results/${stamp}-trace-export-cache.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
