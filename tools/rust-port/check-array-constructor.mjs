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
    "array-constructor-inherited-index-setter",
    "function(){var count=0;Object.defineProperty(Array.prototype,\"0\",{set:function(v){count++;},configurable:true});var a=Array(7,8);delete Array.prototype[0];return count+\":\"+Object.hasOwn(a,\"0\")+\":\"+a[0]+\":\"+a.length;}"
  ],
  [
    "new-array-inherited-setter",
    "function(){var count=0;Object.defineProperty(Array.prototype,\"0\",{set:function(){count++;},configurable:true});var a=new Array(7,8);delete Array.prototype[0];return count+\":\"+a[0]+\":\"+Object.hasOwn(a,\"0\");}"
  ],
  [
    "inherited-readonly-index",
    "function(){Object.defineProperty(Array.prototype,\"0\",{value:42,writable:false,configurable:true});var a=Array(7,8);delete Array.prototype[0];return a[0]+\":\"+Object.hasOwn(a,\"0\");}"
  ],
  [
    "own-index-descriptor-flags",
    "function(){var a=Array(7,8),d=Object.getOwnPropertyDescriptor(a,\"0\");return d.value+\":\"+d.writable+\":\"+d.enumerable+\":\"+d.configurable;}"
  ],
  [
    "single-length-keeps-hole",
    "function(){var count=0;Object.defineProperty(Array.prototype,\"0\",{set:function(){count++;},configurable:true});var a=Array(3);delete Array.prototype[0];return count+\":\"+a.length+\":\"+Object.hasOwn(a,\"0\");}"
  ],
  [
    "single-nonnumeric-value",
    "function(){var count=0,o={};Object.defineProperty(Array.prototype,\"0\",{set:function(){count++;},configurable:true});var a=Array(o);delete Array.prototype[0];return count+\":\"+a.length+\":\"+(a[0]===o)+\":\"+Object.hasOwn(a,\"0\");}"
  ],
  [
    "call-ignores-receiver",
    "function(){var o={},a=Array.call(o,7,8);return Array.isArray(a)+\":\"+(a!==o)+\":\"+a[0]+\":\"+a.length;}"
  ],
  [
    "reflect-alternate-prototype-setter",
    "function(){var count=0;function C(){}C.prototype=Object.create(Array.prototype);Object.defineProperty(C.prototype,\"0\",{set:function(){count++;},configurable:true});var a=Reflect.construct(Array,[7,8],C);return count+\":\"+(Object.getPrototypeOf(a)===C.prototype)+\":\"+a[0]+\":\"+a.length+\":\"+Object.hasOwn(a,\"0\");}"
  ],
  [
    "reflect-prototype-getter-order",
    "function(){var s=\"\",C=function(){}.bind(null),p={};Object.defineProperty(C,\"prototype\",{get:function(){s+=\"P\";return p;}});var a=Reflect.construct(Array,[7,8],C);return s+\":\"+(Object.getPrototypeOf(a)===p)+\":\"+a[0]+\":\"+a.length;}"
  ],
  [
    "zero-and-negative-zero-length",
    "function(){var a=Array(0),b=new Array(-0);return a.length+\":\"+b.length+\":\"+Object.hasOwn(a,\"0\")+\":\"+Object.hasOwn(b,\"0\");}"
  ],
  [
    "invalid-length-range-error",
    "function(){try{Array(1.5);}catch(e){return e.name;}}"
  ],
  [
    "empty-constructor",
    "function(){var a=Array();return Array.isArray(a)+\":\"+a.length+\":\"+Object.getOwnPropertyNames(a).join(\",\");}"
  ],
  [
    "explicit-undefined-is-element",
    "function(){var a=Array(void 0);return a.length+\":\"+Object.hasOwn(a,\"0\")+\":\"+a[0];}"
  ],
  [
    "first-two-indices-prototype-getter",
    "function(){Object.defineProperty(Array.prototype,\"0\",{get:function(){throw 17;},configurable:true});Object.defineProperty(Array.prototype,\"1\",{value:99,writable:false,configurable:true});var a=Array(7,8);delete Array.prototype[0];delete Array.prototype[1];return a[0]+\":\"+a[1]+\":\"+Object.keys(a).join(\",\");}"
  ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-array-constructor.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-array-constructor');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'array-constructor:'+name,allowUnsupported:false})}));
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
const observations=[];for(let index=0;index<cases.length;index++){const[name,source]=cases[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}const text=value=>value.startsWith("ok:string:")?String.fromCharCode(...value.slice(10).match(/.{4}/g).map(x=>parseInt(x,16))):null;observations.push({name,source,expected,actual:actual[index],expectedText:text(expected),actualText:text(actual[index]),matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Array constructor source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-array-constructor.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,regression:'Array constructor must create own data elements without invoking inherited indexed setters',expectedFailure:!passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Source regression: Array constructor must create own data elements without calling inherited indexed setters. No battle reachability or speed qualification claimed. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-array-constructor.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
