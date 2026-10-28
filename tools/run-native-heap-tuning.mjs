import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports,compareHostInputConsumption} from './native-report-compare.mjs';
import {benchmarkMachine} from './benchmark-machine.mjs';

// Runtime-only experiment: original game, generated objects, Rust kernels and
// private VM bytes are held fixed. An old-generation budget can merely defer
// collection; a short improvement is not a sustained-throughput qualification.
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),name=args[0];
assert.match(name??'',/^[a-zA-Z0-9_-]+$/);
assert.equal(args[1],'--','Usage: node tools/run-native-heap-tuning.mjs NAME -- [runtime flags]');
const baselineFile='benchmarks/results/2026-10-28T00-00-09.130Z-native-warm23-unit-speeder-battle.json';
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
const inputs=new Map();
async function pin(file,expected){const actual=await hash(file);if(expected)assert.equal(actual,expected,'Stale prerequisite '+file);inputs.set(file,actual);return JSON.parse(await readFile(resolve(root,file),'utf8'));}
const baseline=await pin(baselineFile);assert.equal(baseline.semanticReportMatched,true);
const build=await pin(baseline.cacheBuild.file,baseline.cacheBuild.sha256);
await pin(baseline.cacheSemanticProof.file,baseline.cacheSemanticProof.sha256);
await pin(baseline.cacheProof.file,baseline.cacheProof.sha256);
async function pinRaw(file,expected){const actual=await hash(file);assert.equal(actual,expected,'Changed input '+file);inputs.set(file,actual);}
await pinRaw(baseline.output,baseline.outputSha256);
await pinRaw(build.privateVM.output,baseline.privateVMSha256);
await pinRaw(baseline.reference.file,baseline.reference.sha256);
await pinRaw(baseline.hostInputs.file,baseline.hostInputs.sha256);
for(const [file,expected]of Object.entries(build.sources))await pinRaw(file,expected);
for(const row of Object.values(build.prerequisites))await pinRaw(row.file,row.sha256);
for(const row of Object.values(build.libraries))await pinRaw(row.path,row.sha256);
for(const row of baseline.dependenciesAtFinish){assert.equal(row.matched,true);await pinRaw(row.file,row.sha256);}
for(const row of baseline.units){await pinRaw(row.object,row.objectSha256);if(row.file)await pinRaw(row.file,row.sha256);if(row.cFile)await pinRaw(row.cFile,row.cSha256);}
const producer='tools/run-native-heap-tuning.mjs';inputs.set(producer,await hash(producer));
const directory=resolve(root,'work/native-heap-tuning');await mkdir(directory,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-'),prefix=resolve(directory,stamp+'-'+name);
const environment={PATH:'/usr/bin:/bin',HOME:directory,LANG:'C',LD_LIBRARY_PATH:dirname(build.privateVM.output)};
const ldd=spawnSync('ldd',[baseline.output],{cwd:root,env:environment,encoding:'utf8'});assert.equal(ldd.status,0);assert.ok(ldd.stdout.includes('libhermesvm.so => '+build.privateVM.output));
const machine=await benchmarkMachine(),runtimeArgs=['-Xhermes-internal-test-methods',...args.slice(2)];
const stdout=openSync(prefix+'.stdout','w'),stderr=openSync(prefix+'.stderr','w');
let peakRSSKiB=0,peakHighWaterRSSKiB=0,samples=0;
const start=performance.now();let execution;
try{execution=await new Promise((accept,reject)=>{
 const child=spawn(baseline.output,runtimeArgs,{cwd:root,env:environment,stdio:['ignore',stdout,stderr]});let pending=false;
 const sample=async()=>{if(pending)return;pending=true;try{const status=await readFile('/proc/'+child.pid+'/status','utf8');peakRSSKiB=Math.max(peakRSSKiB,Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]??0));peakHighWaterRSSKiB=Math.max(peakHighWaterRSSKiB,Number(/VmHWM:\s+(\d+)/.exec(status)?.[1]??0));samples++;}catch{}finally{pending=false;}};
 const timer=setInterval(sample,100);sample();child.on('error',e=>{clearInterval(timer);reject(e);});child.on('exit',(code,signal)=>{clearInterval(timer);accept({code,signal});});
});}finally{closeSync(stdout);closeSync(stderr);}
const wallMs=performance.now()-start,out=await readFile(prefix+'.stdout','utf8'),err=await readFile(prefix+'.stderr','utf8');
let actual=null,difference=null,runtimeDifference=null;
try{
 const reports=out.trim().split('\n').map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(row=>row&&typeof row==='object'&&row.completed===20&&row.totalCallbacks!==undefined);assert.equal(reports.length,1,'Exactly one complete battle report required');actual=reports[0];
 difference=compareNativeReports(actual,JSON.parse(await readFile(baseline.reference.file)))??compareHostInputConsumption(actual.hostInputConsumption,baseline.hostInputs);
 const counter=name=>Number(new RegExp('^'+name+':(\\d+)$','m').exec(err)?.[1]??NaN);
 const counters={unitSpeeder:counter('unit_speeder_hits'),copy:counter('copy_hits'),emptyCopy:counter('empty_copy_hits'),numericCopy:counter('numeric_copy_hits'),entity:counter('entity_hits'),sort:counter('sort_hits'),sortDefaultStrings:counter('sort_default_strings'),sortUnsupportedFallbacks:counter('sort_fallbacks')};
 assert.deepEqual(counters,baseline.fastPathHits,'All established fast paths must retain exact admission counts');
 for(const [prefix,expected]of [['global_slot_cache:',baseline.globalSlotCache],['global_slot_lifecycle:',baseline.globalSlotLifecycle],['global_ed_prefilter_active:',baseline.prefilterActive],['global_ed_prefilter:',baseline.prefilterCleared]]){const rows=err.split('\n').filter(line=>line.startsWith(prefix));assert.equal(rows.length,1);assert.deepEqual(JSON.parse(rows[0].slice(prefix.length)),expected,prefix);}
}catch(error){runtimeDifference={message:error.message};}
const inputsAtFinish=[];for(const[file,expected]of inputs)inputsAtFinish.push({file,sha256:expected,matched:await hash(file)===expected});
const matched=execution.code===0&&difference===null&&runtimeDifference===null&&inputsAtFinish.every(row=>row.matched);
const archivePrefix='benchmarks/results/'+stamp+'-native-heap-'+name,artifacts=[];
for(const[label,bytes]of [['actual',Buffer.from(out)],['stderr',Buffer.from(err)],['reference',await readFile(baseline.reference.file)],['ldd',Buffer.from(ldd.stdout)]]){const file=archivePrefix+'.'+label+'.gz';await writeFile(resolve(root,file),gzipSync(bytes,{level:9}));artifacts.push({label,file,sha256:await hash(file),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length});}
const result={version:1,name,semanticReportMatched:matched,firstDifference:difference,runtimeDifference,execution,runtimeArgs,environment,sourceReport:{file:baselineFile,sha256:inputs.get(baselineFile)},binary:{file:baseline.output,sha256:baseline.outputSha256},privateVM:{file:build.privateVM.output,sha256:baseline.privateVMSha256},machine,resourceSamplingPeriodMs:100,resourceSamples:samples,peakSampledRSSKiB:peakRSSKiB,peakKernelHighWaterRSSKiB:peakHighWaterRSSKiB,completed:actual?.completed??0,measuredBattles:20,warmupBattles:3,elapsedMs:actual?.elapsedMs??null,battlesPerSecond:actual?.battlesPerSecond??null,executionWallMs:wallMs,totalCallbacks:actual?.totalCallbacks??null,hostInputConsumption:actual?.hostInputConsumption??null,allEstablishedFastPathsMatched:runtimeDifference===null,inputsAtFinish,artifacts,producer:{file:producer,sha256:inputs.get(producer)},qualifiesFor10000Target:false,scope:'Runtime-options-only experiment on the unchanged Rust-integrated native core. One frozen callback-only fixture, 20 measured battles after three warmups. All raw source report fields except timings, explicit host clock/RNG consumption, fast-path counts, cache counters and lifecycle are required to match. Larger budgets may defer GC beyond this finite window; sustained throughput across GC cycles and full-scene/random corpus fidelity are not established.'};
await writeFile(resolve(root,archivePrefix+'.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file:archivePrefix+'.json',matched,difference,runtimeDifference,elapsedMs:result.elapsedMs,battlesPerSecond:result.battlesPerSecond,executionWallMs:wallMs,peakRSSKiB,peakHighWaterRSSKiB}));if(!matched)process.exitCode=1;
