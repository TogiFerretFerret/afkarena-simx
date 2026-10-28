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
const setup="var stableGlobal=1;Object.defineProperty(globalThis, \"configurableGlobal\", {configurable:true,writable:true,value:1});var accessorHits=0;Object.defineProperty(globalThis, \"stableAccessor\", {configurable:false,get:function(){accessorHits++;return accessorHits;}});";
const cases=[
 ['nonconfigurable-global-mutation','function(){function f(){var a=stableGlobal;stableGlobal=7;return a+":"+stableGlobal+":"+stableGlobal;}return f();}'],
 ['nonconfigurable-dynamic-global-getter','function(){function f(){return stableAccessor+":"+stableAccessor+":"+accessorHits;}return f();}'],
 ['configurable-dynamic-global-delete','function(){function f(){var a=configurableGlobal;delete globalThis.configurableGlobal;globalThis.configurableGlobal=8;return a+":"+configurableGlobal+":"+configurableGlobal;}return f();}'],
 ['compound-reference-rhs','function(){var x=1;function f(){x+=(x=7,3);return x+":"+x;}return f();}'],
 ['captured-getter-mutable-value','function(){var x={v:1};function f(){var a=x.v;x={v:3};return a+":"+x.v+":"+x.v;}return f();}'],
 ['captured-TDZ-repeated','function(){function f(){return x+x;}var out="";try{f();}catch(e){out=e.name;}let x=4;return out+":"+f();}'],
 ['captured-const-repeated','function(){const x=2;function f(){var a=x+x;try{x=4;}catch(e){return a+":"+e.name+":"+x;}}return f();}'],
 ['block-shadows-free','function(){var x=1;function f(){var a=x+x;{let x=8;a+=x+x;}return a+x;}return f();}'],
 ['mapped-captured-param','function(){function outer(x){function f(){var a=x;arguments;return x+a;}arguments[0]=5;return f();}return outer(1);}'],
 ['loop-captured-per-invocation','function(){var fs=[];for(let i=0;i<3;i++)fs.push(function(){return i+i;});return fs[0]()+":"+fs[1]()+":"+fs[2]();}'],
  [
    "global-getter-reassignment",
    "function(){var hits=0;Object.defineProperty(globalThis,\"capturedGlobal\",{configurable:true,get:function(){hits++;return hits;}});function f(){return capturedGlobal+\":\"+capturedGlobal;}return f()+\":\"+hits;}"
  ],
  [
    "global-delete-and-readd",
    "function(){globalThis.dynamicName=1;function f(){return typeof dynamicName;}var first=f();delete globalThis.dynamicName;var second=f();globalThis.dynamicName=\"x\";return first+\":\"+second+\":\"+f();}"
  ],
  [
    "deleted-reference-throws",
    "function(){globalThis.dynamicName=1;function f(){return dynamicName;}var first=f();delete globalThis.dynamicName;try{f();}catch(e){return first+\":\"+e.name;}}"
  ],
  [
    "global-prototype-after-delete",
    "function(){globalThis.inheritedName=1;function f(){return inheritedName;}var first=f();delete globalThis.inheritedName;Object.setPrototypeOf(globalThis,{inheritedName:2});return first+\":\"+f();}"
  ],
  [
    "captured-cell-updates",
    "function(){function outer(){var x=1;return{read:function(){return x;},write:function(v){x=v;}};}var a=outer();var first=a.read();a.write(3);return first+\":\"+a.read();}"
  ],
  [
    "captured-TDZ",
    "function(){var reads=[];function outer(){var f=function(){return x;};try{f();}catch(e){reads.push(e.name);}let x=3;reads.push(f());}outer();return reads.join(\":\");}"
  ],
  [
    "block-shadow-and-TDZ",
    "function(){var x=1,events=[];{try{events.push(x);}catch(e){events.push(e.name);}let x=2;events.push(x);}events.push(x);return events.join(\":\");}"
  ],
  [
    "const-reassignment",
    "function(){const x=1;try{x=2;}catch(e){return e.name+\":\"+x;}}"
  ],
  [
    "typeof-unresolved",
    "function(){return typeof notDeclared;}"
  ],
  [
    "typeof-TDZ",
    "function(){try{return typeof x;}catch(e){return e.name;}let x=1;}"
  ],
  [
    "sloppy-unresolved-assignment",
    "function(){function f(){createdLater=4;return createdLater;}return f()+\":\"+globalThis.createdLater;}"
  ],
  [
    "strict-unresolved-assignment",
    "function(){function f(){\"use strict\";createdLater=4;}try{f();}catch(e){return e.name;}}"
  ],
  [
    "unicode-identifier",
    "function(){var \u53d8\u91cf=2;function f(){return ++\u53d8\u91cf;}return f()+\":\"+\u53d8\u91cf;}"
  ],
  [
    "duplicate-parameters",
    "function(){function f(x,x){x=3;return arguments[0]+\":\"+arguments[1]+\":\"+x;}return f(1,2);}"
  ],
  [
    "mapped-arguments",
    "function(){function f(x){arguments[0]=4;var first=x;x=8;return first+\":\"+arguments[0];}return f(1);}"
  ],
  [
    "catch-shadows-capture",
    "function(){var e=1;function f(){try{throw 3;}catch(e){return function(){return e;};}}return f()()+\":\"+e;}"
  ],
  [
    "per-iteration-closure",
    "function(){var a=[];for(let i=0;i<3;i++)a.push(function(){return i;});return a.map(function(f){return f();}).join(\":\");}"
  ],
  [
    "loop-var-repeated-assignment",
    "function(){var sum=0;for(var i=0;i<10;i++){var x=i;sum+=x;}return sum+\":\"+x;}"
  ],
  [
    "named-function-self",
    "function(){var f=function self(n){return n?self(n-1):self.name;};return f(3);}"
  ],
  [
    "getter-changes-remaining-name",
    "function(){globalThis.second=1;Object.defineProperty(globalThis,\"first\",{get:function(){globalThis.second=3;return 2;}});function f(){return first+second;}return f();}"
  ],
  [
    "annex-B-block-function",
    "function(){function f(flag){if(flag){function inner(){return 3;}}return typeof inner;}return f(false)+\":\"+f(true);}"
  ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-captured-binding-refs.mjs','crates/js-runtime/src/env.rs','crates/js-runtime/src/literal_pool.rs'])await bind(file);
const directory=resolve(root,'work/rust-port-captured-binding-refs');await mkdir(directory,{recursive:true});
const expanded=cases.flatMap(([name,source])=>[{name,source,specialized:false,forceSplit:false},{name,source,specialized:true,forceSplit:false},{name:name+':split',source,specialized:true,forceSplit:true}]);const modules=expanded.map(({name,source,specialized,forceSplit},index)=>({name,source,specialized,forceSplit,index,...compileSource(setup+'\nvar result=('+source+')();',{mode:'script',filename:'captured-binding-refs:'+name,allowUnsupported:false,cacheCapturedBindings:specialized,staticEnvironmentNames:true,largeBody:forceSplit?{minimumNodes:1,maxNodes:128,maxStatements:4,maxInitGroups:8}:false})}));
for(const item of modules){assert.equal(item.manifest.cacheCapturedBindings,item.specialized);}assert.ok(modules.some(item=>item.specialized&&item.rust.includes("rt.stable_binding_reference(")));
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();let env=rt.global_env;let value=case_${item.index}::run(&mut rt,env,Value::Undefined).and_then(|_|rt.lookup(env,"result"));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,expanded.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<expanded.length;index++){const{name,source,specialized}=expanded[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;runInContext(setup,realm);try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,specialized,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'override dispatcher source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-captured-binding-refs.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:expanded.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Guarded captured binding reference reuse ON/OFF with dynamic global getters/deletion/prototypes, captured mutable cells, TDZ, const, typeof, sloppy/strict assignment, Unicode names, mapped/duplicate arguments, catch shadowing, loop closures and AnnexB. References preserve live reads and writes; non-stable addresses fall back to live resolution. This is an environment component gate, not battle qualification. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-captured-binding-refs.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:expanded.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
