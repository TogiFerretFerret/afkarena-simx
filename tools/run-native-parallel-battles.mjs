import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openSync,closeSync,writeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports,compareHostInputConsumption,firstDifference} from './native-report-compare.mjs';
import {benchmarkMachine} from './benchmark-machine.mjs';
const root=resolve(import.meta.dirname,'..'),option=(flag,fallback)=>process.argv.includes(flag)?process.argv[process.argv.indexOf(flag)+1]:fallback;
const workers=Number(option('--workers','2'));assert.ok(Number.isSafeInteger(workers)&&workers>=1&&workers<=4);
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
const preparedFile='benchmarks/validation/native-current-measured-profile-prepared.json',buildFile='benchmarks/validation/native-current-measured-profile-build.json';
const prepared=JSON.parse(await readFile(resolve(root,preparedFile))),build=JSON.parse(await readFile(resolve(root,buildFile)));
const strict=JSON.parse(await readFile(resolve(root,prepared.strictBaseline.file)));
const profileFile='benchmarks/results/2026-10-28T15-13-33.840Z-native-perf-current-rust-speeder-measured.json';
const profile=JSON.parse(await readFile(resolve(root,profileFile)));assert.equal(profile.semanticReportMatched,true);assert.equal(profile.candidateRuntimeGate.passed,true);assert.equal(profile.binary.sha256,prepared.outputSha256);
assert.equal(strict.semanticReportMatched,true);assert.equal(await hash(prepared.strictBaseline.file),prepared.strictBaseline.sha256);
assert.equal(await hash(prepared.output),prepared.outputSha256);assert.equal(await hash(build.privateVM.output),prepared.privateVMSha256);
assert.equal(await hash(buildFile),prepared.hostProof.sha256);assert.equal(build.privateVM.privateSha256,prepared.privateVMSha256);
const bindings=new Map([[preparedFile,await hash(preparedFile)],[buildFile,await hash(buildFile)],[profileFile,await hash(profileFile)],['tools/run-native-parallel-battles.mjs',await hash('tools/run-native-parallel-battles.mjs')],['tools/native-parallel-barrier.c',await hash('tools/native-parallel-barrier.c')],['tools/native-report-compare.mjs',await hash('tools/native-report-compare.mjs')]]);
for(const [file,expected]of Object.entries(build.sources)){assert.equal(await hash(file),expected,'Stale native source '+file);bindings.set(file,expected);}
for(const unit of prepared.units){assert.equal(await hash(unit.object),unit.objectSha256);assert.equal(await hash(unit.file),unit.sha256);bindings.set(unit.object,unit.objectSha256);bindings.set(unit.file,unit.sha256);}
for(const row of prepared.dependenciesAtFinish){assert.equal(row.matched,true);assert.equal(await hash(row.file),row.sha256);bindings.set(row.file,row.sha256);}
for(const row of [prepared.reference,prepared.hostInputs]){assert.equal(await hash(row.file),row.sha256);bindings.set(row.file,row.sha256);}
for(const row of Object.values(build.libraries)){assert.equal(await hash(row.path),row.sha256);bindings.set(row.path,row.sha256);}
for(const [file,digest]of [[prepared.output,prepared.outputSha256],[build.privateVM.output,prepared.privateVMSha256],[build.helper.file,build.helper.sha256]]){assert.equal(await hash(file),digest);bindings.set(file,digest);}
const directory=resolve(root,'work/native-parallel-battles');await mkdir(directory,{recursive:true});
const shim=resolve(directory,'barrier.so'),compileArgs=['-shared','-fPIC','-O2','-Wall','-Wextra','-Werror','tools/native-parallel-barrier.c','-ldl','-o',shim];
const compile=spawnSync('cc',compileArgs,{cwd:root,encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);const shimSha256=await hash(shim);
const contentionSnapshot=async()=>({at:new Date().toISOString(),processes:spawnSync('ps',['-eo','pid,ppid,comm,pcpu,rss'],{encoding:'utf8'}).stdout,cpuStat:await readFile('/sys/fs/cgroup/cpu.stat','utf8'),loadAverage:await readFile('/proc/loadavg','utf8')});
const contentionBefore=await contentionSnapshot();
const machine=await benchmarkMachine(),reference=JSON.parse(await readFile(resolve(root,prepared.reference.file))),runtimeArgs=['-Xhermes-internal-test-methods'];
const environment={PATH:'/usr/bin:/bin',HOME:resolve(root,'work'),LANG:'C',LD_LIBRARY_PATH:dirname(build.privateVM.output),LD_PRELOAD:shim};
const stamp=new Date().toISOString().replaceAll(':','-'),prefix='benchmarks/results/'+stamp+'-native-parallel-'+workers+'-workers';
const states=[],wholeStart=process.hrtime.bigint();let cohortStart=null,executionError=null;
function launch(index){
 const stdout=resolve(directory,stamp+'.worker'+index+'.stdout'),stderr=resolve(directory,stamp+'.worker'+index+'.stderr');
 const out=openSync(stdout,'w'),err=openSync(stderr,'w'),child=spawn(prepared.output,runtimeArgs,{cwd:root,env:environment,stdio:['ignore',out,'pipe','pipe','pipe']});closeSync(out);
 const state={index,pid:child.pid,stdout,stderr,ready:false,readyAt:null,endArrival:null,releaseNs:null,startNs:null,endNs:null,protocolError:null,child,pending:'',errFd:err};states.push(state);
 let readyResolve,readyReject;state.readyPromise=new Promise((accept,reject)=>{readyResolve=accept;readyReject=reject;});
 child.stdio[4].on('data',bytes=>{if(state.ready||bytes.toString()!=='R'){state.protocolError='Unexpected barrier READY bytes';readyReject(Error(state.protocolError));return;}state.ready=true;state.readyAt=process.hrtime.bigint();readyResolve();});
 child.stderr.on('data',bytes=>{
  writeSync(err,bytes);state.pending+=bytes.toString();let next;
  while((next=state.pending.indexOf('\n'))>=0){const line=state.pending.slice(0,next);state.pending=state.pending.slice(next+1);
   const end=/^simx_measure_end_ns:(\d+)$/.exec(line);if(end){if(state.endArrival!==null)state.protocolError='Duplicate end marker';state.endArrival=process.hrtime.bigint();state.endNs=end[1];}
   const start=/^simx_measure_start_ns:(\d+)$/.exec(line);if(start){if(state.startNs!==null)state.protocolError='Duplicate start marker';state.startNs=start[1];}
   const release=/^simx_parallel_release_ns:(\d+)$/.exec(line);if(release){if(state.releaseNs!==null)state.protocolError='Duplicate release marker';state.releaseNs=release[1];}
  }
 });
 state.exitPromise=new Promise(accept=>{child.on('error',error=>{state.protocolError=error.message;readyReject(error);});child.on('close',(code,signal)=>{closeSync(err);state.execution={code,signal};if(!state.ready)readyReject(Error('Worker exited before READY: '+index));accept();});});
 return state;
}
const timeout=setTimeout(()=>{executionError='Worker cohort exceeded 180 seconds';for(const s of states)s.child.kill('SIGTERM');},180000);
try{for(let i=0;i<workers;i++)launch(i);await Promise.all(states.map(s=>s.readyPromise));cohortStart=process.hrtime.bigint();for(const state of states)state.child.stdio[3].end('G');await Promise.all(states.map(s=>s.exitPromise));}catch(error){executionError=error.message;for(const state of states)state.child.kill('SIGTERM');await Promise.all(states.map(s=>s.exitPromise));}finally{clearTimeout(timeout);}
const wholeEnd=process.hrtime.bigint(),contentionAfter=await contentionSnapshot(),results=[],artifacts=[];
for(const state of states){
 let actual=null,difference=null,fastPathHits=null,cache=null,lifecycle=null,prefilterActive=null,prefilterCleared=null;const stderr=await readFile(state.stderr,'utf8');
 try{
  actual=JSON.parse((await readFile(state.stdout,'utf8')).trim().split('\n').at(-1));difference=compareNativeReports(actual,reference)??compareHostInputConsumption(actual.hostInputConsumption,prepared.hostInputs);
  const counter=name=>Number(new RegExp(name+':(\\d+)').exec(stderr)?.[1]??0),json=prefix=>{const rows=stderr.split(/\r?\n/).filter(line=>line.startsWith(prefix));assert.equal(rows.length,1);return JSON.parse(rows[0].slice(prefix.length));};
  fastPathHits={unitSpeeder:counter('unit_speeder_hits'),copy:counter('copy_hits'),emptyCopy:counter('empty_copy_hits'),numericCopy:counter('numeric_copy_hits'),entity:counter('entity_hits'),sort:counter('sort_hits'),sortDefaultStrings:counter('sort_default_strings'),sortUnsupportedFallbacks:counter('sort_fallbacks')};
  cache=json('global_slot_cache:');lifecycle=json('global_slot_lifecycle:');prefilterActive=json('global_ed_prefilter_active:');prefilterCleared=json('global_ed_prefilter:');
  difference??=firstDifference(fastPathHits,strict.fastPathHits,'$.fastPathHits')??firstDifference(cache,strict.globalSlotCache,'$.globalSlotCache')??firstDifference(lifecycle,strict.globalSlotLifecycle,'$.lifecycle')??firstDifference(prefilterActive,strict.prefilterActive,'$.prefilterActive')??firstDifference(prefilterCleared,strict.prefilterCleared,'$.prefilterCleared');
 }catch(error){difference??={path:'$execution',message:error.message};}
 const markersMatched=state.ready&&state.startNs!==null&&state.releaseNs!==null&&state.endNs!==null&&state.endArrival!==null&&BigInt(state.startNs)<=BigInt(state.releaseNs)&&BigInt(state.releaseNs)<BigInt(state.endNs)&&state.readyAt<=cohortStart&&cohortStart<state.endArrival;
 const matched=state.execution?.code===0&&!state.protocolError&&!difference&&markersMatched&&actual?.completed===20;
 results.push({index:state.index,pid:state.pid,execution:state.execution,matched,difference,protocolError:state.protocolError,markersMatched,completed:actual?.completed??0,callbacks:actual?.totalCallbacks??null,hostInputConsumption:actual?.hostInputConsumption??null,fastPathHits,cache,lifecycle,prefilterActive,prefilterCleared,readyAtParentNs:state.readyAt?.toString()??null,endMarkerArrivalParentNs:state.endArrival?.toString()??null,workerClock:{startBeforeBarrierNs:state.startNs,releaseNs:state.releaseNs,endNs:state.endNs},workerReportedElapsedMs:actual?.elapsedMs??null,workerReportedBattlesPerSecond:actual?.battlesPerSecond??null,workerTimingExcludedFromAggregate:true});
 for(const [label,file]of [['stdout',state.stdout],['stderr',state.stderr]]){const raw=await readFile(file),archive=prefix+'.worker'+state.index+'.'+label+'.gz';await writeFile(resolve(root,archive),gzipSync(raw,{level:9}));artifacts.push({worker:state.index,label,file:archive,sha256:await hash(archive),uncompressedSha256:sha(raw),uncompressedBytes:raw.length});}
}
const bindingsAtFinish=[];for(const [file,expected]of bindings){const actual=await hash(file);bindingsAtFinish.push({file,sha256:expected,matched:actual===expected});}
assert.equal(await hash(shim),shimSha256);
const passed=!executionError&&results.length===workers&&results.every(r=>r.matched)&&bindingsAtFinish.every(r=>r.matched);
const allEnd=states.every(s=>s.endArrival!==null),cohortEnd=allEnd?states.reduce((end,s)=>s.endArrival>end?s.endArrival:end,0n):null;
const cohortWallMs=cohortStart!==null&&cohortEnd!==null?Number(cohortEnd-cohortStart)/1e6:null;
const completed=results.reduce((sum,r)=>sum+r.completed,0),report={version:1,timingStatus:'PROVISIONAL_CONTENDED',contentionPolicy:'User authorized concurrent benchmark work for faster iteration. Other native experiments or compilation may overlap; these timings do not establish an uncontended speedup.',contentionBefore,contentionAfter,passed,semanticReportMatched:passed,executionError,workers,completed,measuredBattlesPerWorker:20,warmupBattlesPerWorker:3,cohortStartParentNs:cohortStart?.toString()??null,cohortEndParentNs:cohortEnd?.toString()??null,cohortWallMs,aggregateBattlesPerSecond:passed?completed/(cohortWallMs/1000):null,wholeCohortWallMs:Number(wholeEnd-wholeStart)/1e6,timingScope:'Parent monotonic clock immediately before release of all READY workers through arrival of the final worker benchmark END marker. Includes release IPC and marker arrival/event-loop delay; excludes all initialization, three warmups per worker and final report. Individual worker timing includes barrier wait and is never used for aggregate rate.',runtimeIsolation:'One OS process and independent Runtime/TLS/clock/RNG/mutable battle heap per worker. Only executable/shared-library read-only pages are naturally shared by the OS; immutable battle configuration is not claimed to be shared across heaps.',machine,environment,runtimeArgs,results,artifacts,prepared:{file:preparedFile,sha256:bindings.get(preparedFile)},baseline:{file:prepared.strictBaseline.file,sha256:prepared.strictBaseline.sha256},profileEvidence:{file:profileFile,sha256:bindings.get(profileFile)},allSevenObjectsAndGameFunctionsUnchanged:true,privateVMUnchanged:true,shim:{source:'tools/native-parallel-barrier.c',sourceSha256:bindings.get('tools/native-parallel-barrier.c'),output:shim,sha256:shimSha256,compileArgs},bindingsAtFinish,producer:{file:'tools/run-native-parallel-battles.mjs',sha256:bindings.get('tools/run-native-parallel-battles.mjs')},qualifiesFor10000Target:false,qualification:'One frozen callback-only fixture replayed independently in parallel workers. Every worker must pass complete raw source reports, callback/RNG/host inputs, exact old/new fast-path counters and runtime cleanup. This is aggregate measured-work throughput, not a full-scene/random-corpus or 10000 faithful battles/second qualification.'};
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',passed,workers,completed,cohortWallMs,aggregateBattlesPerSecond:report.aggregateBattlesPerSecond,wholeCohortWallMs:report.wholeCohortWallMs,differences:results.filter(r=>!r.matched).map(r=>({index:r.index,difference:r.difference,protocolError:r.protocolError,markers:r.markersMatched}))}));if(!passed)process.exitCode=1;
