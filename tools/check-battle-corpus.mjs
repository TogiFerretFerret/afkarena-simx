import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve,relative } from 'node:path';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { createRealisticScenario,instantiateScenario } from './scenario-factory.mjs';
import { traceBattle } from './battle-trace-run.mjs';
import { createHostRandomTape } from './battle-trace.mjs';

const root=resolve(import.meta.dirname,'..');
const options={cases:3,seed:2026,hostSeed:2654435769,maxFrames:20000,strictGraph:0,output:'benchmarks/validation/battle-source-corpus.json'};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].replace(/^--/,'');if(!(key in options))throw new Error(`Unknown option: ${key}`);options[key]=key==='output'?process.argv[i+1]:Number(process.argv[i+1]);}
for(const key of ['cases','seed','maxFrames'])if(!Number.isSafeInteger(options[key])||options[key]<0)throw new Error(`Invalid ${key}`);
if(options.cases<1||options.maxFrames<1)throw new Error('Cases and maxFrames must be positive');
const sourceFiles=['src/srcmodule/game_battle.js','src/srcmodule/game_util.js','src/srcmodule/game_ui_1.js'];
const sourceSha256=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')])));
const hostEntropy=createHostRandomTape(options.hostSeed);
let clockObserver=null;
const runtime=await createBootstrapRuntime({hostRandom:hostEntropy.random,hostClock:{mode:'record',observe(entry,ordinal){clockObserver?.(entry,ordinal)}}});
if(!runtime.clock)throw new Error('Source corpus requires host-clock record/replay support');
const cases=[];
for(let i=0;i<options.cases;i++){
 const wire=await createRealisticScenario((options.seed+i)>>>0);
 const trace=await traceBattle(runtime,wire,{materialize:instantiateScenario,maxFrames:options.maxFrames,keepDeltas:true,strictGraph:Boolean(options.strictGraph),subscribeClock(observer){clockObserver=observer;return()=>{clockObserver=null}}});
 const path=resolve(root,`benchmarks/validation/battle-traces/source-seed-${wire.scenarioSeed}.json.gz`);
 await mkdir(resolve(path,'..'),{recursive:true});
 const bytes=gzipSync(JSON.stringify(trace));await writeFile(path,bytes);
 cases.push({scenarioSeed:wire.scenarioSeed,battleSeed:wire.battleSeed,inputSha256:wire.inputSha256,qualification:wire.qualification,
  status:trace.status,error:trace.error,result:trace.result,frames:trace.frames,eventCount:trace.events.length,rngDraws:trace.rngCount,callbacksExecuted:trace.callbackCount,
  hostRngDraws:trace.hostRngCount,
  artifact:relative(root,path),artifactSha256:createHash('sha256').update(bytes).digest('hex'),coverageLimitations:trace.coverage.limitations});
 if(trace.status!=='completed'){
  await writeFile(resolve(root,'benchmarks/validation/battle-source-first-failed-input.json'),JSON.stringify(wire,null,2)+'\n');break;
 }
}
const report={version:1,referenceRuntime:process.version,sourceSha256,options,cases,
 hostEntropy:{...hostEntropy.provenance,drawCount:hostEntropy.tape.length,tape:hostEntropy.tape},
 hostClock:{stats:runtime.clock.stats(),tape:runtime.clock.tape,provenance:runtime.clockProvenance},
 completedCases:cases.filter(c=>c.status==='completed').length,allRequestedCasesCompleted:cases.length===options.cases&&cases.every(c=>c.status==='completed'),
 fidelityGate:{passed:false,nativeWholeBattleCandidateCompared:false,throughputQualification:false,
  reasons:['This command records the source oracle corpus; no whole-battle native candidate trace is supplied','Actor/effect/view lifecycle outside the copied source callback phase remains an explicit adapter boundary','Native closure environments are opaque; execution events and observable state effects are retained']}};
const output=resolve(root,options.output);await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:relative(root,output),completedCases:report.completedCases,requestedCases:options.cases,events:cases.reduce((n,c)=>n+c.eventCount,0),fidelityGate:report.fidelityGate}));
if(!report.allRequestedCasesCompleted)process.exitCode=2;
