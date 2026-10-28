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
 ['for-continue-updates','function(){var i=0,s=0;for(;i<5;i++){if(i===2)continue;s=s*10+i;}return s*10+i;}'],
 ['nested-label-continue','function(){var i=0;outer:for(;i<4;i++){for(var j=0;j<4;j++){if(j===1)continue outer;}}return i;}'],
 ['finally-return-overrides','function(){function f(){try{return 1;}finally{return 2;}}return f();}'],
 ['catch-finally-mutation','function(){var x=1;try{throw x;}catch(e){x=e+4;}finally{x=x*2;}return x;}'],
 ['outer-finally-overrides','function(){var trace=0;try{try{return 7;}finally{trace=4;}}finally{return trace;}}'],
 ['finally-with-loop-abrupt','function(){var t=0;outer:for(var i=0;i<3;i++){try{if(i<2)continue outer;t=9;break outer;}finally{t=t*10+i;}}return t;}'],
 ['for-in-deletion','function(){var o={a:1,b:2};var seen="";for(var k in o){seen+=k;if(k==="a")delete o.b;}return seen;}'],
 ['for-in-head-tdz','function(){let x={a:1};try{for(let x in x){}}catch(e){return e.name;}return "miss";}'],
 ['for-let-capture','function(){var f0,f1;for(let i=0;i<2;i++){if(i===0)f0=function(){return i;};else f1=function(){return i;};}return f0()*10+f1();}'],
 ['for-in-let-capture','function(){var f0,f1;var i=0;for(let x in {a:1,b:2}){if(i++===0)f0=function(){return x;};else f1=function(){return x;};}return f0()+f1();}'],
 ['switch-lazy-case-fallthrough','function(){var s=0;switch(2){case(s=s*10+1,1):s+=100;break;default:s+=1000;case(s=s*10+2,2):s+=3;case(s=s*10+9,9):s+=4;}return s;}'],
 ['switch-default-after-tests','function(){var s=0;switch(8){case(s=s*10+1,1):s+=100;break;default:s+=1000;case(s=s*10+2,2):s+=3;}return s;}'],
 ['label-block-break','function(){var x=0;outside:{x=1;{break outside;}x=2;}return x;}'],
 ['do-while-continue-test','function(){var i=0,s=0;do{if(i++<2)continue;s+=i;}while(i<4);return s;}'],
 ['finally-throw-overrides-return','function(){try{return 1;}finally{throw 7;}}'],
 ['throw-identity','function(){var o={};try{try{throw o;}finally{}}catch(e){return e===o;}}'],
 ['catch-var-initializer-shadows','function(){var e=10;try{throw 3;}catch(e){var e=4;}return e;}'],
 ['strict-switch-function','function(){"use strict";switch(0){case 0:function f(){return 9;}return f();}}'],
 ['block-tdz','function(){var x=5;try{{let y=x;let x=1;}}catch(e){return e.name;}return "miss";}'],
 ['throw-finally-normal','function(){try{throw 9;}finally{}}'],
 ['continue-finally-break-overrides','function(){var x=0;for(var i=0;i<4;i++){try{continue;}finally{x=i;break;}}return x;}'],
 ['return-after-var-no-reset','function(a){var a;return a===void 0;}'],
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party/ryu-js'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-control-flow.mjs'])await bind(file);
const directory=resolve(root,'work/rust-port-control');await mkdir(directory,{recursive:true});
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
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-control-flow.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:cases.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Directed statement completion, lexical environment, loop, switch, throw/catch/finally and closure-capture cases. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-control-flow.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:cases.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
