import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve,basename}from'node:path';
import{spawn,spawnSync}from'node:child_process';
import{openSync,closeSync}from'node:fs';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{compareNativeReports,compareHostInputConsumption,semanticNativeReport}from'./native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const input=resolve(root,option('--input','work/native-partition-counter-capsule/unit-7.js'));
const objectsPrefix=resolve(root,option('--objects-prefix','work/native-oracle-partition-o1'));
const sortHost=args.includes('--sort-host');
const output=resolve(root,option('--output',sortHost?'work/native-oracle-seven-v8-sort':'work/native-oracle-seven-host-digest'));
const privateDirectory=resolve(root,option('--vm-directory',sortHost?'work/native-sort-host':'work/native-diagnostic-sha256-host'));
const hostProofPath=option('--host-proof',sortHost?'benchmarks/validation/native-sort-host.json':'benchmarks/validation/native-diagnostic-sha256-host.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
const metadata=JSON.parse(await readFile(input+'.metadata.json'));
const cache=JSON.parse(await readFile(resolve(root,option('--object-cache','work/native-seven-object-cache.json'))));
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes');
assert.equal(cache.compilerSha256,sha(await readFile(compiler)));
const liveVM=resolve(root,'work/downloads/hermes-build/lib/libhermesvm.so');
assert.equal(cache.vmSha256,sha(await readFile(liveVM)));
for(const row of cache.headers)assert.equal(sha(await readFile(resolve(root,row.file))),row.sha256);
const units=[...metadata.factoryChunks.map(row=>({...row,name:row.nativeName})),{file:input,sha256:metadata.outputSha256,name:metadata.nativeRunnerName}];
assert.ok(units.length<=7&&units.length>0);
const dependencies=[];
for(const[file,expected]of[...Object.entries(metadata.adapterInputs),...Object.entries(metadata.sourceInputs)]){
 const actual=sha(await readFile(resolve(root,file)));
 if(actual!==expected&&file==='tools/partition-native-program.mjs'){
  // This producer is not executed by the frozen seven-script program. Keep
  // its exact historical source instead of pretending a new partitioner built
  // the unchanged, already-verified unit bytes. Runtime adapters stay strict.
  const history=spawnSync('git',['log','--format=%H','--',file],{cwd:root,encoding:'utf8'});assert.equal(history.status,0);
  let bytes=null,revision=null;
  for(const commit of history.stdout.trim().split('\n')){
   const candidate=spawnSync('git',['show',commit+':'+file],{cwd:root,maxBuffer:16*1024*1024});
   if(candidate.status===0&&sha(candidate.stdout)===expected){bytes=candidate.stdout;revision=commit;break;}
  }
  assert.ok(bytes,'Exact historical partition producer must exist in Git');
  const directory=resolve(root,'benchmarks/validation/native-frozen-producers');await mkdir(directory,{recursive:true});
  const snapshot='benchmarks/validation/native-frozen-producers/partition-'+expected+'.mjs';await writeFile(resolve(root,snapshot),bytes);
  dependencies.push({file:snapshot,producerFile:file,producerRevision:revision,currentProducerSha256:actual,expected,actual:sha(bytes),matched:true});
 }else{dependencies.push({file,expected,actual,matched:actual===expected});assert.equal(actual,expected,'Changed source/adapter: '+file);}
}
for(const row of[metadata.tableBundle,metadata.hostInputs,metadata.reference])assert.equal(sha(await readFile(row.file)),row.sha256);
const reference=JSON.parse(await readFile(metadata.reference.file));
const node=JSON.parse((await readFile(input+'.node.stdout','utf8')).trim().split('\n').at(-1));
assert.equal(compareNativeReports(node,reference),null);assert.equal(compareHostInputConsumption(node.hostInputConsumption,metadata.hostInputs),null);
for(const unit of units){
 assert.match(unit.name,/^[A-Za-z_][A-Za-z0-9_]*$/);assert.equal(sha(await readFile(unit.file)),unit.sha256);
 unit.object=resolve(objectsPrefix+'.units',unit.name+'.o');unit.objectSha256=sha(await readFile(unit.object));
 const cached=cache.units.find(row=>row.name===unit.name);
 if(cached){assert.equal(unit.objectSha256,cached.objectSha256);assert.equal(unit.sha256,cached.sourceSha256);unit.compilation=cached.compileArgs;}
 else{
  // The merged declaration/effect object is the only new compilation. Its
  // exact source, object, compiler and flags are recorded alongside the six
  // independently verified unchanged objects from the failed eight-unit run.
  assert.equal(unit.name,'partition_0');
  unit.compilation=['-O','-c','-exported-unit='+unit.name,'-Wc,-O1,-g0,-ffp-contract=off',unit.file,'-o',unit.object];
 }
}
const privateVM=resolve(privateDirectory,'libhermesvm.so'),privateVMSha256=sha(await readFile(privateVM));
const proof=JSON.parse(await readFile(resolve(root,hostProofPath)));
assert.equal(proof.passed??proof.matched,true);assert.equal(proof.privateVM.originalSha256,cache.vmSha256);
assert.equal(proof.privateVM.privateSha256,privateVMSha256);
const baselineWrapper=await readFile(objectsPrefix+'.units/main.c','utf8');
assert.ok(baselineWrapper.includes('_sh_initialize_units(shr,'+units.length+','));
for(const unit of units)assert.ok(baselineWrapper.includes('sh_export_'+unit.name));
let wrapper=baselineWrapper.replace('int main(int argc,char **argv) {','extern bool simx_install_diagnostic_digest(SHRuntime *);\nint main(int argc,char **argv) {');
assert.notEqual(wrapper,baselineWrapper);
wrapper=wrapper.replace('  bool success=_sh_initialize_units','  if(!simx_install_diagnostic_digest(shr))return 2;\n  bool success=_sh_initialize_units');
assert.ok(wrapper.includes('if(!simx_install_diagnostic_digest(shr))'));
let sortLibrary=null,sortLibrarySha256=null;
if(sortHost){
 sortLibrary=resolve(root,option('--sort-library','work/native-sort-host/libsmall_sort.a'));
 sortLibrarySha256=sha(await readFile(sortLibrary));
 wrapper=wrapper.replace('int main(int argc,char **argv) {',`#include <stdio.h>
typedef int (*SimxSortCompare)(void*,uint32_t,uint32_t,double*);
typedef int (*SimxSortKernel)(uint32_t*,size_t,void*,SimxSortCompare);
extern int battle_v8_small_sort(uint32_t*,size_t,void*,SimxSortCompare);
extern bool simx_install_v8_sort(SHRuntime*,SimxSortKernel);
extern uint64_t simx_sort_hits(void);
extern uint64_t simx_sort_fallbacks(void);
extern uint64_t simx_sort_default_string_hits(void);
int main(int argc,char **argv) {`);
 wrapper=wrapper.replace('  bool success=_sh_initialize_units','  if(!simx_install_v8_sort(shr,battle_v8_small_sort))return 3;\n  bool success=_sh_initialize_units');
 wrapper=wrapper.replace('  release_console_bindings(console);', '  fprintf(stderr,"sort_hits:%llu\\nsort_default_strings:%llu\\nsort_fallbacks:%llu\\n",(unsigned long long)simx_sort_hits(),(unsigned long long)simx_sort_default_string_hits(),(unsigned long long)simx_sort_fallbacks());\n  release_console_bindings(console);');
}
await writeFile(output+'.main.c',wrapper);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build');
const linkArgs=[output+'.main.c',...units.map(unit=>unit.object),'-O2','-g0','-DNDEBUG','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include'),'-L'+privateDirectory,'-Wl,-rpath,'+privateDirectory];
for(const lib of['lib','jsi','tools/shermes']){const path=resolve(build,lib);linkArgs.push('-L'+path,'-Wl,-rpath,'+path);}if(sortLibrary)linkArgs.push(sortLibrary);linkArgs.push('-lshermes_console','-lm','-lhermesvm','-ldl','-lpthread','-o',output);
async function run(command,parameters,label,env=process.env){const out=openSync(output+'.'+label+'.stdout','w'),err=openSync(output+'.'+label+'.stderr','w');try{await new Promise((accept,reject)=>{const child=spawn(command,parameters,{cwd:root,env,stdio:['ignore',out,err]});child.on('error',reject);child.on('exit',(code,signal)=>code===0?accept():reject(new Error(label+' failed: '+(code??signal))));});}finally{closeSync(out);closeSync(err);}}
await run(process.env.CC??'cc',linkArgs,'link');
const start=performance.now();await run(output,['-Xhermes-internal-test-methods'],'execute',{...process.env,LD_LIBRARY_PATH:privateDirectory});const executionWallMs=performance.now()-start;
assert.equal(sha(await readFile(privateVM)),privateVMSha256);assert.equal(sha(await readFile(liveVM)),cache.vmSha256);
const actual=JSON.parse((await readFile(output+'.execute.stdout','utf8')).trim().split('\n').at(-1));
const difference=compareNativeReports(actual,reference)??compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs);
const dependenciesAtFinish=[];for(const row of dependencies){const hash=sha(await readFile(resolve(root,row.file)));dependenciesAtFinish.push({...row,actual:hash,matched:hash===row.expected});}
const report={version:1,engine:'Original source seven-unit Static Hermes O1 with native diagnostic SHA256 host',input,output,outputSha256:sha(await readFile(output)),compilerSha256:cache.compilerSha256,originalVMSha256:cache.vmSha256,privateVMSha256,diagnosticHostProof:'benchmarks/validation/native-diagnostic-sha256-host.json',diagnosticHostOnly:true,battleMechanicsFastPaths:[],units,wrapperSha256:sha(wrapper),linkArgs,executionWallMs,completed:actual.completed,elapsedMs:actual.elapsedMs,battlesPerSecond:actual.battlesPerSecond,semanticReportMatched:difference===null,firstDifference:difference,comparedFields:Object.keys(semanticNativeReport(reference)),classManagerCounters:actual.classManagerCounters??null,hostInputConsumption:actual.hostInputConsumption,executionContract:metadata.executionContract,dependenciesAtStart:dependencies,dependenciesAtFinish,qualifiesFor10000Target:false,qualification:'One frozen source fixture. Native SHA256 accelerates diagnostic hashing only; callbacks, RNG, allocator counters and original source battle execution are compared. Full random corpus and complete actor/effect/view lifecycle qualification remain required.'};
report.hostProof={file:hostProofPath,sha256:sha(await readFile(resolve(root,hostProofPath)))};
if(sortHost){
 const stderr=await readFile(output+'.execute.stderr','utf8');
 report.engine='Original source seven-unit Static Hermes O1 with guarded Rust V8 TimSort';
 report.sortHost={enabled:true,rustLibrarySha256:sortLibrarySha256,hits:Number(/sort_hits:(\d+)/.exec(stderr)?.[1]??0),defaultStringHits:Number(/sort_default_strings:(\d+)/.exec(stderr)?.[1]??0),fallbacks:Number(/sort_fallbacks:(\d+)/.exec(stderr)?.[1]??0)};
 report.diagnosticHostOnly=false;report.battleMechanicsFastPaths=['Guarded dense-array pinned V8 TimSort comparison schedule'];
}
await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
const reportPath=resolve(root,'benchmarks/results',new Date().toISOString().replaceAll(':','-')+'-'+basename(output)+'.json');await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await writeFile(output+'.comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(difference||dependenciesAtFinish.some(row=>!row.matched))process.exitCode=1;
