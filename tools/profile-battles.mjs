import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { createStageFixture,createBootstrapPlayerProto } from './bootstrap-stage.mjs';
import { bits } from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..');
const options={stage:1,battles:1000,warmup:20,seed:2026,maxTicks:20000,team:'mirror'};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i].replace(/^--/,'');
  if(!(key in options)||process.argv[i+1]===undefined)throw new Error('Usage: node tools/profile-battles.mjs [--battles N] [--warmup N] [--team mirror|initial] [--stage N] [--seed N] [--maxTicks N]');
  options[key]=key==='team'?process.argv[i+1]:Number(process.argv[i+1]);
}
for(const key of ['stage','battles','warmup','seed','maxTicks'])assertInteger(key,options[key]);
if(options.battles<1||options.warmup<1||options.maxTicks<1||!['mirror','initial'].includes(options.team))throw new Error('Invalid profiling options');
function assertInteger(key,value){if(!Number.isSafeInteger(value))throw new Error(`Invalid integer option: ${key}`);}

const coldStart=performance.now();
const fixture=await createStageFixture(options.stage);
if(fixture.rounds.length!==1)throw new Error('Profile requires a single-round stage');
const playerProto=options.team==='initial'?await createBootstrapPlayerProto():null;
const runtime=await createBootstrapRuntime();
const{ed,context}=runtime,round=fixture.rounds[0];
function runBattle(){
  const engine=new ed.BattleEngine();ed.battleEngine=engine;ed.srand(options.seed);
  const players=options.team==='mirror'?context.cc.clone(round.enemies):[context.cc.clone(playerProto)];
  engine.enterBattle(players,context.cc.clone(round.enemies),{mode:'stage',battle_id:round.battleId,localBot:true});
  let ticks=0;
  while(engine.running&&ticks<options.maxTicks){engine.tick();ticks++;}
  if(engine.running||!['victory','defeat','timeout'].includes(engine.result))throw new Error('Battle did not complete');
  const final={result:engine.result,ticks,engineTicks:bits(engine.ticks),rng:bits(context.random_seed),units:engine.unit_list.map(u=>({tid:u.tid,camp:u.camp,hp:bits(u.hp),mp:bits(u.mp),position:u.position.map(bits)}))};
  return{signature:createHash('sha256').update(JSON.stringify(final)).digest('hex'),ticks,final};
}
let reference;
for(let i=0;i<options.warmup;i++){
  const battle=runBattle();
  if(reference&&reference.signature!==battle.signature)throw new Error('Warmup nondeterminism');
  reference=battle;
}
const setupAndWarmupMs=performance.now()-coldStart;
const session=new Session();session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
await post('Profiler.enable');
await post('Profiler.setSamplingInterval',{interval:500});
await post('Profiler.start');
const started=performance.now();
let totalTicks=0;
for(let i=0;i<options.battles;i++){
  const battle=runBattle();
  if(battle.signature!==reference.signature)throw new Error(`Battle ${i} diverged from warmup`);
  totalTicks+=battle.ticks;
}
const wallMs=performance.now()-started;
const{profile}=await post('Profiler.stop');session.disconnect();
const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
const parents=new Map();
for(const n of profile.nodes)for(const child of n.children??[])parents.set(child,n.id);
const totals=new Map();
const identity=node=>`${node.callFrame.functionName||'(anonymous)'} @ ${node.callFrame.url||'(runtime)'}:${node.callFrame.lineNumber+1}:${node.callFrame.columnNumber+1}`;
function add(node,field,time){const key=identity(node);let t=totals.get(key);if(!t){t={function:node.callFrame.functionName||'(anonymous)',url:node.callFrame.url,line:node.callFrame.lineNumber+1,column:node.callFrame.columnNumber+1,selfMicros:0,inclusiveMicros:0};totals.set(key,t);}t[field]+=time;}
let sampledMicros=0;
for(let i=0;i<(profile.samples??[]).length;i++){
  const time=profile.timeDeltas?.[i]??0;
  const sample=nodes.get(profile.samples[i]);if(!sample)continue;
  sampledMicros+=time;add(sample,'selfMicros',time);
  let id=sample.id;const seen=new Set();
  while(id!==undefined){const n=nodes.get(id);const key=identity(n);if(!seen.has(key)){add(n,'inclusiveMicros',time);seen.add(key);}id=parents.get(id);}
}
const ranked=(field,sourceOnly)=>[...totals.values()].filter(n=>!sourceOnly||n.url.startsWith('src/')).sort((a,b)=>b[field]-a[field]).slice(0,25).map(n=>({...n,selfPercent:100*n.selfMicros/sampledMicros,inclusivePercent:100*n.inclusiveMicros/sampledMicros}));
const report={version:1,engine:'js-source-provisional-headless',validatedAgainstOriginalRuntime:false,options,setupAndWarmupMs,
  wallMs,profiledBattlesPerSecond:options.battles*1000/wallMs,totalTicks,samples:profile.samples.length,sampledMicros,
  signature:reference.signature,reference:reference.final,
  topSourceSelf:ranked('selfMicros',true),topSourceInclusive:ranked('inclusiveMicros',true),topAllSelf:ranked('selfMicros',false),
  notes:['Profiling starts after runtime source loading and battle warmup','Includes battle initialization, execution and final signature checks','Sampling introduces overhead; profiled throughput is not the benchmark throughput','Source URLs include original expression source offsets; line and column are relative to evaluated RHS expression',...runtime.limitations]};
await mkdir(resolve(root,'work'),{recursive:true});
await writeFile(resolve(root,'work/battles.cpuprofile'),JSON.stringify(profile));
await writeFile(resolve(root,'work/battle-profile.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({options,wallMs,profiledBattlesPerSecond:report.profiledBattlesPerSecond,signature:report.signature,topSourceSelf:report.topSourceSelf.slice(0,12),topAllSelf:report.topAllSelf.slice(0,8)},null,2));
