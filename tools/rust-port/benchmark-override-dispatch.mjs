import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource,rustString} from './compile.mjs';
import {sourceOverrideDispatcher as sourceCopyFunction} from './source-override-dispatch.mjs';

const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex'),profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags);
const source='var ed={arg2arry:function(a){return Array.prototype.slice.call(a);}};function make(e,t){return '+sourceCopyFunction+';}var original={},receiver={},wrapper=make(original,function(e,s,r,i,a,n,o){if(e!==original||s!==receiver)throw Error("forwarded identity mismatch");return(r||0)+(i||0)+(a||0)+(n||0)+(o||0);});';
const variants=[false,true].map(specialized=>({specialized,...compileSource(source,{mode:'script',filename:'source-override-dispatch-benchmark',allowUnsupported:false,sourceSpecializations:specialized})}));
for(const item of variants)assert.ok(item.manifest.functions.some(fn=>fn.sourceSha256===sha(sourceCopyFunction)&&Boolean(fn.sourceSpecialization)===item.specialized));
const label='source-override-dispatch';
const work=resolve(root,'work/rust-port-override-dispatch-benchmark');await mkdir(work,{recursive:true});for(const item of variants)await writeFile(resolve(work,(item.specialized?'specialized':'generic')+'.rs'),item.rust);
const harness=`use js_runtime::{Runtime,Value,EnvId,JsResult};
#[path="generic.rs"]mod generic;#[path="specialized.rs"]mod specialized;
fn run(label:&str,entry:fn(&mut Runtime,EnvId,Value)->JsResult<Value>,kind:usize,trial:usize)->JsResult<()>{
 let mut rt=Runtime::new();let env=rt.global_env;let global=Value::Object(rt.global_object);entry(&mut rt,env,global)?;let function=rt.lookup(env,"wrapper")?;let receiver=rt.lookup(env,"receiver")?;let args=(1..=kind).map(|i|Value::Number(i as f64)).collect::<Vec<_>>();let count=5000;
 let before=rt.object();let before=rt.object_id(before)?.0;let mut output=Value::Undefined;let start=std::time::Instant::now();for _ in 0..count{output=rt.call(function,receiver,&args)?;}let ns=start.elapsed().as_nanos();let after=rt.object();let allocated=rt.object_id(after)?.0-before-1;let Value::Number(value)=output else{panic!()};println!("{}\\t{}\\t{}\\t{}\\t{}\\t{}\\t{:016x}",label,kind,trial,count,ns,allocated,value.to_bits());Ok(())
}
fn main()->JsResult<()>{for trial in 0..3{for kind in [0,1,3,5,6]{if trial%2==0{run("generic",generic::run,kind,trial)?;run("specialized",specialized::run,kind,trial)?;}else{run("specialized",specialized::run,kind,trial)?;run("generic",generic::run,kind,trial)?;}}}Ok(())}
`;
await writeFile(resolve(work,'main.rs'),harness);
async function rustFiles(directory){const files=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const file=directory+'/'+row.name;if(row.isDirectory())files.push(...await rustFiles(file));else if(file.endsWith('.rs')||row.name==='Cargo.toml')files.push(file);}return files;}
const tracked=[...await rustFiles('third-party'),...await rustFiles('crates/js-runtime/src'),...await rustFiles('crates/battle-core/src'),'tools/rust-port/compile.mjs','tools/rust-port/bindings.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/benchmark-override-dispatch.mjs','Cargo.toml','Cargo.lock','crates/js-runtime/Cargo.toml','config/source-oracle-runtime.json','tools/rust-port/source-override-dispatch.mjs'],sources={};for(const file of tracked)sources[file]=sha(await readFile(resolve(root,file)));
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),cargo=resolve(rustBin,'cargo'),rustc=resolve(rustBin,'rustc'),cargoSha256=sha(await readFile(cargo)),rustcSha256=sha(await readFile(rustc));
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,PATH:rustBin+':'+process.env.PATH,RUSTC:rustc},...options});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const buildArgs=['build','--release','-p','js-runtime','--locked','--offline'],build=run(cargo,buildArgs);await writeFile(resolve(work,'cargo.stderr'),build.stderr);
const binary=resolve(work,'check'),compileArgs=['--edition=2024','-O',resolve(work,'main.rs'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-L','dependency='+resolve(root,'target/release/deps'),'-o',binary],native=run(rustc,compileArgs);await writeFile(resolve(work,'rustc.stderr'),native.stderr);
const binarySha256=sha(await readFile(binary)),execution=run(binary,[]),rows=[];
const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source,realm);const view=new DataView(new ArrayBuffer(8));
for(const line of execution.stdout.trim().split('\n')){const[variant,arity,trial,count,ns,allocated,bits]=line.split('\t');const expected=runInContext('wrapper.apply(receiver,['+Array.from({length:Number(arity)},(_,i)=>i+1).join(',')+'])',realm);view.setFloat64(0,expected,false);assert.equal(bits,view.getBigUint64(0,false).toString(16).padStart(16,'0'));rows.push({variant,arity:Number(arity),trial:Number(trial),calls:Number(count),allocatedObjects:Number(allocated),objectsPerCall:Number(allocated)/Number(count),elapsedNs:ns,callsPerSecond:Number(count)/(Number(ns)/1e9)});}
for(const[file,hash]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),hash,'Source changed during benchmark '+file);
const totals=[];for(const arity of [0,1,3,5,6]){const byVariant={};for(const variant of ['generic','specialized']){const selected=rows.filter(row=>row.arity===arity&&row.variant===variant),calls=selected.reduce((n,row)=>n+row.calls,0),ns=selected.reduce((n,row)=>n+Number(row.elapsedNs),0);byVariant[variant]={calls,elapsedNs:String(ns),callsPerSecond:calls/(ns/1e9),objectsPerCall:selected[0].objectsPerCall};}totals.push({arity,...byVariant,observedThroughputRatio:byVariant.specialized.callsPerSecond/byVariant.generic.callsPerSecond});}
const artifact='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-rust-override-dispatch';await writeFile(resolve(root,artifact+'.stdout.gz'),gzipSync(Buffer.from(execution.stdout),{level:9}));const report={passed:true,sourceFunctionSha256:sha(sourceCopyFunction),sourceFunctionUnchanged:true,sources,sourcesUnchangedThroughoutBuildAndRun:true,rows,totals,binarySha256,oracleProfile:profile,artifacts:[{file:artifact+'.stdout.gz',sha256:sha(await readFile(resolve(root,artifact+'.stdout.gz')))}],timingScope:'Original ed.override dispatcher calls with specialization disabled/enabled in one binary, interleaved3trials. Callback identities and exact result bits match pinned source. Target callback work remains inside timed calls. Arities0,1,3,5 use dispatch specialization; arity6 remains original source. Concurrent work makes timings provisional. Calls/second are not battles/second.',qualifiesFor10000Target:false};await writeFile(resolve(root,artifact+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:artifact+'.json',totals}));
