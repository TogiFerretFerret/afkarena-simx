import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports,compareHostInputConsumption} from './native-report-compare.mjs';
import {benchmarkMachine} from './benchmark-machine.mjs';
const root=resolve(import.meta.dirname,'..'),reportFile=process.argv[2];
assert.ok(reportFile,'Usage: node tools/profile-native-candidate.mjs <strict native result.json>');
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=async p=>sha(await readFile(resolve(root,p)));
const baseline=JSON.parse(await readFile(resolve(root,reportFile))),measured=baseline.kind==='profiling-prepared-wrapper';
if(measured){
 assert.equal(baseline.profilingOnly,true);assert.equal(baseline.semanticReportMatched,null);assert.equal(baseline.allSevenObjectsReused,true);
 assert.equal(await hash(baseline.strictBaseline.file),baseline.strictBaseline.sha256);const original=JSON.parse(await readFile(resolve(root,baseline.strictBaseline.file)));assert.equal(original.semanticReportMatched,true);
 assert.deepEqual(baseline.units.map(u=>[u.object,u.objectSha256]),original.units.map(u=>[u.object,u.objectSha256]));assert.equal(await hash(baseline.output+'.main.c'),baseline.wrapperSha256);
 assert.equal(await hash(baseline.producer.file),baseline.producer.sha256);assert.equal(await hash(baseline.initializerSource.file),baseline.initializerSource.sha256);
 assert.equal(baseline.markerClock,'CLOCK_MONOTONIC');assert.equal(baseline.perfClockId,'mono');
}else assert.equal(baseline.semanticReportMatched,true);
assert.equal(baseline.qualifiesFor10000Target,false);
const binary=resolve(baseline.output??'work/native-warm23-'+(baseline.variant??(baseline.entityFastPathEnabled?'entity':'baseline')));assert.equal(await hash(binary),baseline.outputSha256);
const host=JSON.parse(await readFile(resolve(root,baseline.hostProof.file)));assert.equal(await hash(baseline.hostProof.file),baseline.hostProof.sha256);
assert.equal(await hash(host.privateVM.output),baseline.privateVMSha256);
let markerGuardProof=null;
if(measured){
 const file='benchmarks/validation/native-measured-clock.json',proof=JSON.parse(await readFile(resolve(root,file)));assert.equal(proof.passed??proof.matched,true);
 assert.equal(proof.productionClockBuild.file,baseline.hostProof.file);assert.equal(proof.productionClockBuild.sha256,baseline.hostProof.sha256);
 for(const [source,expected]of Object.entries(proof.sources))assert.equal(await hash(source),expected,'Stale directed clock proof: '+source);
 markerGuardProof={file,sha256:await hash(file),productionBuildMatched:true};
}
for(const u of baseline.units)assert.equal(await hash(u.object),u.objectSha256);
for(const row of baseline.dependenciesAtFinish){assert.equal(row.matched,true);assert.equal(await hash(row.file),row.sha256);}
assert.equal(await hash(baseline.reference.file),baseline.reference.sha256);assert.equal(await hash(baseline.hostInputs.file),baseline.hostInputs.sha256);
const reference=JSON.parse(await readFile(baseline.reference.file));
const perf=resolve(root,'work/downloads/perf/perf'),bootstrap='benchmarks/validation/native-profiler-bootstrap.json';
const bootstrapSha256=await hash(bootstrap),perfWrapperSha256=await hash(perf),perfExecutableSha256=await hash('work/downloads/perf/usr/bin/perf');
const directory=resolve(root,'work/native-perf'),home=resolve(directory,'empty-home');await mkdir(home,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-'),prefix=resolve(directory,stamp),data=prefix+'.data';
// DWARF stack samples can include the process's initial environment strings.
// Whitelist the PERF process environment itself; its child inherits only this.
const environment={PATH:'/usr/bin:/bin',HOME:home,LANG:'C',LD_LIBRARY_PATH:dirname(host.privateVM.output)};
async function run(args,label){const out=openSync(prefix+'.'+label+'.stdout','w'),err=openSync(prefix+'.'+label+'.stderr','w');try{return await new Promise((accept,reject)=>{const c=spawn(perf,args,{cwd:root,env:environment,stdio:['ignore',out,err]});c.on('error',reject);c.on('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}}
const machine=await benchmarkMachine(),args=['record',...(measured?['--clockid','mono']:[]),'-e','cpu-clock:u','-F','49','--call-graph','dwarf,16384','-o',data,'--',binary,'-Xhermes-internal-test-methods'];
const start=performance.now(),execution=await run(args,'record'),wallMs=performance.now()-start;
let actual=null,difference=null;try{actual=JSON.parse((await readFile(prefix+'.record.stdout','utf8')).trim().split('\n').at(-1));difference=compareNativeReports(actual,reference)??compareHostInputConsumption(actual.hostInputConsumption,baseline.hostInputs);}catch(e){difference={path:'$execution',message:e.message};}
const reports=[];
if(execution.code===0){
 for(const [label,options]of [['leaf',['report','--stdio','--no-children','--sort','dso,symbol','--percent-limit','0.1','--call-graph','none']],['inclusive',['report','--stdio','--children','--sort','dso,symbol','--percent-limit','0.5','--call-graph','graph,0.5,caller']],['stacks',['script','--ns','--show-mmap-events','-F','comm,pid,tid,time,event,ip,sym,symoff,dso,dsoff']],['buildids',['buildid-list']]])reports.push({label,args:[...options,'-i',data],...(await run([...options,'-i',data],label))});
}
assert.equal(await hash(binary),baseline.outputSha256);assert.equal(await hash(host.privateVM.output),baseline.privateVMSha256);
const dataBytes=await stat(data).then(s=>s.size).catch(()=>0);
const recordStderr=await readFile(prefix+'.record.stderr','utf8'),sampleMatch=/\(([\d,]+) samples\)/.exec(recordStderr);
const sampleCount=sampleMatch?Number(sampleMatch[1].replaceAll(',','')):null;
let measuredWindow=null;
if(measured){const markers=recordStderr.split(/\r?\n/).filter(line=>line.startsWith('simx_measure_')),start=/^simx_measure_start_ns:(\d+)$/.exec(markers[0]??''),end=/^simx_measure_end_ns:(\d+)$/.exec(markers[1]??'');measuredWindow={startNs:start?.[1]??null,endNs:end?.[1]??null,calls:markers.length,valid:markers.length===2&&!!start&&!!end&&BigInt(end[1])>BigInt(start[1])};}
const profileSucceeded=execution.code===0&&dataBytes>0&&reports.length===4&&reports.every(r=>r.code===0)&&(sampleCount===null||sampleCount>0)&&(!measured||measuredWindow.valid);
const archivePrefix='benchmarks/results/'+stamp+'-native-perf-'+baseline.variant,artifacts=[];
for(const [label,file]of [['record-stdout',prefix+'.record.stdout'],['record-stderr',prefix+'.record.stderr'],...reports.flatMap(r=>[[r.label,prefix+'.'+r.label+'.stdout'],[r.label+'-stderr',prefix+'.'+r.label+'.stderr']]),...(dataBytes>0?[['data',data]]:[])]){
 const bytes=await readFile(file),compressed=gzipSync(bytes,{level:9});
 // Independent chunks stay below GitHub's per-blob limit even for raw DWARF data.
 const chunks=[];for(let offset=0;offset<compressed.length;offset+=24*1024*1024){const chunk=compressed.subarray(offset,offset+24*1024*1024),path=archivePrefix+'.'+label+(compressed.length>24*1024*1024?'.'+String(chunks.length).padStart(3,'0'):'')+'.gz';await writeFile(resolve(root,path),chunk);chunks.push({file:path,sha256:sha(chunk),bytes:chunk.length});}
 artifacts.push({label,compression:'gzip; concatenate chunks before decompressing',chunks,compressedSha256:sha(compressed),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length});
}
const result={version:1,markerGuardProof,markerClock:measured?'CLOCK_MONOTONIC':null,perfClockId:measured?'mono':null,measuredWindow,profileSucceeded,sampleCount,dataBytes,kind:'Native user CPU-clock sampling diagnostic',semanticReportMatched:execution.code===0&&difference===null,firstDifference:difference,execution,wallMs,profileScope:(measured?'Exact measured-window marker boundaries are included; raw profile covers the whole process. ':'')+'Entire original process: cold VM/script/table initialization, three warmup battles, twenty measured battles, final capture and report. Sampling affects timing; no throughput or speedup claim.',sampleFrequencyHz:49,callGraph:'DWARF,16384byte stack samples',sourceReport:{file:reportFile,sha256:await hash(reportFile)},binary:{file:binary,sha256:baseline.outputSha256},privateVM:{file:host.privateVM.output,sha256:baseline.privateVMSha256},bootstrap:{file:bootstrap,sha256:bootstrapSha256},perf:{file:perf,wrapperSha256:perfWrapperSha256,executableSha256:perfExecutableSha256},environmentPolicy:'Only explicit environment below is passed to PERF and inherited by its native child; no parent process.env, credentials, proxy settings or tokens are passed.',environment,args,reports,machine,completed:actual?.completed??0,totalCallbacks:actual?.totalCallbacks??null,artifacts,producer:{file:'tools/profile-native-candidate.mjs',sha256:await hash('tools/profile-native-candidate.mjs')},qualifiesFor10000Target:false};
await writeFile(resolve(root,archivePrefix+'.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file:archivePrefix+'.json',matched:result.semanticReportMatched,profileSucceeded,sampleCount,execution,wallMs,difference,artifactBytes:artifacts.map(a=>({label:a.label,bytes:a.uncompressedBytes}))}));if(!result.semanticReportMatched||!profileSucceeded)process.exitCode=1;
