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
    "numeric-timeclip-negative-zero",
    "function(){return 1/new Date(-.5).getTime();}"
  ],
  [
    "numeric-timeclip-fraction",
    "function(){return new Date(123.9).getTime();}"
  ],
  [
    "utc-epoch-components",
    "function(){var d=new Date(0);return [d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),d.getUTCDay(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds()].join(\",\");}"
  ],
  [
    "negative-epoch-iso",
    "function(){return new Date(-1).toISOString();}"
  ],
  [
    "maximum-time-iso",
    "function(){return new Date(8640000000000000).toISOString();}"
  ],
  [
    "minimum-time-iso",
    "function(){return new Date(-8640000000000000).toISOString();}"
  ],
  [
    "invalid-clipped-iso-error",
    "function(){try{new Date(8640000000000001).toISOString();}catch(e){return e.name;}return \"bad\";}"
  ],
  [
    "date-utc-overflow-month",
    "function(){return new Date(Date.UTC(2020,12,0,25,-2,90,1234)).toISOString();}"
  ],
  [
    "date-utc-zero-through-99",
    "function(){return new Date(Date.UTC(0,0,1)).toISOString()+\";\"+new Date(Date.UTC(99,0,1)).toISOString();}"
  ],
  [
    "date-utc-one-year-argument",
    "function(){return new Date(Date.UTC(2020)).toISOString();}"
  ],
  [
    "local-constructor-utc-domain",
    "function(){return new Date(2020,1,30,12,34,56,789).toISOString();}"
  ],
  [
    "copy-date-ignores-overrides",
    "function(){var d=new Date(42);d.valueOf=function(){throw 99;};d.toString=function(){throw 100;};return new Date(d).getTime();}"
  ],
  [
    "constructor-object-default-number",
    "function(){var e=\"\",o={valueOf:function(){e+=\"v\";return 42;},toString:function(){e+=\"s\";return \"bad\";}};return new Date(o).getTime()+\";\"+e;}"
  ],
  [
    "date-default-string-vs-number-hint",
    "function(){var e=\"\",d=new Date(0);d.toString=function(){e+=\"s\";return \"x\";};d.valueOf=function(){e+=\"v\";return 7;};return (\"\"+d)+\";\"+(+d)+\";\"+e;}"
  ],
  [
    "date-json-valid-invalid",
    "function(){return JSON.stringify([new Date(0),new Date(NaN)]);}"
  ],
  [
    "generic-tojson-callback-order",
    "function(){var e=\"\",o={valueOf:function(){e+=\"v\";return 2;},get toISOString(){e+=\"g\";return function(){e+=\"c\";return this===o?\"ok\":\"bad\";};}};var r=Date.prototype.toJSON.call(o);return e+\";\"+r;}"
  ],
  [
    "generic-tojson-nan-skips-iso",
    "function(){var e=\"\",o={valueOf:function(){e+=\"v\";return NaN;},get toISOString(){e+=\"bad\";throw 99;}};return Date.prototype.toJSON.call(o)+\";\"+e;}"
  ],
  [
    "parse-iso-offset",
    "function(){return new Date(Date.parse(\"2020-02-03T04:05:06.789+02:30\")).toISOString();}"
  ],
  [
    "parse-iso-fraction",
    "function(){return new Date(\"2020-02-03T04:05:06.12Z\").toISOString();}"
  ],
  [
    "parse-iso-24-hour",
    "function(){return new Date(\"2020-02-03T24:00:00.000Z\").toISOString();}"
  ],
  [
    "parse-iso-date-only",
    "function(){return new Date(\"2020-02-03\").toISOString();}"
  ],
  [
    "parse-iso-month-only",
    "function(){return new Date(\"2020-02\").toISOString();}"
  ],
  [
    "parse-iso-year-only",
    "function(){return new Date(\"2020\").toISOString();}"
  ],
  [
    "parse-extended-year",
    "function(){return new Date(\"-000001-01-01T00:00:00.000Z\").toISOString();}"
  ],
  [
    "parse-invalid-iso-month",
    "function(){return new Date(\"2020-13-01\").toJSON();}"
  ],
  [
    "parse-offset-before-timeclip",
    "function(){return new Date(\"+275760-09-13T00:01:00.000+01:00\").toISOString();}"
  ],
  [
    "utc-display",
    "function(){return new Date(0).toUTCString();}"
  ],
  [
    "gmt-method-alias",
    "function(){return Date.prototype.toGMTString===Date.prototype.toUTCString;}"
  ],
  [
    "utc-local-display",
    "function(){return new Date(0).toString();}"
  ],
  [
    "date-gettime-receiver-error",
    "function(){try{Date.prototype.getTime.call({});}catch(e){return e.name;}return \"bad\";}"
  ],
  [
    "settime-clips",
    "function(){var d=new Date(0);return d.setTime(-.9)+\";\"+(1/d.getTime());}"
  ],
  [
    "reflect-native-date-newtarget",
    "function(){function N(){}N.prototype=7;var d=Reflect.construct(Date,[42],N);return d.getTime()+\";\"+(Object.getPrototypeOf(d)===Date.prototype);}"
  ],
  [
    "date-bound-constructor",
    "function(){var F=Date.bind(null,5);var d=new F();return d.getTime()+\";\"+(d instanceof Date)+\";\"+(d instanceof F);}"
  ],
  [
    "native-date-prototype-get-after-coercion",
    "function(){var e=\"\";var N=(function(){}).bind(null);Object.defineProperty(N,\"prototype\",{get:function(){e+=\"p\";return Date.prototype;}});var arg={valueOf:function(){e+=\"v\";return 42;}};var d=Reflect.construct(Date,[arg],N);return d.getTime()+\";\"+e;}"
  ],
  [
    "native-date-function-ignores-arguments",
    "function(){return typeof Date({valueOf:function(){throw 99;}});}"
  ],
  [
    "native-date-now-is-number",
    "function(){return typeof Date.now();}"
  ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party/ryu-js'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-date.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-date');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'date:'+name,allowUnsupported:false})}));
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
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Date source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-date.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Actual Babel-generated Rust Date programs: UTC/ISO calendar/time clipping, native Date calls, current-time result types, argument conversion, generic toJSON and constructor/newTarget order. Local operations require verified UTC; legacy parse formats, setters and locale methods remain explicit Unsupported. Current wall-clock values themselves are not compared across sequential executions. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-date.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
