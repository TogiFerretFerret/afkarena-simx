import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource,rustString} from './compile.mjs';
import {sourceCopyFunction} from '../flat-numeric-copy.mjs';

const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags);
const source='var ed={};ed.copyObj='+sourceCopyFunction+';';
const variants=[false,true].map(specialized=>({specialized,...compileSource(source,{mode:'script',filename:'source-copy-obj-benchmark',allowUnsupported:false,sourceSpecializations:specialized})}));
for(const item of variants)assert.ok(item.manifest.functions.some(fn=>fn.sourceSha256===sha(sourceCopyFunction)&&Boolean(fn.sourceSpecialization)===item.specialized));
const label='source-copy-obj';
const work=resolve(root,'work/rust-port-copy-obj-benchmark');await mkdir(work,{recursive:true});for(const item of variants)await writeFile(resolve(work,(item.specialized?'specialized':'generic')+'.rs'),item.rust);
const harness=`use js_runtime::{Runtime,Value,EnvId,JsResult};
#[path="generic.rs"]mod generic;#[path="specialized.rs"]mod specialized;
fn run(label:&str,entry:fn(&mut Runtime,EnvId,Value)->JsResult<Value>,kind:usize,trial:usize)->JsResult<()>{
 let mut rt=Runtime::new();let env=rt.global_env;let global=Value::Object(rt.global_object);entry(&mut rt,env,global)?;let ed=rt.lookup(env,"ed")?;let key=rt.string("copyObj");let function=rt.get(ed,key)?;
 let input=if kind==0{rt.array(&[])}else{let input=rt.object();for i in 0..47{let key=rt.string(&format!("k{}",i));rt.define_data(input,key,Value::Number(if i==0{-0.0}else{i as f64*1.125}),true,true,true)?;}input};let count=if kind==0{10000}else{2000};
 assert!(rt.try_native_copy_obj(input,env)?.is_some());let before=rt.object();let before=rt.object_id(before)?.0;let mut output=Value::Undefined;let start=std::time::Instant::now();for _ in 0..count{output=rt.call(function,ed,&[input])?;assert_ne!(output,input);}let ns=start.elapsed().as_nanos();let after=rt.object();let allocated=rt.object_id(after)?.0-before-1;
 let expected=rt.own_keys(input,true)?;let actual=rt.own_keys(output,true)?;assert_eq!(expected,actual);let mut snapshot=vec![];for key in actual{let Value::String(id)=key else{panic!()};let name=rt.string_text(id);let Value::Number(value)=rt.get(output,key)?else{panic!()};let Value::Number(original)=rt.get(input,key)?else{panic!()};assert_eq!(value.to_bits(),original.to_bits());snapshot.push(format!("{}:{:016x}",name,value.to_bits()));}let length=if kind==0{let key=rt.string("length");assert_eq!(rt.get(output,key)?,Value::Number(0.0));0}else{snapshot.len()};println!("{}\\t{}\\t{}\\t{}\\t{}\\t{}\\t{}\\t{}",label,kind,trial,count,ns,length,allocated,snapshot.join(","));Ok(())
}
fn main()->JsResult<()>{for trial in 0..3{for kind in 0..2{if trial%2==0{run("generic",generic::run,kind,trial)?;run("specialized",specialized::run,kind,trial)?;}else{run("specialized",specialized::run,kind,trial)?;run("generic",generic::run,kind,trial)?;}}}Ok(())}
`;
await writeFile(resolve(work,'main.rs'),harness);
async function rustFiles(directory){const files=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())files.push(...await rustFiles(file));else if(file.endsWith('.rs')||row.name==='Cargo.toml')files.push(file);}return files;}
const tracked=[...await rustFiles('third-party'),...await rustFiles('crates/js-runtime/src'),...await rustFiles('crates/battle-core/src'),'tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/benchmark-copy-obj.mjs','Cargo.toml','Cargo.lock','crates/js-runtime/Cargo.toml','config/source-oracle-runtime.json','tools/flat-numeric-copy.mjs'],sources={};for(const file of tracked)sources[file]=sha(await readFile(resolve(root,file)));
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),cargo=resolve(rustBin,'cargo'),rustc=resolve(rustBin,'rustc'),cargoSha256=sha(await readFile(cargo)),rustcSha256=sha(await readFile(rustc));
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,PATH:rustBin+':'+process.env.PATH,RUSTC:rustc},...options});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const buildArgs=['build','--release','-p','js-runtime','--locked','--offline'],build=run(cargo,buildArgs);await writeFile(resolve(work,'cargo.stderr'),build.stderr);
const binary=resolve(work,'check'),compileArgs=['--edition=2024','-O',resolve(work,'main.rs'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-L','dependency='+resolve(root,'target/release/deps'),'-o',binary],native=run(rustc,compileArgs);await writeFile(resolve(work,'rustc.stderr'),native.stderr);
const binarySha256=sha(await readFile(binary)),execution=run(binary,[]),rows=[];
const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);
const expected=runInContext(`(function(){var d=new DataView(new ArrayBuffer(8)),o={};for(var i=0;i<47;i++)o['k'+i]=i===0?-0:i*1.125;var c=ed.copyObj(o);return Object.keys(c).map(function(k){d.setFloat64(0,c[k],false);return k+':'+d.getBigUint64(0,false).toString(16).padStart(16,'0');}).join(',');})()`,realm);
for(const line of execution.stdout.trim().split('\n')){const[variant,kind,trial,count,ns,length,allocated,snapshot]=line.split('\t');assert.equal(snapshot,kind==='0'?'':expected);assert.equal(Number(length),kind==='0'?0:47);rows.push({variant,kind:Number(kind)===0?'empty-array':'flat-47-number-object',trial:Number(trial),clones:Number(count),allocatedObjects:Number(allocated),objectsPerClone:Number(allocated)/Number(count),elapsedNs:ns,clonesPerSecond:Number(count)/(Number(ns)/1e9)});}
for(const[file,hash]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),hash,'Source changed during benchmark '+file);
const totals=[];for(const kind of ['empty-array','flat-47-number-object']){const byVariant={};for(const variant of ['generic','specialized']){const selected=rows.filter(row=>row.kind===kind&&row.variant===variant),clones=selected.reduce((n,row)=>n+row.clones,0),ns=selected.reduce((n,row)=>n+Number(row.elapsedNs),0);byVariant[variant]={clones,elapsedNs:String(ns),clonesPerSecond:clones/(ns/1e9)};}totals.push({kind,...byVariant,observedThroughputRatio:byVariant.specialized.clonesPerSecond/byVariant.generic.clonesPerSecond});}
const artifact='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-rust-copy-obj';await writeFile(resolve(root,artifact+'.stdout.gz'),gzipSync(Buffer.from(execution.stdout),{level:9}));const report={passed:true,sourceFunctionSha256:sha(sourceCopyFunction),sourceFunctionUnchanged:true,sources,sourcesUnchangedThroughoutBuildAndRun:true,rows,totals,binarySha256,oracleProfile:profile,artifacts:[{file:artifact+'.stdout.gz',sha256:sha(await readFile(resolve(root,artifact+'.stdout.gz')))}],timingScope:'Original ed.copyObj calls through native runtime with specialization disabled/enabled in one binary, interleaved3trials. Input setup and final exact source snapshot checks excluded; all calls retain fresh allocation. Concurrent work makes timings provisional. Clones/second are not battles/second.',qualifiesFor10000Target:false};await writeFile(resolve(root,artifact+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:artifact+'.json',totals}));
