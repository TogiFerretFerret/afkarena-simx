import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const root=resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});process.stdout.write(child.stdout??'');process.stderr.write(child.stderr??'');process.exit(child.status??1);}
const cases=[
  [
    "source-set-dedup",
    "function(){return Array.from(new Set([\"A\",\"B\",\"A\"])).join(\"|\");}"
  ],
  [
    "map-entry-order",
    "function(){return Array.from(new Map([[\"a\",1],[\"b\",2]])).join(\"|\");}"
  ],
  [
    "holes-become-own",
    "function(){var a=Array.from([,2]);return a.length+\":\"+Object.hasOwn(a,\"0\")+\":\"+a.join(\"|\");}"
  ],
  [
    "unicode-codepoints",
    "function(){var a=Array.from(\"a\\ud83d\\ude00\\ud800\");return a.length+\":\"+a[1].length+\":\"+a[2].charCodeAt(0);}"
  ],
  [
    "typed-values",
    "function(){return Array.from(new Uint8Array([1,255,3]),function(v,i){return v+i;}).join(\"|\");}"
  ],
  [
    "arraylike-length-before-construct",
    "function(){var s=\"\";function C(n){s+=\"C\"+n;}var o={get length(){s+=\"L\";return 2;},get 0(){s+=\"0\";return 7;},get 1(){s+=\"1\";return 8;}};var a=Array.from.call(C,o,function(v,i){s+=\"M\"+i;return v;});return s+\":\"+a.length+\":\"+(a instanceof C);}"
  ],
  [
    "iterable-constructor-no-length",
    "function(){var n;function C(){n=arguments.length;}var a=Array.from.call(C,[1,2]);return n+\":\"+a.length+\":\"+a[1];}"
  ],
  [
    "mapper-this-index",
    "function(){return Array.from([3,4],function(v,i){return this.x+v+i;},{x:10}).join(\"|\");}"
  ],
  [
    "invalid-map-before-null",
    "function(){try{Array.from(null,1);}catch(e){return e.name;}}"
  ],
  [
    "null-type-error",
    "function(){try{Array.from(null);}catch(e){return e.name;}}"
  ],
  [
    "mapper-live-length",
    "function(){var a=[1,2];return Array.from(a,function(v,i){if(!i)a.push(3);return v;}).join(\"|\");}"
  ],
  [
    "mapper-arraylike-fixed-length",
    "function(){var a={0:1,1:2,length:2};return Array.from(a,function(v,i){a.length=0;return v;}).join(\"|\");}"
  ],
  [
    "create-data-bypasses-setter",
    "function(){var s=\"\";function C(){}Object.defineProperty(C.prototype,\"0\",{set:function(){s+=\"S\";}});var a=Array.from.call(C,[7]);return s+\":\"+a[0]+\":\"+Object.hasOwn(a,\"0\");}"
  ],
  [
    "mapper-throw-prefix",
    "function(){var s=\"\",e={};try{Array.from([1,2,3],function(v){s+=v;if(v===2)throw e;return v;});}catch(x){return s+\":\"+(x===e);}}"
  ],
  [
    "arraylike-negative-length",
    "function(){return Array.from({length:-5}).length;}"
  ],
  [
    "arraylike-fraction-length",
    "function(){return Array.from({0:7,1:8,length:1.9}).join(\"|\");}"
  ],
  [
    "nonconstructor-receiver",
    "function(){return Array.isArray(Array.from.call({},[1]));}"
  ],
  [
    "arraylike-getter-order",
    "function(){var s=\"\";var a={get length(){s+=\"L\";return {valueOf:function(){s+=\"V\";return 1;}};},get 0(){s+=\"G\";return 8;}};Array.from(a,function(v){s+=\"M\";return v;});return s;}"
  ],
  [
    "mapper-closes-iterator",
    "function(){var s=\"\",e={},i=new Set([1,2]).values();i.return=function(){s+=\"R\";return {};};try{Array.from(i,function(v){s+=v;throw e;});}catch(x){return s+\":\"+(x===e);}}"
  ],
  [
    "mapper-error-beats-close-throw",
    "function(){var s=\"\",e={},f={},i=new Set([1]).values();Object.defineProperty(i,\"return\",{get:function(){s+=\"R\";throw f;}});try{Array.from(i,function(){throw e;});}catch(x){return s+\":\"+(x===e);}}"
  ],
  [
    "next-error-does-not-close",
    "function(){var s=\"\",e={},i=new Set([1]).values();i.next=function(){s+=\"N\";throw e;};i.return=function(){s+=\"R\";return {};};try{Array.from(i);}catch(x){return s+\":\"+(x===e);}}"
  ],
  [
    "define-failure-closes",
    "function(){var s=\"\",i=new Set([1]).values();i.return=function(){s+=\"R\";return {};};function C(){Object.preventExtensions(this);}try{Array.from.call(C,i);}catch(x){return s+\":\"+x.name;}}"
  ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-array-from.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-array-from');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'array-from:'+name,allowUnsupported:false})}));
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();let env=rt.global_env;let value=case_${item.index}::create_function(&mut rt,env).and_then(|f|rt.call_value(f,Value::Undefined,&[]));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,cases.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<cases.length;index++){const[name,source]=cases[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Array.from source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-array-from.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Source-required Array.from over supported intrinsic iterable and array-like domain; constructor, mapper, getter, write and throw ordering. Custom Symbol iterators remain unsupported. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-array-from.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
