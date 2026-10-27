import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runInContext} from 'node:vm';
import {parse} from '@babel/parser';
import assert from 'node:assert/strict';
import {createBootstrapRuntime} from './bootstrap-runtime.mjs';
import {instantiateScenario} from './scenario-factory.mjs';
import {compareNativeReports} from './native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=b=>createHash('sha256').update(b).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1],...process.argv.slice(2)],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(child.status??1);}
await mkdir(directory,{recursive:true});
const baselineFile='benchmarks/results/2026-10-27T21-55-08.845Z-native-warm23-no-proxy.json',baseline=JSON.parse(await readFile(resolve(root,baselineFile)));
assert.equal(baseline.semanticReportMatched,true);
const manifest=JSON.parse(await readFile(resolve(root,baseline.sourceManifest.file))),metadata=JSON.parse(await readFile(manifest.input.file+'.metadata.json'));
const allInputs=JSON.parse(await readFile(metadata.hostInputs.file));assert.equal(allInputs.clock.length,23*260);
const tape={...allInputs,clock:allInputs.clock.slice(0,260)};
await writeFile(resolve(directory,'host-inputs.json'),JSON.stringify(tape)+'\n');
const wire=JSON.parse(await readFile(metadata.scenario.file));
const emitter=await readFile(resolve(root,'tools/emit-native-oracle.mjs'),'utf8'),tree=parse(emitter,{sourceType:'module'});
const names=['__nativeBits','__nativePrimitiveState','__nativeUnitState','__nativeRun'];
const helpers=names.map(name=>{const node=tree.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return emitter.slice(node.start,node.end);});
const runBattle=new Function('instantiateScenario',helpers.join('\n')+'\nreturn __nativeRun;')(instantiateScenario);
const helperFile='tools/battle-boundary-state-trace.js',helper=await readFile(resolve(root,helperFile),'utf8');
async function reference(traced){
 let randomIndex=0,trace=null,clockObserver=null;
 const runtime=await createBootstrapRuntime({eagerBattle:true,observeClassManager:true,hostRandom(){assert.ok(randomIndex<tape.random.length);const ordinal=randomIndex,value=tape.random[randomIndex++];if(trace)trace.record('host:random',{ordinal,value});return value;},hostClock:{mode:'replay',tape:tape.clock,observe(entry,ordinal){if(clockObserver)clockObserver(entry,ordinal);}}});
 if(traced){
  runInContext(helper,runtime.context,{filename:helperFile});
  runtime.context.__boundaryRuntime=runtime;
  runtime.context.__boundaryOptions={digest:sha,onProgress:p=>process.stderr.write(JSON.stringify({status:'boundary_trace_progress',...p})+'\n'),subscribeClock(observer){clockObserver=observer;return()=>clockObserver=null;}};
  try{trace=runInContext('installBattleBoundaryStateTrace(__boundaryRuntime,__boundaryOptions)',runtime.context);runtime.nativeTrace=trace;}
  finally{delete runtime.context.__boundaryRuntime;delete runtime.context.__boundaryOptions;}
 }
 const report=runBattle(runtime,wire,1,0,Date.now,'final');runtime.clock.finish();assert.equal(randomIndex,tape.random.length);
 report.hostInputConsumption={random:randomIndex,clock:runtime.clock.stats()};
 return report;
}
const untraced=await reference(false);
await writeFile(resolve(directory,'source-untraced.json'),JSON.stringify(untraced)+'\n');
const traced=await reference(true),withoutTrace={...traced};delete withoutTrace.trace;
const difference=compareNativeReports(withoutTrace,untraced);
await writeFile(resolve(directory,'source-traced.json'),JSON.stringify(traced)+'\n');
const proof={version:1,passed:difference===null,scope:'Independent original-source runtime executes one entire frozen callback-only battle with and without new boundary tracing. Every terminal report field except timing is compared; trace is separately retained. This is not a full-program trace or a native differential result.',qualifiesFor10000Target:false,difference,completed:traced.completed,events:traced.trace.events.length,snapshots:traced.trace.snapshots.length,rootContract:traced.trace.rootContract,sourceHelper:{file:helperFile,sha256:sha(helper)},baseline:{file:baselineFile,sha256:sha(await readFile(resolve(root,baselineFile)))},oracleProfile:profile,hostInputs:{file:resolve(directory,'host-inputs.json'),sha256:sha(await readFile(resolve(directory,'host-inputs.json'))),clockCount:tape.clock.length,randomCount:tape.random.length},helpers:names.map((name,i)=>({name,sha256:sha(helpers[i])})),scenario:metadata.scenario,reports:{untraced:resolve(directory,'source-untraced.json'),traced:resolve(directory,'source-traced.json')}};
await writeFile(resolve(directory,'source-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof));assert.equal(difference,null,'Tracing changed a terminal source report field');
