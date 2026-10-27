import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{spawnSync}from'node:child_process';
import{createHash}from'node:crypto';
import{runInNewContext}from'node:vm';
import assert from'node:assert/strict';
import{sourceCopyFunction}from'./flat-numeric-copy.mjs';
import{patchFlatNumericCopyC}from'./native-rust-bridge.mjs';
import{firstDifference}from'./native-report-compare.mjs';
import{buildPrivateVMHelper}from'./native-private-vm.mjs';
const empty=process.argv.includes('--empty-array');
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,empty?'work/native-empty-array-copy':'work/native-flat-copy');
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){
 const c=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1],...process.argv.slice(2)],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(c.status??1);
}
const script=`var ed={};ed.copyObj=${sourceCopyFunction};
function bits(x){var a=new ArrayBuffer(8),v=new DataView(a);v.setFloat64(0,x,false);function hex(x){return ('00000000'+x.toString(16)).slice(-8);}return hex(v.getUint32(0,false))+hex(v.getUint32(4,false));}
function snapshot(o){var keys=Object.keys(o),r=[];for(var i=0;i<keys.length;i++){var k=keys[i],d=Object.getOwnPropertyDescriptor(o,k);r.push([k,typeof d.value==='number'?bits(d.value):d.value,d.enumerable,d.writable,d.configurable]);}return r;}
var outputs=[],fresh=true,events=[];
for(var i=0;i<20000;i++){var o={};for(var j=0;j<(i%50);j++)o['k'+j]=(i+j)%11===0?-0:(i-j)*1.125;if(typeof gc==='function'&&i%97===0)gc();var c=ed.copyObj(o);fresh=fresh&&c!==o&&Object.getPrototypeOf(c)===Object.prototype;outputs.push(snapshot(c));}
${empty?"for(var i=0;i<20000;i++){var a=[],b=ed.copyObj(a);fresh=fresh&&a!==b&&Array.isArray(b)&&b.length===0&&Object.getPrototypeOf(b)===Array.prototype;}":''}
var fallback=[];
function check(name,make){events=[];var o=make(),c=ed.copyObj(o);fallback.push([name,snapshot(c),events.slice(),c!==o]);}
check('getter',function(){var o={};Object.defineProperty(o,'x',{enumerable:true,get:function(){events.push('get');return 7;}});return o;});
check('proxy',function(){return new Proxy({x:3},{get:function(t,k){events.push('get:'+String(k));return t[k];},ownKeys:function(t){events.push('keys');return Reflect.ownKeys(t);}});});
check('own-constructor',function(){return{constructor:function C(){events.push('construct');},x:5};});
check('inherited-setter',function(){Object.defineProperty(Object.prototype,'x',{configurable:true,set:function(v){events.push('set:'+v);}});var o={};Object.defineProperty(o,'x',{value:4,enumerable:true,writable:true,configurable:true});return o;});delete Object.prototype.x;
check('array',function(){return[3,4];});
check('hole-array',function(){return new Array(8);});
check('hidden-array-getter',function(){var a=[];Object.defineProperty(a,'hidden',{get:function(){events.push('hidden');return 4;}});return a;});
check('symbol-array',function(){var a=[];a[Symbol('hidden')]=4;return a;});
check('array-constructor-getter',function(){var a=[];Object.defineProperty(a,'constructor',{get:function(){events.push('array-constructor');return Array;}});return a;});
var arrayConstructorDescriptor=Object.getOwnPropertyDescriptor(Array.prototype,'constructor');
check('array-prototype-constructor-getter',function(){Object.defineProperty(Array.prototype,'constructor',{configurable:true,get:function(){events.push('array-prototype-constructor');return Array;}});return[];});Object.defineProperty(Array.prototype,'constructor',arrayConstructorDescriptor);
check('non-enumerable',function(){var o={x:1};Object.defineProperty(o,'z',{value:2});return o;});
check('symbol',function(){var o={x:2};o[Symbol('hidden')]=3;return o;});
check('frozen',function(){return Object.freeze({x:2});});
check('constructor-getter',function(){var o={x:2};Object.defineProperty(o,'constructor',{get:function(){events.push('constructor');return Object;}});return o;});
check('nonfinite',function(){return{x:Infinity,y:-Infinity,z:NaN};});
check('nested',function(){return{x:{y:1}};});
check('numeric-keys',function(){return{'12':4,'1':5,z:6};});
check('proto-key',function(){var o={};Object.defineProperty(o,'__proto__',{value:4,enumerable:true,writable:true,configurable:true});return o;});
check('keys-replacement',function(){var original=Object.keys;Object.keys=function(o){events.push('customKeys');Object.keys=original;return original(o);};return{x:1};});
var originalPrototypeConstructor=Object.prototype.constructor;
check('prototype-constructor',function(){Object.prototype.constructor=function(){events.push('customCtor');};return{x:2};});Object.prototype.constructor=originalPrototypeConstructor;
print(JSON.stringify({outputs:outputs,fresh:fresh,fallback:fallback,source:ed.copyObj.toString()}));`;
const jsfile=resolve(directory,'probe.js');await writeFile(jsfile,script);
function run(cmd,args,env=process.env){const r=spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',maxBuffer:64*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r;}
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),pools=resolve(directory,'pools'),original=resolve(directory,'original.c');await mkdir(pools,{recursive:true});
run(compiler,['-O','-emit-c',jsfile,'-o',original],{...process.env,SHERMES_BINARY_STRING_DIR:pools});
let{source}=await patchFlatNumericCopyC(await readFile(original,'utf8'),pools,sourceCopyFunction);
let privateVM=null;
if(empty){source=source.replaceAll('simx_flat_numeric_copy','simx_empty_array_copy');privateVM=await buildPrivateVMHelper({root,directory,helperFile:'tools/native-compiler-patches/empty-array-copy.inc'});}
source=source.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_original_main(int argc,char **argv) {');
source+='\n#include <stdio.h>\nint main(int argc,char **argv){int result=simx_original_main(argc,argv);fprintf(stderr,"copy_hits:%zu\\n",simx_copy_hits);return result;}\n';
const patched=resolve(directory,'patched.c');await writeFile(patched,source);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build'),binary=resolve(directory,'probe');
const args=[patched,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')];
if(empty)args.push('-L'+directory,'-Wl,-rpath,'+directory);
for(const lib of['lib','jsi','tools/shermes']){const path=resolve(build,lib);args.push('-L'+path,'-Wl,-rpath,'+path);}args.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',binary);run('cc',args);
const execution=run(binary,['-Xhermes-internal-test-methods'],empty?{...process.env,LD_LIBRARY_PATH:directory}:process.env),actual=JSON.parse(execution.stdout);let expected;runInNewContext(script,{gc:()=>{},print:t=>{expected=JSON.parse(t);}});
const difference=firstDifference(actual,expected),hits=Number(/copy_hits:(\d+)/.exec(execution.stderr)[1]);
const report={version:1,matched:difference===null,difference,sourceCases:20000,fallbackCases:actual.fallback.length,cloneHits:hits,originalSourceSha256:sha(sourceCopyFunction),compilerSha256:sha(await readFile(compiler)),vmSha256:sha(await readFile(resolve(build,'lib/libhermesvm.so'))),oracleProfile:profile,qualifiesFor10000Target:false,scope:'Guarded native VM flat finite Number clone with original source fallback, fresh identity, descriptor/key order and exact Number bits. Isolated probe, not whole-battle qualification.'};
if(empty){report.sourceCases=40000;report.specializedEmptyArrayCases=20000;report.privateVM=privateVM;report.scope='Guarded original intrinsic empty Array clone in isolated private VM; unsupported shapes execute unchanged original copyObj. Not installed in live compiler; not whole-battle qualification.';}
await writeFile(resolve(root,'benchmarks/validation',empty?'native-empty-array-copy.json':'native-flat-copy.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));assert.equal(difference,null);assert.ok(hits>=20000);
