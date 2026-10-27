import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports,compareHostInputConsumption,semanticNativeReport} from './native-report-compare.mjs';
import {benchmarkMachine} from './benchmark-machine.mjs';

// No compiler/emitter rerun: all seven independently checked NoProxy objects
// are reused byte-for-byte. Build-only cache evidence is deliberately insufficient.
const root=resolve(import.meta.dirname,'..');
const baselineFile='benchmarks/results/2026-10-27T21-55-08.845Z-native-warm23-no-proxy.json';
const variant='dictionary-lease';
const buildFile='benchmarks/validation/native-'+variant+'-build.json';
const semanticFile='benchmarks/validation/native-'+variant+'.json';
const previousHintFile='benchmarks/results/2026-10-27T22-53-56.831Z-native-warm23-dictionary-hint.json';
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=async p=>sha(await readFile(resolve(root,p)));
const semanticProofSha256=await hash(semanticFile),previousHint=JSON.parse(await readFile(resolve(root,previousHintFile)));
assert.equal(previousHint.semanticReportMatched,true);
const baseline=JSON.parse(await readFile(resolve(root,baselineFile))),build=JSON.parse(await readFile(resolve(root,buildFile))),proof=JSON.parse(await readFile(resolve(root,semanticFile)));
assert.equal(baseline.semanticReportMatched,true);assert.equal(baseline.performanceOnly,true);assert.equal(baseline.instrumentationOff,true);
assert.equal(proof.passed,true,'Directed native semantics must pass before a battle run');
assert.equal(proof.emptyGuardTested,true);assert.equal(proof.originalClassDefinitionsUnchanged,true);
assert.equal(proof.noPerReadSharedRefcounts,true);assert.equal(proof.sameMutatorThreadRequired,true);
const interleaved=proof.interleavedRuntimeProof;assert.equal(interleaved.passed,true);assert.equal(interleaved.runtimes,2);assert.ok(interleaved.interleavedChecks>=20000);assert.ok(interleaved.adoptionChecks>=20000);assert.equal(interleaved.boundedLiveContexts,1);
for(const key of ['bothSourceReportsMatched','secondRuntimeOriginalFallback','deadOwnerCleared','automaticShutdownRelease','releaseDeadIdempotent','releaseWhileAliveRejected','adoptionRetiredOldLease'])assert.equal(interleaved[key],true,key+' not proved');
assert.equal(proof.untouchedNativeMatched,true);assert.equal(proof.nodeMatched,true);assert.ok(proof.iterations>=8);assert.ok(proof.mutationCasesPerIteration>=20000);
for(const [file,expected]of Object.entries(proof.sources))assert.equal(await hash(file),expected,'Stale directed proof '+file);
assert.equal(proof.buildProof.file,buildFile);assert.equal(proof.buildProof.sha256,await hash(buildFile));
assert.equal(await hash(baseline.output),baseline.outputSha256);
assert.equal(await hash(build.privateVM.output),build.privateVM.privateSha256);
assert.equal(build.privateVM.originalSha256,baseline.originalVMSha256);
assert.equal(await hash(build.wrapper.output),build.wrapper.sha256);
for(const [file,expected]of Object.entries(build.sources))assert.equal(await hash(file),expected,'Stale native source '+file);
for(const row of Object.values(build.headers))assert.equal(await hash(row.original),row.originalSha256,'Original VM header changed');
for(const [file,row]of Object.entries(build.prerequisites))assert.equal(await hash(file),row.sha256);
for(const row of Object.values(build.libraries))assert.equal(await hash(row.path),row.sha256);
for(const unit of baseline.units){assert.equal(await hash(unit.object),unit.objectSha256);assert.equal(await hash(unit.file),unit.sha256);}
const dependencies=baseline.dependenciesAtFinish.map(({file,sha256,matched})=>{assert.equal(matched,true);return{file,sha256};});
for(const row of dependencies)assert.equal(await hash(row.file),row.sha256);
for(const row of [baseline.reference,baseline.hostInputs])assert.equal(await hash(row.file),row.sha256);
const output=resolve(root,'work/native-no-proxy-'+variant),oldWrapper=await readFile(baseline.output+'.main.c','utf8');assert.equal(sha(oldWrapper),baseline.wrapperSha256);
let wrapper=oldWrapper.replace('int main(int argc,char **argv){','extern bool simx_dictionary_lease_init(SHRuntime*),simx_dictionary_lease_release_dead(void);\nextern void simx_dictionary_lease_dump(SHRuntime*),simx_dictionary_lease_lifecycle_dump(void);\nint main(int argc,char **argv){');assert.notEqual(wrapper,oldWrapper);
assert.equal(wrapper.split('if(!simx_install_diagnostic_digest(shr)').length,2);
wrapper=wrapper.replace('if(!simx_install_diagnostic_digest(shr)','if(!simx_dictionary_lease_init(shr)||!simx_install_diagnostic_digest(shr)');
assert.equal(wrapper.split('release_console_bindings(console);').length,2);
wrapper=wrapper.replace('release_console_bindings(console);','simx_dictionary_lease_dump(shr);\n release_console_bindings(console);');
wrapper=wrapper.replace('free_console_context(console);return success?0:1;','free_console_context(console);if(!simx_dictionary_lease_release_dead())return 3;simx_dictionary_lease_lifecycle_dump();return success?0:1;');
await writeFile(output+'.main.c',wrapper);
const linkArgs=[...baseline.linkArgs],oldDirectory=dirname(JSON.parse(await readFile(resolve(root,baseline.hostProof.file))).privateVM.output),privateDirectory=dirname(build.privateVM.output);
linkArgs[0]=output+'.main.c';linkArgs[linkArgs.length-1]=output;
for(let i=0;i<linkArgs.length;i++){
 if(linkArgs[i]==='-L'+oldDirectory)linkArgs[i]='-L'+privateDirectory;
 if(linkArgs[i]==='-Wl,-rpath,'+oldDirectory)linkArgs[i]='-Wl,-rpath,'+privateDirectory;
}
assert.ok(linkArgs.includes('-L'+privateDirectory));linkArgs.splice(1,0,build.wrapper.output,build.wrapper.linkFlag);
const linked=spawnSync('cc',linkArgs,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});await writeFile(output+'.link.stderr',linked.stderr??'');assert.equal(linked.status,0,linked.stderr);
const environment={PATH:'/usr/bin:/bin',HOME:resolve(root,'work'),LANG:'C',LD_LIBRARY_PATH:privateDirectory},ldd=spawnSync('ldd',[output],{cwd:root,env:environment,encoding:'utf8'});assert.equal(ldd.status,0);assert.ok(ldd.stdout.includes('libhermesvm.so => '+build.privateVM.output));await writeFile(output+'.ldd',ldd.stdout);
const machine=await benchmarkMachine(),out=openSync(output+'.stdout','w'),err=openSync(output+'.stderr','w'),runtimeArgs=['-Xhermes-internal-test-methods'],start=performance.now();let execution;
try{execution=await new Promise((accept,reject)=>{const child=spawn(output,runtimeArgs,{cwd:root,env:environment,stdio:['ignore',out,err]});child.on('error',reject);child.on('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}
const executionWallMs=performance.now()-start,stderr=await readFile(output+'.stderr','utf8'),counter=name=>Number(new RegExp(name+':(\\d+)').exec(stderr)?.[1]??0);
let actual=null,difference=null,cache=null,lifecycle=null;
try{
 actual=JSON.parse((await readFile(output+'.stdout','utf8')).trim().split('\n').at(-1));difference=compareNativeReports(actual,JSON.parse(await readFile(baseline.reference.file)))??compareHostInputConsumption(actual.hostInputConsumption,baseline.hostInputs);
 const getJSON=prefix=>{const rows=stderr.split(/\r?\n/).filter(s=>s.startsWith(prefix));assert.equal(rows.length,1);return JSON.parse(rows[0].slice(prefix.length));};
 cache=getJSON('dictionary_lease:');lifecycle=getJSON('dictionary_lease_lifecycle:');
}catch(error){difference??={path:'$execution',message:error.message};}
const dependenciesAtFinish=[];for(const row of dependencies)dependenciesAtFinish.push({...row,matched:await hash(row.file)===row.sha256});
assert.equal(await hash(semanticFile),semanticProofSha256,'Semantic proof changed during measurement');
for(const row of Object.values(build.headers))assert.equal(await hash(row.original),row.originalSha256,'Original VM header changed');
for(const [file,expected]of Object.entries(build.sources))assert.equal(await hash(file),expected);assert.equal(await hash(build.privateVM.output),build.privateVM.privateSha256);assert.equal(await hash(build.wrapper.output),build.wrapper.sha256);
const fastPathHits={copy:counter('copy_hits'),emptyCopy:counter('empty_copy_hits'),numericCopy:counter('numeric_copy_hits'),entity:counter('entity_hits'),sort:counter('sort_hits'),sortDefaultStrings:counter('sort_default_strings'),sortUnsupportedFallbacks:counter('sort_fallbacks')};
const hintAdmissionCountsMatched=JSON.stringify(cache)===JSON.stringify(previousHint.dictionaryHint);
const matched=hintAdmissionCountsMatched&&execution.code===0&&difference===null&&dependenciesAtFinish.every(r=>r.matched)&&cache?.hits>0&&actual?.completed===20&&actual?.totalCallbacks===baseline.totalCallbacks&&Object.entries(baseline.fastPathHits).every(([key,value])=>fastPathHits[key]===value)&&fastPathHits.sortUnsupportedFallbacks===0&&lifecycle?.created===1&&lifecycle?.destroyed===1&&lifecycle?.liveContexts===0&&lifecycle?.otherRuntimeFallbacks===0;
const stamp=new Date().toISOString().replaceAll(':','-'),prefix='benchmarks/results/'+stamp+'-native-warm23-'+variant,artifacts=[];await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
for(const [label,file]of [['actual',output+'.stdout'],['stderr',output+'.stderr'],['reference',baseline.reference.file],['wrapper',output+'.main.c'],['ldd',output+'.ldd']]){const bytes=await readFile(file),archive=prefix+'.'+label+'.gz';await writeFile(resolve(root,archive),gzipSync(bytes,{level:9}));artifacts.push({label,file:archive,sha256:await hash(archive),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length});}
const report={version:1,variant:'no-proxy-'+variant,performanceOnly:true,instrumentationOff:true,semanticReportMatched:matched,firstDifference:difference,execution,completed:actual?.completed??0,measuredBattles:20,warmupBattles:3,elapsedMs:actual?.elapsedMs??null,battlesPerSecond:actual?.battlesPerSecond??null,executionWallMs,timingScope:baseline.timingScope,machine,totalCallbacks:actual?.totalCallbacks??null,classManagerCounters:actual?.classManagerCounters??null,hostInputConsumption:actual?.hostInputConsumption??null,comparedFields:Object.keys(semanticNativeReport(JSON.parse(await readFile(baseline.reference.file)))),dictionaryLease:cache,dictionaryLeaseLifecycle:lifecycle,hintAdmissionCountsMatched,previousHint:{file:previousHintFile,sha256:await hash(previousHintFile)},fastPathHits,nativeCounterScope:'Complete process, including cold initialization, three warmups,20 measured battles and final reporting; totalCallbacks covers the measured20 battles.',baseline:{file:baselineFile,sha256:await hash(baselineFile)},cacheBuild:{file:buildFile,sha256:await hash(buildFile)},cacheSemanticProof:{file:semanticFile,sha256:semanticProofSha256,unchangedThroughoutRun:true,interleavedRuntimeProof:interleaved},sourceManifest:baseline.sourceManifest,reference:baseline.reference,hostInputs:baseline.hostInputs,compilerSha256:baseline.compilerSha256,originalVMSha256:baseline.originalVMSha256,privateVMSha256:build.privateVM.privateSha256,output,outputSha256:await hash(output),wrapperSha256:sha(wrapper),linkArgs,units:baseline.units,allSevenObjectsReused:true,allOriginalGameFunctionsUnchanged:true,dependenciesAtFinish,environment,runtimeArgs,artifacts,producer:{file:'tools/run-native-dictionary-lease.mjs',sha256:await hash('tools/run-native-dictionary-lease.mjs')},qualifiesFor10000Target:false,qualification:'One fixed callback-only fixture20after3, all source report fields excepttimings compared. Original named-property helper remains fallback; ordinary dictionary own-data reads check the current map/count/key and current descriptor flags/slot, then load current values from current storage; only symbol/ordinal integers are retained. Full actor/effect/view lifecycle, broad random5v5corpus and ordered event/state traces remain unqualified.'};
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');await writeFile(output+'.comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',matched,difference,completed:report.completed,elapsedMs:report.elapsedMs,battlesPerSecond:report.battlesPerSecond,dictionaryLease:cache,dictionaryLeaseLifecycle:lifecycle}));if(!matched)process.exitCode=1;
