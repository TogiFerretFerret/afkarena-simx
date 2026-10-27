import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {buildPrivateVMHelper} from './native-private-vm.mjs';

const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-measured-clock-probe');
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=(command,args,env=process.env)=>{const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r;};
const basePath='benchmarks/validation/native-measured-clock-build.json',base=JSON.parse(await readFile(resolve(root,basePath)));
for(const [file,expected] of Object.entries(base.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale clock build '+file);
const script=`
var mode=hermescli.getScriptArgs()[0],events=[],savedDate=Date,savedNow=Date.now,savedPrototype=Date.prototype,savedConstructorPrototype=Object.getPrototypeOf(Date);
function flags(d){return d?{enumerable:d.enumerable,configurable:d.configurable,writable:d.writable,accessor:!('value'in d)}:null;}
function attempt(fn){try{return{value:fn()};}catch(e){return{error:e.name};}}
var success=mode.indexOf('success-')===0;
if(mode==='inherited')Object.defineProperty(Object.getPrototypeOf(globalThis),'__nativeWallNow',{value:Date.now,configurable:true});
else if(mode==='accessor')Object.defineProperty(globalThis,'__nativeWallNow',{configurable:true,get:function(){events.push('get');throw new Error('read');},set:function(){events.push('set');}});
else if(mode!=='missing'){
 var value=Date.now;
 if(mode==='js-function')value=function(){events.push('call');return 1;};
 if(mode==='proxy')value=new Proxy(Date.now,{get:function(){events.push('get');throw new Error('get');},apply:function(){events.push('call');throw new Error('call');}});
 if(mode==='number')value=7;
 if(mode==='constructor')value=Date;
 Object.defineProperty(globalThis,'__nativeWallNow',{value:value,writable:mode!=='readonly',enumerable:success?mode.charAt(8)==='1':true,configurable:success?mode.charAt(10)==='1':true});
}
var before=Object.getOwnPropertyDescriptor(globalThis,'__nativeWallNow'),install=attempt(function(){return __probeInstallClock();}),after=Object.getOwnPropertyDescriptor(globalThis,'__nativeWallNow');
var result={mode:mode,install:install,before:flags(before),after:flags(after),events:events.slice(),callsAfterInstall:__probeClockCalls(),bindingUnchanged:before&&after?before.value===after.value&&before.get===after.get&&before.set===after.set:before===after};
if(success){
 result.argFirst=attempt(function(){return __nativeWallNow(1);});result.callsAfterArg=__probeClockCalls();
 result.start=__nativeWallNow();var sum=0;for(var i=0;i<10000;i++)sum+=i;
 result.end=__nativeWallNow();result.delta=result.end-result.start;
 result.third=attempt(function(){return __nativeWallNow();});
 result.argAfter=attempt(function(){return __nativeWallNow(2);});
 result.repeat=attempt(function(){return __probeInstallClock();});
 result.name=__nativeWallNow.name;result.arity=__nativeWallNow.length;
}
result.calls=__probeClockCalls();result.dateUnchanged=Date===savedDate&&Date.now===savedNow&&Date.prototype===savedPrototype&&Object.getPrototypeOf(Date)===savedConstructorPrototype;
result.dateCallable=typeof Date()==='string'&&Object.getPrototypeOf(new Date())===savedPrototype;
print(JSON.stringify(result));
`;
const js=resolve(directory,'probe.js');await writeFile(js,script);
const privateVM=await buildPrivateVMHelper({root,directory,helperFile:'tools/native-compiler-patches/measured-clock-probe.inc'});
const build=resolve(root,'work/downloads/hermes-build'),compiler=resolve(build,'bin/shermes'),cfile=resolve(directory,'probe.c');
run(compiler,['-O','-emit-c',js,'-o',cfile]);let c=await readFile(cfile,'utf8');
const include='#include "hermes/VM/static_h.h"';assert.ok(c.includes(include));c=c.replace(include,include+'\nextern bool simx_install_clock_probe(SHRuntime *shr);');
const init=/init_console_bindings\(shr, scriptArgc, \(const char \*const \*\)scriptArgv\);/;assert.ok(init.test(c));c=c.replace(init,text=>text+'\nif(!simx_install_clock_probe(shr))return 2;');await writeFile(cfile,c);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),binary=resolve(directory,'probe');
const args=[cfile,'-O1','-g0','-DNDEBUG','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include'),'-L'+directory,'-Wl,-rpath,'+directory];
for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);args.push('-L'+path,'-Wl,-rpath,'+path);}args.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',binary);run('cc',args);
const modes=['missing','inherited','accessor','readonly','js-function','proxy','number','constructor','success-0-0','success-0-1','success-1-0','success-1-1'];
const results=[];
for(const mode of modes){
 const executed=run(binary,['-Xhermes-internal-test-methods','--',mode],{...process.env,LD_LIBRARY_PATH:directory});
 const actual=JSON.parse(executed.stdout),markers=[...executed.stderr.matchAll(/^simx_measure_(start|end)_ns:(\d+)$/gm)].map(m=>({phase:m[1],ns:m[2]}));
 assert.equal(actual.mode,mode);assert.equal(actual.dateUnchanged,true);assert.equal(actual.dateCallable,true);assert.deepEqual(actual.events,[]);assert.deepEqual(actual.before,actual.after);assert.equal(actual.callsAfterInstall,0);
 if(mode.startsWith('success-')){
  assert.deepEqual(actual.install,{value:true});assert.equal(actual.bindingUnchanged,false);assert.equal(actual.name,'now');assert.equal(actual.arity,0);assert.equal(actual.callsAfterArg,0);assert.equal(actual.calls,2);
  for(const key of ['argFirst','third','argAfter','repeat'])assert.deepEqual(actual[key],{error:'TypeError'});
  assert.deepEqual(markers.map(m=>m.phase),['start','end']);assert.ok(BigInt(markers[1].ns)>=BigInt(markers[0].ns));
  assert.equal(actual.start,Number(markers[0].ns)/1e6);assert.equal(actual.end,Number(markers[1].ns)/1e6);assert.equal(actual.delta,actual.end-actual.start);
 }else{assert.deepEqual(actual.install,{error:'TypeError'});assert.equal(actual.bindingUnchanged,true);assert.equal(actual.calls,0);assert.deepEqual(markers,[]);}
 results.push({mode,actual,markers,stdout:executed.stdout,stderr:executed.stderr});
}
const sources={...base.sources};for(const file of ['tools/native-measured-clock-probe.mjs','tools/native-compiler-patches/measured-clock-probe.inc'])sources[file]=sha(await readFile(resolve(root,file)));
for(const [file,expected] of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Changed probe input '+file);
const raw=JSON.stringify({script,results}),archive='benchmarks/validation/native-measured-clock.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(raw));
const report={version:1,passed:true,cases:modes.length,successCases:4,rejectedInstallCases:8,privateVM,productionClockBuild:{file:basePath,sha256:sha(await readFile(resolve(root,basePath)))},sources,compilerSha256:sha(await readFile(compiler)),binarySha256:sha(await readFile(binary)),scriptSha256:sha(script),archive:{file:archive,uncompressedSha256:sha(raw)},qualifiesFor10000Target:false,scope:'Actual tiny Static Hermes VM probe of production measured-clock helper, included unchanged with probe-only access functions. Validates guard rejection without JS getters/proxy effects, four preserved descriptor flag combinations, original Date identities, exactly two ordered monotonic ns markers and matching returned millisecond delta; invalid arguments/third call/reinstallation add no markers. Diagnostic timer contract only, no battle fidelity or throughput claim.'};
await writeFile(resolve(root,'benchmarks/validation/native-measured-clock.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:modes.length}));
