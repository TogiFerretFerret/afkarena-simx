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
const setup="";
const cases=[
 ['dense','function(){var a=[11,22];return a[1]+":"+a[1];}'],
 ['negative-zero','function(){var a=[11];return a[-0];}'],
 ['positive-zero','function(){var a=[11];return a[+0];}'],
 ['huge-canonical','function(){var a={"1e+21":7};return a[1e21];}'],
 ['overflow-literal','function(){var a={Infinity:7,"-Infinity":8};return a[1e309]+":"+a[-1e309];}'],
 ['fraction','function(){var a={"1.5":7};return a[1.5];}'],
 ['hole-prefix','function(){var a=[,,7];return a[2];}'],
 ['named-before-index','function(){var a=[];a.x=1;a[0]=7;return a[0]+":"+a[0];}'],
 ['delete-reinsert','function(){var a=[1,2];var first=a[0];delete a[0];a[0]=8;return first+":"+a[0];}'],
 ['overwrite','function(){var a=[1];var x=a[0];a[0]=8;return x+":"+a[0];}'],
 ['descriptor-attributes','function(){var a=[1];Object.defineProperty(a,"0",{value:8,writable:false,configurable:false,enumerable:false});return a[0];}'],
 ['own-getter','function(){var a=[1],n=0;Object.defineProperty(a,"0",{get:function(){n++;return this.length+n;}});return a[0]+":"+a[0]+":"+n;}'],
 ['prototype-getter-hole','function(){var a=[,],n=0;Object.defineProperty(Array.prototype,"0",{configurable:true,get:function(){n++;return this.length+7;}});var x=a[0];delete Array.prototype[0];return x+":"+n;}'],
 ['own-shadows-getter','function(){var a=[3],n=0;Object.defineProperty(Array.prototype,"0",{configurable:true,get:function(){n++;return 9;}});var x=a[0];delete Array.prototype[0];return x+":"+n;}'],
 ['getter-replaces-data','function(){var a=[1];Object.defineProperty(a,"0",{configurable:true,get:function(){Object.defineProperty(a,"0",{value:9});return 3;}});return a[0]+":"+a[0];}'],
 ['shrink-readd','function(){var a=[1,2,3];a.length=1;a[2]=8;return a[2]+":"+a.length;}'],
 ['extend-hole','function(){var a=[1];a.length=4;return typeof a[2];}'],
 ['sparse-huge','function(){var a=[];a[4294967294]=7;return a[4294967294]+":"+a.length;}'],
 ['uint32-max-property','function(){var a=[];a[4294967295]=7;return a[4294967295]+":"+a.length;}'],
 ['primitive-string','function(){return "abc"[1];}'],
 ['typed-array','function(){var a=new Uint8Array(2);a[1]=255;return a[1];}'],
 ['mapped-arguments','function(){function f(x){x=8;return arguments[0];}return f(1);}'],
 ['inherited-data','function(){var a=[,];Array.prototype[0]=8;var n=a[0];delete Array.prototype[0];return n;}'],
 ['compound-rhs-order','function(){var a=[2],l=[];Object.defineProperty(a,"0",{get:function(){l.push("get");return 2;},set:function(v){l.push("set"+v);}});a[0]+=(l.push("rhs"),3);return l.join("|");}'],
 ['assignment-setter-only','function(){var a=[],l=[];Object.defineProperty(a,"0",{get:function(){l.push("bad");return 2;},set:function(v){l.push("set"+v);}});a[0]=(l.push("rhs"),3);return l.join("|");}'],
 ['postfix-and-prefix','function(){var a=[2];var x=a[0]++;return x+":"+(++a[0])+":"+a[0];}'],
 ['logical-assignment','function(){var a=[0];a[0]||=7;a[0]&&=8;return a[0];}'],
 ['method-receiver','function(){var a={0:function(){return this.x;},x:9};return a[0]();}'],
 ['null-base','function(){try{return null[0];}catch(e){return e.name;}}'],
 ['optional-null','function(){return null?.[0];}'],
 ['dynamic-key-coercion-fallback','function(){var n=0,a=[7],k={toString:function(){n++;return "0";}};return a[k]+":"+n;}'],
 ['binary-nan-fallback','function(){var a={NaN:7};return a[0/0];}'],
 ['negative-zero-result','function(){var a=[-0];return a[0];}'],
 ['nan-getter-result','function(){var a={};Object.defineProperty(a,"0",{get:function(){return 0/0;}});return a[0];}'],
 ['literal-write-rhs-throws','function(){var a=[2];try{a[0]+=function(){throw 7;}();}catch(e){return a[0]+":"+e;}}'],
 ['polymorphic-own-slots','function(){function f(a){return a[0];}var a={x:1,0:7},b={0:8,x:2};return f(a)+":"+f(b)+":"+f(a);}'],
 ['accessor-mutates-prototype','function(){var a=[,];Object.defineProperty(Array.prototype,"0",{configurable:true,get:function(){Object.defineProperty(a,"0",{value:9});return 3;}});var n=a[0]+":"+a[0];delete Array.prototype[0];return n;}']
];
for(const high of ["7ff00000","fff00000","7ff80000","fff80000"]){cases.push(['raw-number-data-'+high,`function(){var v=new DataView(new ArrayBuffer(8));v.setUint32(0,0x${high});v.setUint32(4,1);var a={label:null};a[0]=v.getFloat64(0);function f(x){return x[0];}f(a);return f(a);}`]);}
cases.push(['source-text','function(){var f=function(a){return a[0];};return f.toString();}']);
for(const options of [{numericLiteralReadSlots:true,numericLiteralKeys:false},{numericLiteralReadSlots:true,literalPropertySlots:false}]){const x=compileSource('function(a){return a[0];}',{mode:'function',...options});assert.equal(x.rust.includes('get_literal_cached'),false);}
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-numeric-literal-read-slots.mjs','crates/js-runtime/src/env.rs','crates/js-runtime/src/literal_pool.rs'])await bind(file);
const directory=resolve(root,'work/rust-port-numeric-literal-read-slots');await mkdir(directory,{recursive:true});
const expanded=cases.flatMap(([name,source])=>[{name,source,specialized:false,forceSplit:false},{name,source,specialized:true,forceSplit:false},{name:name+':split',source,specialized:true,forceSplit:true}]);const modules=expanded.map(({name,source,specialized,forceSplit},index)=>({name,source,specialized,forceSplit,index,...compileSource(setup+'\nvar result=('+source+')();',{mode:'script',filename:'numeric-literal-read-slots:'+name,allowUnsupported:false,staticEnvironmentNames:true,numericLiteralReadSlots:specialized,largeBody:forceSplit?{minimumNodes:1,maxNodes:128,maxStatements:4,maxInitGroups:8}:false})}));
const denseVariants=modules.filter(item=>item.name==='dense');assert.equal(denseVariants[0].rust.includes('get_literal_cached'),false);assert.equal(denseVariants[1].rust.includes('get_literal_cached'),true);
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();let env=rt.global_env;let value=case_${item.index}::run(&mut rt,env,Value::Undefined).and_then(|_|rt.lookup(env,"result"));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH,CARGO_BUILD_JOBS:'1'};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,expanded.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<expanded.length;index++){const{name,source,specialized}=expanded[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;runInContext(setup,realm);try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,specialized,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'override dispatcher source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-numeric-literal-read-slots.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:expanded.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Numeric-literal computed reads emitted through existing guarded literal property slots ON/OFF and ON with helper splitting, compared to pinned source raw returned number bits. Existing slots must match the canonical literal key and contain own Data; holes, getters, named-prefix insertion, deletion/reinsertion, sparse indices, primitive/object keys, typed arrays and arguments use fallback. The exact preexisting numeric literal whitelist and pinned String(number) canonicalization is reused; dynamic/arbitrary expression keys are unchanged. No runtime modifications. Component only, not battle qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-numeric-literal-read-slots.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:expanded.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
