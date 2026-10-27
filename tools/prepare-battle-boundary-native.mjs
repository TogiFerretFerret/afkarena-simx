import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {parse} from '@babel/parser';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
const dependencies=new Map();async function bind(file,expected){const actual=await hash(file);if(expected!==undefined)assert.equal(actual,expected,'Changed build input '+file);dependencies.set(file,actual);}
await mkdir(directory,{recursive:true});
const baselineFile='benchmarks/results/2026-10-27T21-55-08.845Z-native-warm23-no-proxy.json',baseline=JSON.parse(await readFile(resolve(root,baselineFile)));
assert.equal(baseline.semanticReportMatched,true);assert.equal(baseline.units.length,7);
for(const unit of baseline.units){assert.equal(await hash(unit.file),unit.sourceSha256??unit.sha256);assert.equal(await hash(unit.object),unit.objectSha256);}
await bind(baselineFile);for(const unit of baseline.units){await bind(unit.file,unit.sourceSha256??unit.sha256);await bind(unit.object,unit.objectSha256);}
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build'),compiler=resolve(build,'bin/shermes');
assert.equal(await hash(compiler),baseline.compilerSha256);
const hostFile='benchmarks/validation/native-entity-sort-copy-host.json',host=JSON.parse(await readFile(resolve(root,hostFile)));assert.equal(host.passed,true);
assert.equal(await hash(host.privateVM.output),host.privateVM.privateSha256);
for(const row of Object.values(host.libraries))assert.equal(await hash(row.path),row.sha256);
const tapeFile=resolve(directory,'host-inputs.json'),tape=JSON.parse(await readFile(tapeFile));assert.equal(tape.clock.length,260);assert.equal(tape.random.length,2);
for(const file of [tapeFile,'tools/prepare-battle-boundary-native.mjs','tools/battle-boundary-state-trace.js','config/native-compiler-static-hermes.json',hostFile,host.privateVM.output,...Object.values(host.libraries).map(r=>r.path),compiler])await bind(file);
const oldFirst=await readFile(baseline.units[0].file,'utf8'),tree=parse(oldFirst,{sourceType:'script'});let tapeLiteral=null;
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='AssignmentExpression'&&node.left?.type==='Identifier'&&node.left.name==='__nativeHostInputs'){assert.equal(tapeLiteral,null);assert.equal(node.right.type,'CallExpression');assert.equal(node.right.arguments[0].type,'StringLiteral');tapeLiteral=node.right.arguments[0];}for(const [key,value]of Object.entries(node)){if(['loc','extra'].includes(key))continue;if(Array.isArray(value))for(const child of value)walk(child);else if(value&&typeof value==='object')walk(value);}}
walk(tree);assert.ok(tapeLiteral);
const oldTape=JSON.parse(tapeLiteral.value);assert.deepEqual(tape,{...oldTape,clock:oldTape.clock.slice(0,260)});
const first=oldFirst.slice(0,tapeLiteral.start)+JSON.stringify(JSON.stringify(tape))+oldFirst.slice(tapeLiteral.end);
const helperFile='tools/battle-boundary-state-trace.js',helper=await readFile(resolve(root,helperFile),'utf8');
const oldRunner=await readFile(baseline.units[6].file,'utf8'),needle='void (__nativeResult=(__nativeRun(__nativeRuntime,__nativeWire,20,3,__nativeWallNow,"final")));';assert.equal(oldRunner.split(needle).length,2);
const install=helper+'\n__nativeRuntime.nativeTrace=installBattleBoundaryStateTrace(__nativeRuntime,{digest:globalThis.__nativeDiagnosticDigest,onProgress:function(p){print(JSON.stringify({status:"boundary_trace_progress",events:p.events,frame:p.frame,kind:p.kind}));},subscribeClock:function(observer){__nativeClockObserver=observer;return function(){__nativeClockObserver=null;};}});\n';
const runner=oldRunner.replace(needle,install+'void (__nativeResult=(__nativeRun(__nativeRuntime,__nativeWire,1,0,__nativeWallNow,"final")));');
const firstFile=resolve(directory,'partition_0.js'),runnerFile=resolve(directory,'runner.js');await writeFile(firstFile,first);await writeFile(runnerFile,runner);
const units=baseline.units.map((u,i)=>({...u,...(i===0?{file:firstFile,object:resolve(directory,'partition_0.o')}:i===6?{file:runnerFile,object:resolve(directory,'runner.o')}:{})}));
async function run(command,args,label){const out=openSync(resolve(directory,label+'.stdout'),'w'),err=openSync(resolve(directory,label+'.stderr'),'w');try{return await new Promise((accept,reject)=>{const child=spawn(command,args,{cwd:root,stdio:['ignore',out,err]});child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}}
const compilations=[];
for(const index of [0,6]){
 const unit=units[index],sourceSha256=await hash(unit.file),proofFile=unit.object+'.proof.json';let cached=null;try{cached=JSON.parse(await readFile(proofFile));}catch{}
 const args=['-O','-c','-exported-unit='+unit.name,'-Wc,-O1,-g0,-ffp-contract=off',unit.file,'-o',unit.object];
 if(!cached||cached.sourceSha256!==sourceSha256||cached.compilerSha256!==baseline.compilerSha256){const execution=await run(compiler,args,'compile-'+index);assert.equal(execution.code,0,await readFile(resolve(directory,'compile-'+index+'.stderr'),'utf8'));cached={sourceSha256,compilerSha256:baseline.compilerSha256,args,objectSha256:await hash(unit.object)};await writeFile(proofFile,JSON.stringify(cached,null,2)+'\n');}
 assert.equal(await hash(unit.object),cached.objectSha256);unit.sourceSha256=sourceSha256;unit.objectSha256=cached.objectSha256;compilations.push(cached);
}
const main=`#include "hermes/VM/static_h.h"
#include <stdbool.h>
typedef struct SHConsoleContext SHConsoleContext;
SHConsoleContext *init_console_bindings(SHRuntime*,int,const char *const*);
void release_console_bindings(SHConsoleContext*);void free_console_context(SHConsoleContext*);bool run_event_loop(SHRuntime*,SHConsoleContext*);
typedef int (*SortCompare)(void*,uint32_t,uint32_t,double*);typedef int (*SortKernel)(uint32_t*,size_t,void*,SortCompare);
extern int battle_v8_small_sort(uint32_t*,size_t,void*,SortCompare);
extern bool simx_install_v8_sort(SHRuntime*,SortKernel);extern bool simx_install_diagnostic_digest(SHRuntime*);
${units.map(u=>'SHUnit *sh_export_'+u.name+'(void);').join('\n')}
int main(int argc,char **argv){SHRuntime *shr=_sh_init(argc,argv);SHConsoleContext *console=init_console_bindings(shr,0,NULL);
if(!simx_install_diagnostic_digest(shr)||!simx_install_v8_sort(shr,battle_v8_small_sort))return 2;
bool ok=_sh_initialize_units(shr,7,${units.map(u=>'sh_export_'+u.name).join(',')})&&run_event_loop(shr,console);
release_console_bindings(console);_sh_done(shr);free_console_context(console);return ok?0:1;}
`;
const mainFile=resolve(directory,'main.c'),output=resolve(directory,'native');await writeFile(mainFile,main);
const includes=['-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')],privateDirectory=resolve(host.privateVM.output,'..');
const linkArgs=[mainFile,...units.map(u=>u.object),...Object.values(host.libraries).map(r=>r.path),'-O2','-g0','-DNDEBUG','-ffp-contract=off',...includes,'-L'+privateDirectory,'-Wl,-rpath,'+privateDirectory];
for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);linkArgs.push('-L'+path,'-Wl,-rpath,'+path);}linkArgs.push('-lshermes_console','-lm','-lhermesvm','-ldl','-lpthread','-o',output);
assert.equal((await run('cc',linkArgs,'link')).code,0,await readFile(resolve(directory,'link.stderr'),'utf8'));
const proof={version:1,passed:true,scope:'BUILD ONLY narrower boundary-state trace; five frozen native objects reused and two privately recompiled. All original game function bytes are preserved. Initial host tape becomes the exact first-battle prefix; runner changes20after3 to1after0 and installs identical diagnostic helper. No source/native trace comparison claim.',semanticReportMatched:null,qualifiesFor10000Target:false,baseline:{file:baselineFile,sha256:await hash(baselineFile)},helper:{file:helperFile,sha256:sha(helper)},hostInputs:{file:tapeFile,sha256:await hash(tapeFile)},compiler:{file:compiler,sha256:await hash(compiler)},privateVM:host.privateVM,units,compilations,output,outputSha256:await hash(output),linkArgs,sourceChanges:{first:{oldSha256:sha(oldFirst),newSha256:sha(first),kind:'Only JSON literal of host tape'},runner:{oldSha256:sha(oldRunner),newSha256:sha(runner),kind:'Diagnostic helper installation and run1after0'}},producer:{file:'tools/prepare-battle-boundary-native.mjs',sha256:await hash('tools/prepare-battle-boundary-native.mjs')}};
proof.dependenciesAtFinish=[];for(const [file,expected]of dependencies){const actual=await hash(file);proof.dependenciesAtFinish.push({file,sha256:expected,matched:actual===expected});assert.equal(actual,expected,'Build input changed during compile '+file);}
await writeFile(resolve(directory,'native-build.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,output,outputSha256:proof.outputSha256}));
