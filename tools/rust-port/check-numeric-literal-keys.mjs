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
  "keys-on",
  "function(){var o={};o[0]=1;o[-0]+=2;o[1e21]=4;o[1e-7]=5;o[1e400]=6;return Object.keys(o).join(\"|\")+\":\"+o[0];}"
 ],
 [
  "keys-off",
  "function(){var o={};o[0]=1;o[-0]+=2;o[1e21]=4;o[1e-7]=5;o[1e400]=6;return Object.keys(o).join(\"|\")+\":\"+o[0];}"
 ],
 [
  "decimals-on",
  "function(){var o={};o[0.10000000000000001]=1;o[-1.5]=2;o[9007199254740993]=3;o[5e-324]=4;return Object.keys(o).join(\"|\");}"
 ],
 [
  "decimals-off",
  "function(){var o={};o[0.10000000000000001]=1;o[-1.5]=2;o[9007199254740993]=3;o[5e-324]=4;return Object.keys(o).join(\"|\");}"
 ],
 [
  "getter-setter-order-on",
  "function(){var log=[],o={get 0(){log.push(\"g\");return 2;},set 0(v){log.push(\"s\"+v);}};o[0]+=(log.push(\"r\"),3);return log.join(\"|\");}"
 ],
 [
  "getter-setter-order-off",
  "function(){var log=[],o={get 0(){log.push(\"g\");return 2;},set 0(v){log.push(\"s\"+v);}};o[0]+=(log.push(\"r\"),3);return log.join(\"|\");}"
 ],
 [
  "base-rhs-order-on",
  "function(){var l=[],o={};function b(){l.push(\"b\");return o;}b()[0]=(l.push(\"r\"),3);return l.join(\"|\")+o[0];}"
 ],
 [
  "base-rhs-order-off",
  "function(){var l=[],o={};function b(){l.push(\"b\");return o;}b()[0]=(l.push(\"r\"),3);return l.join(\"|\")+o[0];}"
 ],
 [
  "null-assignment-order-on",
  "function(){var l=[];try{(l.push(\"b\"),null)[0]=(l.push(\"r\"),1);}catch(e){l.push(e.name);}return l.join(\"|\");}"
 ],
 [
  "null-assignment-order-off",
  "function(){var l=[];try{(l.push(\"b\"),null)[0]=(l.push(\"r\"),1);}catch(e){l.push(e.name);}return l.join(\"|\");}"
 ],
 [
  "null-get-order-on",
  "function(){var l=[];try{(l.push(\"b\"),null)[0];}catch(e){l.push(e.name);}return l.join(\"|\");}"
 ],
 [
  "null-get-order-off",
  "function(){var l=[];try{(l.push(\"b\"),null)[0];}catch(e){l.push(e.name);}return l.join(\"|\");}"
 ],
 [
  "post-pre-update-on",
  "function(){var o={0:2,1:4};return [o[0]++,++o[1],o[0],o[1]].join(\"|\");}"
 ],
 [
  "post-pre-update-off",
  "function(){var o={0:2,1:4};return [o[0]++,++o[1],o[0],o[1]].join(\"|\");}"
 ],
 [
  "delete-on",
  "function(){var o={0:1};return [delete o[0],o[0],delete o[-0]].join(\"|\");}"
 ],
 [
  "delete-off",
  "function(){var o={0:1};return [delete o[0],o[0],delete o[-0]].join(\"|\");}"
 ],
 [
  "strict-delete-on",
  "function(){\"use strict\";var o={};Object.defineProperty(o,\"0\",{value:1});try{delete o[0];}catch(e){return e.name;}}"
 ],
 [
  "strict-delete-off",
  "function(){\"use strict\";var o={};Object.defineProperty(o,\"0\",{value:1});try{delete o[0];}catch(e){return e.name;}}"
 ],
 [
  "optional-null-on",
  "function(){var o=null;return [o?.[0],delete o?.[-0]].join(\"|\");}"
 ],
 [
  "optional-null-off",
  "function(){var o=null;return [o?.[0],delete o?.[-0]].join(\"|\");}"
 ],
 [
  "optional-chain-on",
  "function(){var o={0:{1:7}};return o?.[0]?.[1];}"
 ],
 [
  "optional-chain-off",
  "function(){var o={0:{1:7}};return o?.[0]?.[1];}"
 ],
 [
  "method-this-on",
  "function(){var o={0:function(){return this===o;}};return o[0]()&&o?.[0]();}"
 ],
 [
  "method-this-off",
  "function(){var o={0:function(){return this===o;}};return o[0]()&&o?.[0]();}"
 ],
 [
  "prototype-ignored-on",
  "function(){Number.prototype.toString=function(){throw 7;};var o={0:3};return o[0];}"
 ],
 [
  "prototype-ignored-off",
  "function(){Number.prototype.toString=function(){throw 7;};var o={0:3};return o[0];}"
 ],
 [
  "dynamic-key-remains-on",
  "function(){var l=[],k={toString:function(){l.push(\"k\");return \"0\";}},o={0:1};o[k]+=(l.push(\"r\"),2);return l.join(\"|\")+o[0];}"
 ],
 [
  "dynamic-key-remains-off",
  "function(){var l=[],k={toString:function(){l.push(\"k\");return \"0\";}},o={0:1};o[k]+=(l.push(\"r\"),2);return l.join(\"|\")+o[0];}"
 ],
 [
  "dynamic-minus-zero-on",
  "function(){var k=-0,o={0:4};return o[k];}"
 ],
 [
  "dynamic-minus-zero-off",
  "function(){var k=-0,o={0:4};return o[k];}"
 ],
 [
  "optional-base-once-on",
  "function(){var n=0;function b(){n++;return {0:8};}return b()?.[0]+n;}"
 ],
 [
  "optional-base-once-off",
  "function(){var n=0;function b(){n++;return {0:8};}return b()?.[0]+n;}"
 ]
];
const knownUnsupported=[];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party/ryu-js'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-numeric-literal-keys.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-numeric-literal-keys');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'control:'+name,allowUnsupported:false,numericLiteralKeys:!name.endsWith('-off')})}));
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
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Control-flow source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-numeric-literal-keys.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,knownUnsupported,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Numeric literal computed member keys with folding enabled and disabled on the same native runtime; canonical numeric strings, Reference evaluation order, getters/setters, update/delete, optional chains, null errors, primitive prototype independence and unchanged dynamic object keys. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-numeric-literal-keys.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
