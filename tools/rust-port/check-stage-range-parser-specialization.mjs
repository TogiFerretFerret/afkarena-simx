import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
import {sourceCopyFunction} from '../flat-numeric-copy.mjs';
const root=resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});process.stdout.write(child.stdout??'');process.stderr.write(child.stderr??'');process.exit(child.status??1);}
const pin=JSON.parse(await readFile(resolve(root,'config/native-stage-range-parser.json'),'utf8')),file=await readFile(resolve(root,pin.source),'utf8'),parserSource=file.slice(pin.start,pin.end);assert.equal(sha(parserSource),pin.sha256);
const setup=`var events=[],ed={},cc={warn:function(a,b,c,d){events.push([a,b,c,d])}};ed.parseUseSkillCacheStageBattle=${parserSource};function bits(x){var d=new DataView(new ArrayBuffer(8));d.setFloat64(0,x,false);return d.getUint32(0,false).toString(16).padStart(8,'0')+d.getUint32(4,false).toString(16).padStart(8,'0');}`;
const cases=[
 ['standard','function(){var r=ed.parseUseSkillCacheStageBattle(["stage","1","9000","tower","20001","29000"]);return JSON.stringify([r,Object.keys(r),events]);}'],
 ['empty','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle([]),events]);}'],
 ['mode-only','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","tower"]),events]);}'],
 ['repeat-mode','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["z","1","2","a","3","4","z","5","6"]),events]);}'],
 ['reversed-range','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","9","1"]),events]);}'],
 ['uint-bounds','function(){var r=ed.parseUseSkillCacheStageBattle(["stage","0000000000","4294967295"]);return JSON.stringify([r,bits(r.stage[0][0]),bits(r.stage[0][1]),events]);}'],
 ['result-fresh','function(){var x=["stage","1","2"],a=ed.parseUseSkillCacheStageBattle(x);a.stage[0][0]=99;a.stage.push([7,8]);a.extra=4;var b=ed.parseUseSkillCacheStageBattle(x);return JSON.stringify([a,b,a!==b,a.stage!==b.stage,a.stage[0]!==b.stage[0],events]);}'],
 ['input-mutation','function(){var x=["stage","1","2"],a=ed.parseUseSkillCacheStageBattle(x);x[1]="9";var b=ed.parseUseSkillCacheStageBattle(x);return JSON.stringify([a,b,events]);}'],
 ['input-getter','function(){var x=["stage","1","2"];Object.defineProperty(x,"1",{get:function(){events.push("get");return "1"}});return JSON.stringify([ed.parseUseSkillCacheStageBattle(x),events]);}'],
 ['getter-mutates-next','function(){var x=["stage","1","2"];Object.defineProperty(x,"1",{get:function(){events.push("get");x[2]="8";return "1"}});return JSON.stringify([ed.parseUseSkillCacheStageBattle(x),events]);}'],
 ['input-hole','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle([,"1","2"]),events]);}'],
 ['not-array','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle({0:"stage",1:"1",2:"2",length:3}),events]);}'],
 ['null-input','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(null),events]);}'],
 ['numeric-without-mode','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["1","2","stage","3","4"]),events]);}'],
 ['incomplete','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1"]),events]);}'],
 ['bad-range','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1","bad"]),events]);}'],
 ['partial-int','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1e3","2tail"]),events]);}'],
 ['negative-zero','function(){var r=ed.parseUseSkillCacheStageBattle(["stage","-0","2"]);return JSON.stringify([r,bits(r.stage[0][0]),events]);}'],
 ['signed-spaces','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage"," -2 ","+4"]),events]);}'],
 ['fractional','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1.5","2.9"]),events]);}'],
 ['hex','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","0x10","0x20"]),events]);}'],
 ['large-int','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","4294967296","9007199254740993"]),events]);}'],
 ['unicode-mode','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["关卡","1","2"]),events]);}'],
 ['empty-mode','function(){return JSON.stringify([ed.parseUseSkillCacheStageBattle(["","1","2"]),events]);}'],
 ['constructor-mode','function(){try{return JSON.stringify([ed.parseUseSkillCacheStageBattle(["constructor","1","2"]),events])}catch(e){return JSON.stringify([e.name,events]);}}'],
 ['proto-mode','function(){try{return JSON.stringify([ed.parseUseSkillCacheStageBattle(["__proto__","1","2"]),events])}catch(e){return JSON.stringify([e.name,events]);}}'],
 ['isArray-observer','function(){var old=Array.isArray;Array.isArray=function(x){events.push(this===Array);return old(x)};return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1","2"]),events]);}'],
 ['Array-getter','function(){var old=Array;Object.defineProperty(globalThis,"Array",{get:function(){events.push("Array");return old}});return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1","2"]),events]);}'],
 ['parseInt-observer','function(){var old=parseInt;parseInt=function(x){events.push("parse:"+x);return old(x)};return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1","2"]),events]);}'],
 ['isNaN-observer','function(){var old=isNaN;isNaN=function(x){events.push("nan:"+x);return old(x)};return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1","2"]),events]);}'],
 ['isFinite-observer','function(){var old=isFinite;isFinite=function(x){events.push("finite:"+x);return old(x)};return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1","2"]),events]);}'],
 ['push-observer','function(){var calls=0,old=Array.prototype.push;Array.prototype.push=function(x){calls++;return old.call(this,x)};var r=ed.parseUseSkillCacheStageBattle(["stage","1","2"]);return JSON.stringify([r,calls]);}'],
 ['lexical-parseInt','function(){var old=parseInt;ed.parseUseSkillCacheStageBattle=(function(parseInt){return SOURCE_PARSER})(function(x){events.push("parse:"+x);return old(x)});return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage","1","2"]),events]);}'],
 ['mode-getter','function(){var log="";Object.defineProperty(Object.prototype,"stage",{get:function(){log+="g";return []},configurable:true});var r=ed.parseUseSkillCacheStageBattle(["stage","1","2"]);return JSON.stringify([Object.keys(r),log]);}'],
 ['array-index-setter','function(){var log="";Object.defineProperty(Array.prototype,"0",{get:function(){return 7},set:function(v){log+="s"},configurable:true});var r=ed.parseUseSkillCacheStageBattle(["stage","1","2"]);return JSON.stringify([Object.keys(r.stage),r.stage.length,log]);}'],
 ['cache-then-proto-mutation','function(){var x=["stage","1","2"],a=ed.parseUseSkillCacheStageBattle(x),log="";Object.defineProperty(Object.prototype,"stage",{get:function(){log+="g";return []},configurable:true});var b=ed.parseUseSkillCacheStageBattle(x);return JSON.stringify([Object.keys(a),Object.keys(b),log]);}'],
 ['token-object','function(){var x={toString:function(){events.push("string");return "1"},valueOf:function(){events.push("value");return 1}};return JSON.stringify([ed.parseUseSkillCacheStageBattle(["stage",x,"2"]),events]);}'],
 ['warning-throws','function(){cc.warn=function(){throw 9};try{ed.parseUseSkillCacheStageBattle(["1"])}catch(e){return e}return "miss";}']
];for(const row of cases)row[1]=row[1].replaceAll('SOURCE_PARSER',parserSource);
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-stage-range-parser-specialization.mjs','tools/flat-numeric-copy.mjs','config/native-stage-range-parser.json',pin.source])await bind(file);
const directory=resolve(root,'work/rust-port-stage-range-parser-specialization');await mkdir(directory,{recursive:true});
const expanded=cases.flatMap(([name,source])=>[false,true].map(specialized=>({name,source,specialized})));const modules=expanded.map(({name,source,specialized},index)=>({name,source,specialized,index,...compileSource(setup+'\nvar result=('+source+')();',{mode:'script',filename:'stage-range-parser-specialization:'+name,allowUnsupported:false,sourceSpecializations:specialized})}));
for(const item of modules){const copies=item.manifest.functions.filter(fn=>fn.sourceSha256===sha(parserSource));assert.ok(copies.length);assert.ok(copies.every(fn=>Boolean(fn.sourceSpecialization)===item.specialized),'Copy specialization switch must be exercised');}
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();rt.native_stage_range_parser_enabled=true;let env=rt.global_env;let value=case_${item.index}::run(&mut rt,env,Value::Undefined).and_then(|_|rt.lookup(env,"result"));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-j','1','--config','profile.release.codegen-units=64','--config','profile.release.lto=false','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,expanded.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<expanded.length;index++){const{name,source,specialized}=expanded[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;runInContext(setup,realm);try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,specialized,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'copyObj specialization source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-stage-range-parser-specialization.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:expanded.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Guarded exact-source createDataObj primitive-only for-in scan, with mutable Array binding, getters, inherited enumerable properties, copy callbacks, closure identity/source and wrap/recover behavior. This is a copy component gate, not battle qualification. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-stage-range-parser-specialization.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:expanded.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
