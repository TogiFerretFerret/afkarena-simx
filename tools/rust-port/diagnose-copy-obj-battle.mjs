import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareOneBattleReports,runMonitored} from './one-battle-check-support.mjs';
import {firstDifference} from '../native-report-compare.mjs';
import {sourceCopyFunction} from '../flat-numeric-copy.mjs';

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const baselineFile=resolve(root,option('--baseline','benchmarks/results/2026-10-28T18-40-55.250Z-rust-one-battle-check.json'));
const stamp=new Date().toISOString().replaceAll(':','-'),prefix='benchmarks/results/'+stamp+'-rust-copy-obj-battle',work=resolve(root,'work/rust-copy-obj-battle',stamp),inputs=new Map(),artifacts=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hash(file){const result=createHash('sha256');for await(const bytes of createReadStream(file))result.update(bytes);return result.digest('hex');}
async function bind(file,expected){const path=resolve(root,file),digest=await hash(path);if(expected!==undefined)assert.equal(digest,expected,'Frozen diagnostic input changed: '+path);inputs.set(path,digest);return digest;}
async function archive(label,bytes){const raw=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),compressed=gzipSync(raw,{level:9}),file=prefix+'.'+label+'.gz';await writeFile(resolve(root,file),compressed);artifacts.push({label,file,sha256:sha(compressed),uncompressedSha256:sha(raw)});}
await mkdir(work,{recursive:true});const report={version:1,passed:false,qualifiesFor10000Target:false,scope:'Instrumented one-battle copyObj diagnostic against frozen release libraries. Every intercepted invocation calls the original function with the same receiver and arguments. Object deltas are allocation signatures, not direct internal guard counters. Timings include observer overhead and cannot qualify battle throughput.',artifacts};
let beforeLibraries={},expected=null,actual=null;
async function snapshot(directory){const result={};for(const file of (await readdir(directory)).filter(file=>file.endsWith('.rlib')).sort())result[resolve(directory,file)]=await hash(resolve(directory,file));return result;}
try{
 const baselineBytes=await readFile(baselineFile);await bind(baselineFile,sha(baselineBytes));const baseline=JSON.parse(baselineBytes);assert.equal(baseline.passed,true);
 const reference=baseline.reference.oracleArtifact,compressed=await readFile(resolve(root,reference.file));await bind(reference.file,reference.sha256);const raw=gunzipSync(compressed);assert.equal(sha(raw),reference.uncompressedSha256);expected=JSON.parse(raw);await archive('oracle-report',raw);
 report.baseline={file:baselineFile,sha256:sha(baselineBytes),timing:baseline.timing,memory:baseline.memory};
 const libraries=baseline.linkedDependencies;assert.equal(libraries.length,8);const deps=dirname(libraries[0].file);for(const row of libraries)await bind(row.file,row.sha256);beforeLibraries=await snapshot(deps);report.linkedDependencies=libraries;
 for(const file of ['tools/rust-port/diagnose-copy-obj-battle.mjs','tools/rust-port/copy-obj-battle-probe.rs','tools/rust-port/program-one-battle-check.rs','tools/rust-port/program-host.rs','tools/rust-port/one-battle-check-support.mjs','tools/native-report-compare.mjs','tools/flat-numeric-copy.mjs'])await bind(file);
 const old=await readFile(resolve(root,'tools/rust-port/program-one-battle-check.rs'),'utf8');let wrapper=old;
 function replace(needle,replacement){assert.equal(wrapper.split(needle).length,2,'Wrapper anchor changed');wrapper=wrapper.replace(needle,replacement);}
 replace('use js_runtime::{Runtime,Value,EnvId,JsResult,JsError};','use js_runtime::{Runtime,Value,EnvId,JsResult,JsError};\n#[path="copy_obj_probe.rs"]mod copy_obj_probe;');
 replace('let mut rt=Runtime::new();','let mut rt=Runtime::new();copy_obj_probe::capture(&mut rt)?;');
 replace('let original=rt.lookup(env,"__nativeRun")?;','copy_obj_probe::install(&mut rt,env)?;let original=rt.lookup(env,"__nativeRun")?;');
 replace('eprintln!("one_battle_start:objects:{}",rt.objects.len());','copy_obj_probe::reset();eprintln!("one_battle_start:objects:{}",rt.objects.len());');
 replace('println!("ONE_BATTLE_REPORT:{}",json(rt,report)?);','copy_obj_probe::finish();println!("ONE_BATTLE_REPORT:{}",json(rt,report)?);');
 const source=resolve(work,'main.rs');await writeFile(source,wrapper);await bind(source);await archive('wrapper',wrapper);
 for(const [destination,original] of [['program_host.rs','tools/rust-port/program-host.rs'],['copy_obj_probe.rs','tools/rust-port/copy-obj-battle-probe.rs']]){const bytes=await readFile(resolve(root,original));const file=resolve(work,destination);await writeFile(file,bytes);await bind(file);await archive(destination,bytes);}
 const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),rustc=resolve(rustBin,'rustc');await bind(rustc);const binary=resolve(work,'copy-battle');
 const command=[rustc,'--edition=2024','-O',source,'-L','dependency='+deps,...libraries.flatMap(row=>['--extern',row.name+'='+row.file]),'-o',binary],env={...process.env,PATH:rustBin+':'+process.env.PATH,RUST_PORT_TRACE:'0'},limits={cwd:root,env,maxRssKiB:8*1024*1024,timeoutMs:120000};
 report.compile={command,execution:await runMonitored(command,{...limits,stdoutFile:resolve(work,'compile.stdout'),stderrFile:resolve(work,'compile.stderr')})};await archive('compile-args',JSON.stringify(command));await archive('compile-stdout',await readFile(resolve(work,'compile.stdout')));await archive('compile-stderr',await readFile(resolve(work,'compile.stderr')));assert.equal(report.compile.execution.status,0,'Diagnostic app compile failed');
 report.binary={file:binary,sha256:await hash(binary),bytes:(await stat(binary)).size};report.execution=await runMonitored([binary],{...limits,stdoutFile:resolve(work,'native.stdout'),stderrFile:resolve(work,'native.stderr')});
 const stdout=await readFile(resolve(work,'native.stdout'),'utf8'),stderr=await readFile(resolve(work,'native.stderr'),'utf8');await archive('native-stdout',stdout);await archive('native-stderr',stderr);
 const lines=stdout.split('\n').filter(line=>line.startsWith('ONE_BATTLE_REPORT:'));assert.equal(lines.length,1);actual=JSON.parse(lines[0].slice('ONE_BATTLE_REPORT:'.length));await archive('native-report',JSON.stringify(actual));
 const sourceLines=stderr.split('\n').filter(line=>line.startsWith('COPY_OBJ_SOURCE:'));assert.equal(sourceLines.length,1);const functionSource=sourceLines[0].slice('COPY_OBJ_SOURCE:'.length);report.functionSource={text:functionSource,sha256:sha(functionSource),expectedSha256:sha(sourceCopyFunction),unchanged:functionSource===sourceCopyFunction};
 const summaries=stderr.split('\n').filter(line=>line.startsWith('COPY_OBJ_SUMMARY:'));assert.equal(summaries.length,1);const summary=JSON.parse(summaries[0].slice('COPY_OBJ_SUMMARY:'.length));
 const rows=stderr.split('\n').filter(line=>line.startsWith('COPY_OBJ_ROW:')).map(line=>JSON.parse(line.slice('COPY_OBJ_ROW:'.length)));assert.equal(rows.reduce((n,row)=>n+row.calls,0),summary.calls);assert.equal(rows.length,summary.rows);
 const categories={},signatures={delta0:0,delta1:0,deltaGreaterThan1:0,deltaNegative:0};for(const row of rows){const category=categories[row.category]??={calls:0,delta0:0,delta1:0,deltaGreaterThan1:0,threw:0};category.calls+=row.calls;const signature=row.objectDelta===0?'delta0':row.objectDelta===1?'delta1':row.objectDelta>1?'deltaGreaterThan1':'deltaNegative';signatures[signature]+=row.calls;category[signature]=(category[signature]??0)+row.calls;if(row.threw)category.threw+=row.calls;}
 const start=/^one_battle_start:objects:(\d+)$/m.exec(stderr),complete=/^one_battle_complete:elapsed_ms:([0-9.eE+-]+):objects:(\d+)$/m.exec(stderr);assert.ok(start&&complete);
 report.copyObj={summary,rows,categories,allocationSignatures:signatures,delta1Fraction:summary.calls?signatures.delta1/summary.calls:null,flags:{1:'extensible',2:'standard Object prototype',4:'standard Array prototype',8:'mapped arguments',16:'own constructor descriptor',32:'writable array length'},intrinsicChangeMask:{0:'global Object',1:'global Array',2:'Object.keys',3:'Object.prototype',4:'Array.prototype',5:'Object.prototype.constructor',6:'Array.prototype.constructor',7:'Object prototype chain',8:'Array prototype chain'},lexicalObjectBinding:'Not inspected: environment internals are private. Delta1 is a likely native-copy signature, not a direct guard hit counter.'};
 report.timing={externalBattleMs:Number(complete[1]),reportElapsedMs:actual.elapsedMs,reportBattlesPerSecond:actual.battlesPerSecond,topLevelCopyOriginalMs:Number(summary.topLevelInclusiveNs)/1e6,scope:'Instrumented, possibly contended. Top-level copy time excludes its immediate classification but includes nested diagnostic overhead; recursive inclusive row times overlap.'};
 report.memory={objectsBefore:Number(start[1]),objectsAfter:Number(complete[2]),objectsAdded:Number(complete[2])-Number(start[1]),peakRssKiB:report.execution.peakRssKiB};
 report.comparison={equal:compareOneBattleReports(actual,expected)===null,difference:compareOneBattleReports(actual,expected),classManagerDifference:firstDifference(actual.classManagerCounters,expected.classManagerCounters),ignoredTimingFields:['elapsedMs','battlesPerSecond'],actual,expected};
 report.intentionalStop=report.execution.status===1&&report.execution.signal===null&&!report.execution.termination&&stderr.includes('one_battle_error:Unsupported("one-battle diagnostic stop; remaining host clock intentionally unconsumed")');
 report.binary.unchanged=await hash(binary)===report.binary.sha256;
}catch(error){report.error=String(error.stack??error);}
const changedInputs=[];for(const [file,before] of inputs){let after=null;try{after=await hash(file);}catch{}if(before!==after)changedInputs.push({file,before,after});}
let afterLibraries={},librarySnapshotError=null;try{if(report.linkedDependencies)afterLibraries=await snapshot(dirname(report.linkedDependencies[0].file));}catch(error){librarySnapshotError=String(error.stack??error);}
const changedLibraries=[];for(const file of new Set([...Object.keys(beforeLibraries),...Object.keys(afterLibraries)]))if(beforeLibraries[file]!==afterLibraries[file])changedLibraries.push({file,before:beforeLibraries[file]??null,after:afterLibraries[file]??null});
report.provenance={inputs:Object.fromEntries(inputs),beforeLibraries,afterLibraries,changedInputs,changedLibraries,librarySnapshotError,workingRuntimeSourcesNotUsedOrRebuilt:true};
report.passed=!report.error&&report.comparison?.equal===true&&report.comparison?.classManagerDifference===null&&report.intentionalStop===true&&report.functionSource?.unchanged===true&&report.binary?.unchanged===true&&changedInputs.length===0&&changedLibraries.length===0&&!librarySnapshotError;
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',passed:report.passed,timing:report.timing,memory:report.memory,copyObj:report.copyObj&&{summary:report.copyObj.summary,categories:report.copyObj.categories,allocationSignatures:report.copyObj.allocationSignatures,delta1Fraction:report.copyObj.delta1Fraction},difference:report.comparison?.difference,classManagerDifference:report.comparison?.classManagerDifference,error:report.error,changedInputs,changedLibraries}));if(!report.passed)process.exitCode=1;
