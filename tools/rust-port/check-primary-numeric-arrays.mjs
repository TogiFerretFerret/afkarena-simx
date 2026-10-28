import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const cacheLocalBindings=!process.argv.includes('--no-local-cache');
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-port-primary-numeric-arrays-tests'+(cacheLocalBindings?'':'-uncached')),sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
  [
    "includes-holes",
    "var result=JSON.stringify([[,].includes(void 0),[,].indexOf(void 0),[NaN].includes(NaN),[-0].includes(0),[1,2,3].includes(1,-3)]);"
  ],
  [
    "find-holes",
    "var log='';var out=[,2].find(function(v,i,a){log+=i+':'+v+';';return i===1});var result=log+':'+out;"
  ],
  [
    "findIndex-receiver",
    "var o={x:9},a=[1,2];var result=a.findIndex(function(v,i,b){return this===o&&b===a&&v===2},o);"
  ],
  [
    "reduce-holes",
    "var a=[,2,,3];var result=JSON.stringify([a.reduce(function(a,b){return a+b}),a.reduce(function(a,b){return a+b},10),a.reduceRight(function(a,b){return a-b})]);"
  ],
  [
    "reduce-callback-order",
    "var log='',a=[1,2,3];var out=a.reduce(function(p,v,i,b){log+=i+':'+v+':'+(b===a)+';';if(i===0){delete a[1];a.push(99)}return p+v},0);var result=log+':'+out;"
  ],
  [
    "reduce-empty",
    "var result='';try{[,].reduce(function(){})}catch(e){result=e.name}result+=':'+[].reduce(function(){},void 0);"
  ],
  [
    "concat-holes",
    "var a=[,2],b=a.concat([3,,4],5);var result=JSON.stringify([b,b.length,0 in b,3 in b,a.length]);"
  ],
  [
    "concat-prototype-index",
    "var a=[,2];Object.defineProperty(Array.prototype,'0',{get:function(){return 9},configurable:true});var b=a.concat([]);delete Array.prototype[0];var result=JSON.stringify(b);"
  ],
  [
    "iterate-no-result",
    "var log='',a=[1,2,3];var r=a.forEach(function(v,i){log+=v;if(i===0)delete a[1]});var result=log+':'+r;"
  ],
  [
    "map-holes",
    "var a=[,2],b=a.map(function(v){return v+1});var result=JSON.stringify([b.length,0 in b,b[1]]);"
  ],
  [
    "reduceRight-order",
    "var log='';var out=[1,2,3].reduceRight(function(p,v,i){log+=i;return p-v},10);var result=log+':'+out;"
  ]
];
cases.push(
 ['own-keys-hole-order', "var a=[1,,3];a.x=8;delete a[0];a[0]=9;var result=JSON.stringify([Object.keys(a),Object.getOwnPropertyNames(a),a]);"],
 ['primary-keys', "var a=[1,,3,4];var s='';for(var k in a)s+=k+':'+a[k]+';';var result=JSON.stringify([s,Object.keys(a),Object.getOwnPropertyNames(a),Object.getOwnPropertyDescriptor(a,'2')]);"],
 ['length-shrink-grow', "var a=[1,2,3,4];a.length=2;a.length=4;var result=JSON.stringify([a,a.length,2 in a,3 in a,Object.keys(a)]);"],
 ['length-two-coercions', "var a=[1,2,3,4],log='';a.length={valueOf:function(){log+='x';a[2]=8;return 2;}};var result=JSON.stringify([log,a,Object.keys(a)]);"],
 ['length-coercion-throw', "var a=[1,2,3],log='';try{a.length={valueOf:function(){log+='x';if(log.length===2)throw 7;return 1}}}catch(e){log+=':'+e}var result=JSON.stringify([log,a]);"],
 ['length-invalid', "var a=[1,2];var log='';try{a.length=1.5}catch(e){log=e.name}var result=JSON.stringify([log,a]);"],
 ['read-only-length', "var a=[1,2];Object.defineProperty(a,'length',{writable:false});a[1]=7;a[2]=9;var log='';try{Object.defineProperty(a,'2',{value:4})}catch(e){log=e.name}var result=JSON.stringify([a,log,Object.getOwnPropertyDescriptor(a,'length')]);"],
 ['nonconfig-truncate', "var a=[1,2,3,4];Object.defineProperty(a,'1',{configurable:false});var log='';try{Object.defineProperty(a,'length',{value:0,writable:false})}catch(e){log=e.name}var result=JSON.stringify([log,a,a.length,Object.keys(a),Object.getOwnPropertyDescriptor(a,'length')]);"],
 ['descriptor-deopt', "var a=[1,2,3];Object.defineProperty(a,'1',{enumerable:false});Object.defineProperty(a,'0',{writable:false});a[0]=9;var result=JSON.stringify([a,Object.keys(a),Object.getOwnPropertyDescriptor(a,'0'),Object.getOwnPropertyDescriptor(a,'1')]);"],
 ['accessor-deopt', "var a=[1,2,3],log='';Object.defineProperty(a,'1',{get:function(){log+='g';return 8},set:function(v){log+='s'+v}});a[1]=4;var result=JSON.stringify([a,log,Object.keys(a)]);"],
 ['mixed-deopt', "var a=[1,2];a[1]={x:8};a[4]=4;var result=JSON.stringify([a,Object.keys(a)]);"],
 ['noncanonical-key', "var a=[1,2];a['01']=7;a['-0']=8;a['4294967295']=9;var result=JSON.stringify([a,Object.keys(a),a['01'],a['-0'],a['4294967295']]);"],
 ['prevent-extensions', "var a=[1,,3];Object.preventExtensions(a);a[0]=7;a[1]=8;a[3]=9;var result=JSON.stringify([a,Object.keys(a),Object.isExtensible(a)]);"],
 ['seal-freeze', "var a=[1,2],b=[3,4];Object.seal(a);Object.freeze(b);a[0]=8;delete a[1];b[0]=9;var result=JSON.stringify([a,b,Object.isSealed(a),Object.isFrozen(b)]);"],
 ['prototype-hole', "var a=[,2];Object.defineProperty(Array.prototype,'0',{get:function(){return 7},configurable:true});var x=a[0];delete Array.prototype[0];var result=JSON.stringify([x,a,Object.keys(a)]);"],
 ['prototype-setter', "var a=[,2],log='';Object.defineProperty(Array.prototype,'0',{set:function(v){log+='s'+v},get:function(){return 9},configurable:true});a[0]=7;var x=a[0];delete Array.prototype[0];var result=JSON.stringify([log,x,Object.keys(a)]);"],
 ['splice-shift-pop', "var a=[1,2,3,4];var x=a.shift(),y=a.pop(),z=a.splice(0,1,8);a.unshift(6);a.push(9);var result=JSON.stringify([x,y,z,a]);"],
 ['sort-reverse', "var a=[4,,2,1];a.reverse();a.sort(function(x,y){return x-y});var result=JSON.stringify([a,Object.keys(a)]);"],
 ['slice-concat-filter', "var a=[1,,3,4];var result=JSON.stringify([a.slice(1),a.concat([5]),a.filter(function(x){return x>1}),a.map(function(x){return x*2})]);"],
 ['numeric-bits', "var a=[-0,Infinity,-Infinity,NaN];var result=JSON.stringify([1/a[0],a[1],a[2],a[3]!==a[3],Object.is(a[0],-0)]);"],
 ['for-in-delete', "var a=[1,2,3],s='';for(var k in a){s+=k;if(k==='0')delete a[1]}var result=s;"],
 ['length-extend-deopt', "var a=[1,2];a.length=20;a[15]=8;var result=JSON.stringify([a.length,a[0],a[1],a[15],Object.keys(a)]);"],
 ['literal-cache-mutation', "var a=[1,2];function f(){return a[0]}var x=f();delete a[0];Object.defineProperty(a,'0',{get:function(){return 8}});var result=JSON.stringify([x,f(),Object.keys(a)]);"],
 ['key-coercion-mutation', "var a=[1,2],key={toString:function(){a[0]={x:8};return '0'}};var x=a[key];var result=JSON.stringify([x,a]);"]
);
const originalCases=cases.slice();cases.splice(0,cases.length,...originalCases.flatMap(([name,source])=>[[name+'-off',source],[name+'-on',source]]));
await mkdir(work,{recursive:true});
const files=['tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/check-primary-numeric-arrays.mjs'];
async function collect(directory){const out=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())out.push(...await collect(file));else if(file.endsWith('.rs'))out.push(file);}return out;}
files.push(...await collect('crates/js-runtime/src'),'crates/js-runtime/Cargo.toml','crates/battle-core/src/js_math.rs','config/source-oracle-runtime.json');
const before={};for(const f of files)before[f]=sha(await readFile(resolve(root,f)));
const modules=[],manifests=[];
for(let i=0;i<cases.length;i++){const [name,source]=cases[i],out=compileSource(source,{filename:name+'.js',allowUnsupported:false,cacheLocalBindings});manifests.push(out.manifest);await writeFile(resolve(work,'case_'+i+'.rs'),out.rust);modules.push(`#[path="case_${i}.rs"] mod case_${i};`);}
const runCases=cases.map((_,i)=>`{ let mut rt=Runtime::new(); rt.primary_numeric_arrays_enabled=${i%2===1}; let env=rt.global_env; case_${i}::run(&mut rt,env,Value::Undefined)?; let value=rt.lookup(env,"result")?; println!("{}",encode(&rt,value)); }`).join('\n');
await writeFile(resolve(work,'main.rs'),modules.join('\n')+'\nuse js_runtime::{Runtime,Value,JsResult};\nfn encode(rt:&Runtime,v:Value)->String{match v{Value::Undefined=>"u".into(),Value::Null=>"n".into(),Value::Bool(v)=>format!("b:{v}"),Value::Number(v)=>format!("d:{:016x}",v.to_bits()),Value::String(id)=>format!("s:{}",rt.string_units(id).iter().map(|n|format!("{n:04x}")).collect::<String>()),_=>"object".into()}}\nfn main()->JsResult<()>{\n'+runCases+'\nOk(())}\n');
await writeFile(resolve(work,'Cargo.toml'),'[package]\nname="rust-port-primary-numeric-arrays-tests"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\njs-runtime={path="../../crates/js-runtime"}\n[[bin]]\nname="arrays-tests"\npath="main.rs"\n');
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),args=['build','--release','--manifest-path',resolve(work,'Cargo.toml')],built=spawnSync(resolve(rustBin,'cargo'),args,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH,CARGO_TARGET_DIR:resolve(root,'work/rust-port-shared-target')},encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(built.status,0,built.stderr);
const binary=resolve(root,'work/rust-port-shared-target/release/arrays-tests'),actualRun=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(actualRun.status,0,actualRun.stderr);const actual=actualRun.stdout.trimEnd().split('\n');assert.equal(actual.length,cases.length);
function encode(v){if(v===undefined)return'u';if(v===null)return'n';if(typeof v==='boolean')return'b:'+v;if(typeof v==='number'){const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,v,false);return'd:'+d.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof v==='string')return's:'+Array.from({length:v.length},(_,i)=>v.charCodeAt(i).toString(16).padStart(4,'0')).join('');return'object';}
const results=cases.map(([name,source],i)=>{const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);const expected=encode(realm.result);return{name,source,expected,actual:actual[i],passed:expected===actual[i]};});
const failure=results.find(r=>!r.passed);if(failure){await writeFile(resolve(root,'benchmarks/validation/rust-port-primary-numeric-arrays-failure.json'),JSON.stringify(failure,null,2)+'\n');throw Error('Array differential first failure '+JSON.stringify(failure));}
for(const[f,expected]of Object.entries(before))assert.equal(sha(await readFile(resolve(root,f))),expected,'Compiler source changed during gate '+f);
const report={version:1,passed:true,cacheLocalBindings,cachedBindingDeclarations:manifests.reduce((n,m)=>n+m.functions.reduce((a,f)=>a+(f.cachedBindings??0),0),0),cases:results.length,results,compilerInputs:before,binary:{file:binary,sha256:sha(await readFile(binary))},buildArgs:args,scope:'Actual generated Rust executed against source JS Array programs. Ordered observable effects and primitive results compare exactly; Number results use raw f64 bits and arrays use UTF-16 units. This is a language-Array gate, not battle fidelity or throughput.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/rust-port-primary-numeric-arrays'+(cacheLocalBindings?'':'-uncached')+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:results.length}));
