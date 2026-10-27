import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createBootstrapRuntime} from './bootstrap-runtime.mjs';
import {instantiateScenario} from './scenario-factory.mjs';
import {installEmptyArrayCopyPrototype} from './empty-array-copy.mjs';
import {binary64,createGraphSnapshotter,realmIntrinsics,createHostRandomTape} from './battle-trace.mjs';
const root=resolve(import.meta.dirname,'..'),sha=x=>createHash('sha256').update(x).digest('hex');
const policy=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,policy.node);assert.equal(process.versions.v8,policy.v8);
assert.deepEqual(process.execArgv,policy.rawBitReferenceFlags);assert.equal(process.env.NODE_OPTIONS??'','');
const scenarioPath=process.argv[2]??'config/scenario-example-2026.json',count=Number(process.argv[3]??3);
assert.ok(Number.isSafeInteger(count)&&count>0&&count<=100);
const inputs=['tools/check-empty-array-copy.mjs','tools/empty-array-copy.mjs','tools/bootstrap-runtime.mjs','tools/bootstrap-host.js','tools/bootstrap-render-host.js','tools/bootstrap-render-scene.mjs','tools/bootstrap-callbacks.mjs','tools/scenario-factory.mjs','tools/oracle-clock.js','tools/battle-trace.mjs',scenarioPath,...(await readdir(resolve(root,'src/srcmodule'))).filter(p=>p.endsWith('.js')).sort().map(p=>'src/srcmodule/'+p)];
const hashInputs=async()=>Object.fromEntries(await Promise.all(inputs.map(async p=>[p,sha(await readFile(resolve(root,p)))])));
const inputHashes=await hashInputs();
const wire=JSON.parse(await readFile(resolve(root,scenarioPath),'utf8'));
const clockTape=[],random=createHostRandomTape(),runs=[];
let baseline;
for(const mode of ['observe','specialize']){
 const entropy=mode==='observe'?random:createHostRandomTape(0,{replay:random.tape});
 const runtime=await createBootstrapRuntime({eagerBattle:true,hostRandom:entropy.random,hostClock:{mode:mode==='observe'?'record':'replay',tape:clockTape}});
 const prototype=installEmptyArrayCopyPrototype(runtime,{mode}),results=[],started=performance.now();
 for(let i=0;i<count;i++){
  const scenario=instantiateScenario(runtime,wire),engine=new runtime.ed.BattleEngine();runtime.ed.battleEngine=engine;
  runtime.ed.srand(scenario.battleSeed);engine.enterBattle(scenario.players,scenario.enemies,scenario.config);
  let frames=0,callbacks=0;
  while(engine.running&&frames<20000){callbacks+=runtime.callbacks.updateFrame(0.125).executed;frames++;}
  assert.ok(!engine.running&&['victory','defeat','timeout'].includes(engine.result));
  results.push({result:engine.result,ticks:engine.ticks,frames,callbacks,rngBits:binary64(runtime.context.random_seed)});
 }
 const elapsedMs=performance.now()-started,stats=prototype.stats();prototype.restore();
 const snapshot=createGraphSnapshotter({intrinsics:realmIntrinsics(runtime.context)});
 const graph=snapshot({engine:runtime.ed.battleEngine,device:runtime.host});
 const graphText=JSON.stringify(graph),terminalGraphSha256=sha(graphText);
 runtime.clock.finish();entropy.assertFullyConsumed();
 const run={mode,elapsedMs,stats,results,terminalGraphSha256,terminalNodes:graph.nodes.length,clock:runtime.clock.stats(),hostRandomDraws:entropy.tape.length};
 if(mode==='observe')baseline={results,graphText};else{assert.deepEqual(results,baseline.results);assert.equal(graphText,baseline.graphText,'Terminal engine/device graph differs');}
 runs.push(run);
}
assert.deepEqual(await hashInputs(),inputHashes,'Profile inputs changed during execution');
const report={version:1,qualifiesFor10000Target:false,scenario:scenarioPath,battlesPerMode:count,reference:policy,inputHashes,runs,hostClockTape:clockTape,hostRandomTape:random.tape,limitations:['Diagnostic JS specialization prototype adds a wrapper and reflection overhead; timings do not estimate native clone throughput.','Repeated single scenario, callback-only host; full actor/effect frame lifecycle is outside adapter.','Terminal engine/device descriptor graphs and result/RNG/callback counts compare exactly; this tool does not compare per-event graphs or hidden closure state.','Eligibility is conservative: source-realm extensible arrays with exactly the own writable length descriptor set to zero, original Array.prototype constructor and Object/keys. Unsupported inputs execute original source.']};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});
const path=resolve(root,'benchmarks/validation/empty-array-copy-proof.json');await writeFile(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({path,runs},null,2));
