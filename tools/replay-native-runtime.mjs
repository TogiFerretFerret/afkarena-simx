import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports,compareHostInputConsumption} from './native-report-compare.mjs';
import {benchmarkMachine} from './benchmark-machine.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),sourceReport=args[0],name=args[1],separator=args.indexOf('--');
assert.ok(sourceReport&&name&&(separator===2||separator===4&&args[2]==='--diagnostic-vm-proof'),'Usage: node tools/replay-native-runtime.mjs <strict result.json> <name> [--diagnostic-vm-proof file] -- <runtime flags>');assert.match(name,/^[a-zA-Z0-9_-]+$/);
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=async p=>sha(await readFile(resolve(root,p))),baseline=JSON.parse(await readFile(resolve(root,sourceReport)));
assert.equal(baseline.semanticReportMatched,true);const binary=resolve(root,baseline.output??'work/native-warm23-'+(baseline.variant??(baseline.entityFastPathEnabled?'entity':'baseline')));assert.equal(await hash(binary),baseline.outputSha256);
const diagnosticVM=separator===4,hostFile=diagnosticVM?args[3]:baseline.hostProof.file;
assert.equal(await hash(baseline.hostProof.file),baseline.hostProof.sha256);
const host=JSON.parse(await readFile(resolve(root,hostFile)));assert.equal(host.passed,true);assert.equal(host.privateVM.originalSha256,baseline.originalVMSha256);assert.equal(await hash(host.privateVM.output),diagnosticVM?host.privateVM.privateSha256:baseline.privateVMSha256);
for(const [file,expected]of Object.entries(host.sources))assert.equal(await hash(file),expected);
for(const [file,row]of Object.entries(host.prerequisites??{}))assert.equal(await hash(file),row.sha256);
for(const row of baseline.units)assert.equal(await hash(row.object),row.objectSha256);
for(const row of baseline.dependenciesAtFinish){assert.equal(row.matched,true);assert.equal(await hash(row.file),row.sha256);}
for(const row of [baseline.reference,baseline.hostInputs])assert.equal(await hash(row.file),row.sha256);
const reference=JSON.parse(await readFile(baseline.reference.file)),machine=await benchmarkMachine(),directory=resolve(root,'work/native-runtime-replay');await mkdir(directory,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-'),prefix=resolve(directory,stamp+'-'+name),stdout=openSync(prefix+'.stdout','w'),stderr=openSync(prefix+'.stderr','w');
const runtimeArgs=['-Xhermes-internal-test-methods',...args.slice(separator+1)],environment={PATH:'/usr/bin:/bin',HOME:directory,LANG:'C',LD_LIBRARY_PATH:dirname(host.privateVM.output)};
const linkage=spawnSync('ldd',[binary],{cwd:root,env:environment,encoding:'utf8'});assert.equal(linkage.status,0);assert.ok(linkage.stdout.includes('libhermesvm.so => '+host.privateVM.output));await writeFile(prefix+'.ldd',linkage.stdout);
let peakSampledRSSKiB=0,peakKernelHighWaterRSSKiB=0,resourceSamples=0;
const start=performance.now();let execution;
try{execution=await new Promise((accept,reject)=>{
 const child=spawn(binary,runtimeArgs,{cwd:root,env:environment,stdio:['ignore',stdout,stderr]});let pending=false;
 const sample=async()=>{if(pending)return;pending=true;try{const status=await readFile('/proc/'+child.pid+'/status','utf8');peakSampledRSSKiB=Math.max(peakSampledRSSKiB,Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]??0));peakKernelHighWaterRSSKiB=Math.max(peakKernelHighWaterRSSKiB,Number(/VmHWM:\s+(\d+)/.exec(status)?.[1]??0));resourceSamples++;}catch{}finally{pending=false;}};
 const timer=setInterval(sample,250);sample();child.on('error',e=>{clearInterval(timer);reject(e);});child.on('exit',(code,signal)=>{clearInterval(timer);accept({code,signal});});
});}finally{closeSync(stdout);closeSync(stderr);}
const wallMs=performance.now()-start;let actual=null,difference=null;
try{actual=JSON.parse((await readFile(prefix+'.stdout','utf8')).trim().split('\n').at(-1));difference=compareNativeReports(actual,reference)??compareHostInputConsumption(actual.hostInputConsumption,baseline.hostInputs);}catch(e){difference={path:'$execution',message:e.message};}
const diagnosticText=await readFile(prefix+'.stderr','utf8'),classificationMatch=/empty_copy_classification:(\{[^\n]*\})/.exec(diagnosticText),copyClassification=classificationMatch?JSON.parse(classificationMatch[1]):null;
const diagnosticSucceeded=!diagnosticVM||!!copyClassification&&copyClassification.calls>0&&copyClassification.hits===baseline.fastPathHits.emptyCopy&&Object.values(copyClassification.categories).reduce((a,b)=>a+b,0)===copyClassification.calls;
const semanticReportMatched=execution.code===0&&difference===null,dependenciesAtFinish=[];
for(const row of baseline.dependenciesAtFinish)dependenciesAtFinish.push({...row,matched:await hash(row.file)===row.sha256});
assert.equal(await hash(binary),baseline.outputSha256);assert.equal(await hash(host.privateVM.output),host.privateVM.privateSha256);
const archivePrefix='benchmarks/results/'+stamp+'-native-runtime-'+name,artifacts=[];
for(const [label,file]of [['actual',prefix+'.stdout'],['stderr',prefix+'.stderr'],['reference',baseline.reference.file],['ldd',prefix+'.ldd']]){const bytes=await readFile(file),archive=archivePrefix+'.'+label+'.gz';await writeFile(resolve(root,archive),gzipSync(bytes,{level:9}));artifacts.push({file:archive,sha256:await hash(archive),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length});}
const result={version:1,name,diagnosticSucceeded,copyClassification,semanticReportMatched,firstDifference:difference,execution,runtimeArgs,environment,sourceReport:{file:sourceReport,sha256:await hash(sourceReport)},binary:{file:binary,sha256:baseline.outputSha256},diagnosticVM,hostProof:{file:hostFile,sha256:await hash(hostFile)},privateVM:{file:host.privateVM.output,sha256:host.privateVM.privateSha256},machine,resourceSamplingPeriodMs:250,resourceScope:'Maximum observed /proc VmRSS and cumulative VmHWM sampled every250ms; final subinterval can be missed.',gcBudgetScope:'GC allocation flags may delay the first old-generation collection until after this finite20battle window. First oldGC resets promotion mode; sustained throughput across multiple GC cycles is not established by this result.',peakSampledRSSKiB,peakKernelHighWaterRSSKiB,resourceSamples,completed:actual?.completed??0,measuredBattles:baseline.measuredBattles,warmupBattles:baseline.warmupBattles,elapsedMs:actual?.elapsedMs??null,battlesPerSecond:actual?.battlesPerSecond??null,wallMs,timingScope:baseline.timingScope,totalCallbacks:actual?.totalCallbacks??null,classManagerCounters:actual?.classManagerCounters??null,hostInputConsumption:actual?.hostInputConsumption??null,dependenciesAtFinish,artifacts,producer:{file:'tools/replay-native-runtime.mjs',sha256:await hash('tools/replay-native-runtime.mjs')},qualifiesFor10000Target:false,qualification:(diagnosticVM?'DIAGNOSTIC private VM counters enabled; timings do not establish a performance improvement. ':'')+'Same one fixed callback-only scenario, original source/binary/objects/helpers and strict full raw report; only explicitly recorded VM/runtime options differ. Complete random5v5 and actor/effect/view lifecycle qualification remain required.'};
await writeFile(resolve(root,archivePrefix+'.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file:archivePrefix+'.json',matched:semanticReportMatched,execution,completed:result.completed,elapsedMs:result.elapsedMs,battlesPerSecond:result.battlesPerSecond,wallMs,peakKernelHighWaterRSSKiB,difference}));if(!semanticReportMatched||!diagnosticSucceeded||dependenciesAtFinish.some(r=>!r.matched))process.exitCode=1;
