import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-generated-opt-levels');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){
 const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,import.meta.filename],{cwd:root,env:{...process.env,NODE_OPTIONS:profile.rawBitReferenceNodeOptions},encoding:'utf8',maxBuffer:128*1024*1024});process.stdout.write(child.stdout??'');process.stderr.write(child.stderr??'');process.exitCode=child.status??1;
}else{
 await mkdir(work,{recursive:true});
 const assessmentFile='benchmarks/validation/rust-unit-update-optimization-assessment.json',assessmentBytes=await readFile(resolve(root,assessmentFile)),assessment=JSON.parse(assessmentBytes);
 const originalBytes=await readFile(resolve(root,assessment.result.file));assert.equal(sha(originalBytes),assessment.result.sha256);const original=JSON.parse(originalBytes);
 async function artifact(label){const row=original.artifacts.find(value=>value.label===label);assert.ok(row,label);const bytes=await readFile(resolve(root,row.file));assert.equal(sha(bytes),row.sha256);const raw=gunzipSync(bytes);assert.equal(sha(raw),row.uncompressedSha256);return raw;}
 const source=await artifact('source'),expectedBytes=await artifact('expected');
 const frozen=resolve(root,'work/rust-env-map-controlled/after'),deps=resolve(frozen,'app/target/release/deps');
 const runtimeCandidates=(await readdir(deps)).filter(file=>/^libjs_runtime-.*\.rlib$/.test(file));assert.equal(runtimeCandidates.length,1);
 const runtime=resolve(deps,runtimeCandidates[0]),inputs=new Map();
 async function track(file){const absolute=resolve(root,file);inputs.set(absolute,sha(await readFile(absolute)));}
 for(const file of [assessmentFile,assessment.result.file,'config/source-oracle-runtime.json','tools/rust-port/benchmark-generated-opt-levels.mjs',resolve(frozen,'manifest.json'),resolve(frozen,'runtime/Cargo.toml'),resolve(frozen,'app/Cargo.toml')])await track(file);
 for(const file of await readdir(deps))if(file.endsWith('.rlib')||file.endsWith('.rmeta'))await track(resolve(deps,file));
 const runtimeManifest=JSON.parse(await readFile(resolve(frozen,'manifest.json')));for(const [file,digest] of Object.entries(runtimeManifest)){const path=resolve(frozen,'runtime/src',file);await track(path);assert.equal(inputs.get(path),digest,'Frozen runtime source changed');}
 const generated={};for(const variant of ['baseline','cached']){
  generated[variant]=await readFile(resolve(frozen,'app',variant+'.rs'));assert.deepEqual(generated[variant],await artifact(variant+'-generated'));
  const pool=resolve(root,'work/rust-unit-update-benchmark',variant+'.utf16le');assert.deepEqual(await readFile(pool),Buffer.from(source.toString('utf8'),'utf16le'));await track(pool);
  await writeFile(resolve(work,variant+'.rs'),generated[variant]);await track(resolve(work,variant+'.rs'));
 }
 const main=await readFile(resolve(frozen,'app/main.rs'));assert.ok(main.includes('3000.0'));await writeFile(resolve(work,'main.rs'),main);await track(resolve(work,'main.rs'));
 const realm=createContext(constants.DONT_CONTEXTIFY);runInContext(source.toString('utf8'),realm);realm.benchmarkUnitUpdates(3000);const expected=JSON.parse(realm.snapshotBench());assert.deepEqual(expected,JSON.parse(expectedBytes));
 const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),rustc=resolve(rustBin,'rustc');await track(rustc);
 const tool=spawnSync(rustc,['--version','--verbose'],{encoding:'utf8'});assert.equal(tool.status,0);
 const builds=[],outputs=[],rows=[];
 for(const level of [1,3]){
  const binary=resolve(work,'unit-update-opt'+level),command=[rustc,'--edition=2024','--crate-name','unit_update_opt'+level,resolve(work,'main.rs'),'--extern','js_runtime='+runtime,'-L','dependency='+deps,'-C','opt-level='+level,'-C','codegen-units=64','-C','debuginfo=0','-C','lto=off','-o',binary];
  const begin=performance.now(),result=spawnSync(command[0],command.slice(1),{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH},encoding:'utf8',maxBuffer:64*1024*1024});
  builds.push({level,command,wallMs:performance.now()-begin,status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,binary:{file:binary,sha256:result.status===0?sha(await readFile(binary)):null,bytes:result.status===0?(await stat(binary)).size:null}});
  assert.equal(result.status,0,result.stderr);
 }
 for(let pair=0;pair<3;pair++)for(const level of pair%2===0?[1,3]:[3,1]){
  const build=builds.find(value=>value.level===level),begin=performance.now(),result=spawnSync(build.binary.file,[],{cwd:root,env:{...process.env,RUST_PORT_TRACE:'0'},encoding:'utf8',maxBuffer:128*1024*1024});
  outputs.push({pair,level,status:result.status,wallMs:performance.now()-begin,stdout:result.stdout,stderr:result.stderr});assert.equal(result.status,0,result.stderr);
  const lines=result.stdout.trim().split('\n');assert.equal(lines.length,6);
  for(const line of lines){const [compilerVariant,trial,elapsedNs,...json]=line.split('\t'),snapshot=JSON.parse(json.join('\t'));assert.deepEqual(snapshot,expected);rows.push({pair,level,compilerVariant,trial:Number(trial),elapsedNs,updates:3000,updatesPerSecond:3000/(Number(elapsedNs)/1e9),orderedEvents:snapshot.events.length});}
 }
 const changedInputs=[];for(const [file,before] of inputs){const after=sha(await readFile(file));if(after!==before)changedInputs.push({file,before,after});}
 for(const build of builds)assert.equal(sha(await readFile(build.binary.file)),build.binary.sha256);
 const summaries=['baseline','cached'].map(compilerVariant=>{
  const stats=level=>{const selected=rows.filter(row=>row.level===level&&row.compilerVariant===compilerVariant),elapsedNs=selected.reduce((sum,row)=>sum+Number(row.elapsedNs),0),updates=selected.reduce((sum,row)=>sum+row.updates,0);return{level,trials:selected.length,updates,elapsedNs,updatesPerSecond:updates/(elapsedNs/1e9)};};
  const opt1=stats(1),opt3=stats(3);return{compilerVariant,opt1,opt3,observedOpt1OverOpt3:opt1.updatesPerSecond/opt3.updatesPerSecond};
 });
 const prefix='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-rust-generated-opt-levels';
 const raw=gzipSync(JSON.stringify({builds,outputs}),{level:9});await writeFile(resolve(root,prefix+'.outputs.json.gz'),raw);
 const fixture=gzipSync(JSON.stringify({source:source.toString('utf8'),main:main.toString('utf8'),baseline:generated.baseline.toString('utf8'),cached:generated.cached.toString('utf8')}),{level:9});await writeFile(resolve(root,prefix+'.fixture.json.gz'),fixture);
 const report={version:1,passed:changedInputs.length===0,qualifiesFor10000Target:false,timingQualification:'PROVISIONAL_CONTENDED',sourceReference:assessment.result,runtime:{rlib:runtime,sha256:inputs.get(runtime),sourceRoot:resolve(frozen,'runtime'),sourceManifest:runtimeManifest,optimization:'Existing Cargo release rlib, linked unchanged into both generated optimization variants; no LTO.'},sameOptimizedRuntime:true,allOrderedEventsAndSelectedStateBitsMatch:true,orderedEventsPerTrial:expected.events.length,inputs:Object.fromEntries(inputs),changedInputs,toolchain:tool.stdout,builds:builds.map(({stdout,stderr,...row})=>row),rows,summaries,observedCompileWallRatioOpt3OverOpt1:builds[1].wallMs/builds[0].wallMs,artifacts:{outputs:{file:prefix+'.outputs.json.gz',sha256:sha(raw)},fixture:{file:prefix+'.fixture.json.gz',sha256:sha(fixture)}},scope:'Unchanged original Unit.update component fixture, generated Rust opt-level1 versus3, same frozen optimized runtime and codegen-units64. Each process retains baseline/cached generated paths, three3000-update trials each, five warmup updates, every callback and raw-bit observer. Three alternating process pairs. Updates/sec are component counts, not battles/sec. Compile wall includes linking and is sequential and potentially contended; no estimate of full175MB program build speed.'};
 await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',passed:report.passed,builds:report.builds.map(row=>({level:row.level,wallMs:row.wallMs,bytes:row.binary.bytes})),summaries,changedInputs}));if(!report.passed)process.exitCode=1;
}
