import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Separate SHUnits share the JavaScript global environment. Initialize verified
// declaration/effect partitions in their recorded source order.
export async function compileNativeUnits({root,metadata,input,output,compiler,ccOpt,runnerOpt=ccOpt,reuseManifest,binaryPools,run,sha,jobs=2}) {
  assert.ok(Number.isSafeInteger(jobs)&&jobs>0&&jobs<=4,'Native compile jobs must be 1..4');
  const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8'));
  const build=resolve(root,'work/downloads/hermes-build');
  const include=resolve(root,'work/downloads',config.source.directory,'include');
  const units=[...metadata.factoryChunks.map((chunk,index)=>({...chunk,name:chunk.nativeName??'factories_'+index})),{file:input,sha256:metadata.outputSha256,name:metadata.nativeRunnerName??'runner'}];
  assert.ok(units.length<=7,'Pinned SHRuntime ABI supports at most 7 SHUnits; index zero is reserved');
  assert.equal(new Set(units.map(unit=>unit.name)).size,units.length,'Native export names must be unique');
  assert.ok(units.every(unit=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(unit.name)),'Native export names must be C identifiers');
  const directory=output+'.units';await mkdir(directory,{recursive:true});
  let next=0;
  async function worker(){
    while(next<units.length){
      const unit=units[next++];
      assert.equal(sha(await readFile(unit.file)),unit.sha256,'Native unit source changed after emission');
      unit.object=resolve(directory,unit.name+'.o');
      const env={...process.env};
      if(binaryPools){unit.poolDirectory=resolve(directory,unit.name+'.string-pools');await mkdir(unit.poolDirectory,{recursive:true});env.SHERMES_BINARY_STRING_DIR=unit.poolDirectory;}
      else delete env.SHERMES_BINARY_STRING_DIR;
      const reused=reuseManifest?.units.find(record=>record.name===unit.name);
      if(reused){
        assert.equal(unit.sha256,reused.sourceSha256,'Reused native unit has different source');
        assert.equal(sha(await readFile(reused.object)),reused.objectSha256,'Reused native object changed');
        assert.equal(reused.object,unit.object,'Resume requires the original dedicated unit directory');
        if(reuseManifest.kind==='exact-native-object-cache-v1'){
          const opt=unit.name==='runner'?runnerOpt:ccOpt;
          assert.equal(reused.compilerSha256,sha(await readFile(compiler)),'Reused compiler changed');
          assert.deepEqual(reused.compileArgs,['-O','-c','-exported-unit='+unit.name,`-Wc,-${opt},-g0,-ffp-contract=off`,unit.file,'-o',unit.object],'Reused compilation flags or source path changed');
        }
        unit.reusedObject=reused;continue;
      }
      const opt=unit.name==='runner'?runnerOpt:ccOpt;
      assert.ok(['O0','Og','O1','O2','O3','Os'].includes(opt));
      unit.compilerSha256=sha(await readFile(compiler));
      unit.compileArgs=['-O','-c','-exported-unit='+unit.name,`-Wc,-${opt},-g0,-ffp-contract=off`,unit.file,'-o',unit.object];
      const result=await run(compiler,unit.compileArgs,unit.object+'.stdout',unit.object+'.stderr',env);
      assert.equal(result.code,0,await readFile(unit.object+'.stderr','utf8'));
    }
  }
  await Promise.all(Array.from({length:Math.min(jobs,units.length)},worker));
  const wrapper=resolve(directory,'main.c');
  await writeFile(wrapper,`#include "hermes/VM/static_h.h"
#include <stdlib.h>
typedef struct SHConsoleContext SHConsoleContext;
SHConsoleContext *init_console_bindings(SHRuntime *,int,const char *const *);
void release_console_bindings(SHConsoleContext *);
void free_console_context(SHConsoleContext *);
bool run_event_loop(SHRuntime *,SHConsoleContext *);
${units.map(unit=>'SHUnit *sh_export_'+unit.name+'(void);').join('\n')}
int main(int argc,char **argv) {
  int scriptArgc=0,clArgc=argc;char **scriptArgv=NULL;
  for(int i=1;i<argc;i++)if(argv[i][0]=='-'&&argv[i][1]=='-'&&argv[i][2]=='\\0'){scriptArgc=argc-i-1;scriptArgv=argv+i+1;clArgc=i;break;}
  SHRuntime *shr=_sh_init(clArgc,argv);
  SHConsoleContext *console=init_console_bindings(shr,scriptArgc,(const char *const *)scriptArgv);
  bool success=_sh_initialize_units(shr,${units.length},${units.map(unit=>'sh_export_'+unit.name).join(',')})&&run_event_loop(shr,console);
  release_console_bindings(console);_sh_done(shr);free_console_context(console);
  return success?0:1;
}
`);
  const linkArgs=[wrapper,...units.map(unit=>unit.object),'-O2','-g0','-DNDEBUG','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+include];
  for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);linkArgs.push('-L'+path,'-Wl,-rpath,'+path);}
  linkArgs.push('-lshermes_console','-lm','-lhermesvm','-o',output);
  const result=await run(process.env.CC??'cc',linkArgs,output+'.compile.stdout',output+'.compile.stderr');
  return {...result,units,linkArgs,wrapperSha256:sha(await readFile(wrapper))};
}
