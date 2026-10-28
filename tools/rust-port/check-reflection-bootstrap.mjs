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
  "assign-get-set-order",
  "function(){var s=\"\",t={set x(v){s+=\"s\"+v;}};var o={get x(){s+=\"g\";return 2;},y:3};Object.assign(t,o);return s+\":\"+t.y;}"
 ],
 [
  "assign-deleted-later-key",
  "function(){var o={get a(){delete o.b;return 1;},b:2},t={};Object.assign(t,o);return Object.keys(t).join(\",\")+\":\"+t.a;}"
 ],
 [
  "assign-no-added-later-key",
  "function(){var o={get a(){o.c=3;return 1;},b:2};var t=Object.assign({},o);return Object.keys(t).join(\",\");}"
 ],
 [
  "assign-prefix-throw",
  "function(){var e={},t={set b(v){throw e;}};try{Object.assign(t,{a:1,b:2,c:3});}catch(x){return x===e&&t.a===1&&!Object.hasOwn(t,\"c\");}}"
 ],
 [
  "assign-primitives",
  "function(){var t=Object.assign({},null,void 0,\"ab\",true,7);return Object.keys(t).join(\",\")+\":\"+t[0]+t[1];}"
 ],
 [
  "assign-integer-key-order",
  "function(){var s=\"\",o={get 2(){s+=\"2\";return 2;},get 1(){s+=\"1\";return 1;},get x(){s+=\"x\";return 3;}};Object.assign({},o);return s;}"
 ],
 [
  "freeze-data-flags",
  "function(){var o={x:1};Object.freeze(o);o.x=2;o.y=3;var d=Object.getOwnPropertyDescriptor(o,\"x\");return [o.x,Object.hasOwn(o,\"y\"),delete o.x,d.writable,d.configurable,Object.isFrozen(o),Object.isSealed(o),Object.isExtensible(o)].join(\"|\");}"
 ],
 [
  "freeze-accessor-not-read",
  "function(){var s=\"\",o={get x(){s+=\"g\";return 1;},set x(v){s+=\"s\"+v;}};Object.freeze(o);o.x=2;return s+\":\"+Object.isFrozen(o)+\":\"+Object.getOwnPropertyDescriptor(o,\"x\").configurable;}"
 ],
 [
  "freeze-array-length",
  "function(){var a=[1,2];Object.freeze(a);var n;try{a.push(3);}catch(e){n=e.name;}return [n,a.length,a[0],Object.getOwnPropertyDescriptor(a,\"length\").writable,Object.isFrozen(a)].join(\"|\");}"
 ],
 [
  "seal-retains-writable",
  "function(){var o={x:1};Object.seal(o);o.x=2;o.y=3;return [o.x,Object.hasOwn(o,\"y\"),delete o.x,Object.isSealed(o),Object.isFrozen(o),Object.getOwnPropertyDescriptor(o,\"x\").writable].join(\"|\");}"
 ],
 [
  "freeze-negative-zero-primitive",
  "function(){return Object.freeze(-0);}"
 ],
 [
  "freeze-boxed-string",
  "function(){var o=Object(\"ab\");Object.freeze(o);return [Object.isFrozen(o),Object.getOwnPropertyNames(o).join(\",\"),o[0],o[1]].join(\"|\");}"
 ],
 [
  "define-properties-all-convert-before-define",
  "function(){var e={},o={},s=\"\";try{Object.defineProperties(o,{a:{get value(){s+=\"a\";return 1;}},get b(){s+=\"b\";return{get value(){s+=\"v\";throw e;}};}});}catch(x){return s+\":\"+(x===e)+\":\"+Object.hasOwn(o,\"a\");}}"
 ],
 [
  "define-properties-convert-before-target-failure",
  "function(){var o={},s=\"\";Object.defineProperty(o,\"a\",{value:0});try{Object.defineProperties(o,{a:{get value(){s+=\"a\";return 1;}},b:{get value(){s+=\"b\";return 2;}}});}catch(e){return s+\":\"+e.name+\":\"+o.a+\":\"+Object.hasOwn(o,\"b\");}}"
 ],
 [
  "define-properties-live-bag-enumerability",
  "function(){var o={},p={a:{get value(){Object.defineProperty(p,\"b\",{enumerable:false});return 1;}},b:{value:2}};Object.defineProperties(o,p);return o.a+\":\"+Object.hasOwn(o,\"b\");}"
 ],
 [
  "define-properties-inherited-descriptor-fields",
  "function(){var d=Object.create({value:3,enumerable:true}),o={};Object.defineProperties(o,{x:d});var p=Object.getOwnPropertyDescriptor(o,\"x\");return [o.x,p.writable,p.enumerable,p.configurable].join(\"|\");}"
 ],
 [
  "define-properties-prefix-on-apply-failure",
  "function(){var o={},s=\"\";Object.defineProperty(o,\"b\",{value:0});try{Object.defineProperties(o,{a:{get value(){s+=\"a\";return 1;}},b:{get value(){s+=\"b\";return 2;}}});}catch(e){return s+\":\"+o.a+\":\"+o.b+\":\"+e.name;}}"
 ],
 [
  "object-create-descriptors-eager",
  "function(){var s=\"\",e={};try{Object.create(null,{a:{get value(){s+=\"a\";return 1;}},get b(){s+=\"b\";throw e;}});}catch(x){return s+\":\"+(x===e);}}"
 ],
 [
  "object-create-proto-key-data",
  "function(){var o=Object.create(null,{[\"__proto__\"]:{value:3,enumerable:true}});return Object.hasOwn(o,\"__proto__\")+\":\"+o.__proto__+\":\"+(Object.getPrototypeOf(o)===null);}"
 ],
 [
  "descriptor-snapshot-null-prototype",
  "function(){var n=0,o={};Object.defineProperty(Object.prototype,\"value\",{get:function(){n++;return 7;},configurable:true});try{Object.defineProperties(o,{x:{writable:true}});return o.x+\":\"+n;}finally{delete Object.prototype.value;}}"
 ],
 [
  "object-is-same-value",
  "function(){return [Object.is(0/0,0/0),Object.is(-0,0),Object.is(0,0),Object.is([],[])].join(\"|\");}"
 ],
 [
  "has-own-target-before-key",
  "function(){var n=0,k={toString:function(){n++;return \"x\";}};try{Object.hasOwn(null,k);}catch(e){return e.name+\":\"+n;}}"
 ],
 [
  "has-own-coercion-once",
  "function(){var n=0,k={toString:function(){n++;return \"x\";}};return Object.hasOwn({x:1},k)+\":\"+n;}"
 ],
 [
  "descriptor-batch-no-accessor-get",
  "function(){var n=0,f=function(){n++;return 1;},o={};Object.defineProperty(o,\"x\",{get:f,enumerable:true});var d=Object.getOwnPropertyDescriptors(o);return [n,d.x.get===f,d.x.set===void 0,d.x.enumerable,d.x.configurable].join(\"|\");}"
 ]
];

const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-reflection-bootstrap.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-reflection');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'reflection:'+name,allowUnsupported:false})}));
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
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Reflection source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-reflection.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Source-guided Object.freeze/assign/is bootstrap methods plus descriptor batch conversion, integrity flags, primitive ordering and getter/throw prefixes. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-reflection.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
