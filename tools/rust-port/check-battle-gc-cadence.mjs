import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
const root=resolve(import.meta.dirname,'../..'),sha=x=>createHash('sha256').update(x).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){
 const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,encoding:'utf8'});
 process.stdout.write(child.stdout??'');process.stderr.write(child.stderr??'');process.exit(child.status??1);
}
const original=await readFile(resolve(root,'crates/js-runtime/src/native_battle_run.js'),'utf8');
assert.equal(sha(original),'d7f91f446d24282b489ef9943494f0658f778232b5948d66b8d941d3f42e950d');
// This is a collector/control-flow fixture, not a replacement battle simulator.
// The actual pinned __nativeRun body below executes every original loop step.
const fixture=`var visits=[],next=0,weak=new WeakMap();
function Engine(){var data={value:++next},bytes=new Uint8Array([next]);var unit={id:next};
 Object.defineProperty(unit,"value",{enumerable:true,get:function(){return data.value;}});
 unit.read=function(add){return data.value+bytes[0]+add;};unit.bound=unit.read.bind(unit,5);
 unit.grow=function(){data.value++;};weak.set(unit,data);
 this.unit_list=[unit];this.dead_unit_list=[];this.pet_list=[];this.ticks=0;this.running=false;this.result=1;}
Engine.prototype.enterBattle=function(){this.running=true;};
Engine.prototype.toString=function(){return JSON.stringify({ticks:this.ticks,id:this.unit_list[0].id,value:this.unit_list[0].value,bound:this.unit_list[0].bound()});};
var ed={BattleEngine:Engine,srand:function(seed){runtime.context.random_seed=seed;}};
var runtime={ed:ed,context:{random_seed:0},host:{events:[],audioState:function(){return{visits:visits.length};}},callbacks:{updateFrame:function(dt){
 var engine=ed.battleEngine,unit=engine.unit_list[0];unit.grow();engine.ticks++;runtime.context.random_seed++;
 if(weak.get(unit).value!==unit.value)throw new Error("weak value lost");
 visits.push(unit.id+":"+engine.ticks+":"+unit.value);runtime.host.events.push({id:unit.id,tick:engine.ticks});
 var cycle={};cycle.self=cycle;cycle.fn=function(){return cycle;};
 if(engine.ticks===3)engine.running=false;return{executed:2,queued:1};}}};
var wire={seed:123};function wallNow(){return 0;}
function instantiateScenario(runtime,wire){return{battleSeed:wire.seed,players:[],enemies:[],config:{}};}
function __nativeBits(value){var bytes=new ArrayBuffer(8),view=new DataView(bytes);view.setFloat64(0,value,true);return [view.getUint32(0,true),view.getUint32(4,true)];}
function __nativePrimitiveState(engine){return{ticks:engine.ticks,running:engine.running};}
function __nativeUnitState(unit){return{id:unit.id,value:unit.value,bound:unit.bound()};}
function summary(report){return JSON.stringify({report:report,visits:visits});}
`;
const source=fixture+original,compiled=compileSource(source,{nativeBattleGc:true,sourcePoolPath:'source.utf16le',allowUnsupported:false});
assert.equal(compiled.manifest.functions.flatMap(f=>f.battleGcSafePoints).length,1);
const compiled4=compileSource(source,{nativeBattleGc:true,nativeBattleGcCadence:4,sourcePoolPath:'source.utf16le',allowUnsupported:false});
const tracked={};async function bind(file){tracked[file]=sha(await readFile(resolve(root,file)));}
async function tree(dir){for(const entry of await readdir(resolve(root,dir),{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(file.endsWith('.rs')||file.endsWith('.js')||entry.name==='Cargo.toml')await bind(file);}}
for(const dir of ['crates/js-runtime','crates/battle-core','third-party'])await tree(dir);
for(const file of ['tools/rust-port/check-battle-gc-cadence.mjs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','config/source-oracle-runtime.json','Cargo.toml','Cargo.lock'])await bind(file);
const work=resolve(root,'work/rust-battle-gc-cadence-gate');await mkdir(work,{recursive:true});
await writeFile(resolve(work,'generated.rs'),compiled.rust);await writeFile(resolve(work,'generated4.rs'),compiled4.rust);await writeFile(resolve(work,'source.utf16le'),compiled.sourcePool);
const harness=`use js_runtime::{Runtime,Value,JsResult};#[path="generated.rs"]mod generated;#[path="generated4.rs"]mod generated4;
fn main()->JsResult<()>{for (enabled,cadence) in [(false,1),(true,1),(true,4)]{let mut rt=Runtime::new();if enabled{rt.enable_native_battle_gc();}let env=rt.global_env;let global=Value::Object(rt.global_object);if cadence==4{generated4::run(&mut rt,env,global)?;}else{generated::run(&mut rt,env,global)?;}
 let f=rt.lookup(env,"__nativeRun")?;let runtime=rt.lookup(env,"runtime")?;let wire=rt.lookup(env,"wire")?;let clock=rt.lookup(env,"wallNow")?;let mode=rt.string("final");
 let report=rt.call(f,Value::Undefined,&[runtime,wire,Value::Number(20.0),Value::Number(3.0),clock,mode])?;
 let summary=rt.lookup(env,"summary")?;let text=rt.call(summary,Value::Undefined,&[report])?;let Value::String(id)=text else{panic!("summary string")};
 let stats=rt.native_battle_gc_stats();println!("{}\\t{}\\t{}\\t{}\\t{}\\t{}",enabled,stats.collections,stats.objects_freed,stats.functions_freed,stats.environments_freed,String::from_utf16_lossy(rt.string_units(id)));}Ok(())}`;
await writeFile(resolve(work,'main.rs'),harness);
const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),cargo=resolve(rustBin,'cargo'),rustc=resolve(rustBin,'rustc');
function run(command,args){const result=spawnSync(command,args,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH},encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(result.status,0,result.stderr);return result;}
const buildArgs=['build','--release','-p','js-runtime'];run(cargo,buildArgs);
const binary=resolve(work,'check'),compileArgs=['--edition=2024','-O',resolve(work,'main.rs'),'--extern','js_runtime='+resolve(root,'target/release/libjs_runtime.rlib'),'-L','dependency='+resolve(root,'target/release/deps'),'-o',binary];run(rustc,compileArgs);
const actual=run(binary,[]),rows=actual.stdout.trim().split('\n').map(line=>{const[enabled,collections,objectsFreed,functionsFreed,environmentsFreed,...data]=line.split('\t');return{enabled:enabled==='true',collections:Number(collections),objectsFreed:Number(objectsFreed),functionsFreed:Number(functionsFreed),environmentsFreed:Number(environmentsFreed),summary:JSON.parse(data.join('\t'))};});
const realm=createContext(constants.DONT_CONTEXTIFY),expected=JSON.parse(runInContext(source+'\nsummary(__nativeRun(runtime,wire,20,3,wallNow,"final"));',realm));
assert.equal(rows.length,3);for(const row of rows)assert.deepEqual(row.summary,expected);
assert.equal(rows[0].collections,0);assert.equal(rows[1].collections,23);assert.equal(rows[2].collections,6);assert.ok(rows[1].objectsFreed>0&&rows[1].functionsFreed>0&&rows[1].environmentsFreed>0);
assert.equal(expected.visits.length,69);assert.equal(expected.report.completed,20);assert.equal(expected.report.totalCallbacks,120);
for(const[file,digest]of Object.entries(tracked))assert.equal(sha(await readFile(resolve(root,file))),digest,'Source changed during GC gate: '+file);
const prefix='benchmarks/validation/rust-generated-battle-gc-cadence',artifacts=[];
for(const[label,data]of [['source',Buffer.from(source)],['generated',Buffer.from(compiled.rust)],['generated4',Buffer.from(compiled4.rust)],['harness',Buffer.from(harness)],['actual',Buffer.from(actual.stdout)],['expected',Buffer.from(JSON.stringify(expected))]]){const file=prefix+'.'+label+'.gz';await writeFile(resolve(root,file),gzipSync(data));artifacts.push({label,file,sha256:sha(await readFile(resolve(root,file))),uncompressedSha256:sha(data)});}
const report={version:1,passed:true,sourceFunctionSha256:sha(original),originalBodyUnchanged:true,rows:rows.map(({summary,...row})=>row),orderedFixtureFrames:expected.visits.length,warmups:3,measuredFixtureIterations:20,sourceReportCallbacks:expected.report.totalCallbacks,allSourceReportFieldsMatched:true,oracleProfile:profile,sourceInputsUnchanged:tracked,binary:{file:binary,sha256:sha(await readFile(binary))},buildArgs,compileArgs,artifacts,qualifiesFor10000Target:false,scope:'Actual unchanged __nativeRun outer loop with an explicit toy collector fixture, compared OFF/every1/every4 against pinned source JS. Covers 23/6 actual collection points and exact RNG f64 bits, closure/accessor/bound/view roots, WeakMap values and unreachable cycles. This is collector/control-flow qualification, not real battle mechanics, throughput, full host tape, or scene qualification.'};
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,collections:rows.map(r=>r.collections),frames:expected.visits.length,callbacks:expected.report.totalCallbacks}));
