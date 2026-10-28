import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const cacheLocalBindings=!process.argv.includes('--no-local-cache');
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-port-arrays-tests'+(cacheLocalBindings?'':'-uncached')),sha=b=>createHash('sha256').update(b).digest('hex');
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
await mkdir(work,{recursive:true});
const files=['tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/check-arrays.mjs'];
async function collect(directory){const out=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())out.push(...await collect(file));else if(file.endsWith('.rs'))out.push(file);}return out;}
files.push(...await collect('crates/js-runtime/src'),'crates/js-runtime/Cargo.toml','crates/battle-core/src/js_math.rs','config/source-oracle-runtime.json');
const before={};for(const f of files)before[f]=sha(await readFile(resolve(root,f)));
const modules=[],manifests=[];
for(let i=0;i<cases.length;i++){const [name,source]=cases[i],out=compileSource(source,{filename:name+'.js',allowUnsupported:false,cacheLocalBindings});manifests.push(out.manifest);await writeFile(resolve(work,'case_'+i+'.rs'),out.rust);modules.push(`#[path="case_${i}.rs"] mod case_${i};`);}
const runCases=cases.map((_,i)=>`{ let mut rt=Runtime::new(); let env=rt.global_env; case_${i}::run(&mut rt,env,Value::Undefined)?; let value=rt.lookup(env,"result")?; println!("{}",encode(&rt,value)); }`).join('\n');
await writeFile(resolve(work,'main.rs'),modules.join('\n')+'\nuse js_runtime::{Runtime,Value,JsResult};\nfn encode(rt:&Runtime,v:Value)->String{match v{Value::Undefined=>"u".into(),Value::Null=>"n".into(),Value::Bool(v)=>format!("b:{v}"),Value::Number(v)=>format!("d:{:016x}",v.to_bits()),Value::String(id)=>format!("s:{}",rt.string_units(id).iter().map(|n|format!("{n:04x}")).collect::<String>()),_=>"object".into()}}\nfn main()->JsResult<()>{\n'+runCases+'\nOk(())}\n');
await writeFile(resolve(work,'Cargo.toml'),'[package]\nname="rust-port-arrays-tests"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\njs-runtime={path="../../crates/js-runtime"}\n[[bin]]\nname="arrays-tests"\npath="main.rs"\n');
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),args=['build','--release','--manifest-path',resolve(work,'Cargo.toml')],built=spawnSync(resolve(rustBin,'cargo'),args,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH,CARGO_TARGET_DIR:resolve(root,'work/rust-port-shared-target')},encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(built.status,0,built.stderr);
const binary=resolve(root,'work/rust-port-shared-target/release/arrays-tests'),actualRun=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(actualRun.status,0,actualRun.stderr);const actual=actualRun.stdout.trimEnd().split('\n');assert.equal(actual.length,cases.length);
function encode(v){if(v===undefined)return'u';if(v===null)return'n';if(typeof v==='boolean')return'b:'+v;if(typeof v==='number'){const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,v,false);return'd:'+d.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof v==='string')return's:'+Array.from({length:v.length},(_,i)=>v.charCodeAt(i).toString(16).padStart(4,'0')).join('');return'object';}
const results=cases.map(([name,source],i)=>{const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);const expected=encode(realm.result);return{name,source,expected,actual:actual[i],passed:expected===actual[i]};});
const failure=results.find(r=>!r.passed);if(failure){await writeFile(resolve(root,'benchmarks/validation/rust-port-arrays-failure.json'),JSON.stringify(failure,null,2)+'\n');throw Error('Array differential first failure '+JSON.stringify(failure));}
for(const[f,expected]of Object.entries(before))assert.equal(sha(await readFile(resolve(root,f))),expected,'Compiler source changed during gate '+f);
const report={version:1,passed:true,cacheLocalBindings,cachedBindingDeclarations:manifests.reduce((n,m)=>n+m.functions.reduce((a,f)=>a+(f.cachedBindings??0),0),0),cases:results.length,results,compilerInputs:before,binary:{file:binary,sha256:sha(await readFile(binary))},buildArgs:args,scope:'Actual generated Rust executed against source JS Array programs. Ordered observable effects and primitive results compare exactly; Number results use raw f64 bits and arrays use UTF-16 units. This is a language-Array gate, not battle fidelity or throughput.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/rust-port-arrays'+(cacheLocalBindings?'':'-uncached')+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:results.length}));
