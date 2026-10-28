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
  "constant-MAX_VALUE",
  "function(){return Number.MAX_VALUE;}"
 ],
 [
  "constant-MIN_VALUE",
  "function(){return Number.MIN_VALUE;}"
 ],
 [
  "constant-NaN",
  "function(){return Number.NaN;}"
 ],
 [
  "constant-NEGATIVE_INFINITY",
  "function(){return Number.NEGATIVE_INFINITY;}"
 ],
 [
  "constant-POSITIVE_INFINITY",
  "function(){return Number.POSITIVE_INFINITY;}"
 ],
 [
  "constant-MAX_SAFE_INTEGER",
  "function(){return Number.MAX_SAFE_INTEGER;}"
 ],
 [
  "constant-MIN_SAFE_INTEGER",
  "function(){return Number.MIN_SAFE_INTEGER;}"
 ],
 [
  "constant-EPSILON",
  "function(){return Number.EPSILON;}"
 ],
 [
  "descriptor-MAX_VALUE",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"MAX_VALUE\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "descriptor-MIN_VALUE",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"MIN_VALUE\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "descriptor-NaN",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"NaN\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "descriptor-NEGATIVE_INFINITY",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"NEGATIVE_INFINITY\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "descriptor-POSITIVE_INFINITY",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"POSITIVE_INFINITY\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "descriptor-MAX_SAFE_INTEGER",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"MAX_SAFE_INTEGER\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "descriptor-MIN_SAFE_INTEGER",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"MIN_SAFE_INTEGER\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "descriptor-EPSILON",
  "function(){var d=Object.getOwnPropertyDescriptor(Number,\"EPSILON\");return [d.writable,d.enumerable,d.configurable].join(\"|\");}"
 ],
 [
  "number-own-native-order",
  "function(){return Object.getOwnPropertyNames(Number).join(\",\");}"
 ],
 [
  "number-fields-not-enumerable",
  "function(){return Object.keys(Number).length;}"
 ],
 [
  "immutable-maximum-loose-write",
  "function(){Number.MAX_VALUE=1;return Number.MAX_VALUE;}"
 ],
 [
  "immutable-maximum-strict-write",
  "function(){\"use strict\";try{Number.MAX_VALUE=1;}catch(e){return e.name;}return \"miss\";}"
 ],
 [
  "immutable-maximum-delete",
  "function(){return delete Number.MAX_VALUE;}"
 ],
 [
  "source-range-sentinel-finite",
  "function(){var distance=Number.MAX_VALUE;if(10<distance)distance=10;return distance;}"
 ],
 [
  "positive-infinity-comparison",
  "function(){return Number.POSITIVE_INFINITY>Number.MAX_VALUE;}"
 ],
 [
  "parse-function-alias-identities",
  "function(){return [Number.parseFloat===parseFloat,Number.parseInt===parseInt,Number.parseFloat.name,Number.parseFloat.length,Number.parseInt.name,Number.parseInt.length].join(\"|\");}"
 ],
 [
  "noncoercing-finite-predicates",
  "function(){var n=0,o={valueOf:function(){n++;return 1;}};return [Number.isFinite(o),Number.isFinite(\"1\"),Number.isFinite(null),Number.isFinite(1),Number.isFinite(1/0),n].join(\"|\");}"
 ],
 [
  "noncoercing-nan-predicates",
  "function(){return [Number.isNaN(\"bad\"),Number.isNaN(void 0),Number.isNaN(0/0),Number.isNaN(new Number(0/0))].join(\"|\");}"
 ],
 [
  "integer-predicates",
  "function(){return [Number.isInteger(-0),Number.isInteger(0.5),Number.isInteger(9007199254740992),Number.isInteger(1/0),Number.isInteger(0/0),Number.isInteger(\"1\")].join(\"|\");}"
 ],
 [
  "safe-integer-boundaries",
  "function(){return [Number.isSafeInteger(Number.MAX_SAFE_INTEGER),Number.isSafeInteger(Number.MIN_SAFE_INTEGER),Number.isSafeInteger(9007199254740992),Number.isSafeInteger(-9007199254740992),Number.isSafeInteger(-0),Number.isSafeInteger(Number.MIN_VALUE)].join(\"|\");}"
 ],
 [
  "predicate-metadata",
  "function(){return [Number.isFinite.name,Number.isFinite.length,Number.isInteger.name,Number.isInteger.length,Number.isNaN.name,Number.isNaN.length,Number.isSafeInteger.name,Number.isSafeInteger.length].join(\"|\");}"
 ]
];

const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-numeric-bootstrap.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-numeric-bootstrap');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'numeric-bootstrap:'+name,allowUnsupported:false})}));
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
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Numeric source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-numeric-bootstrap.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Source-guided Number constructor binary64 constants, immutable descriptors, property ordering, noncoercing predicates and parse-function alias identity. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-numeric-bootstrap.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
