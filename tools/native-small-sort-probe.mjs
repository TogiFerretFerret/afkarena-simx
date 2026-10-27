import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{spawnSync}from'node:child_process';
import{createHash}from'node:crypto';
import{runInNewContext}from'node:vm';
import assert from'node:assert/strict';
import{patchFlatNumericCopyC}from'./native-rust-bridge.mjs';
import{buildPrivateVMHelper}from'./native-private-vm.mjs';
import{firstDifference}from'./native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-small-sort');await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)||(process.env.NODE_OPTIONS??'')!==''){const r=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(r.status??1);}
const inputs=['tools/native-small-sort-probe.mjs','tools/native-small-sort.rs','tools/native-compiler-patches/small-sort.inc','crates/battle-core/src/v8_small_sort.rs','tools/native-private-vm.mjs','tools/native-rust-bridge.mjs','tools/native-report-compare.mjs','config/native-compiler-static-hermes.json'];
const hashInputs=async()=>Object.fromEntries(await Promise.all(inputs.map(async p=>[p,sha(await readFile(resolve(root,p)))])));const inputHashes=await hashInputs();
const candidate='function(a,b){return a.sort(b)}';
const script=`var candidateSort=${candidate};
var outputs=[],orderedCalls=0,strictThis=true,randomState=0x12345678;
function draw(){randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState;}
function snap(a){var out=[];for(var i=0;i<a.length;i++){var d=Object.getOwnPropertyDescriptor(a,String(i));out.push(!d?['hole']:'value'in d?[d.value===undefined?'undefined':d.value.id,d.writable,d.enumerable,d.configurable]:['accessor',!!d.get,!!d.set,d.enumerable,d.configurable]);}return{length:a.length,values:out};}
for(var id=0;id<5000;id++){
 var n=id%64,array=[],calls=[],effects=[],mode=id%10,seed=draw(),sentinel={id:'sentinel'},threw=false,errorName=null;
 for(var j=0;j<n;j++)array.push(id%3===0&&j%7===0?undefined:{id:j,value:draw()%11});
 var compare=function(a,b){'use strict';strictThis=strictThis&&this===undefined;calls.push([a.id,b.id]);var value=a.value-b.value;
  switch(mode){case 0:return value;case 1:return-value;case 2:return-1;case 3:seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;seed>>>=0;return .5-seed/4294967296;case 4:return NaN;case 5:return a.id%3===b.id%3?0:(a.id%3+1)%3===b.id%3?-1:1;case 6:return{valueOf:function(){effects.push('coerce');return value}};case 7:return{valueOf:function(){effects.push('coerce-throw');throw sentinel}};case 8:if(calls.length===3)throw sentinel;return value;case 9:return calls.length%2?-Infinity:Infinity;}
 };
 var returned=false;try{returned=candidateSort(array,compare)===array}catch(error){threw=error===sentinel;errorName=error.name??null;}
 orderedCalls+=calls.length;outputs.push({array:snap(array),calls:calls,effects:effects,seed:seed,returned:returned,threw:threw,errorName:errorName});
}
var directed=[];
for(var mutation=0;mutation<11;mutation++){
 var arr=[{id:3,value:3},{id:1,value:1},{id:2,value:2}],events=[],count=0,known={id:'known'},error=null,returned=false;
 var cmp=function(a,b){'use strict';events.push(['compare',a.id,b.id,arr.length]);count++;
  if(count===1){switch(mutation){case 0:arr[0]={id:99,value:99};break;case 1:arr.length=0;break;case 2:arr.push({id:9,value:9});break;case 3:Object.freeze(arr);break;case 4:delete arr[0];Object.defineProperty(arr,'0',{configurable:true,enumerable:true,set:function(v){events.push(['setter',v.id]);}});break;case 5:delete arr[0];var p=Object.create(Array.prototype);Object.defineProperty(p,'0',{set:function(v){events.push(['prototype-setter',v.id]);},configurable:true});Object.setPrototypeOf(arr,p);break;case 6:Object.defineProperty(arr,'1',{value:arr[1],writable:false});break;case 7:throw known;case 8:if(typeof gc==='function')gc();break;case 9:arr.length=1;Object.defineProperty(arr,'length',{writable:false});break;case 10:arr[2].value=-100;break;}}
  return a.value-b.value;
 };
 try{returned=candidateSort(arr,cmp)===arr}catch(e){error=e===known?'known':e.name;}
 directed.push({mutation:mutation,array:snap(arr),events:events,error:error,returned:returned});
}
var unsupported=[];
if(typeof hermescli!=='undefined'){
 function reject(label,make,compare){var before=0,traps=0;var value=make(function(){traps++}),cmp=arguments.length>=3?compare:function(){before++;return 0;},error=null;try{candidateSort(value,cmp)}catch(e){error=e.message}unsupported.push([label,error,before,traps]);}
 reject('large',function(){return new Array(64).fill(1)});
 reject('hole',function(){return new Array(2)});
 reject('getter',function(trap){var a=[1,2];Object.defineProperty(a,'0',{get:function(){trap();return 1;}});return a;});
 reject('proxy',function(trap){return new Proxy([1,2],{get:function(t,k){trap();return t[k]},getPrototypeOf:function(t){trap();return Object.getPrototypeOf(t)},ownKeys:function(t){trap();return Reflect.ownKeys(t)}})});
 reject('frozen',function(){return Object.freeze([1,2])});
 reject('length-readonly',function(){var a=[1,2];Object.defineProperty(a,'length',{writable:false});return a;});
 reject('custom-prototype',function(){var a=[1,2];Object.setPrototypeOf(a,Object.create(Array.prototype));return a;});
 reject('bound-comparator',function(){return[1,2]},function(a,b){return a-b}.bind(null));
 reject('default-comparator',function(){return[1,2]},null);
}
print(JSON.stringify({outputs:outputs,directed:directed,orderedCalls:orderedCalls,strictThis:strictThis,randomState:randomState,source:candidateSort.toString(),name:candidateSort.name,length:candidateSort.length,unsupported:unsupported}));`;
function run(command,args,options={}){const r=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,...options});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r;}
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),pools=resolve(directory,'pools'),original=resolve(directory,'original.c'),jsfile=resolve(directory,'probe.js');await mkdir(pools,{recursive:true});await writeFile(jsfile,script);
const rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc'),rustlib=resolve(directory,'libsmall_sort.a');run(rustc,['--edition=2024','--crate-type=staticlib','-O',resolve(root,'tools/native-small-sort.rs'),'-o',rustlib]);
const privateVM=await buildPrivateVMHelper({root,directory,helperFile:'tools/native-compiler-patches/small-sort.inc'});
run(compiler,['-O','-emit-c',jsfile,'-o',original],{env:{...process.env,SHERMES_BINARY_STRING_DIR:pools}});
let{source}=await patchFlatNumericCopyC(await readFile(original,'utf8'),pools,candidate);
source=source.replace('extern SHLegacyValue simx_flat_numeric_copy(SHRuntime *,SHLegacyValue);',`extern int battle_v8_small_sort(uint32_t*,size_t,void*,int(*)(void*,uint32_t,uint32_t,double*));\nextern SHLegacyValue simx_v8_small_sort(SHRuntime*,SHLegacyValue,SHLegacyValue,int(*)(uint32_t*,size_t,void*,int(*)(void*,uint32_t,uint32_t,double*)));`);
source=source.replace('simx_flat_numeric_copy(shr,_sh_ljs_param(shr->stackPointer,1))','simx_v8_small_sort(shr,_sh_ljs_param(shr->stackPointer,1),_sh_ljs_param(shr->stackPointer,2),battle_v8_small_sort)');
source=source.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_original_main(int argc,char **argv) {');source+='\n#include <stdio.h>\nextern void simx_small_sort_set_gc_period(uint64_t);extern uint64_t simx_small_sort_gc_count(void);int main(int argc,char **argv){simx_small_sort_set_gc_period(4096);int result=simx_original_main(argc,argv);fprintf(stderr,"gc_cycles:%llu\\n",(unsigned long long)simx_small_sort_gc_count());fprintf(stderr,"sort_hits:%zu\\n",simx_copy_hits);return result;}\n';
const patched=resolve(directory,'patched.c');await writeFile(patched,source);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build'),binary=resolve(directory,'probe');
const args=[patched,rustlib,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include'),'-L'+directory,'-Wl,-rpath,'+directory];
for(const lib of['lib','jsi','tools/shermes']){const p=resolve(build,lib);args.push('-L'+p,'-Wl,-rpath,'+p);}args.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',binary);run('cc',args);
const execution=run(binary,['-Xhermes-internal-test-methods'],{env:{...process.env,LD_LIBRARY_PATH:directory}}),actual=JSON.parse(execution.stdout);let expected;runInNewContext(script,{gc:()=>{},print:t=>{expected=JSON.parse(t);}});
const unsupported=actual.unsupported;delete actual.unsupported;delete expected.unsupported;
const difference=firstDifference(actual,expected),hits=Number(/sort_hits:(\d+)/.exec(execution.stderr)[1]);
assert.deepEqual(await hashInputs(),inputHashes,'Native sort inputs changed during proof');
assert.equal(sha(await readFile(resolve(build,'lib/libhermesvm.so'))),privateVM.originalSha256,'Live VM changed during private proof');
const forcedCollections=Number(/gc_cycles:(\d+)/.exec(execution.stderr)[1]);assert.ok(forcedCollections>0);
const report={version:1,qualifiesFor10000Target:false,matched:difference===null,difference,cases:actual.outputs.length,directedCases:actual.directed.length,orderedComparatorCalls:actual.orderedCalls,forcedCollections,strictThis:actual.strictThis,hits,unsupported,privateVM,oracleProfile:profile,inputHashes,compilerSha256:sha(await readFile(compiler)),binarySha256:sha(await readFile(binary)),referenceCanonicalSha256:sha(JSON.stringify(expected)),candidateCanonicalSha256:sha(JSON.stringify(actual)),scope:'Isolated C++ VM snapshot/coercion/writeback plus Rust V8 smallsort token schedule; dense admitted arrays<=63 only, ordinary compiled JS comparator. No live Array.prototype.sort replacement.',limitations:['Unsupported shapes fail closed before comparator/user getters; no Hermes sorting fallback.','Comparator callback mutations, throws, coercions, GC and generic writeback checked; native VM TypeError messages are not matched, only failure boundary and error type.','No original full battle/scene or broad roster qualification follows from this component.']};
await writeFile(resolve(root,'benchmarks/validation/native-small-sort.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));assert.equal(difference,null);assert.equal(hits,expected.outputs.filter(x=>x.returned).length+expected.directed.filter(x=>x.returned).length);for(const row of unsupported){assert.equal(row[1],'Unsupported native small sort admission',row[0]);assert.equal(row[2],0,row[0]);assert.equal(row[3],0,row[0]);}
