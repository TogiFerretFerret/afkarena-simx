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
  "live-data-replacement",
  "function(){function r(o){return o.x;}var o={x:1};var a=r(o);o.x=7;return a+\":\"+r(o)+\":\"+r(o);}"
 ],
 [
  "delete-reinsert",
  "function(){function r(o){return o.x;}var o={x:1};r(o);delete o.x;o.y=9;var a=r(o);o.x=7;return typeof a+\":\"+r(o);}"
 ],
 [
  "data-to-accessor-and-back",
  "function(){var log=\"\";function r(o){return o.x;}var o={x:1};r(o);Object.defineProperty(o,\"x\",{get:function(){log+=\"G\";return 3;},configurable:true});var a=r(o),b=r(o);Object.defineProperty(o,\"x\",{value:9,writable:true,configurable:true});return a+\":\"+b+\":\"+r(o)+\":\"+log;}"
 ],
 [
  "inherited-getter-receiver",
  "function(){var log=\"\";function r(o){return o.x;}var p={get x(){log+=\"G\";return this.y;}},o=Object.create(p);o.y=4;var a=r(o);o.y=5;return a+\":\"+r(o)+\":\"+log;}"
 ],
 [
  "delete-own-exposes-prototype",
  "function(){var n=0;function r(o){return o.x;}var p={get x(){return ++n;}},o=Object.create(p);o.x=9;Object.defineProperty(o,\"x\",{value:7,configurable:true});r(o);delete o.x;return r(o)+\":\"+r(o);}"
 ],
 [
  "prototype-replacement",
  "function(){function r(o){return o.x;}var o=Object.create({x:2});var a=r(o);Object.setPrototypeOf(o,{x:8});return a+\":\"+r(o);}"
 ],
 [
  "alternate-layouts",
  "function(){function r(o){return o.x;}var a={x:1,y:2},b={y:3,x:4};return r(a)+\":\"+r(b)+\":\"+r(a)+\":\"+r(b);}"
 ],
 [
  "same-slot-different-objects",
  "function(){function r(o){return o.x;}var a={x:1},b={x:2};r(a);return r(b)+\":\"+r(a);}"
 ],
 [
  "array-length-is-exotic",
  "function(){function r(o){return o.length;}var a=[1,2];r({length:7});var x=r(a);a.length=0;return x+\":\"+r(a);}"
 ],
 [
  "boxed-and-primitive-strings",
  "function(){function r(o){return o.length;}r({length:9});return r(\"💩\")+\":\"+r(new String(\"abc\"));}"
 ],
 [
  "arguments-live-mapping",
  "function(){function r(o){return o.length;}function f(a){r({length:9});arguments[1]=4;return r(arguments)+\":\"+arguments[0];}return f(3);}"
 ],
 [
  "typed-arrays-stay-exotic",
  "function(){function r(o){return o.length;}r({length:9});var a=new Uint8Array(3);return r(a)+\":\"+r(new Float64Array(2));}"
 ],
 [
  "function-properties-stay-dynamic",
  "function(){function f(a){function r(o){return o.arguments;}var a1=r(f),a2=r(f);return a1!==a2&&a1[0]===a2[0];}return f(7);}"
 ],
 [
  "method-receiver-argument-mutation",
  "function(){var o={x:3,m:function(v){return this.x+v;}};function r(){return o.m((o={x:100},2));}return r();}"
 ],
 [
  "getter-mutates-then-throws",
  "function(){var log=\"\";function r(o){return o.x;}var o={};Object.defineProperty(o,\"x\",{get:function(){log+=\"G\";Object.defineProperty(o,\"x\",{value:9,writable:true,configurable:true});throw 4;},configurable:true});try{r(o);}catch(e){log+=e;}return log+\":\"+r(o);}"
 ],
 [
  "null-base-after-warmup",
  "function(){function r(o){return o.x;}r({x:1});try{r(null);}catch(e){return e.name;}return \"miss\";}"
 ],
 [
  "compound-getter-setter-order",
  "function(){var log=\"\",o={x:2};function f(){o.x+=3;}f();Object.defineProperty(o,\"x\",{get:function(){log+=\"G\";return 4;},set:function(v){log+=\"S\"+v;},configurable:true});f();return log;}"
 ],
 [
  "literal-read-negative-zero-bits",
  "function(){function r(o){return o.x;}var o={x:1};r(o);o.x=-0;return r(o);}"
 ]
];
cases.push(
 ["prototype-live-data","function(){function read(o){return o.x;}var p={x:1},o=Object.create(p);var a=read(o);p.x=7;return a+':'+read(o)+':'+read(o);}"],
 ["prototype-shadow-accessor-without-getter","function(){function read(o){return o.x;}var p={x:1},o=Object.create(p);o.y=4;read(o);Object.defineProperty(o,'x',{set:function(){},configurable:true});return typeof read(o);}"],
 ["prototype-accessor-replaces-parent","function(){var n=0;function read(o){return o.x;}var p={x:1},q={x:9},o=Object.create(p);read(o);Object.defineProperty(p,'x',{get:function(){n++;Object.setPrototypeOf(this,q);return 5;},configurable:true});return read(o)+':'+read(o)+':'+n;}"],
 ["prototype-delete-exposes-grandparent","function(){function read(o){return o.x;}var q={x:9},p=Object.create(q),o=Object.create(p);p.x=1;read(o);delete p.x;return read(o)+':'+read(o);}"],
 ["array-length-beats-parent-data","function(){function read(o){return o.length;}var p={length:999},o=Object.create(p);read(o);var a=[];Object.setPrototypeOf(a,p);return read(a)+':'+read(a);}"]
);
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name.endsWith('.js')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-one-hop-slots.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-one-hop-slots');await mkdir(directory,{recursive:true});
// Test-only instrumentation forces the guarded hinted entry for mutation fixtures; production compiler hints require exact frozen source ancestry.
function forceHinted(generated){return{...generated,rust:generated.rust.replace(/LiteralReadSite::new\(("(?:[^"\\]|\\.)*")\)/g,'LiteralReadSite::new_with_prototype_hint($1, true)').replaceAll('rt.get_literal_cached(', 'rt.get_literal_cached_with_prototype_hint(')}}
const modules=cases.map(([name,source],index)=>({name,source,index,...forceHinted(compileSource(source,{mode:'function',filename:'control:'+name,allowUnsupported:false}))}));
const crossSources=['var readModuleA=function(o){return o.x;};','var readModuleB=function(o){return o.y;};var crossResult=readModuleA({x:1})+":"+readModuleB({y:2})+":"+readModuleA({x:3})+":"+readModuleB({y:4});'];
const crossModules=crossSources.map((source,index)=>forceHinted(compileSource(source,{mode:'script',filename:'cross-module-'+index,allowUnsupported:false})));
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+crossModules.map((item,index)=>'mod cross_'+index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{for enabled in [false,true]{let mut rt=Runtime::new();rt.one_hop_literal_slots_enabled=enabled;let env=rt.global_env;let value=case_${item.index}::create_function(&mut rt,env).and_then(|f|rt.call_value(f,Value::Undefined,&[]));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}}\n`;
rust+='for enabled in [false,true]{let mut rt=Runtime::new();rt.one_hop_literal_slots_enabled=enabled;let env=rt.global_env;let global=Value::Object(rt.global_object);cross_0::run(&mut rt,env,global).unwrap();cross_1::run(&mut rt,env,global).unwrap();let result=rt.lookup(env,"crossResult").unwrap();println!("cross:{}",encode(&rt,result));}\n';
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,cases.length*2+2);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<cases.length;index++){const[name,source]=cases[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,source,expected,actual:[actual[index*2],actual[index*2+1]],matched:expected===actual[index*2]&&expected===actual[index*2+1]});}
const crossRealm=createContext(constants.DONT_CONTEXTIFY);for(const source of crossSources)runInContext(source,crossRealm);const crossExpected="cross:"+encodeValue(crossRealm.crossResult);observations.push({name:"two-separate-compiled-modules-one-runtime",sources:crossSources,expected:crossExpected,actual:actual.slice(-2),matched:actual.slice(-2).every(value=>value===crossExpected)});
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Control-flow source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-one-hop-slots.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,testOnlyForcedHintedSites:true,productionHintsRequireExactSourceAncestry:true,passed,cases:observations.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Same generated entry keeps own-data caching enabled in both arms and toggles only one-hop prototype data caching. Own shadow/accessor checks and parent identity/descriptor checks are fresh on every hit. Mutation, getters, prototypes, receiver identity, exotic objects and raw numeric bits compare to independent source JS. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-one-hop-slots.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:observations.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
