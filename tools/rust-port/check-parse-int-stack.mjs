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
const cases=[];
for(const text of ["", " ", "0", "-0", "+0", "123", "-123", "  +123tail", "0x10", "-0Xff", "08", "1e21", "Infinity", "NaN", "9007199254740993", "18446744073709551617", "9".repeat(63), "9".repeat(64), "9".repeat(65), "1"+"0".repeat(309), "\ufeff\u2028\u2029123", "\ud800123", "123\udfff", "１２３"]){for(const radix of [0,10,16]){if(radix===16&&text.length>13)continue;cases.push([JSON.stringify(text)+":"+radix,`function(){return parseInt(${JSON.stringify(text)},${radix});}`]);}}
cases.push(
 ['coercion-order','function(){var log=[];var x={toString:function(){log.push("string");return "-12";}};var r={valueOf:function(){log.push("radix");return 10;}};return parseInt(x,r)+":"+log.join("|");}'],
 ['radix-mutates-input','function(){var x="123";var o={toString:function(){return x;}};var r={valueOf:function(){x="999";return 10;}};return parseInt(o,r)+":"+x;}'],
 ['radix-allocates-many-strings','function(){var r={valueOf:function(){for(var i=0;i<1000;i++)String(i);return 10;}};return parseInt("123456789",r);}'],
 ['string-throws-before-radix','function(){var l=[];try{parseInt({toString:function(){l.push("s");throw 7;}},{valueOf:function(){l.push("r");return 10;}});}catch(e){return l.join("|")+":"+e;}}'],
 ['radix-throws','function(){try{parseInt("123",{valueOf:function(){throw 8;}});}catch(e){return e;}}'],
 ['radix-wrap','function(){return parseInt("12",4294967306);}'],
 ['radix-invalid','function(){return parseInt("12",1);}'],
 ['radix-signed','function(){return parseInt("12",-2);}'],
 ['hex-explicit-decimal','function(){return parseInt("0xff",10);}'],
 ['negative-overflow','function(){return parseInt("-"+"9".repeat(400),10);}']
);
const tracked=new Map();async function bind(file){const bytes=await readFile(resolve(root,file));tracked.set(file,sha(bytes));}
async function tree(directory){for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['Cargo.toml','Cargo.lock','config/source-oracle-runtime.json','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/check-parse-int-stack.mjs','crates/js-runtime/src/env.rs','crates/js-runtime/src/literal_pool.rs'])await bind(file);
const directory=resolve(root,'work/rust-port-parse-int-stack');await mkdir(directory,{recursive:true});
const expanded=cases.flatMap(([name,source])=>[{name,source,specialized:false,forceSplit:false},{name,source,specialized:true,forceSplit:false},{name:name+':split',source,specialized:true,forceSplit:true}]);const modules=expanded.map(({name,source,specialized,forceSplit},index)=>({name,source,specialized,forceSplit,index,...compileSource(setup+'\nvar result=('+source+')();',{mode:'script',filename:'parse-int-stack:'+name,allowUnsupported:false,cacheCapturedBindings:false,staticEnvironmentNames:true,largeBody:forceSplit?{minimumNodes:1,maxNodes:128,maxStatements:4,maxInitGroups:8}:false})}));
const encode=`fn encode(rt:&Runtime,value:Value)->String{match value{Value::Undefined=>"undefined".into(),Value::Null=>"null".into(),Value::Bool(value)=>format!("bool:{}",value),Value::Number(value)=>format!("number:{:016x}",value.to_bits()),Value::String(id)=>format!("string:{}",rt.string_units(id).iter().map(|v|format!("{:04x}",v)).collect::<String>()),other=>format!("unexpected:{:?}",other)}}`;
let rust='use js_runtime::{Runtime,Value,JsError};\n'+encode+'\n'+modules.map(item=>'mod case_'+item.index+' {\n'+item.rust+'\n}').join('\n')+'\nfn main(){\n';
for(const item of modules)rust+=`{let mut rt=Runtime::new();let env=rt.global_env;let value=case_${item.index}::run(&mut rt,env,Value::Undefined).and_then(|_|rt.lookup(env,"result"));match value{Ok(v)=>println!("ok:{}",encode(&rt,v)),Err(JsError::Throw(v))=>println!("throw:{}",encode(&rt,v)),Err(e)=>println!("runtime-error:{:?}",e)}}\n`;
rust+='}\n';await writeFile(resolve(directory,'main.rs'),rust);
const rustbin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),environment={...process.env,PATH:rustbin+':'+process.env.PATH};
const build=spawnSync(resolve(rustbin,'cargo'),['build','--release','-p','js-runtime'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(build.status,0,build.stderr);
const binary=resolve(directory,'check'),rustc=resolve(rustbin,'rustc'),compileArgs=['--edition=2024','-O',resolve(directory,'main.rs'),'-L','dependency='+resolve(root,'target/release/deps'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-o',binary];
const compiled=spawnSync(rustc,compileArgs,{cwd:root,env:environment,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync(binary,[],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n');assert.equal(actual.length,expanded.length);
const view=new DataView(new ArrayBuffer(8));function encodeValue(value){if(value===undefined)return'undefined';if(value===null)return'null';if(typeof value==='boolean')return'bool:'+value;if(typeof value==='number'){view.setFloat64(0,value,false);return'number:'+view.getBigUint64(0,false).toString(16).padStart(16,'0');}if(typeof value==='string')return'string:'+Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('');throw Error('Unsupported fixture return type '+typeof value);}
const observations=[];for(let index=0;index<expanded.length;index++){const{name,source,specialized}=expanded[index],realm=createContext(constants.DONT_CONTEXTIFY);let expected;runInContext(setup,realm);try{expected='ok:'+encodeValue(runInContext('('+source+')',realm)());}catch(error){expected='throw:'+encodeValue(error);}observations.push({name,specialized,source,expected,actual:actual[index],matched:expected===actual[index]});}
const inputsAtFinish=[];for(const[file,digest]of tracked){const actualDigest=sha(await readFile(resolve(root,file)));inputsAtFinish.push({file,sha256:digest,matched:actualDigest===digest});}assert.ok(inputsAtFinish.every(row=>row.matched),'override dispatcher source inputs changed during build/run');
const passed=observations.every(row=>row.matched),archive='benchmarks/validation/rust-generated-parse-int-stack.outputs.json.gz';await writeFile(resolve(root,archive),gzipSync(Buffer.from(JSON.stringify(observations))));
const report={version:1,passed,cases:expanded.length,firstDifference:observations.find(row=>!row.matched)??null,backend:'Babel-generated Rust executed by native Rust js-runtime. JavaScript executes only the independent source reference.',sourceInputsAtFinish:inputsAtFinish,oracleProfile:profile,generatedRustSha256:sha(rust),binary:{file:binary,sha256:sha(await readFile(binary))},rustc:{file:rustc,sha256:sha(await readFile(rustc))},compileArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive)))},qualifiesFor10000Target:false,scope:'parseInt borrowed UTF16 and stack decimal conversion with dynamic global getters/deletion/prototypes, captured mutable cells, TDZ, const, typeof, sloppy/strict assignment, Unicode names, mapped/duplicate arguments, catch shadowing, loop closures and AnnexB. Short decimal conversion uses the same Rust f64 parser; long decimal and nondecimal behavior remain unchanged. This is an environment component gate, not battle qualification. This is not a complete battle or unrestricted ECMAScript qualification.'};await writeFile(resolve(root,'benchmarks/validation/rust-generated-parse-int-stack.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,cases:expanded.length,firstDifference:report.firstDifference}));if(!passed)process.exitCode=1;
