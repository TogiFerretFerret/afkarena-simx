import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {patchEntityUpdateC} from './native-entity-update.mjs';
import {firstDifference} from './native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-entity-update');
await mkdir(directory,{recursive:true});
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)||(process.env.NODE_OPTIONS||'')!==profile.rawBitReferenceNodeOptions){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:profile.rawBitReferenceNodeOptions},stdio:'inherit'});if(child.error)throw child.error;process.exit(child.status??1);}
const sha=value=>createHash('sha256').update(value).digest('hex');
const contract=JSON.parse(await readFile(resolve(root,'config/entity-translation.json'),'utf8'));
const source=(await readFile(resolve(root,contract.source),'utf8')).slice(contract.start,contract.end);assert.equal(sha(source),contract.sha256);
const buffer=new ArrayBuffer(8),view=new DataView(buffer);const bits=value=>{view.setFloat64(0,value,false);return view.getBigUint64(0,false).toString(16).padStart(16,'0');};
let random=0x51fab23;function next(){random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;}
const edges=[0,-0,1,-1,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,1e150,-1e150,1e-150,-1e-150];
const cases=Array.from({length:20000},(_,index)=>[...Array.from({length:6},(_,j)=>bits(index<1000?edges[(index+j)%edges.length]:(next()-0x80000000)/128)),index%3===0]);
const input=resolve(directory,'cases.json');await writeFile(input,JSON.stringify(cases));
const script=`var update=${source};
function bits(value){var a=new ArrayBuffer(8),v=new DataView(a);v.setFloat64(0,value,false);function hex(x){var s=x.toString(16);while(s.length<8)s='0'+s;return s;}return hex(v.getUint32(0,false))+hex(v.getUint32(4,false));}
function number(text){var a=new ArrayBuffer(8),v=new DataView(a);v.setUint32(0,parseInt(text.slice(0,8),16),false);v.setUint32(4,parseInt(text.slice(8),16),false);return v.getFloat64(0,false);}
var bytes=hermescli.loadFile(${JSON.stringify(input)}),wire='';for(var i=0;i<bytes.length;i++)wire+=String.fromCharCode(bytes[i]);var cases=JSON.parse(wire),outputs=[],expectedHits=0;
function ownValue(o,key){var d=Object.getOwnPropertyDescriptor(o,key);return !d?'missing':!('value' in d)?'accessor':typeof d.value==='number'?bits(d.value):'type:'+typeof d.value;}\nfunction state(e,p,v){return {position:[ownValue(p,'0'),ownValue(p,'1')],velocity:[ownValue(v,'0'),ownValue(v,'1')],direction:ownValue(e,'direction'),alias:p===v};}
for(var i=0;i<cases.length;i++){var c=cases[i],p=[number(c[0]),number(c[1])],v=c[6]?p:[number(c[2]),number(c[3])],e={position:p,velocity:v,direction:number(c[4])},dt=number(c[5]);
 for(var pass=0;pass<2;pass++){if(p.every(Number.isFinite)&&v.every(Number.isFinite)&&Number.isFinite(e.direction)&&Number.isFinite(dt))expectedHits++;update.call(e,dt);outputs.push(state(e,p,v));}}
var fallback=[],events=[];
function check(label,make){events=[];var fixture=make(),error=null;try{update.call(fixture.e,fixture.dt===undefined?0.5:fixture.dt);}catch(e){error={name:e.name,message:e.message};}var observed=events.slice();fallback.push({label:label,events:observed,state:state(fixture.e,fixture.p,fixture.v),error:error});}
function ordinary(){var p=[2,3],v=[-4,5];return{e:{position:p,velocity:v,direction:1},p:p,v:v};}
check('aliased-update-reverses-direction',function(){var f=ordinary();f.e.velocity=f.p;f.v=f.p;f.dt=-2;expectedHits++;return f;});\ncheck('infinite-dt',function(){var f=ordinary();f.dt=Infinity;return f;});\ncheck('nan-dt',function(){var f=ordinary();f.dt=NaN;return f;});\ncheck('frozen-position',function(){var f=ordinary();Object.freeze(f.p);return f;});
check('sealed-position-eligible',function(){var f=ordinary();Object.seal(f.p);expectedHits++;return f;});
check('readonly-direction',function(){var f=ordinary();Object.defineProperty(f.e,'direction',{writable:false});return f;});
check('frozen-entity',function(){var f=ordinary();Object.freeze(f.e);return f;});
check('position-getter',function(){var f=ordinary();Object.defineProperty(f.e,'position',{get:function(){events.push('position');return f.p;}});return f;});
check('velocity-getter',function(){var f=ordinary();Object.defineProperty(f.e,'velocity',{get:function(){events.push('velocity');return f.v;}});return f;});
check('direction-getter',function(){var f=ordinary();Object.defineProperty(f.e,'direction',{get:function(){events.push('direction');return 1;},set:function(x){events.push('direction-set:'+bits(x));}});return f;});
check('proxy-entity',function(){var f=ordinary();f.e=new Proxy(f.e,{get:function(t,k){events.push('entity-get:'+k);return t[k];},set:function(t,k,x){events.push('entity-set:'+k);t[k]=x;return true;}});return f;});
check('proxy-position',function(){var f=ordinary();f.e.position=new Proxy(f.p,{get:function(t,k){events.push('p-get:'+k);return t[k];},set:function(t,k,x){events.push('p-set:'+k);t[k]=x;return true;}});return f;});
check('y-getter-observes-x-write',function(){var f=ordinary();Object.defineProperty(f.v,'1',{get:function(){events.push('x-now:'+bits(f.p[0]));return 5;}});return f;});
check('position-y-readonly',function(){var f=ordinary();Object.defineProperty(f.p,'1',{writable:false});return f;});
check('position-hole',function(){var f=ordinary();delete f.p[0];return f;});
check('inherited-position',function(){var f=ordinary(),e=Object.create(f.e);e.direction=1;f.e=e;return f;});
check('coercing-dt',function(){var f=ordinary();f.dt={valueOf:function(){events.push('dt');return 0.5;}};return f;});
check('coercing-vector',function(){var f=ordinary();f.v[0]={valueOf:function(){events.push('v0');return -4;}};return f;});
check('throwing-getter-after-x-write',function(){var f=ordinary();Object.defineProperty(f.v,'1',{get:function(){events.push('x-now:'+bits(f.p[0]));throw Error('source getter');}});return f;});
print(JSON.stringify({outputs:outputs,fallback:fallback,expectedHits:expectedHits,functionSource:update.toString()}));`;
const jsfile=resolve(directory,'probe.js');await writeFile(jsfile,script);
function run(command,args,env=process.env){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:64*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8')),build=resolve(root,'work/downloads/hermes-build'),checkout=resolve(root,'work/downloads',config.source.directory),compiler=resolve(build,'bin/shermes'),pools=resolve(directory,'pools');await mkdir(pools,{recursive:true});
const cfile=resolve(directory,'original.c');run(compiler,['-O','-emit-c',jsfile,'-o',cfile],{...process.env,SHERMES_BINARY_STRING_DIR:pools});
const patch=await patchEntityUpdateC(await readFile(cfile,'utf8'),pools,source),patched=resolve(directory,'bridge.c');
let patchedSource=patch.source.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_original_main(int argc,char **argv) {');assert.notEqual(patchedSource,patch.source);
patchedSource+='\n#include <stdio.h>\nint main(int argc,char **argv){int result=simx_original_main(argc,argv);fprintf(stderr,"entity_hits:%zu\\n",simx_entity_hits);return result;}\n';await writeFile(patched,patchedSource);
const library=resolve(directory,'libentity.a'),rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc');run(rustc,['--edition=2024','-O','-C','panic=abort','--crate-type=staticlib',resolve(root,'tools/native-entity-update.rs'),'-o',library]);
const includes=['-I'+resolve(build,'lib/config'),'-I'+resolve(checkout,'include')],helper=resolve(directory,'helper.o');
run('c++',['-DHERMESVM_ALLOW_CONCURRENT_GC','-DHERMESVM_ALLOW_INLINE_ASM','-DHERMESVM_INDIRECT_THREADING','-DHERMES_CHECK_NATIVE_STACK','-DHERMES_ENABLE_UNICODE_REGEXP_PROPERTY_ESCAPES','-DHERMES_USE_BOOST_CONTEXT=1','-DSTATIC_HERMES','-fno-exceptions','-fno-rtti','-x','c++','-std=c++17','-O2','-g0','-DNDEBUG','-fPIC','-ffp-contract=off',...includes,'-I'+resolve(checkout,'external/llvh/include'),'-I'+resolve(checkout,'external/llvh/gen/include'),'-I'+resolve(checkout,'external'),'-I'+resolve(checkout,'public'),'-I'+resolve(checkout,'API'),'-I'+resolve(checkout,'API/jsi'),'-I'+resolve(build,'external/llvh/include'),'-I'+resolve(build,'include'),'-c',resolve(root,'tools/native-compiler-patches/entity-update.inc'),'-o',helper]);
const originalVM=resolve(build,'lib/libhermesvm.so'),originalVMHash=sha(await readFile(originalVM));
const ninja=resolve(root,'work/downloads/ninja-bin/ninja');
const commands=run(ninja,['-C',build,'-t','commands','lib/libhermesvm.so']).stdout.trim().split('\n');
let link=commands.at(-1);assert.ok(link.startsWith(': && /usr/bin/c++ ')&&link.includes('-o lib/libhermesvm.so '));
const quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
link=link.replace('-o lib/libhermesvm.so ', '-o '+quote(resolve(directory,'libhermesvm.so'))+' '+quote(helper)+' ').replace('-Wl,--dependency-file=lib/CMakeFiles/hermesvm.dir/link.d','-Wl,--dependency-file='+resolve(directory,'link.d'));
const privateLink=spawnSync('/bin/bash',['-c',link],{cwd:build,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(privateLink.status,0,privateLink.stderr);
assert.equal(sha(await readFile(originalVM)),originalVMHash,'Live pinned VM changed during isolated helper link');
function compile(cfile,binary,extras=[]){const args=[cfile,...extras,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off',...includes,'-L'+directory,'-Wl,-rpath,'+directory];for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);args.push('-L'+path,'-Wl,-rpath,'+path);}args.push('-lshermes_console','-lhermesvm','-lstdc++','-ldl','-lpthread','-lm','-o',binary);run('cc',args);}
const binary=resolve(directory,'probe'),originalBinary=resolve(directory,'original');compile(patched,binary,[library]);compile(cfile,originalBinary);
const execution=run(binary,['-Xhermes-internal-test-methods'],{...process.env,LD_LIBRARY_PATH:directory}),actual=JSON.parse(execution.stdout),unmodified=JSON.parse(run(originalBinary,['-Xhermes-internal-test-methods'],{...process.env,LD_LIBRARY_PATH:directory}).stdout);let expected;
runInNewContext(script,{hermescli:{loadFile:()=>Buffer.from(JSON.stringify(cases))},print:text=>{expected=JSON.parse(text);}});
const loadedLibraries=run('ldd',[binary],{...process.env,LD_LIBRARY_PATH:directory}).stdout;
assert.ok(loadedLibraries.includes('libhermesvm.so => '+resolve(directory,'libhermesvm.so')),'Probe must load the private VM with GC-aware helper');
const nativeDifference=firstDifference(actual,unmodified),oracleDifference=firstDifference(actual,expected),hits=Number(/entity_hits:(\d+)/.exec(execution.stderr)[1]);assert.equal(hits,actual.expectedHits);
const files=['tools/native-compiler-patches/entity-update.inc','tools/native-entity-update.rs','tools/native-entity-update.mjs','tools/native-entity-update-probe.mjs','crates/battle-core/src/js_math.rs'];
const sourceHashes={};for(const file of files)sourceHashes[file]=sha(await readFile(resolve(root,file)));
assert.equal(sha(await readFile(originalVM)),originalVMHash,'Live pinned VM changed during isolated proof');
const outputArchive='benchmarks/validation/native-entity-update.outputs.json.gz';
await writeFile(resolve(root,outputArchive),gzipSync(JSON.stringify(actual),{level:9}));
const report={version:1,matched:!nativeDifference&&!oracleDifference,source:{file:contract.source,name:contract.sourceName,start:contract.start,end:contract.end,sha256:contract.sha256},numericPolicy:'Strict raw bits for all captured numeric outputs; no NaN normalization.',inputSha256:sha(JSON.stringify(cases)),actualOutputSha256:sha(JSON.stringify(actual)),nodeOutputSha256:sha(JSON.stringify(expected)),unmodifiedNativeOutputSha256:sha(JSON.stringify(unmodified)),outputArchive,outputArchiveSha256:sha(await readFile(resolve(root,outputArchive))),oracleProfile:profile,sourceCases:cases.length,updates:cases.length*2,aliasCases:cases.filter(row=>row[6]).length,directedCases:actual.fallback.length,directedFastCases:2,directedFallbackCases:actual.fallback.length-2,rustIntegratedUpdates:hits,nativeDifference,oracleDifference,sourceHashes,compilerSha256:sha(await readFile(compiler)),vmSha256:originalVMHash,privateProbeVMSha256:sha(await readFile(resolve(directory,'libhermesvm.so'))),liveVMPreserved:sha(await readFile(originalVM))===originalVMHash,loadedPrivateVM:resolve(directory,'libhermesvm.so'),privateVMArchiveSha256:sha(await readFile(resolve(build,'lib/libhermesvm_a.a'))),canonicalArraysRetained:true,gcAwareWrites:true,scope:'Opt-in isolated original Entity.update VM function-body block; guard failures execute original source, with no extra getters or Proxy traps. Not integrated whole-battle qualification or a throughput result.',qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/native-entity-update.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.matched)process.exitCode=1;
