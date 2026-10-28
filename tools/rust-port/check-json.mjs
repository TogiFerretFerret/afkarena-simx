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
    "parse-duplicate-index-order",
    "function(){return JSON.stringify(JSON.parse('{\"b\":1,\"2\":2,\"1\":1,\"a\":-0,\"b\":3}'));}"
  ],
  [
    "parse-negative-zero",
    "function(){var x=JSON.parse(\"-0\");return 1/x;}"
  ],
  [
    "parse-lone-and-paired-surrogates",
    "function(){return JSON.stringify(JSON.parse('[\"\\\\ud800\",\"\\\\udfff\",\"\\\\ud83d\\\\udca9\"]'));}"
  ],
  [
    "parse-overflow",
    "function(){return JSON.stringify(JSON.parse(\"[1e999,-1e999,-0,5e-324]\"));}"
  ],
  [
    "parse-proto-data-property",
    "function(){var o=JSON.parse('{\"__proto__\":{\"x\":3},\"a\":2}');return (Object.getPrototypeOf(o)===Object.prototype)+\";\"+JSON.stringify(o);}"
  ],
  [
    "array-undefined-function-nan",
    "function(){return JSON.stringify([void 0,function(){},NaN,Infinity,-Infinity,-0]);}"
  ],
  [
    "root-undefined",
    "function(){return JSON.stringify(void 0);}"
  ],
  [
    "function-tojson",
    "function(){function f(){}f.toJSON=function(k){return \"f:\"+k;};return JSON.stringify(f);}"
  ],
  [
    "own-key-snapshot-live-get",
    "function(){var e=\"\";var o={get a(){e+=\"a\";this.c=5;delete this.b;return 1;},get b(){e+=\"b\";return 2;}};var r=JSON.stringify(o);return e+\";\"+r;}"
  ],
  [
    "inherited-array-hole-getter",
    "function(){var e=\"\";Object.defineProperty(Array.prototype,\"1\",{get:function(){e+=\"h\";return 9;},configurable:true});var a=[1,,3];var r=JSON.stringify(a);return e+\";\"+r;}"
  ],
  [
    "tojson-before-replacer",
    "function(){var e=\"\";var o={toJSON:function(k){e+=\"j\"+k+\"|\";return {b:3};}};var r=JSON.stringify(o,function(k,v){e+=\"r\"+k+\"|\";return v;});return e+\";\"+r;}"
  ],
  [
    "replacer-holder-identity",
    "function(){var o={a:1},e=\"\";var r=JSON.stringify(o,function(k,v){e+=(k===\"\"?this[k]===o:this===o)+\"|\";return v;});return e+\";\"+r;}"
  ],
  [
    "replacer-snapshot-not-added-key",
    "function(){var o={a:1};return JSON.stringify(o,function(k,v){if(k===\"a\")o.b=2;return v;});}"
  ],
  [
    "replacer-array-order-dedup",
    "function(){return JSON.stringify({a:1,b:2,\"1\":3,c:4},[\"b\",\"a\",\"b\",1,new String(\"c\")]);}"
  ],
  [
    "replacer-array-inherited-nonenum",
    "function(){var p={x:7},o=Object.create(p);Object.defineProperty(o,\"y\",{value:8});return JSON.stringify(o,[\"x\",\"y\"]);}"
  ],
  [
    "pretty-number-space",
    "function(){return JSON.stringify({b:[1,{a:2}],c:{}},null,2);}"
  ],
  [
    "pretty-ten-unit-space",
    "function(){return JSON.stringify({a:[1,2]},null,\"abcdefghijk\");}"
  ],
  [
    "cycle-name",
    "function(){var o={};o.self=o;try{JSON.stringify(o);}catch(e){return e.name;}return \"bad\";}"
  ],
  [
    "tojson-breaks-cycle",
    "function(){var o={};o.self=o;o.toJSON=function(){return 7;};return JSON.stringify(o);}"
  ],
  [
    "replacer-cuts-cycle",
    "function(){var o={};o.self=o;return JSON.stringify(o,function(k,v){if(k===\"self\")return void 0;return v;});}"
  ],
  [
    "alias-is-not-cycle",
    "function(){var q={x:1};return JSON.stringify({a:q,b:q});}"
  ],
  [
    "tojson-getter-throw-prefix",
    "function(){var e=\"\",sentinel={};var o={get toJSON(){e+=\"j\";throw sentinel;}};try{JSON.stringify(o,function(k,v){e+=\"bad\";return v;});}catch(x){return e+\";\"+(x===sentinel);}return \"bad\";}"
  ],
  [
    "replacer-throw-prefix",
    "function(){var e=\"\",s={},o={a:1,b:2};try{JSON.stringify(o,function(k,v){e+=k+\"|\";if(k===\"a\"){o.b=8;throw s;}return v;});}catch(x){return e+\";\"+(x===s)+\";\"+o.b;}return \"bad\";}"
  ],
  [
    "boxed-primitives",
    "function(){return JSON.stringify([new Number(-0),new Boolean(false),new String(\"\\ud800\")]);}"
  ],
  [
    "parse-tostring-callback",
    "function(){var e=\"\";var o={toString:function(){e+=\"s\";return \"12\";}};return JSON.parse(o)+\";\"+e;}"
  ],
  [
    "parse-error-name",
    "function(){try{JSON.parse(\"[1,]\");}catch(e){return e.name;}return \"bad\";}"
  ],
  [
    "parse-invalid-leading-zero",
    "function(){try{JSON.parse(\"01\");}catch(e){return e.name;}return \"bad\";}"
  ],
  [
    "parse-json-whitespace-excludes-nbsp",
    "function(){try{JSON.parse(\"\\u00a01\");}catch(e){return e.name;}return \"bad\";}"
  ],
  [
    "boxed-number-overridden-valueof",
    "function(){var n=new Number(4);n.valueOf=function(){return 9;};return JSON.stringify(n);}"
  ],
  [
    "primitive-vs-boxed-tojson",
    "function(){Number.prototype.toJSON=function(k){return \"x\"+k;};return JSON.stringify([1,new Number(2)]);}"
  ],
  [
    "space-box-string-conversion",
    "function(){var s=new String(\"x\");s.toString=function(){return \"----------Z\";};return JSON.stringify({a:1},null,s);}"
  ],
  [
    "replacer-result-does-not-reapply-tojson",
    "function(){return JSON.stringify({x:1},function(k,v){if(k===\"x\"){var f=function(){};f.toJSON=function(){return 7;};return f;}return v;});}"
  ],
  [
    "noncallable-reviver-ignored",
    "function(){return JSON.parse(\"3\",7);}"
  ],
  [
    "string-quote-controls",
    "function(){return JSON.stringify(\"\\u0000\\b\\t\\n\\f\\r\\\\\\\"\\u2028\\u2029\");}"
  ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party/ryu-js'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-json.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-json');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'json:'+name,allowUnsupported:false})}));
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
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'JSON source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-json.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Actual Babel-generated Rust JSON.parse/stringify programs, callbacks, getters, toJSON/replacer order, UTF-16 escaping, property ordering and failure-prefix identities. Callable parse revivers remain explicitly unsupported; SyntaxError message strings are not qualified by these error-name fixtures. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-json.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
