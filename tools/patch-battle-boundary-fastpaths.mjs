import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
import {patchEntityUpdateC} from './native-entity-update.mjs';
import {patchCombinedCopyC} from './native-copy-bridge.mjs';
import {sourceCopyFunction} from './flat-numeric-copy.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
const dependencies=new Map();async function bind(file,expected){const actual=await hash(file);if(expected!==undefined)assert.equal(actual,expected,'Changed fast build input '+file);dependencies.set(file,actual);}
const initial=JSON.parse(await readFile(resolve(directory,'native-build.json')));assert.equal(initial.passed,true);
for(const unit of initial.units){assert.equal(await hash(unit.file),unit.sourceSha256??unit.sha256);assert.equal(await hash(unit.object),unit.objectSha256);}
for(const unit of initial.units){await bind(unit.file,unit.sourceSha256??unit.sha256);await bind(unit.object,unit.objectSha256);}
assert.equal(await hash(initial.helper.file),initial.helper.sha256);assert.equal(await hash(initial.compiler.file),initial.compiler.sha256);
const hostFile='benchmarks/validation/native-global-ed-prefilter-build.json',semanticFile='benchmarks/validation/native-global-ed-prefilter.json',host=JSON.parse(await readFile(resolve(root,hostFile))),semantic=JSON.parse(await readFile(resolve(root,semanticFile)));
assert.equal(host.passed,true);assert.equal(semantic.passed,true);assert.equal(semantic.semanticProofPassed,true);
for(const [file,expected]of Object.entries(semantic.sources))assert.equal(await hash(file),expected);
for(const [file,expected]of Object.entries(semantic.sources))await bind(file,expected);
for(const file of [resolve(directory,'native-build.json'),initial.helper.file,initial.compiler.file,hostFile,semanticFile,host.privateVM.output,host.wrapper.output,...Object.values(host.libraries).map(r=>r.path),'tools/patch-battle-boundary-fastpaths.mjs','tools/native-entity-update.mjs','tools/native-copy-bridge.mjs','tools/flat-numeric-copy.mjs'])await bind(file);
assert.equal(await hash(host.privateVM.output),host.privateVM.privateSha256);assert.equal(await hash(host.wrapper.output),host.wrapper.sha256);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build'),pools=resolve(directory,'fast-string-pools');await mkdir(pools,{recursive:true});
const originalC=resolve(directory,'partition_0.original.c'),patchedC=resolve(directory,'partition_0.fast.c'),object=resolve(directory,'partition_0.fast.o');
async function run(command,args,label,env=process.env){const out=openSync(resolve(directory,label+'.stdout'),'w'),err=openSync(resolve(directory,label+'.stderr'),'w');try{return await new Promise((accept,reject)=>{const child=spawn(command,args,{cwd:root,env,stdio:['ignore',out,err]});child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}}
const emitArgs=['-O','-emit-c','-exported-unit=partition_0','-Wc,-O1,-g0,-ffp-contract=off',initial.units[0].file,'-o',originalC];
assert.equal((await run(initial.compiler.file,emitArgs,'fast-emit',{...process.env,SHERMES_BINARY_STRING_DIR:pools})).code,0);
const contract=JSON.parse(await readFile(resolve(root,'config/entity-translation.json'))),original=(await readFile(resolve(root,contract.source),'utf8')).slice(contract.start,contract.end);assert.equal(sha(original),contract.sha256);
const entity=await patchEntityUpdateC(await readFile(originalC,'utf8'),pools,original),copy=await patchCombinedCopyC(entity.source,pools,sourceCopyFunction);
let text=copy.source+'\nsize_t simx_entity_update_hits(void){return simx_entity_hits;}\nsize_t simx_battle_copy_hits(void){return simx_copy_hits;}\nsize_t simx_battle_empty_copy_hits(void){return simx_empty_copy_hits;}\nsize_t simx_battle_numeric_copy_hits(void){return simx_numeric_copy_hits;}\n';await writeFile(patchedC,text);
const includes=['-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')],ccArgs=['-O1','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off',...includes,'-c',patchedC,'-o',object];
assert.equal((await run('cc',ccArgs,'fast-compile')).code,0,await readFile(resolve(directory,'fast-compile.stderr'),'utf8'));
const units=initial.units.map((u,i)=>i===0?{...u,object,objectSha256:null}:u);units[0].objectSha256=await hash(object);
let main=await readFile(resolve(directory,'main.c'),'utf8');
main=main.replace('#include <stdbool.h>','#include <stdbool.h>\n#include <stdio.h>\nextern bool simx_global_slot_init(SHRuntime*);\nextern void simx_global_slot_dump(SHRuntime*),simx_global_slot_lifecycle_dump(void);\nextern uint64_t simx_sort_hits(void),simx_sort_fallbacks(void),simx_sort_default_string_hits(void);\nextern size_t simx_entity_update_hits(void),simx_battle_copy_hits(void),simx_battle_empty_copy_hits(void),simx_battle_numeric_copy_hits(void);');
main=main.replace('if(!simx_install_diagnostic_digest(shr)','if(!simx_global_slot_init(shr)||!simx_install_diagnostic_digest(shr)');
main=main.replace('release_console_bindings(console);_sh_done(shr);free_console_context(console);',`fprintf(stderr,"entity_hits:%zu\\ncopy_hits:%zu\\nempty_copy_hits:%zu\\nnumeric_copy_hits:%zu\\nsort_hits:%llu\\nsort_fallbacks:%llu\\n",simx_entity_update_hits(),simx_battle_copy_hits(),simx_battle_empty_copy_hits(),simx_battle_numeric_copy_hits(),(unsigned long long)simx_sort_hits(),(unsigned long long)simx_sort_fallbacks());simx_global_slot_dump(shr);release_console_bindings(console);_sh_done(shr);free_console_context(console);simx_global_slot_lifecycle_dump();`);
const mainFile=resolve(directory,'fast-main.c'),output=resolve(directory,'native-fast');await writeFile(mainFile,main);
const privateDirectory=dirname(host.privateVM.output),linkArgs=[mainFile,host.wrapper.output,host.wrapper.linkFlag,...units.map(u=>u.object),...Object.values(host.libraries).map(r=>r.path),'-O2','-g0','-DNDEBUG','-ffp-contract=off',...includes,'-L'+privateDirectory,'-Wl,-rpath,'+privateDirectory];
for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);linkArgs.push('-L'+path,'-Wl,-rpath,'+path);}linkArgs.push('-lshermes_console','-lm','-lhermesvm','-ldl','-lpthread','-o',output);
assert.equal((await run('cc',linkArgs,'fast-link')).code,0,await readFile(resolve(directory,'fast-link.stderr'),'utf8'));
const proof={version:1,passed:true,scope:'BUILD ONLY actual benchmark fast-path composition for narrower boundary trace. Same Rust Entity, V8-sort, numeric/empty copy and C-prefilter guarded cache as benchmark; five objects reused, new first unit C patched by original guarded patchers. Actual trace and terminal-report gates still required.',semanticReportMatched:null,qualifiesFor10000Target:false,initialBuild:{file:resolve(directory,'native-build.json'),sha256:await hash(resolve(directory,'native-build.json'))},helper:initial.helper,units,compiler:initial.compiler,privateVM:host.privateVM,hostBuild:{file:hostFile,sha256:await hash(hostFile)},hostSemantic:{file:semanticFile,sha256:await hash(semanticFile)},wrapper:host.wrapper,sourceChanges:initial.sourceChanges,hostInputs:initial.hostInputs,originalC:{file:originalC,sha256:await hash(originalC)},patchedC:{file:patchedC,sha256:await hash(patchedC)},emitArgs,ccArgs,linkArgs,output,outputSha256:await hash(output),producer:{file:'tools/patch-battle-boundary-fastpaths.mjs',sha256:await hash('tools/patch-battle-boundary-fastpaths.mjs')}};
proof.dependenciesAtFinish=[];for(const [file,expected]of dependencies){const actual=await hash(file);proof.dependenciesAtFinish.push({file,sha256:expected,matched:actual===expected});assert.equal(actual,expected,'Fast build input changed during compile '+file);}
await writeFile(resolve(directory,'native-fast-build.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,output,outputSha256:proof.outputSha256}));
