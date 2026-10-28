import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {parse} from '@babel/parser';
import assert from 'node:assert/strict';
import {compareOneBattleReports,runMonitored} from './one-battle-check-support.mjs';

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
if(args.includes('--help')){console.log('node tools/rust-port/check-one-battle.mjs [--deps work/rust-port-shared-target/release/deps] [--manifest work/rust-battle-full/program-manifest.json] [--output benchmarks/results/NAME.json] [--max-rss-gib 8] [--timeout-ms 120000]\nRun only after the main release build completes. Compiles a standalone diagnostic app; does not invoke Cargo or rebuild game modules.');process.exit(0);}
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const stamp=new Date().toISOString().replaceAll(':','-'),output=resolve(root,option('--output',`benchmarks/results/${stamp}-rust-one-battle-check.json`)),prefix=output.replace(/\.json$/,'');
const work=resolve(root,'work/rust-one-battle-check',stamp),deps=resolve(root,option('--deps','work/rust-port-shared-target/release/deps'));
const manifestFile=resolve(root,option('--manifest','work/rust-battle-full/program-manifest.json'));
const referenceFile='benchmarks/results/2026-10-28T17-46-01.273Z-rust-one-battle-diagnostic.json';
const maxRssGiB=Number(option('--max-rss-gib','8')),timeoutMs=Number(option('--timeout-ms','120000'));
assert.ok(Number.isFinite(maxRssGiB)&&maxRssGiB>0&&Number.isFinite(timeoutMs)&&timeoutMs>0);
const maxRssKiB=maxRssGiB*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashFile(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}
await mkdir(work,{recursive:true});await mkdir(dirname(output),{recursive:true});
const inputs=new Map(),artifacts=[],report={version:1,prepared:true,passed:false,qualifiesFor10000Target:false,startedAt:new Date().toISOString(),scope:'One cold fixed-fixture battle through generated native Rust, exact final-report comparison to the committed pinned-Node 1/0 reference. The harness intentionally stops before the original 5980-clock tape finishes; no complete batch, intermediate trace, steady-state speed or random/full-scene qualification is claimed.',work,rlibSelectionPolicy:'Newest modification time for each top-level release crate; run after the main release build has completed. Every dependency rlib is hashed before and after.',limits:{maxRssKiB,timeoutMs},artifacts};
let librariesBefore={},actual=null,expected=null,hostInputs=null;
async function track(file,expectedDigest){const path=resolve(root,file),digest=await hashFile(path);if(expectedDigest!==undefined)assert.equal(digest,expectedDigest,'Changed source input '+file);inputs.set(path,digest);return digest;}
async function sourceTree(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=resolve(directory,entry.name);if(entry.isDirectory())await sourceTree(file);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')await track(file);}}
async function librarySnapshot(){const result={};for(const file of (await readdir(deps)).filter(file=>file.endsWith('.rlib')).sort())result[resolve(deps,file)]=await hashFile(resolve(deps,file));return result;}
async function archive(label,bytes){const raw=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),compressed=gzipSync(raw,{level:9}),file=prefix+'.'+label+'.gz';await writeFile(file,compressed);const row={label,file,sha256:sha(compressed),uncompressedSha256:sha(raw),uncompressedBytes:raw.length};artifacts.push(row);return row;}
try{
 const referenceBytes=await readFile(resolve(root,referenceFile));await track(referenceFile,sha(referenceBytes));const reference=JSON.parse(referenceBytes);assert.equal(reference.passed,true);assert.equal(reference.completed,1);
 const oracle=reference.artifacts.find(row=>row.name==='oracleReport');assert.ok(oracle);const compressed=await readFile(resolve(root,oracle.file));await track(oracle.file,oracle.sha256);const raw=gunzipSync(compressed);assert.equal(sha(raw),oracle.uncompressedSha256);expected=JSON.parse(raw);
 report.reference={file:referenceFile,sha256:sha(referenceBytes),oracleArtifact:oracle};await archive('oracle-report',raw);
 const manifestBytes=await readFile(manifestFile);await track(manifestFile,sha(manifestBytes));const manifest=JSON.parse(manifestBytes);assert.equal(manifest.units.length,7);report.manifest={file:manifestFile,sha256:sha(manifestBytes)};
 for(const unit of manifest.units){const original=reference.sourceUnits.find(row=>row.index===unit.index);assert.ok(original);assert.equal(unit.sourceSha256,original.sourceSha256,'Game source differs from the archived oracle fixture');await track(unit.file,unit.sourceSha256);}
 const pending=[parse((await readFile(manifest.units[0].file)).toString('utf8'),{sourceType:'script'})],tables=new Set();
 while(pending.length){const node=pending.pop();if(node.type==='AssignmentExpression'&&node.left?.name==='__nativeTablePath'){assert.equal(node.right?.type,'StringLiteral');tables.add(resolve(root,node.right.value));}for(const [key,value] of Object.entries(node)){if(['loc','extra','comments','tokens'].includes(key))continue;if(Array.isArray(value)){for(const child of value)if(child&&typeof child.type==='string')pending.push(child);}else if(value&&typeof value.type==='string')pending.push(value);}}
 assert.equal(tables.size,1);for(const file of tables)await track(file);
 for(const file of ['tools/rust-port/check-one-battle.mjs','tools/rust-port/one-battle-check-support.mjs','tools/native-report-compare.mjs','tools/rust-port/program-one-battle-check.rs','tools/rust-port/program-host.rs','config/source-oracle-runtime.json'])await track(file);
 await sourceTree(resolve(root,'crates/js-runtime'));await sourceTree(resolve(root,'crates/battle-core'));
 const wrapper=await readFile(resolve(root,'tools/rust-port/program-one-battle-check.rs')),host=await readFile(resolve(root,'tools/rust-port/program-host.rs'));
 const source=resolve(work,'main.rs'),hostCopy=resolve(work,'program_host.rs');await writeFile(source,wrapper);await writeFile(hostCopy,host);await track(source);await track(hostCopy);await archive('wrapper',wrapper);await archive('program-host',host);
 librariesBefore=await librarySnapshot();assert.ok(Object.keys(librariesBefore).length>=8);
 const selected=[];for(const name of ['js_runtime',...Array.from({length:7},(_,index)=>'battle_unit_'+index)]){
  const matches=[];for(const file of Object.keys(librariesBefore))if(new RegExp('^lib'+name+'-[0-9a-f]+\\.rlib$').test(file.slice(file.lastIndexOf('/')+1)))matches.push({file,mtimeMs:(await stat(file)).mtimeMs});
  matches.sort((a,b)=>b.mtimeMs-a.mtimeMs||a.file.localeCompare(b.file));assert.ok(matches.length,'Missing release library '+name);selected.push({name,...matches[0],sha256:librariesBefore[matches[0].file],candidateCount:matches.length});
 }
 report.linkedDependencies=selected;
 const rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),rustc=resolve(rustBin,'rustc');await track(rustc);
 const binary=resolve(work,'one-battle'),command=[rustc,'--edition=2024','-O',source,'-L','dependency='+deps,...selected.flatMap(row=>['--extern',row.name+'='+row.file]),'-o',binary];
 report.compile={command};await archive('compile-args',JSON.stringify(command));
 const compileStdout=resolve(work,'compile.stdout'),compileStderr=resolve(work,'compile.stderr'),env={...process.env,PATH:rustBin+':'+(process.env.PATH??''),RUST_PORT_TRACE:'0'};
 report.compile.execution=await runMonitored(command,{cwd:root,env,stdoutFile:compileStdout,stderrFile:compileStderr,maxRssKiB,timeoutMs});
 await archive('compile-stdout',await readFile(compileStdout));await archive('compile-stderr',await readFile(compileStderr));assert.equal(report.compile.execution.status,0,'Standalone wrapper compilation failed');
 report.binary={file:binary,sha256:await hashFile(binary),bytes:(await stat(binary)).size};
 const stdoutFile=resolve(work,'native.stdout'),stderrFile=resolve(work,'native.stderr');report.execution=await runMonitored([binary],{cwd:root,env,stdoutFile,stderrFile,maxRssKiB,timeoutMs});
 const stdout=await readFile(stdoutFile,'utf8'),stderr=await readFile(stderrFile,'utf8');await archive('native-stdout',stdout);await archive('native-stderr',stderr);
 const reports=stdout.split('\n').filter(line=>line.startsWith('ONE_BATTLE_REPORT:')),hostRows=stdout.split('\n').filter(line=>line.startsWith('ONE_BATTLE_HOST_INPUTS:'));
 assert.equal(reports.length,1,'Expected one complete battle report');actual=JSON.parse(reports[0].slice('ONE_BATTLE_REPORT:'.length));await archive('native-report',JSON.stringify(actual));
 assert.equal(hostRows.length,1,'Expected host-prefix diagnostic');hostInputs=JSON.parse(hostRows[0].slice('ONE_BATTLE_HOST_INPUTS:'.length));report.hostInputConsumption=hostInputs;
 const start=[...stderr.matchAll(/^one_battle_start:objects:(\d+)$/gm)],complete=[...stderr.matchAll(/^one_battle_complete:elapsed_ms:([0-9.eE+-]+):objects:(\d+)$/gm)];assert.equal(start.length,1);assert.equal(complete.length,1);
 const before=Number(start[0][1]),after=Number(complete[0][2]),elapsedMs=Number(complete[0][1]);assert.ok(Number.isSafeInteger(before)&&Number.isSafeInteger(after)&&after>=before&&Number.isFinite(elapsedMs)&&elapsedMs>0);
 report.memory={objectsBefore:before,objectsAfter:after,objectsAdded:after-before,peakRssKiB:report.execution.peakRssKiB,peakHwmKiB:report.execution.peakHwmKiB};
 report.timing={externalBattleMs:elapsedMs,reportElapsedMs:actual.elapsedMs,reportBattlesPerSecond:actual.battlesPerSecond,scope:'One cold battle, potentially contended; diagnostic timer only. Initialization excluded from battle markers; no steady-state throughput claim.'};
 report.intentionalStop=report.execution.status===1&&report.execution.signal===null&&report.execution.termination===null&&stderr.split('\n').filter(line=>line==='one_battle_error:Unsupported("one-battle diagnostic stop; remaining host clock intentionally unconsumed")').length===1;
 const expectedHost={random:2,clock:{version:1,mode:'replay',attempts:260,consumed:260,total:5980,remaining:5720,counts:{'Date.now':0,'Date.construct':260,'Date.call':0},finished:false,restored:false,failure:null}};
 report.hostPrefixDifference=compareOneBattleReports(hostInputs,expectedHost);
 report.comparison={equal:compareOneBattleReports(actual,expected)===null,difference:compareOneBattleReports(actual,expected),ignoredTimingFields:['elapsedMs','battlesPerSecond'],actual,expected};
 assert.equal(actual.completed,1);assert.equal(actual.results?.length,1);assert.ok(Number.isFinite(actual.elapsedMs)&&actual.elapsedMs>0&&Number.isFinite(actual.battlesPerSecond)&&actual.battlesPerSecond>0);
 report.binary.unchanged=await hashFile(binary)===report.binary.sha256;
}catch(error){report.error=String(error.stack??error);}
const changedInputs=[];for(const [file,before] of inputs){let after=null;try{after=await hashFile(file);}catch{}if(after!==before)changedInputs.push({file,before,after});}
let librariesAfter={},librarySnapshotError=null;try{if(Object.keys(librariesBefore).length)librariesAfter=await librarySnapshot();}catch(error){librarySnapshotError=String(error.stack??error);}
const changedLibraries=[];for(const file of new Set([...Object.keys(librariesBefore),...Object.keys(librariesAfter)]))if(librariesBefore[file]!==librariesAfter[file])changedLibraries.push({file,before:librariesBefore[file]??null,after:librariesAfter[file]??null});
if(actual&&expected&&!report.comparison)report.comparison={equal:compareOneBattleReports(actual,expected)===null,difference:compareOneBattleReports(actual,expected),ignoredTimingFields:['elapsedMs','battlesPerSecond'],actual,expected};
report.provenance={inputs:Object.fromEntries(inputs),changedInputs,librariesBefore,librariesAfter,changedLibraries,librarySnapshotError,rlibBuildToCurrentSourcesIndependentlyProven:false};
report.passed=!report.error&&report.comparison?.equal===true&&report.hostPrefixDifference===null&&report.intentionalStop===true&&report.binary?.unchanged===true&&changedInputs.length===0&&changedLibraries.length===0&&librarySnapshotError===null;
report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,passed:report.passed,timing:report.timing,memory:report.memory,intentionalStop:report.intentionalStop,difference:report.comparison?.difference,hostPrefixDifference:report.hostPrefixDifference,error:report.error,changedInputs,changedLibraries}));if(!report.passed)process.exitCode=1;
