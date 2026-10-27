import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInContext,createContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-global-ed-prefilter-probe');
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=(command,args,env=process.env)=>{const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:128*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r;};
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(child.status??1);}
const proofPath='benchmarks/validation/native-global-ed-prefilter-build.json',buildProof=JSON.parse(await readFile(resolve(root,proofPath)));
for(const[file,expected]of Object.entries(buildProof.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale build '+file);
assert.equal(sha(await readFile(buildProof.privateVM.output)),buildProof.privateVM.privateSha256);
assert.equal(sha(await readFile(buildProof.wrapper.output)),buildProof.wrapper.sha256);
const script=`
var G=globalThis,events=[],rows=[],gcCalls=0;
function bits(x){var b=new ArrayBuffer(8),v=new DataView(b);v.setFloat64(0,x,false);return ('00000000'+v.getUint32(0,false).toString(16)).slice(-8)+('00000000'+v.getUint32(4,false).toString(16)).slice(-8);}
function snapshot(x){return typeof x==='number'?['number',bits(x)]:x===null?['null']:typeof x==='object'?['object',x.marker]:[typeof x,x];}
function readPermanent(){return G.ed;}
function readConfigurable(){return G.simxConfigurable;}
function attempt(fn){try{return['return',snapshot(fn())];}catch(e){return['throw',e===sentinel?'sentinel':e.name];}}
Object.defineProperty(G,'ed',{configurable:true,get:function(){events.push('early-ed-get');return 33;}});rows.push(['early-ed-get',G.ed]);delete G.ed;
Object.defineProperty(G,'ed',{value:44,writable:true,configurable:true});rows.push(['early-ed-data',G.ed]);delete G.ed;
Object.defineProperty(Object.prototype,'ed',{configurable:true,get:function(){events.push('early-ed-inherited');return 55;}});rows.push(['early-ed-inherited',G.ed]);delete Object.prototype.ed;rows.push(['early-ed-missing',snapshot(G.ed)]);
Object.defineProperty(G,'ed',{value:-0,writable:true,enumerable:true,configurable:false});
Object.defineProperty(G,'simxConfigurable',{value:1,writable:true,enumerable:true,configurable:true});
Object.defineProperty(G,'simxAccessor',{configurable:false,get:function(){events.push('accessor');return -0;}});
var sentinel={marker:'sentinel'};
Object.defineProperty(G,'simxThrow',{configurable:false,get:function(){events.push('throw');throw sentinel;}});
Object.defineProperty(Object.prototype,'simxInherited',{configurable:true,get:function(){events.push('inherited');return 17;}});
// Warm one permanent slot, then churn OTHER dictionary entries and storage.
rows.push(['initial',snapshot(readPermanent())]);
for(var i=0;i<20000;i++){
 var value=i%7===0?-0:i%7===1?i*0.125:i%7===2?NaN:i%7===3?{marker:i}:i%7===4?'s'+i:i%7===5?null:undefined;
 G.ed=value;
 G['simxChurn'+(i%307)]=i;
 if(i%3===0)delete G['simxChurn'+((i+71)%307)];
 if(i%97===0&&typeof gc==='function'){gc();gcCalls++;}
 var read=readPermanent();rows.push([i,snapshot(read),read===value||(read!==read&&value!==value)]);
 if(i%1000===0){G.simxConfigurable=i;rows.push(['config',snapshot(readConfigurable())]);delete G.simxConfigurable;Object.defineProperty(G,'simxConfigurable',{configurable:true,get:function(){events.push('config-get');return 99;}});rows.push(['config-get',readConfigurable()]);delete G.simxConfigurable;Object.defineProperty(G,'simxConfigurable',{value:i+1,writable:true,configurable:true});}
}
rows.push(['accessor',snapshot(G.simxAccessor)]);
rows.push(['throw',attempt(function(){return G.simxThrow;})]);
rows.push(['inherited',G.simxInherited]);
rows.push(['missing',snapshot(G.simxMissing)]);
Object.defineProperty(G,'12',{value:123,configurable:false});rows.push(['index',G['12']]);
var proxy=new Proxy(G,{get:function(t,k){events.push('proxy:'+String(k));return Reflect.get(t,k);}});
rows.push(['proxy',snapshot(proxy.ed)]);
var local={ed:'local-own-value'};rows.push(['same-SymbolID-local',local.ed]);Object.defineProperty(local,'ed',{get:function(){events.push('local-ed-get');return 123;}});rows.push(['same-SymbolID-local-accessor',local.ed]);
G.globalThis={ed:'different globalThis object'};
rows.push(['reassigned-globalThis',snapshot(readPermanent()),globalThis.ed]);
Object.defineProperty(G,'ed',{writable:false});
rows.push(['readonly',attempt(function(){'use strict';G.ed=77;return G.ed;})]);
rows.push(['delete',delete G.ed]);
rows.push(['reconfigure',attempt(function(){Object.defineProperty(G,'ed',{get:function(){return 44;}});return 0;})]);
rows.push(['final',snapshot(readPermanent())]);
delete Object.prototype.simxInherited;
var capacityReaders=[${Array.from({length:80},(_,i)=>'function(){return G.simxCapacity'+i+';}').join(',')}];
for(var k=0;k<80;k++){Object.defineProperty(G,'simxCapacity'+k,{value:k+0.5,writable:true,configurable:false});rows.push(['capacity',k,capacityReaders[k]()]);}
for(var k=0;k<80;k++){G['simxCapacity'+k]=-k-0.25;rows.push(['capacity-current',k,capacityReaders[k]()]);}
print(JSON.stringify({rows:rows,events:events,gcCalls:gcCalls}));
`;
const js=resolve(directory,'probe.js');await writeFile(js,script);
const build=resolve(root,'work/downloads/hermes-build'),compiler=resolve(build,'bin/shermes'),original=resolve(directory,'original.c');
run(compiler,['-O','-emit-c',js,'-o',original]);let c=await readFile(original,'utf8');
const include='#include "hermes/VM/static_h.h"';assert.ok(c.includes(include));
c=c.replace(include,include+'\nextern bool simx_global_slot_init(SHRuntime*);\nextern void simx_global_slot_dump(SHRuntime*);\nextern void simx_global_slot_lifecycle_dump(void);');
c=c.replace('  bool success =','  if(!simx_global_slot_init(shr))return 2;\n  bool success =');
c=c.replace('  _sh_done(shr);','  simx_global_slot_dump(shr);\n  _sh_done(shr);\n  simx_global_slot_lifecycle_dump();');
c=c.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_original_main(int argc,char **argv) {');
c+='\nint main(int argc,char **argv){for(int iteration=0;iteration<8;iteration++){int result=simx_original_main(argc,argv);if(result)return result;}return 0;}\n';
const patched=resolve(directory,'patched.c');await writeFile(patched,c);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),binary=resolve(directory,'probe'),baseline=resolve(directory,'original');
function link(input,output,wrapped){const args=[input,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')];if(wrapped)args.push(buildProof.wrapper.output,buildProof.wrapper.linkFlag,'-L'+resolve(buildProof.privateVM.output,'..'),'-Wl,-rpath,'+resolve(buildProof.privateVM.output,'..'));for(const lib of['lib','jsi','tools/shermes']){const p=resolve(build,lib);args.push('-L'+p,'-Wl,-rpath,'+p);}args.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',output);run('cc',args);return args;}
const compileArgs=link(patched,binary,true),baselineArgs=link(original,baseline,false);
let expected;const nodeContext=createContext(constants.DONT_CONTEXTIFY);nodeContext.print=t=>expected=JSON.parse(t);nodeContext.gc=()=>{};runInContext(script,nodeContext);
const originalRun=run(baseline,['-Xhermes-internal-test-methods']),originalReport=JSON.parse(originalRun.stdout);assert.deepEqual(originalReport,expected,'Untouched native differs from Node');
const executed=run(binary,['-Xhermes-internal-test-methods'],{...process.env,LD_LIBRARY_PATH:resolve(buildProof.privateVM.output,'..')});
const reports=executed.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(reports.length,8);for(const report of reports)assert.deepEqual(report,expected);
const activePrefilters=[...executed.stderr.matchAll(/^global_ed_prefilter_active:(.+)$/gm)].map(m=>JSON.parse(m[1]));assert.equal(activePrefilters.length,8);for(const hint of activePrefilters){assert.equal(hint.runtimeKeyMatches,true);assert.equal(hint.valid,1);assert.ok(hint.symbol>0);}
const prefilters=[...executed.stderr.matchAll(/^global_ed_prefilter:(.+)$/gm)].map(m=>JSON.parse(m[1]));assert.equal(prefilters.length,8);for(const hint of prefilters)assert.deepEqual(hint,{runtimeKeyCleared:true,symbol:0,valid:0});
const counters=[...executed.stderr.matchAll(/^global_slot_cache:(.+)$/gm)].map(m=>JSON.parse(m[1])),lifecycle=[...executed.stderr.matchAll(/^global_slot_lifecycle:(.+)$/gm)].map(m=>JSON.parse(m[1]));
assert.equal(counters.length,8);assert.equal(lifecycle.length,8);for(let i=0;i<8;i++){assert.ok(counters[i].hits>=20000);assert.equal(counters[i].capacityRejected,0);assert.equal(counters[i].entries,1);assert.ok(counters[i].configurable>=2);assert.ok(counters[i].notOwn>=2);assert.equal(counters[i].edSeen,true);assert.equal(counters[i].edPresent,true);assert.equal(lifecycle[i].created,i+1);assert.equal(lifecycle[i].destroyed,i+1);}
const raw=JSON.stringify({script,expected,untouchedNative:originalReport,reports,stdout:executed.stdout,stderr:executed.stderr});
const archive='benchmarks/validation/native-global-ed-prefilter.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(raw));
const sources={...buildProof.sources,'tools/native-global-ed-prefilter-probe.mjs':sha(await readFile(resolve(root,'tools/native-global-ed-prefilter-probe.mjs')))};
for(const[file,expected]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),expected);
const proof={version:1,passed:true,semanticProofPassed:true,privateVM:buildProof.privateVM,wrapper:buildProof.wrapper,sources,buildProof:{file:proofPath,sha256:sha(await readFile(resolve(root,proofPath)))},iterations:8,mutationCasesPerIteration:20000,forcedCollectionsPerIteration:expected.gcCalls,counters,lifecycle,prefilters,activePrefilters,compilerSha256:sha(await readFile(compiler)),generatedSourceSha256:sha(script),generatedCSha256:sha(await readFile(original)),patchedCSha256:sha(c),binarySha256:sha(await readFile(binary)),compileArgs,baselineArgs,archive:{file:archive,uncompressedSha256:sha(raw)},untouchedNativeMatched:true,nodeMatched:true,qualifiesFor10000Target:false,oracleProfile:profile,scope:'Isolated actual native GNU-wrapped slow-get probe. Selective ed-only integer cache of a nonconfigurable actual-global own data slot, current-value reads under dictionary/storage growth and unrelated deletes, explicit GC, signed zero and NaN bits, value identity changes, readonly transition, configurable/accessor/inherited/missing/proxy rejection, exception identity, globalThis reassignment, and eight VM teardown/reinitialization cycles. No full-battle fidelity or throughput claim.'};
await writeFile(resolve(root,'benchmarks/validation/native-global-ed-prefilter.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,iterations:8,counters,lifecycle}));
