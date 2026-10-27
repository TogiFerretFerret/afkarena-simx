import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInContext,createContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-dictionary-lease-probe');
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=(command,args,env=process.env)=>{const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:128*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,JSON.stringify({signal:r.signal,stderr:r.stderr}));return r;};
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(child.status??1);}
const proofPath='benchmarks/validation/native-dictionary-lease-build.json',buildProof=JSON.parse(await readFile(resolve(root,proofPath)));
for(const[file,expected]of Object.entries(buildProof.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale build '+file);
assert.equal(sha(await readFile(buildProof.privateVM.output)),buildProof.privateVM.privateSha256);
assert.equal(sha(await readFile(buildProof.wrapper.output)),buildProof.wrapper.sha256);
const script=`
var simxEmptyProbe=123.25;
var events=[],rows=[],gcCalls=0,sentinel={marker:'sentinel'};
function bits(x){var b=new ArrayBuffer(8),v=new DataView(b);v.setFloat64(0,x,false);return ('00000000'+v.getUint32(0,false).toString(16)).slice(-8)+('00000000'+v.getUint32(4,false).toString(16)).slice(-8);}
function snapshot(x){return typeof x==='number'?['number',bits(x)]:x===null?['null']:typeof x==='object'?['object',x.marker]:[typeof x,x];}
function attempt(fn){try{return['return',snapshot(fn())];}catch(e){return['throw',e===sentinel?'sentinel':e.name];}}
function dictionary(prefix,reverse){var o={};for(var j=0;j<80;j++)o[prefix+j]=j;if(reverse)o.target=1;delete o[prefix+3];if(!reverse)o.target=2;return o;}
var left=dictionary('left',false),right=dictionary('right',true),target=left;
function readTarget(){return target.target;}
rows.push(['initial',snapshot(readTarget())]);
for(var i=0;i<24000;i++){
 // Alternate maps and descriptor ordinal positions, then keep same map long
 // enough to exercise ordinal hits and replace CURRENT values each read.
 target=(i%47===0)?right:left;
 var value=i%8===0?-0:i%8===1?i*0.125:i%8===2?NaN:i%8===3?{marker:i}:i%8===4?'s'+i:i%8===5?null:i%8===6?Infinity:undefined;
 Object.defineProperty(target,'target',{value:value,writable:true,enumerable:true,configurable:true});
 target['churn'+(i%307)]=i;
 if(i%3===0)delete target['churn'+((i+71)%307)];
 if(i%97===0&&typeof gc==='function'){gc();gcCalls++;}
 var read=readTarget();rows.push([i,snapshot(read),read===value||(read!==read&&value!==value)]);
 if(i%300===0){
  Object.defineProperty(target,'target',{configurable:true,get:function(){events.push('getter');return -0;}});
  rows.push(['getter',snapshot(readTarget())]);
  Object.defineProperty(target,'target',{configurable:true,get:function(){events.push('throw');throw sentinel;}});
  rows.push(['throw',attempt(readTarget)]);
  delete target.target;
  Object.defineProperty(Object.prototype,'target',{configurable:true,get:function(){events.push('inherited');return 19;}});
  rows.push(['inherited',readTarget()]);delete Object.prototype.target;
  rows.push(['missing',snapshot(readTarget())]);
  target.target=value;
  rows.push(['reinsert',snapshot(readTarget())]);
 }
}
var original=target;
var proxy=new Proxy(target,{get:function(t,k){events.push('proxy:'+String(k));return Reflect.get(t,k);}});
target=proxy;rows.push(['proxy',snapshot(readTarget())]);target=original;
// Readonly/current flags; a value cache or stale slot must not survive it.
Object.defineProperty(target,'target',{value:-0,writable:false,configurable:false});
rows.push(['readonly',snapshot(readTarget()),attempt(function(){'use strict';target.target=9;return 0;})]);
rows.push(['nonconfig-accessor',attempt(function(){Object.defineProperty(target,'target',{get:function(){return 3;}});return 0;})]);
// Exotics/typed/indexed all use the original helper and preserve getter traps.
var typed=new Uint8Array(4);typed[0]=17;rows.push(['typed',typed[0],typed.length]);
var array=[1,2,3];delete array[1];rows.push(['array',array.length,array[0],array[1]]);
var exoticEvents=[];var proto={};Object.defineProperty(proto,'x',{get:function(){exoticEvents.push('x');return 11;}});
var own=Object.create(proto);for(var z=0;z<90;z++)own['n'+z]=z;delete own.n3;rows.push(['proto-exotic',own.x]);
var sym=Symbol('private-example');own[sym]=37;rows.push(['symbol',own[sym]]);
print(JSON.stringify({rows:rows,events:events,exoticEvents:exoticEvents,gcCalls:gcCalls}));
`;
const js=resolve(directory,'probe.js');await writeFile(js,script);
const build=resolve(root,'work/downloads/hermes-build'),compiler=resolve(build,'bin/shermes'),original=resolve(directory,'original.c');
run(compiler,['-O','-emit-c',js,'-o',original]);let c=await readFile(original,'utf8');
const include='#include "hermes/VM/static_h.h"';assert.ok(c.includes(include));
c=c.replace(include,include+'\nextern bool simx_dictionary_lease_init(SHRuntime*);\nextern void simx_dictionary_lease_dump(SHRuntime*);\nextern void simx_dictionary_lease_lifecycle_dump(void);\nextern bool simx_dictionary_lease_probe_empty(SHRuntime*);\nextern bool simx_dictionary_lease_release_dead(void);\nextern bool simx_dictionary_lease_probe_live(SHRuntime*,bool,bool);');
c=c.replace('  bool success =','  if(!simx_dictionary_lease_init(shr))return 2;\n  bool success =');
c=c.replace('  _sh_done(shr);','  if(!simx_dictionary_lease_probe_empty(shr))return 3;\n  simx_dictionary_lease_dump(shr);\n  _sh_done(shr);\n  if(!simx_dictionary_lease_release_dead())return 4;\n  simx_dictionary_lease_lifecycle_dump();');
c=c.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_original_main(int argc,char **argv) {');
c+=`
int main(int argc,char **argv){
 for(int iteration=0;iteration<8;iteration++){int result=simx_original_main(argc,argv);if(result)return result;}
 SHRuntime *left=_sh_init(argc,argv);
 SHConsoleContext *leftConsole=init_console_bindings(left,0,NULL);
 if(!simx_dictionary_lease_init(left))return 5;
 if(!_sh_initialize_units(left,1,CREATE_THIS_UNIT)||!run_event_loop(left,leftConsole))return 6;
 SHRuntime *right=_sh_init(argc,argv);
 SHConsoleContext *rightConsole=init_console_bindings(right,0,NULL);
 // Cache unavailable is not VM initialization failure; original reads continue.
 if(simx_dictionary_lease_init(right))return 7;
 if(!_sh_initialize_units(right,1,CREATE_THIS_UNIT)||!run_event_loop(right,rightConsole))return 8;
 if(simx_dictionary_lease_release_dead())return 9;
 for(int i=0;i<20000;i++){
  if(!simx_dictionary_lease_probe_live(left,true,(i&1)!=0))return 10;
  if(!simx_dictionary_lease_probe_live(right,false,(i&1)==0))return 11;
 }
 if(!simx_dictionary_lease_probe_empty(left))return 12;
 simx_dictionary_lease_dump(left);
 simx_dictionary_lease_lifecycle_dump();
 release_console_bindings(leftConsole);_sh_done(left);free_console_context(leftConsole);
 // Matching TLS ownership is cleared automatically at owner shutdown.
 simx_dictionary_lease_lifecycle_dump();
 // The second still-live runtime adopts a new lease after owner shutdown.
 if(!simx_dictionary_lease_init(right))return 13;
 for(int i=0;i<20000;i++)if(!simx_dictionary_lease_probe_live(right,true,(i&1)!=0))return 14;
 if(!simx_dictionary_lease_probe_empty(right))return 15;
 simx_dictionary_lease_dump(right);
 simx_dictionary_lease_lifecycle_dump();
 release_console_bindings(rightConsole);_sh_done(right);free_console_context(rightConsole);
 simx_dictionary_lease_lifecycle_dump();
 if(!simx_dictionary_lease_release_dead()||!simx_dictionary_lease_release_dead())return 16;
 simx_dictionary_lease_lifecycle_dump();
 return 0;
}
`;

const patched=resolve(directory,'patched.c');await writeFile(patched,c);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),binary=resolve(directory,'probe'),baseline=resolve(directory,'original');
function link(input,output,wrapped){const args=[input,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')];if(wrapped)args.push(buildProof.wrapper.output,buildProof.wrapper.linkFlag,'-L'+resolve(buildProof.privateVM.output,'..'),'-Wl,-rpath,'+resolve(buildProof.privateVM.output,'..'));for(const lib of['lib','jsi','tools/shermes']){const p=resolve(build,lib);args.push('-L'+p,'-Wl,-rpath,'+p);}args.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',output);run('cc',args);return args;}
const compileArgs=link(patched,binary,true),baselineArgs=link(original,baseline,false);
let expected;const nodeContext=createContext(constants.DONT_CONTEXTIFY);nodeContext.print=t=>expected=JSON.parse(t);nodeContext.gc=()=>{};runInContext(script,nodeContext);
const originalRun=run(baseline,['-Xhermes-internal-test-methods']),originalReport=JSON.parse(originalRun.stdout);assert.deepEqual(originalReport,expected,'Untouched native differs from Node');
const executed=run(binary,['-Xhermes-internal-test-methods'],{...process.env,LD_LIBRARY_PATH:resolve(buildProof.privateVM.output,'..')});
const reports=executed.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(reports.length,10);for(const report of reports)assert.deepEqual(report,expected);
const counters=[...executed.stderr.matchAll(/^dictionary_lease:(.+)$/gm)].map(m=>JSON.parse(m[1])),lifecycle=[...executed.stderr.matchAll(/^dictionary_lease_lifecycle:(.+)$/gm)].map(m=>JSON.parse(m[1]));
assert.equal(counters.length,10);assert.equal(lifecycle.length,13);
for(let i=0;i<8;i++){
 assert.ok(counters[i].hits>=20000);assert.ok(counters[i].learned>0);assert.ok(counters[i].special>0);assert.ok(counters[i].noOwn>0);assert.ok(counters[i].empty>0);
 assert.equal(lifecycle[i].created,i+1);assert.equal(lifecycle[i].destroyed,i+1);assert.equal(lifecycle[i].liveContexts,0);assert.equal(lifecycle[i].otherRuntimeFallbacks,0);
}
for(const entry of lifecycle)assert.ok(entry.liveContexts<=1,'Lease state count must remain bounded');
const pairLifecycle=lifecycle.slice(8);
assert.deepEqual(pairLifecycle.map(x=>[x.created,x.destroyed,x.liveContexts]),[[9,8,1],[9,9,0],[10,9,1],[10,10,0],[10,10,0]]);
assert.ok(pairLifecycle[0].otherRuntimeFallbacks>=20000);
for(const entry of pairLifecycle)assert.equal(entry.otherRuntimeFallbacks,pairLifecycle[0].otherRuntimeFallbacks);
assert.ok(counters[8].hits>=counters[0].hits+19999);assert.ok(counters[8].learned>=counters[0].learned+1);assert.ok(counters[8].empty>0);
assert.ok(counters[9].hits>=19999);assert.ok(counters[9].empty>0);

const raw=JSON.stringify({script,expected,untouchedNative:originalReport,reports,stdout:executed.stdout,stderr:executed.stderr});
const archive='benchmarks/validation/native-dictionary-lease.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(raw));
const sources={...buildProof.sources,'tools/native-dictionary-lease-probe.mjs':sha(await readFile(resolve(root,'tools/native-dictionary-lease-probe.mjs')))};
for(const[file,expected]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),expected);
const handleFile=resolve(root,'work/downloads',config.source.directory,'include/hermes/VM/HandleRootOwner.h'),handleSource=await readFile(handleFile,'utf8');
const markerStart=handleSource.indexOf('class GCScopeMarkerRAII {');assert.ok(markerStart>=0);
const scopeContext={file:handleFile,sourceSha256:sha(handleSource),text:handleSource.slice(markerStart,markerStart+1100)};
const helperSource=await readFile(resolve(root,'tools/native-compiler-patches/dictionary-lease-host.inc'),'utf8');
assert.match(helperSource,/simx_dictionary_lease_probe_empty[\s\S]*?GCScope gcScope\(runtime\)/);
const proof={version:1,passed:true,semanticProofPassed:true,privateVM:buildProof.privateVM,wrapper:buildProof.wrapper,sources,buildProof:{file:proofPath,sha256:sha(await readFile(resolve(root,proofPath)))},iterations:8,mutationCasesPerIteration:24000,interleavedRuntimeProof:{passed:true,runtimes:2,interleavedChecks:20000,adoptionChecks:20000,bothSourceReportsMatched:true,secondRuntimeOriginalFallback:true,deadOwnerCleared:true,automaticShutdownRelease:true,releaseDeadIdempotent:true,releaseWhileAliveRejected:true,adoptionRetiredOldLease:true,boundedLiveContexts:1,lifecycle:pairLifecycle},noPerReadSharedRefcounts:true,sameMutatorThreadRequired:true,forcedCollectionsPerIteration:expected.gcCalls,counters,lifecycle,compilerSha256:sha(await readFile(compiler)),generatedSourceSha256:sha(script),generatedCSha256:sha(await readFile(original)),patchedCSha256:sha(c),binarySha256:sha(await readFile(binary)),compileArgs,baselineArgs,archive:{file:archive,uncompressedSha256:sha(raw)},untouchedNativeMatched:true,nodeMatched:true,emptyGuardTested:true,originalClassDefinitionsUnchanged:true,qualifiesFor10000Target:false,oracleProfile:profile,setupFailure:{passed:false,signal:'SIGSEGV',reached:'Empty probe entry before global/object/map access',cause:'The first probe-only C export used GCScopeMarkerRAII after run_event_loop returned to C main, where there is no active GCScope. The marker constructor dereferenced the absent top scope. This was a test entry-scope bug, not an Empty decoder or dictionary hint result.',fix:'Probe-only export now creates its own real GCScope before any handles/markers. Wrapped SH helper is called only during JS under its existing active scope; the C Empty probe establishes this precondition before calling it. All eight corrected runs exercise Empty rejection and restore the original slot before returning.'},scopeContext,noAllocationContract:'NoAllocScope is a debug assertion contract and a release no-op, not a collector lock. Correctness relies on the actual fast path performing no JS execution or VM allocation/GC safepoint while current raw map/descriptor/storage pointers are used. C++ ownership/refcount bookkeeping does not trigger VM GC.',scope:'Isolated actual native dictionary hint differential versus Node and untouched native VM. Current maps, descriptor count/key/flags/slot/storage under same-site cross-map alternation, descriptor deletion/reinsertion, growth/compaction, explicit forced collection, signedzero/NaN/current aliases, accessor and inherited getter order, missing properties, exact thrown sentinel, readonly current flags, indexed/typed/Proxy/symbol fallbacks and eight runtime teardown cycles. Integer-only hints; no retained heap pointers or modified class definitions. No full-battle fidelity or throughput claim.'};
await writeFile(resolve(root,'benchmarks/validation/native-dictionary-lease.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,iterations:8,counters,lifecycle}));
