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
 ['dense','function(){var a=[11,22],k=1;return a[k];}'],
 ['negative-zero','function(){var a=[11],k=-0;return a[k];}'],
 ['hole-prefix','function(){var a=[,,7],k=2;return a[k];}'],
 ['named-before-index','function(){var a=[];a.x=1;a[0]=7;var k=0;return a[k];}'],
 ['delete-reinsert','function(){var a=[1,2];delete a[0];a[0]=8;var k=0;return a[k];}'],
 ['overwrite','function(){var a=[1],k=0;var x=a[k];a[k]=8;return x+":"+a[k];}'],
 ['descriptor-attributes','function(){var a=[1],k=0;Object.defineProperty(a,"0",{value:8,writable:false,configurable:false,enumerable:false});return a[k];}'],
 ['own-getter','function(){var a=[1],n=0,k=0;Object.defineProperty(a,"0",{get:function(){n++;return this.length+n;}});return a[k]+":"+a[k]+":"+n;}'],
 ['prototype-getter-hole','function(){var a=[,],n=0,k=0;Object.defineProperty(Array.prototype,"0",{configurable:true,get:function(){n++;return this.length+7;}});var x=a[k];delete Array.prototype[0];return x+":"+n;}'],
 ['own-shadows-getter','function(){var a=[3],n=0,k=0;Object.defineProperty(Array.prototype,"0",{configurable:true,get:function(){n++;return 9;}});var x=a[k];delete Array.prototype[0];return x+":"+n;}'],
 ['getter-replaces-data','function(){var a=[1],k=0;Object.defineProperty(a,"0",{configurable:true,get:function(){Object.defineProperty(a,"0",{value:9});return 3;}});return a[k]+":"+a[k];}'],
 ['shrink-readd','function(){var a=[1,2,3],k=2;a.length=1;a[k]=8;return a[k]+":"+a.length;}'],
 ['extend-hole','function(){var a=[1],k=2;a.length=4;return typeof a[k];}'],
 ['sparse-huge','function(){var a=[],k=4294967294;a[k]=7;return a[k]+":"+a.length;}'],
 ['uint32-max-property','function(){var a=[],k=4294967295;a[k]=7;return a[k]+":"+a.length;}'],
 ['fraction-property','function(){var a=[],k=1.5;a[k]=7;return a[k];}'],
 ['negative-property','function(){var a=[],k=-1;a[k]=7;return a[k];}'],
 ['nonfinite-property','function(){var a=[],k=1/0;a[k]=7;return a[k];}'],
 ['nan-property','function(){var a=[],k=0/0;a[k]=7;return a[k];}'],
 ['string-minus-zero','function(){var a=[1],k="-0";a[k]=7;return a[k]+":"+a[0];}'],
 ['object-key-coercion','function(){var a=[1],n=0,k={toString:function(){n++;a[0]=8;return "0";}};return a[k]+":"+n;}'],
 ['null-before-key','function(){var n=0,k={toString:function(){n++;return "0";}};try{null[k];}catch(e){return e.name+":"+n;}}'],
 ['plain-object','function(){var a={0:8},k=0;return a[k];}'],
 ['primitive-string','function(){var a="abc",k=1;return a[k];}'],
 ['typed-array','function(){var a=new Uint8Array(2),k=1;a[k]=255;return a[k];}'],
 ['mapped-arguments','function(){function f(x){var k=0;x=8;return arguments[k];}return f(1);}'],
 ['inherited-data','function(){var a=[,],k=0;Array.prototype[0]=8;var n=a[k];delete Array.prototype[0];return n;}']
];
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-direct-array-slot.mjs','crates/js-runtime/src/env.rs','crates/js-runtime/src/literal_pool.rs'])await bind(file);
const directory=resolve(root,'work/rust-port-direct-array-slot');await mkdir(directory,{recursive:true});
const expanded=cases.flatMap(([name,source])=>[{name,source,specialized:false,forceSplit:false},{name,source,specialized:true,forceSplit:false},{name:name+':split',source,specialized:true,forceSplit:true}]);const modules=expanded.map(({name,source,specialized,forceSplit},index)=>({name,source,specialized,forceSplit,index,...compileSource(setup+'\nvar result=('+source+')();',{mode:'script',filename:'direct-array-slot:'+name,allowUnsupported:false,staticEnvironmentNames:true,largeBody:forceSplit?{minimumNodes:1,maxNodes:128,maxStatements:4,maxInitGroups:8}:false})}));
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();rt.direct_array_slot_reads_enabled=${item.specialized};let env=rt.global_env;let value=case_${item.index}::run(&mut rt,env,Value::Undefined).and_then(|_|rt.lookup(env,"result"));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH,CARGO_BUILD_JOBS:'1'};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,expanded.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<expanded.length;index++){const{name,source,specialized}=expanded[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;runInContext(setup,realm);try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,specialized,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'override dispatcher source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-direct-array-slot.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:expanded.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'Dynamic primitive-Number Array physical-slot reads ON/OFF and ON with helper splitting, compared to pinned source raw returned number bits. Fresh slots must match the converted canonical key and contain own Data; holes, getters, named-prefix insertion, deletion/reinsertion, sparse indices, primitive/object keys, typed arrays and arguments use fallback. No per-object cache or write maintenance. Component only, not battle qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-direct-array-slot.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:expanded.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
