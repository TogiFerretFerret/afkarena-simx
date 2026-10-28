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
 ["apply-stack-and-heap-boundary", "function(){function f(){return arguments.length+\":\"+Array.prototype.join.call(arguments,\",\");}return [f.apply(null,[]),f.apply(null,[1]),f.apply(null,[1,2,3,4,5,6,7,8]),f.apply(null,[1,2,3,4,5,6,7,8,9])].join(\";\");}"],
 ["apply-getter-order-and-reentrant-list", "function(){var log=\"\",o={length:3,1:2,2:3};function f(){log+=\"C\";return Array.prototype.join.call(arguments,\",\");}Object.defineProperty(o,\"0\",{get:function(){log+=\"G\";o.length=1;o[1]=7;delete o[2];return f.apply(null,[9]);}});var result=f.apply(null,o);return log+\":\"+result;}"],
 ["apply-getter-throw-prevents-call", "function(){var log=\"\",o={length:2,0:1};Object.defineProperty(o,\"1\",{get:function(){log+=\"G\";throw 42;}});try{(function(){log+=\"C\";}).apply(null,o);}catch(e){log+=e;}return log;}"],
 [
  "shared-returned-cells",
  "function(){function make(){var n=0;return{inc:function(){return ++n;},read:function(){return n;}};}var a=make();return a.inc()*100+a.read();}"
 ],
 [
  "separate-factory-environments",
  "function(){function make(n){return function(){return ++n;};}var a=make(1),b=make(20);return a()*10000+b()*100+a();}"
 ],
 [
  "capture-write-before-throw",
  "function(){var n=0,o={};function f(){n=7;throw o;}try{f();}catch(e){return n*10+(e===o?1:0);}}"
 ],
 [
  "hoisted-var-preserves-param",
  "function(){function f(a){var a;return a;}return f(9);}"
 ],
 [
  "function-hoist-replaces-param",
  "function(){function f(a){function a(){return 6;}return a();}return f(9);}"
 ],
 [
  "last-function-declaration-wins",
  "function(){function f(){return 1;}function f(){return 2;}return f();}"
 ],
 [
  "duplicate-parameter-last-wins",
  "function(){function f(a,a){return a;}return f(1,7);}"
 ],
 [
  "strict-this-undefined",
  "function(){function f(){\"use strict\";return this;}return f.call(void 0)===void 0;}"
 ],
 [
  "sloppy-this-boxes-number",
  "function(){function f(){return typeof this+\":\"+this.valueOf();}return f.call(3);}"
 ],
 [
  "arrow-bound-this-ignored",
  "function(){function f(){return (()=>this).bind({x:2});}var o={x:1};return f.call(o).call({x:3})===o;}"
 ],
 [
  "nested-bound-arguments",
  "function(){function f(a,b,c){return this.n*1000+a*100+b*10+c;}return f.bind({n:1},2).bind({n:9},3)(4);}"
 ],
 [
  "bound-constructor-ignores-bound-this",
  "function(){function F(a){this.x=a;}var o={},B=F.bind(o,7),x=new B;return x.x*100+(x instanceof F?10:0)+(x instanceof B?1:0)+(o.x===void 0?1000:0);}"
 ],
 [
  "constructor-object-return",
  "function(){function F(){this.x=1;return{x:9};}return(new F).x;}"
 ],
 [
  "bound-name-length",
  "function(){function named(a,b,c){}var b=named.bind(null,1);return b.name+\":\"+b.length;}"
 ],
 [
  "exact-function-source",
  "function(){var f=function f( a ) { return a; };return Function.prototype.toString.call(f)===\"function f( a ) { return a; }\";}"
 ],
 [
  "callable-function-prototype",
  "function(){return typeof Function.prototype+\":\"+(Function.prototype()===void 0)+\":\"+(Object.getPrototypeOf(function(){})===Function.prototype);}"
 ],
 [
  "method-no-own-prototype",
  "function(){var o={m(){}};return Object.prototype.hasOwnProperty.call(o.m,\"prototype\");}"
 ],
 [
  "method-not-constructible",
  "function(){var o={m(){}};try{new o.m;}catch(e){return e.name;}return\"miss\";}"
 ],
 [
  "arrow-not-constructible",
  "function(){var f=()=>1;try{new f;}catch(e){return e.name;}return\"miss\";}"
 ],
 [
  "named-expression-sloppy-name-immutable",
  "function(){var f=function named(){named=3;return typeof named;};return f();}"
 ],
 [
  "named-expression-strict-name-immutable",
  "function(){var f=function named(){\"use strict\";named=3;};try{f();}catch(e){return e.name;}return\"miss\";}"
 ],
 [
  "mapped-arguments-write-param",
  "function(){function f(a){arguments[0]=7;return a;}return f(2);}"
 ],
 [
  "mapped-param-write-arguments",
  "function(){function f(a){a=7;return arguments[0];}return f(2);}"
 ],
 [
  "mapped-duplicate-param-only-last",
  "function(){function f(a,a){arguments[0]=9;return a*100+arguments[0]*10+arguments[1];}return f(1,2);}"
 ],
 [
  "mapped-delete-detaches",
  "function(){function f(a){delete arguments[0];a=7;return 0 in arguments;}return f(2);}"
 ],
 [
  "mapped-readonly-detaches",
  "function(){function f(a){Object.defineProperty(arguments,\"0\",{writable:false});a=7;return arguments[0];}return f(2);}"
 ],
 [
  "mapped-accessor-detaches",
  "function(){function f(a){Object.defineProperty(arguments,\"0\",{get:function(){return 8;}});a=7;return arguments[0];}return f(2);}"
 ],
 [
  "strict-arguments-unmapped",
  "function(){function f(a){\"use strict\";arguments[0]=7;return a;}return f(2);}"
 ],
 [
  "strict-arguments-callee-poison",
  "function(){function f(){\"use strict\";return arguments.callee;}try{f();}catch(e){return e.name;}return\"miss\";}"
 ],
 [
  "callee-original-under-bind",
  "function(){function named(){return arguments.callee.name;}return named.bind(null)();}"
 ],
 [
  "callee-recursion",
  "function(){function f(n){return n?arguments.callee(n-1)+1:0;}return f(3);}"
 ],
 [
  "apply-array-like-order",
  "function(){var s=\"\";function f(a,b){s+=\"c\";return a+b;}var o={get length(){s+=\"l\";return 2;},get 0(){s+=\"a\";return 3;},get 1(){s+=\"b\";return 4;}};var n=f.apply(null,o);return s+\":\"+n;}"
 ],
 [
  "bind-metadata-read-order",
  "function(){var s=\"\";function f(){}Object.defineProperty(f,\"length\",{get:function(){s+=\"l\";return 5;}});Object.defineProperty(f,\"name\",{get:function(){s+=\"n\";return\"foo\";}});var b=f.bind(1,2);return s+\":\"+b.name+\":\"+b.length;}"
 ],
 [
  "for-let-closure-cells",
  "function(){var a=[];for(let i=0;i<3;i++)a[i]=function(){return i;};return a[0]()*100+a[1]()*10+a[2]();}"
 ],
 [
  "closure-catch-cell-after-throw",
  "function(){var f;try{throw 7;}catch(e){f=function(){return ++e;};}return f()*100+f();}"
 ],
 [
  "arrow-captures-arguments",
  "function(){function f(a){return (()=>arguments[0])();}return f(9);}"
 ],
 [
  "arguments-var-hoist-preserves-object",
  "function(){function f(a){var arguments;return arguments[0];}return f(9);}"
 ],
 [
  "missing-later-duplicate-param-unmaps-earlier",
  "function(){function f(a,a){a=2;return arguments[0];}return f(1);}"
 ],
 [
  "ordinary-own-function-key-order",
  "function(){function f(){}return Object.getOwnPropertyNames(f).join(\",\");}"
 ],
 [
  "strict-own-function-key-order",
  "function(){function f(){\"use strict\";}return Object.getOwnPropertyNames(f).join(\",\");}"
 ],
 [
  "method-own-function-key-order",
  "function(){var o={m(){}};return Object.getOwnPropertyNames(o.m).join(\",\");}"
 ],
 [
  "arguments-object-tag",
  "function(){return Object.prototype.toString.call(arguments);}"
 ],
 [
  "constructor-new-target",
  "function(){function F(){this.target=new.target;}return(new F).target===F;}"
 ],
 [
  "ordinary-new-target-not-inherited",
  "function(){var seen;function f(){seen=new.target;}function F(){f();}new F;return seen===void 0;}"
 ],
 [
  "arrow-escapes-with-lexical-new-target",
  "function(){function F(){return()=>new.target;}return(new F)()===F;}"
 ],
 [
  "bound-constructor-new-target-remapped",
  "function(){function F(){this.target=new.target;}var B=F.bind(null);return(new B).target===F;}"
 ],
 [
  "nested-native-call-keeps-receiver",
  "function(){return Function.prototype.call.call(function(){\"use strict\";return this;},3)===3;}"
 ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party/ryu-js'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-closures.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-closures');await mkdir(directory,{recursive:true});
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
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-closures.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Directed pure Rust generated closure, receiver, bind/construct, source-metadata, mapped-argument, hoisting and lexical-cell cases. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-closures.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
