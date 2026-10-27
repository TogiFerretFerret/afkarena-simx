import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {patchEntityUpdateC} from './native-entity-update.mjs';
import {patchCombinedCopyC} from './native-copy-bridge.mjs';
import {sourceCopyFunction} from './flat-numeric-copy.mjs';
import {compareNativeReports,compareHostInputConsumption,semanticNativeReport} from './native-report-compare.mjs';
import {benchmarkMachine} from './benchmark-machine.mjs';

// Build/run the existing independently gated warm23 input. Only its first and
// last SHUnits differ; middle objects require exact source/compiler/flag hashes.
const baseline=process.argv.includes('--baseline');
const copy=process.argv.includes('--copy');assert.ok(!(baseline&&copy));
const variant=baseline?'baseline':copy?'entity-copy':'entity';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-warm23-entity.units');
const output=resolve(root,'work/native-warm23-'+variant),manifestFile='work/native-warm23-partition/manifest.json';
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=async p=>sha(await readFile(resolve(root,p)));
const manifest=JSON.parse(await readFile(resolve(root,manifestFile))),metadata=JSON.parse(await readFile(manifest.input.file+'.metadata.json'));
assert.equal(manifest.passed,true);assert.equal(manifest.difference,null);assert.equal(metadata.battles,20);assert.equal(metadata.warmup,3);
const cache=JSON.parse(await readFile(resolve(root,'work/native-seven-object-cache.json')));
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build');
const compiler=resolve(build,'bin/shermes'),liveVM=resolve(build,'lib/libhermesvm.so');
assert.equal(await hash(compiler),cache.compilerSha256);assert.equal(await hash(liveVM),cache.vmSha256);
for(const row of cache.headers)assert.equal(await hash(row.file),row.sha256);
const dependencies=[];
for(const [file,expected]of Object.entries({...metadata.adapterInputs,...metadata.sourceInputs,[manifest.input.file]:manifest.input.sha256,[manifest.input.file+'.metadata.json']:manifest.input.metadataSha256,[manifest.transformation.file]:manifest.transformation.sha256})){
 const actual=await hash(file);assert.equal(actual,expected,'Changed source/adapter '+file);dependencies.push({file,sha256:actual});
}
for(const row of [metadata.reference,metadata.hostInputs,metadata.tableBundle])assert.equal(await hash(row.file),row.sha256);
const reference=JSON.parse(await readFile(metadata.reference.file));
const node=JSON.parse((await readFile(resolve(root,'work/native-warm23-partition/node.stdout'),'utf8')).trim().split('\n').at(-1));
assert.equal(compareNativeReports(node,reference),null);assert.equal(compareHostInputConsumption(node.hostInputConsumption,metadata.hostInputs),null);
await mkdir(directory,{recursive:true});
async function run(command,args,label,env=process.env){
 const out=openSync(output+'.'+label+'.stdout','w'),err=openSync(output+'.'+label+'.stderr','w');
 try{return await new Promise((accept,reject)=>{const c=spawn(command,args,{cwd:root,env,stdio:['ignore',out,err]});c.on('error',reject);c.on('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}
}
const includes=['-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')];
const contract=JSON.parse(await readFile(resolve(root,'config/entity-translation.json'))),original=(await readFile(resolve(root,contract.source),'utf8')).slice(contract.start,contract.end);
assert.equal(sha(original),contract.sha256);
async function patchUnit(text,pools){
 if(baseline)return text+'\nsize_t simx_entity_update_hits(void){return 0;}\n';
 let source=(await patchEntityUpdateC(text,pools,original)).source;
 if(copy)source=(await patchCombinedCopyC(source,pools,sourceCopyFunction)).source;
 source+='\nsize_t simx_entity_update_hits(void){return simx_entity_hits;}\n';
 if(copy)source+='\nsize_t simx_battle_copy_hits(void){return simx_copy_hits;}\nsize_t simx_battle_empty_copy_hits(void){return simx_empty_copy_hits;}\nsize_t simx_battle_numeric_copy_hits(void){return simx_numeric_copy_hits;}\n';
 return source;
}
const units=[];
for(let index=0;index<manifest.units.length;index++){
 const row=manifest.units[index],name=index===0?'partition_0':index===6?'runner':row.nativeName;
 assert.equal(await hash(row.file),row.sha256);
 if(index>0&&index<6){
  const cached=cache.units.find(u=>u.name===name);assert.ok(cached);assert.equal(cached.sourceSha256,row.sha256);assert.equal(cached.compilerSha256,cache.compilerSha256);assert.equal(await hash(cached.object),cached.objectSha256);
  assert.deepEqual(cached.compileArgs,['-O','-c','-exported-unit='+name,'-Wc,-O1,-g0,-ffp-contract=off',row.file,'-o',cached.object]);
  units.push({...row,name,object:cached.object,objectSha256:cached.objectSha256,reusedObject:true,compileArgs:cached.compileArgs});continue;
 }
 const object=resolve(directory,name+(index===0&&variant!=='entity'?'.'+variant:'')+'.o'),pools=resolve(directory,name+'.string-pools'),proofFile=object+'.build.json';await mkdir(pools,{recursive:true});
 const sourceArgs=['-O',index===0?'-emit-c':'-c','-exported-unit='+name,'-Wc,-O1,-g0,-ffp-contract=off',relative(root,row.file),'-o',index===0?resolve(directory,name+'.original.c'):object];
 const ccArgs=['-O1','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off',...includes.map(p=>'-I'+relative(root,p.slice(2))),'-c',relative(root,resolve(directory,name+'.'+variant+'.c')),'-o',relative(root,object)];
 let proof=null;try{proof=JSON.parse(await readFile(proofFile));}catch{}
 if(!proof||process.argv.includes('--rebuild')){
  assert.equal((await run(compiler,sourceArgs,name+'-source',{...process.env,SHERMES_BINARY_STRING_DIR:pools})).code,0);
  if(index===0){await writeFile(ccArgs.at(-3),await patchUnit(await readFile(sourceArgs.at(-1),'utf8'),pools));assert.equal((await run('cc',ccArgs,name+'-compile')).code,0);}
  proof={name,sourceSha256:row.sha256,compilerSha256:cache.compilerSha256,sourceArgs,ccArgs:index===0?ccArgs:null,objectSha256:await hash(object),originalCSha256:index===0?await hash(sourceArgs.at(-1)):null,patchedCSha256:index===0?await hash(ccArgs.at(-3)):null};await writeFile(proofFile,JSON.stringify(proof,null,2)+'\n');
 }
 assert.equal(proof.sourceSha256,row.sha256);assert.equal(proof.compilerSha256,cache.compilerSha256);assert.deepEqual(proof.sourceArgs,sourceArgs);assert.deepEqual(proof.ccArgs,index===0?ccArgs:null);assert.equal(proof.objectSha256,await hash(object));
 if(index===0){const patched=await patchUnit(await readFile(sourceArgs.at(-1),'utf8'),pools);assert.equal(await hash(ccArgs.at(-3)),sha(patched));assert.equal(await hash(sourceArgs.at(-1)),proof.originalCSha256);assert.equal(await hash(ccArgs.at(-3)),proof.patchedCSha256);}
 const poolFiles=[];for(const file of ['s_ascii_pool.bin','s_u16_pool.bin','s_strings.bin'])poolFiles.push({file:resolve(pools,file),sha256:await hash(resolve(pools,file)),bytes:(await stat(resolve(pools,file))).size});
 units.push({...row,name,object,objectSha256:proof.objectSha256,reusedObject:false,compilation:proof,poolFiles});
}
const hostFile=copy?'benchmarks/validation/native-entity-sort-copy-host.json':'benchmarks/validation/native-entity-sort-host.json',host=JSON.parse(await readFile(resolve(root,hostFile))),privateDirectory=resolve(host.privateVM.output,'..');
assert.equal(host.passed,true);assert.equal(host.privateVM.originalSha256,cache.vmSha256);assert.equal(await hash(host.privateVM.output),host.privateVM.privateSha256);
for(const [file,expected]of Object.entries(host.sources))assert.equal(await hash(file),expected);
for(const [file,row]of Object.entries(host.prerequisites))assert.equal(await hash(file),row.sha256);
for(const row of Object.values(host.libraries))assert.equal(await hash(row.path),row.sha256);
const wrapper=`#include "hermes/VM/static_h.h"
#include <stdlib.h>
#include <stdio.h>
typedef struct SHConsoleContext SHConsoleContext;
SHConsoleContext *init_console_bindings(SHRuntime *,int,const char *const *);
void release_console_bindings(SHConsoleContext *);void free_console_context(SHConsoleContext *);bool run_event_loop(SHRuntime *,SHConsoleContext *);
typedef int (*SortCompare)(void*,uint32_t,uint32_t,double*);typedef int (*SortKernel)(uint32_t*,size_t,void*,SortCompare);
extern int battle_v8_small_sort(uint32_t*,size_t,void*,SortCompare);
extern bool simx_install_v8_sort(SHRuntime*,SortKernel);extern bool simx_install_diagnostic_digest(SHRuntime*);
extern uint64_t simx_sort_hits(void),simx_sort_fallbacks(void),simx_sort_default_string_hits(void);extern size_t simx_entity_update_hits(void);
${copy?'extern size_t simx_battle_copy_hits(void),simx_battle_empty_copy_hits(void),simx_battle_numeric_copy_hits(void);':''}
${units.map(u=>'SHUnit *sh_export_'+u.name+'(void);').join('\n')}
int main(int argc,char **argv){
 SHRuntime *shr=_sh_init(argc,argv);SHConsoleContext *console=init_console_bindings(shr,0,NULL);
 if(!simx_install_diagnostic_digest(shr)||!simx_install_v8_sort(shr,battle_v8_small_sort))return 2;
 bool success=_sh_initialize_units(shr,${units.length},${units.map(u=>'sh_export_'+u.name).join(',')})&&run_event_loop(shr,console);
 fprintf(stderr,"sort_hits:%llu\\nsort_default_strings:%llu\\nsort_fallbacks:%llu\\nentity_hits:%zu\\n",(unsigned long long)simx_sort_hits(),(unsigned long long)simx_sort_default_string_hits(),(unsigned long long)simx_sort_fallbacks(),simx_entity_update_hits());
 ${copy?'fprintf(stderr,"copy_hits:%zu\\nempty_copy_hits:%zu\\nnumeric_copy_hits:%zu\\n",simx_battle_copy_hits(),simx_battle_empty_copy_hits(),simx_battle_numeric_copy_hits());':''}
 release_console_bindings(console);_sh_done(shr);free_console_context(console);return success?0:1;
}\n`;
await writeFile(output+'.main.c',wrapper);
const linkArgs=[output+'.main.c',...units.map(u=>u.object),...Object.values(host.libraries).map(r=>r.path),'-O2','-g0','-DNDEBUG','-ffp-contract=off',...includes,'-L'+privateDirectory,'-Wl,-rpath,'+privateDirectory];
for(const lib of ['lib','jsi','tools/shermes']){const p=resolve(build,lib);linkArgs.push('-L'+p,'-Wl,-rpath,'+p);}linkArgs.push('-lshermes_console','-lm','-lhermesvm','-ldl','-lpthread','-o',output);
assert.equal((await run('cc',linkArgs,'link')).code,0,await readFile(output+'.link.stderr','utf8'));
const machine=await benchmarkMachine(),start=performance.now(),execution=await run(output,['-Xhermes-internal-test-methods'],'execute',{...process.env,LD_LIBRARY_PATH:privateDirectory}),executionWallMs=performance.now()-start;
let actual=null,difference=null;try{actual=JSON.parse((await readFile(output+'.execute.stdout','utf8')).trim().split('\n').at(-1));difference=compareNativeReports(actual,reference)??compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs);}catch(e){difference={path:'$execution',message:e.message};}
const stderr=await readFile(output+'.execute.stderr','utf8'),counter=name=>Number(new RegExp(name+':(\\d+)').exec(stderr)?.[1]??0);
const dependenciesAtFinish=[];for(const row of dependencies)dependenciesAtFinish.push({...row,matched:await hash(row.file)===row.sha256});
assert.equal(await hash(liveVM),cache.vmSha256);assert.equal(await hash(host.privateVM.output),host.privateVM.privateSha256);
const matched=execution.code===0&&difference===null&&dependenciesAtFinish.every(r=>r.matched)&&(baseline?counter('entity_hits')===0:counter('entity_hits')>0)&&(!copy||counter('copy_hits')>0)&&counter('sort_fallbacks')===0;
const report={version:1,copyFastPathEnabled:copy,copySourceSha256:copy?sha(sourceCopyFunction):null,engine:baseline?'Original seven-unit Static Hermes O1 with pinned V8 TimSort, Entity unchanged':'Original seven-unit Static Hermes O1 with guarded Rust Entity update and pinned V8 TimSort',variant,entityFastPathEnabled:!baseline,semanticReportMatched:matched,firstDifference:difference,execution,completed:actual?.completed??0,measuredBattles:20,warmupBattles:3,elapsedMs:actual?.elapsedMs??null,battlesPerSecond:actual?.battlesPerSecond??null,executionWallMs,timingScope:'elapsedMs measures20original battles after3warmups, including scenario materialization and engine setup. Final capture/report hashing occurs after measured timer. Wall time includes VM/script/table cold initialization,3warmups,20battles and report. Their difference is combined overhead, not an isolated cold-init or warmup measurement.',unmeasuredCombinedOverheadMs:actual?executionWallMs-actual.elapsedMs:null,machine,sourceManifest:{file:manifestFile,sha256:await hash(manifestFile)},metadataSha256:await hash(manifest.input.file+'.metadata.json'),reference:metadata.reference,hostInputs:metadata.hostInputs,hostProof:{file:hostFile,sha256:await hash(hostFile)},compilerSha256:cache.compilerSha256,originalVMSha256:cache.vmSha256,privateVMSha256:host.privateVM.privateSha256,outputSha256:await hash(output),wrapperSha256:sha(wrapper),units,linkArgs,comparedFields:Object.keys(semanticNativeReport(reference)),totalCallbacks:actual?.totalCallbacks??null,classManagerCounters:actual?.classManagerCounters??null,hostInputConsumption:actual?.hostInputConsumption??null,fastPathHits:{copy:counter('copy_hits'),emptyCopy:counter('empty_copy_hits'),numericCopy:counter('numeric_copy_hits'),entity:counter('entity_hits'),sort:counter('sort_hits'),sortDefaultStrings:counter('sort_default_strings'),sortUnsupportedFallbacks:counter('sort_fallbacks')},dependenciesAtStart:dependencies,dependenciesAtFinish,executionContract:metadata.executionContract,qualifiesFor10000Target:false,qualification:'One fixed callback-only scenario repeated20times after3warmups. Full raw semantic report checked, no ignored counter fields or NaN normalization. Complete actor/effect/view lifecycle and random5v5corpus are still required; no speedup claim without a matched baseline.'};
const stamp=new Date().toISOString().replaceAll(':','-'),prefix='benchmarks/results/'+stamp+'-native-warm23-'+variant;
report.artifacts=[];for(const [label,file]of [['actual',output+'.execute.stdout'],['stderr',output+'.execute.stderr'],['reference',metadata.reference.file],['wrapper',output+'.main.c']]){const bytes=await readFile(file),archive=prefix+'.'+label+'.gz';await writeFile(resolve(root,archive),gzipSync(bytes,{level:9}));report.artifacts.push({file:archive,sha256:await hash(archive),uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length});}
report.producer={file:'tools/native-warm-entity-run.mjs',sha256:await hash('tools/native-warm-entity-run.mjs')};
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');await writeFile(output+'.comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',matched,completed:report.completed,elapsedMs:report.elapsedMs,battlesPerSecond:report.battlesPerSecond,executionWallMs,fastPathHits:report.fastPathHits,difference}));if(!matched)process.exitCode=1;
