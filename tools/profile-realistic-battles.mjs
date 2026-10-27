import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { instantiateScenario } from './scenario-factory.mjs';
import { bits } from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..');
const options={battles:10,warmup:3,scenario:'config/scenario-example-2026.json',maxFrames:20000};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i].replace(/^--/,'');
  if(!(key in options)||process.argv[i+1]===undefined)throw Error('Expected --battles N --warmup N --scenario PATH --maxFrames N');
  options[key]=key==='scenario'?process.argv[i+1]:Number(process.argv[i+1]);
}
for(const key of ['battles','warmup','maxFrames'])if(!Number.isSafeInteger(options[key])||options[key]<(key==='warmup'?0:1))throw Error(`Invalid ${key}`);
const sha=value=>createHash('sha256').update(value).digest('hex');
const wire=JSON.parse(await readFile(resolve(root,options.scenario),'utf8'));
const runtime=await createBootstrapRuntime();
const {ed,context}=runtime;
function battle(){
  const materialized=instantiateScenario(runtime,wire),engine=new ed.BattleEngine();ed.battleEngine=engine;
  ed.srand(materialized.battleSeed);engine.enterBattle(materialized.players,materialized.enemies,materialized.config);
  let frames=0,callbacks=0;
  while(engine.running&&frames<options.maxFrames){const phase=runtime.callbacks.updateFrame(0.125);frames++;callbacks+=phase.executed;}
  if(engine.running||!['victory','defeat','timeout'].includes(engine.result))throw Error(`Battle failed to finish: ${engine.result}`);
  return{result:engine.result,ticks:engine.ticks,frames,callbacks,rngBits:bits(context.random_seed)};
}
for(let i=0;i<options.warmup;i++)battle();
const session=new Session();session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,value)=>error?reject(error):resolve(value)));
await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:500});await post('Profiler.start');
const started=performance.now(),results=[];
for(let i=0;i<options.battles;i++)results.push(battle());
const wallMs=performance.now()-started;
const {profile}=await post('Profiler.stop');session.disconnect();
const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map(),totals=new Map();
for(const n of profile.nodes)for(const child of n.children??[])parents.set(child,n.id);
const identity=n=>JSON.stringify(n.callFrame);
function add(n,field,time){const key=identity(n);let t=totals.get(key);if(!t){t={...n.callFrame,selfMicros:0,inclusiveMicros:0};totals.set(key,t);}t[field]+=time;}
let sampledMicros=0;
for(let i=0;i<(profile.samples??[]).length;i++){
  const time=profile.timeDeltas[i],sample=nodes.get(profile.samples[i]);sampledMicros+=time;add(sample,'selfMicros',time);
  let id=sample.id;const seen=new Set();while(id!==undefined){const n=nodes.get(id),key=identity(n);if(!seen.has(key)){add(n,'inclusiveMicros',time);seen.add(key);}id=parents.get(id);}
}
const ranked=(field,sourceOnly)=>[...totals.values()].filter(n=>!sourceOnly||n.url.startsWith('src/')).sort((a,b)=>b[field]-a[field]).slice(0,40).map(n=>({...n,selfPercent:100*n.selfMicros/sampledMicros,inclusivePercent:100*n.inclusiveMicros/sampledMicros}));
const inputs=['tools/profile-realistic-battles.mjs','tools/bootstrap-runtime.mjs','tools/bootstrap-host.js','tools/bootstrap-render-host.js','tools/bootstrap-render-scene.mjs','tools/bootstrap-callbacks.mjs','tools/scenario-factory.mjs',options.scenario];
const report={version:1,engine:'copied-js-source-realistic-5v5',qualifiesFor10000Target:false,options,machine:{node:process.version,cpu:cpus()[0]?.model},inputHashes:Object.fromEntries(await Promise.all(inputs.map(async p=>[p,sha(await readFile(resolve(root,p)))]))),runtimeProvenance:runtime.provenance,wallMs,profiledBattlesPerSecond:options.battles*1000/wallMs,sampledMicros,results,topSourceSelf:ranked('selfMicros',true),topSourceInclusive:ranked('inclusiveMicros',true),topAllSelf:ranked('selfMicros',false),limitations:[...runtime.limitations,'Repeated single scenario; not broad differential qualification','Inspector sampling adds overhead','Timed work includes fresh source scenario materialization, battle initialization, all queued source callbacks and outcome counters; full diagnostic graph snapshots are excluded','Headless callback device baseline; source scene actor/effect frame lifecycle remains outside this adapter']};
const stamp=new Date().toISOString().replaceAll(':','-'),stem=`${stamp}-realistic-5v5`;
await mkdir(resolve(root,'benchmarks/profiles'),{recursive:true});await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
await writeFile(resolve(root,`benchmarks/profiles/${stem}.cpuprofile`),JSON.stringify(profile));
await writeFile(resolve(root,`benchmarks/results/${stem}-profile.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stem,wallMs,profiledBattlesPerSecond:report.profiledBattlesPerSecond,results,topAllSelf:report.topAllSelf.slice(0,15),topSourceInclusive:report.topSourceInclusive.slice(0,10)},null,2));
