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
  "strict-unused",
  "function(){\"use strict\";function f(a){return a+1;}return f(4);}"
 ],
 [
  "strict-used",
  "function(){\"use strict\";function f(a){a=8;return arguments[0]*10+a;}return f(4);}"
 ],
 [
  "strict-nested-arrow",
  "function(){\"use strict\";function f(a){return (()=>arguments[0])();}return f(9);}"
 ],
 [
  "strict-returned-arrow",
  "function(){\"use strict\";function f(a){return ()=>arguments[0];}return f(11)();}"
 ],
 [
  "nested-normal-own",
  "function(){\"use strict\";function f(a){return function(b){return arguments[0];};}return f(11)(14);}"
 ],
 [
  "nested-normal-arrow-own",
  "function(){\"use strict\";function f(a){return function(b){return (()=>arguments[0])();};}return f(11)(15);}"
 ],
 [
  "strict-function-arguments-throws",
  "function(){\"use strict\";function f(){return 1;}try{return f.arguments;}catch(e){return e.name;}}"
 ],
 [
  "strict-function-caller-throws",
  "function(){\"use strict\";function f(){return 1;}try{return f.caller;}catch(e){return e.name;}}"
 ],
 [
  "sloppy-callee-still-present",
  "function(){function f(){return arguments.callee===f;}return f();}"
 ],
 [
  "strict-source-preserved",
  "function(){\"use strict\";function f(a){return a+1;}return f.toString();}"
 ],
 [
  "strict-computed-method-key",
  "function(){\"use strict\";function f(a){return ({[arguments[0]](){return 7;}})[a]();}return f(\"x\");}"
 ],
 [
  "sloppy-lazy-active-reflection",
  "function(){function read(f){return f.arguments[0];}function f(a){return read(f);}return f(17);}"
 ],
 [
  "sloppy-lazy-modified-parameter",
  "function(){function read(f){return f.arguments[0];}function f(a){a=23;return read(f);}return f(17);}"
 ],
 [
  "sloppy-lazy-reflection-outside",
  "function(){function f(a){return a+1;}f(17);return f.arguments===null;}"
 ],
 [
  "sloppy-lazy-snapshot-identity",
  "function(){function read(f){var a=f.arguments,b=f.arguments;return a===b;}function f(a){return read(f);}return f(17);}"
 ],
 [
  "sloppy-lazy-snapshot-mutation",
  "function(){function read(f){f.arguments[0]=99;return f.arguments[0];}function f(a){return read(f)*100+a;}return f(17);}"
 ],
 [
  "sloppy-lazy-recursion",
  "function(){function read(f){return f.arguments[0];}function f(a){if(a>0)return f(a-1)*10+read(f);return read(f);}return f(3);}"
 ],
 [
  "sloppy-lazy-bound-reflection",
  "function(){function read(f){return f.arguments[0];}function f(a){return read(f);}return f.bind(null,31)();}"
 ],
 [
  "sloppy-lazy-reflection-throw-cleanup",
  "function(){function f(a){throw a;}try{f(17);}catch(e){}return f.arguments===null;}"
 ],
 [
  "sloppy-lazy-direct-property-reflection",
  "function(){function f(a){a=2;return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-duplicate-parameters",
  "function(){function f(a,a){a=9;return f.arguments[0]*100+f.arguments[1];}return f(1,2);}"
 ],
 [
  "sloppy-eager-legacy-original-snapshot",
  "function(){function f(a){arguments[0]=3;return f.arguments[0]*100+a;}return f(1);}"
 ],
 [
  "sloppy-eager-duplicate-snapshot",
  "function(){function f(a,a){arguments[1]=9;return f.arguments[0]*100+f.arguments[1];}return f(1,2);}"
 ],
 [
  "sloppy-lazy-captured-parameter",
  "function(){function f(a,b){a=2;b=3;var g=()=>a;return f.arguments[0]*100+f.arguments[1];}return f(1,4);}"
 ],
 [
  "sloppy-lazy-nested-shadow",
  "function(){function f(a){a=2;var g=function(a){return a;};return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-catch-shadow",
  "function(){function f(a){a=2;try{throw 7;}catch(a){var g=()=>a;}return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-loop-shadow",
  "function(){function f(a){a=2;for(let a=0;a<1;a++){var g=()=>a;}return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-nested-write-capture",
  "function(){function f(a){a=2;var g=function(){a=7;};return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-computed-key-not-capture",
  "function(){function f(a){a=2;var o={[a](){return 1;}};return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-method-body-capture",
  "function(){function f(a){a=2;var o={m(){return a;}};return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-hoisted-parameter-function",
  "function(){function f(a){function a(){return 1;}return f.arguments[0]===a;}return f(1);}"
 ],
 [
  "sloppy-lazy-named-expression-shadow",
  "function(){function f(a){a=2;var g=function a(){return a;};return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-eval-reference-bailout-snapshot",
  "function(){function f(a,eval){var g=eval;a=2;return f.arguments[0];}return f(1,function(){});}"
 ],
 [
  "sloppy-nested-direct-eval-forces-context",
  "function(){function f(a){function g(){eval(\"\");}a=2;return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-shadowed-eval-call-context",
  "function(){function f(a,eval){eval();a=2;return f.arguments[0];}return f(1,function(){});}"
 ],
 [
  "sloppy-parameter-named-arguments",
  "function(){function f(arguments){arguments=2;return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-var-arguments-initializer",
  "function(){function f(a){var arguments=0;a=2;return f.arguments[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-own-descriptor-value",
  "function(){function f(a){a=2;return Object.getOwnPropertyDescriptor(f,\"arguments\").value[0];}return f(1);}"
 ],
 [
  "sloppy-lazy-legacy-descriptor-shape",
  "function(){function f(a){var d=Object.getOwnPropertyDescriptor(f.arguments,\"callee\");return [d.value===f,d.writable,d.enumerable,d.configurable].join(\"|\");}return f(1);}"
 ],
 [
  "sloppy-lazy-legacy-string-ownkeys",
  "function(){function f(a){return Object.getOwnPropertyNames(f.arguments).join(\"|\");}return f(1);}"
 ]
];
const knownUnsupported=[{"name": "sloppy-lazy-legacy-iterator", "source": "function(){function f(a){return f.arguments[Symbol.iterator]===Array.prototype.values;}return f(1);}", "reason": "Native Symbol identities/keys and the arguments Symbol.iterator property remain unsupported, as for existing eager arguments objects. This gate does not qualify those semantics."}, {"name": "sloppy-lazy-legacy-ownkeys", "source": "function(){function f(a){return Reflect.ownKeys(f.arguments).map(String).join(\"|\");}return f(1);}", "reason": "Native Symbol identities/keys and the arguments Symbol.iterator property remain unsupported, as for existing eager arguments objects. This gate does not qualify those semantics."}];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party/ryu-js'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-arguments-elision.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-arguments-elision');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'control:'+name,allowUnsupported:false})}));
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
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-arguments-elision.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,knownUnsupported,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Strict unused arguments elision, retained nested-arrow captures, ordinary nested arguments, source metadata, and restricted reflection cases. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-arguments-elision.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
