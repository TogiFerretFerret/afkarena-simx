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
    "add-left-right-number",
    "function(){var e=[];var a={valueOf:function(){e.push(\"L\");return 3;}},b={valueOf:function(){e.push(\"R\");return 4;}};var r=a+b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "add-both-primitives-before-concat",
    "function(){var e=[];var a={valueOf:function(){e.push(\"L\");return \"x\";}},b={valueOf:function(){e.push(\"R\");return 4;}};var r=a+b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "fallback-valueof-object",
    "function(){var e=[];var a={get valueOf(){e.push(\"get-v\");return function(){e.push(\"call-v\");return {};};},get toString(){e.push(\"get-s\");return function(){e.push(\"call-s\");return \"7\";};}};var r=+a;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "string-hint-first",
    "function(){var e=[];var a={toString:function(){e.push(\"s\");return \"9\";},valueOf:function(){e.push(\"v\");return 4;}};var r=String(a);return e.join(\",\")+\";\"+r;}"
  ],
  [
    "number-hint-first",
    "function(){var e=[];var a={toString:function(){e.push(\"s\");return \"9\";},valueOf:function(){e.push(\"v\");return 4;}};var r=Number(a);return e.join(\",\")+\";\"+r;}"
  ],
  [
    "greater-left-before-right",
    "function(){var e=[];var a={valueOf:function(){e.push(\"L\");return 3;}},b={valueOf:function(){e.push(\"R\");return 4;}};var r=a>b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "less-equal-left-before-right",
    "function(){var e=[];var a={valueOf:function(){e.push(\"L\");return 3;}},b={valueOf:function(){e.push(\"R\");return 4;}};var r=a<=b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "abstract-equality-default-hint",
    "function(){var e=[];var a={valueOf:function(){e.push(\"v\");return \"1\";}};return (a==true)+\";\"+e.join(\",\");}"
  ],
  [
    "null-equality-no-coercion",
    "function(){var e=[];var a={valueOf:function(){e.push(\"bad\");return null;}};return (a==null)+\";\"+e.join(\",\");}"
  ],
  [
    "strict-equality-no-coercion",
    "function(){var e=[];var a={valueOf:function(){e.push(\"bad\");return 1;}};return (a===1)+\";\"+(a===a)+\";\"+e.join(\",\");}"
  ],
  [
    "throwing-valueof-getter-identity",
    "function(){var e=[],sentinel={};var a={get valueOf(){e.push(\"get\");throw sentinel;},toString:function(){e.push(\"bad\");return \"1\";}};try{+a;}catch(x){return e.join(\",\")+\";\"+(x===sentinel);}return \"bad\";}"
  ],
  [
    "skip-noncallable-valueof",
    "function(){var e=[];var a={get valueOf(){e.push(\"get-v\");return 4;},get toString(){e.push(\"get-s\");return function(){e.push(\"call-s\");return \"5\";};}};return +a+\";\"+e.join(\",\");}"
  ],
  [
    "nonprimitive-returns-typeerror",
    "function(){var e=[];var a={valueOf:function(){e.push(\"v\");return {};},toString:function(){e.push(\"s\");return {};}};try{+a;}catch(x){return x.name+\";\"+e.join(\",\");}return \"bad\";}"
  ],
  [
    "coercion-receiver-identity",
    "function(){var a={valueOf:function(){return this===a?8:99;}};return +a;}"
  ],
  [
    "left-mutates-right-conversion",
    "function(){var e=[];var b={valueOf:function(){e.push(\"old\");return 3;}};var a={valueOf:function(){e.push(\"L\");b.valueOf=function(){e.push(\"new\");return 7;};return 2;}};var r=a+b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "greater-left-mutates-right",
    "function(){var e=[];var b={valueOf:function(){e.push(\"old\");return 3;}};var a={valueOf:function(){e.push(\"L\");b.valueOf=function(){e.push(\"new\");return 7;};return 2;}};var r=a>b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "subtract-coercion-order",
    "function(){var e=[];var a={valueOf:function(){e.push(\"L\");return \"9\";}},b={valueOf:function(){e.push(\"R\");return \"2\";}};var r=a-b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "shift-coercion-order",
    "function(){var e=[];var a={valueOf:function(){e.push(\"L\");return 3;}},b={valueOf:function(){e.push(\"R\");return 2;}};var r=a<<b;return e.join(\",\")+\";\"+r;}"
  ],
  [
    "concat-lone-surrogates",
    "function(){var a={valueOf:function(){return \"\\ud800\";}};return a+\"\\udfff\";}"
  ],
  [
    "math-max-nan-still-converts-tail",
    "function(){var e=[];var a={valueOf:function(){e.push(\"tail\");return 3;}};var r=Math.max(NaN,a);return e.join(\",\")+\";\"+r;}"
  ],
  [
    "math-min-tail-throw-after-nan",
    "function(){var e=[],sentinel={};var a={valueOf:function(){e.push(\"tail\");throw sentinel;}};try{Math.min(NaN,a);}catch(x){return e.join(\",\")+\";\"+(x===sentinel);}return \"bad\";}"
  ],
  [
    "math-imul-coercion-order",
    "function(){var e=[];var a={valueOf:function(){e.push(\"L\");return 4294967295;}},b={valueOf:function(){e.push(\"R\");return 3;}};var r=Math.imul(a,b);return e.join(\",\")+\";\"+r;}"
  ],
  [
    "math-round-object-negative-zero",
    "function(){var a={valueOf:function(){return -.5;}};var r=Math.round(a);return 1/r;}"
  ],
  [
    "relational-utf16-order",
    "function(){return (\"\\ud800\"<\"\\ue000\")+\";\"+(\"\\udfff\">\"\\ud800\");}"
  ],
  [
    "atan-object-coercion",
    "function(){var e=\"\";var a={valueOf:function(){e+=\"v\";return 1;}};var r=Math.atan(a);return e+\";\"+r;}"
  ],
  [
    "atan2-object-coercion-order",
    "function(){var e=\"\";var a={valueOf:function(){e+=\"y\";return 1;}},b={valueOf:function(){e+=\"x\";return -1;}};var r=Math.atan2(a,b);return e+\";\"+r;}"
  ],
  [
    "atan2-throw-stops-second-coercion",
    "function(){var e=\"\",s={};var a={valueOf:function(){e+=\"y\";throw s;}},b={valueOf:function(){e+=\"bad\";return -1;}};try{Math.atan2(a,b);}catch(x){return e+\";\"+(x===s);}return \"bad\";}"
  ],
  [
    "atan2-nan-still-converts-second",
    "function(){var e=\"\";var a={valueOf:function(){e+=\"y\";return NaN;}},b={valueOf:function(){e+=\"x\";return -1;}};var r=Math.atan2(a,b);return e+\";\"+r;}"
  ],
  [
    "atan2-quadrant-raw-bits",
    "function(){return Math.atan2(1,-1);}"
  ],
  [
    "atan-negative-zero-raw-bits",
    "function(){return Math.atan(-0);}"
  ]
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party/ryu-js'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-coercions.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-coercions');await mkdir(directory,{recursive:true});
const modules=cases.map(([name,source],index)=>({name,source,index,...compileSource(source,{mode:'function',filename:'coercion:'+name,allowUnsupported:false})}));
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
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'Coercion source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-coercions.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Actual Babel-generated Rust object coercion, getter/call/throw order, receiver identity, UTF-16 comparisons and Math coercion cases. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-coercions.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
