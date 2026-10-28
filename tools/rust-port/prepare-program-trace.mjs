import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Readable} from 'node:stream';
import {createInterface} from 'node:readline';
import {parse} from '@babel/parser';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
import {compareNativeReports} from '../native-report-compare.mjs';

const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/rust-battle-trace');
const referenceFile='benchmarks/results/2026-10-27T23-49-07.298Z-boundary-optimized-native.json';
const reportFile='benchmarks/validation/rust-program-trace-preparation.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const referenceBytes=await readFile(resolve(root,referenceFile)),reference=JSON.parse(referenceBytes);assert.equal(reference.passed,true);assert.equal(reference.allSourceGameFunctionBytesUnchanged,true);
const coverageFile='benchmarks/validation/rust-battle-compile-coverage.json',coverageBytes=await readFile(resolve(root,coverageFile)),coverage=JSON.parse(coverageBytes);
const tracked=new Map();async function track(file,expected){const path=resolve(root,file),digest=sha(await readFile(path));if(expected!==undefined)assert.equal(digest,expected,'Changed input '+file);tracked.set(path,digest);}
for(const file of [referenceFile,coverageFile,'tools/rust-port/prepare-program-trace.mjs','tools/rust-port/check-program.mjs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/bindings.mjs','tools/native-report-compare.mjs','config/source-oracle-runtime.json'])await track(file);
async function archived(row){const parts=[];for(const chunk of row.chunks){await track(chunk.file,chunk.sha256);const bytes=gunzipSync(await readFile(resolve(root,chunk.file)));assert.equal(sha(bytes),chunk.uncompressedSha256);parts.push(bytes);}const bytes=Buffer.concat(parts);assert.equal(sha(bytes),row.uncompressedSha256);return bytes;}
const functionTypes=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
function functions(source){const result=new Map(),pending=[parse(source,{sourceType:'script'})];while(pending.length){const node=pending.pop();if(functionTypes.has(node.type)){const digest=sha(source.slice(node.start,node.end));result.set(digest,(result.get(digest)??0)+1);}for(const [key,value] of Object.entries(node)){if(['loc','extra','comments','tokens'].includes(key))continue;if(Array.isArray(value)){for(const child of value)if(child&&typeof child.type==='string')pending.push(child);}else if(value&&typeof value.type==='string')pending.push(value);}}return result;}
await mkdir(work,{recursive:true});const units=[],sourceChanges=[];
for(const unit of coverage.units){
 await track(unit.file,unit.sha256);
 if(unit.index!==0&&unit.index!==6){units.push(unit);continue;}
 const label=unit.index===0?'unit0-source':'runner-source',row=reference.artifacts.find(value=>value.label===label);assert.ok(row,label);const bytes=await archived(row),source=bytes.toString('utf8');
 const before=functions((await readFile(unit.file)).toString('utf8')),after=functions(source);
 for(const [digest,count] of before)assert.ok((after.get(digest)??0)>=count,'An original function body changed: '+digest);
 const file=resolve(work,`unit-${unit.index}.js`);await writeFile(file,bytes);await track(file,row.uncompressedSha256);
 const {manifest}=compileSource(source,{filename:file,emitRust:false});assert.equal(manifest.unsupportedFunctions,0);
 units.push({...unit,...manifest,index:unit.index,file,sha256:sha(bytes),sourceBytes:bytes.length});
 sourceChanges.push({index:unit.index,file,sha256:sha(bytes),archiveLabel:label,originalFile:unit.file,originalSha256:unit.sha256,preservedOriginalFunctions:[...before.values()].reduce((a,b)=>a+b,0),addedFunctions:[...after.values()].reduce((a,b)=>a+b,0)-[...before.values()].reduce((a,b)=>a+b,0)});
}
const tablePath=/__nativeTablePath=\(?("(?:[^"\\]|\\.)*")/.exec((await readFile(units[0].file)).toString('utf8'));assert.ok(tablePath,'Missing literal external table path');await track(JSON.parse(tablePath[1]));
const manifestFile=resolve(work,'coverage.json'),manifest={...coverage,fixture:undefined,units,totalFunctions:units.reduce((n,unit)=>n+unit.functions.length,0),compiledFunctions:units.reduce((n,unit)=>n+unit.compiledFunctions,0),derivedFrom:{file:coverageFile,sha256:sha(coverageBytes)},traceReference:{file:referenceFile,sha256:sha(referenceBytes)},workload:{measuredBattles:1,warmups:0,clockInputs:260,randomInputs:2},scope:'Selected-state ordered-trace diagnostic workload restored from previously verified source/native instrumentation. Original source function bytes are preserved. This is not a full-program object graph or a throughput workload.',qualifiesFor10000Target:false};
await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');await track(manifestFile);
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
const stdoutFile=resolve(work,'node.stdout'),stderrFile=resolve(work,'node.stderr'),out=await open(stdoutFile,'w'),err=await open(stderrFile,'w');
const command=[process.execPath,...profile.rawBitReferenceFlags,resolve(root,'tools/rust-port/check-program.mjs'),'--oracle','--manifest',manifestFile],begin=performance.now();
let execution;try{execution=await new Promise(accept=>{const child=spawn(command[0],command.slice(1),{cwd:root,env:{...process.env,NODE_OPTIONS:profile.rawBitReferenceNodeOptions},stdio:['ignore',out.fd,err.fd]});let error=null;child.on('error',value=>error=value.message);child.on('close',(status,signal)=>accept({status,signal,error}));});}finally{await out.close();await err.close();}
const wallMs=performance.now()-begin;
// Compare streamed state hashes and exact event JSON against the old verified
// archive. Keeping only digests avoids materializing two ~284MB trace objects.
const expectedRow=reference.artifacts.find(value=>value.label==='native-traced');assert.ok(expectedRow);
async function* referenceChunks(){const digest=createHash('sha256');let bytes=0;for(const chunk of expectedRow.chunks){await track(chunk.file,chunk.sha256);const raw=gunzipSync(await readFile(resolve(root,chunk.file)));assert.equal(sha(raw),chunk.uncompressedSha256);assert.equal(raw.length,chunk.uncompressedBytes);digest.update(raw);bytes+=raw.length;yield raw;}assert.equal(digest.digest('hex'),expectedRow.uncompressedSha256);assert.equal(bytes,expectedRow.uncompressedBytes);}
async function collect(input,expected){
 const snapshots=new Set(),events=[],lines=createInterface({input,crlfDelay:Infinity});let header=null,end=null,firstDifference=null;
 for await(const line of lines){const record=JSON.parse(line);if(record.status==='boundary_trace_progress')continue;
  if(record.record==='report'){assert.equal(header,null);header=record;continue;}
  if(record.record==='snapshot'){assert.ok(header);assert.equal(record.index,snapshots.size);assert.equal(sha(JSON.stringify(record.snapshot.value)),record.snapshot.hash);assert.ok(!snapshots.has(record.snapshot.hash));snapshots.add(record.snapshot.hash);if(expected&&!expected.snapshots.has(record.snapshot.hash)&&!firstDifference)firstDifference={kind:'snapshot',index:record.index,hash:record.snapshot.hash};continue;}
  if(record.record==='event'){assert.equal(record.index,events.length);assert.equal(record.event.sequence,events.length);assert.equal(sha(JSON.stringify(record.event.state)),record.event.stateHash);const digest=sha(JSON.stringify(record.event));events.push(digest);if(expected&&expected.events[record.index]!==digest&&!firstDifference)firstDifference={kind:'event',sequence:record.index,expectedSha256:expected.events[record.index],actualSha256:digest};continue;}
  if(record.record==='end'){assert.equal(end,null);end=record;continue;}
  throw Error('Unknown trace export record');
 }
 assert.ok(header&&end);assert.equal(end.events,events.length);assert.equal(end.snapshots,snapshots.size);assert.equal(header.eventCount,events.length);assert.equal(header.snapshotCount,snapshots.size);assert.equal(end.completed,1);
 return{snapshots,events,header,end,firstDifference};
}
let comparison=null,validationError=null;
try{
 assert.equal(execution.status,0,await readFile(stderrFile,'utf8'));
 const expected=await collect(Readable.from(referenceChunks())),actual=await collect(createReadStream(stdoutFile),expected);
 const terminalDifference=compareNativeReports(actual.header.report,expected.header.report),sameSnapshotPool=actual.snapshots.size===expected.snapshots.size&&[...actual.snapshots].every(hash=>expected.snapshots.has(hash));
 comparison={passed:!actual.firstDifference&&!terminalDifference&&sameSnapshotPool&&actual.events.length===expected.events.length,firstDifference:actual.firstDifference,terminalDifference,sameSnapshotPool,eventCount:actual.events.length,snapshotCount:actual.snapshots.size,rootContract:actual.header.traceHeader.rootContract,traceHeaderMatched:JSON.stringify(actual.header.traceHeader)===JSON.stringify(expected.header.traceHeader),terminalReport:actual.header.report};
 comparison.passed=comparison.passed&&comparison.traceHeaderMatched;
}catch(error){validationError=String(error.stack??error);}
const changedInputs=[];for(const [file,before] of tracked){const after=sha(await readFile(file));if(after!==before)changedInputs.push({file,before,after});}
const prefix=reportFile.replace(/\.json$/,''),artifacts=[];
async function archiveFile(label,file){const handle=await open(file,'r'),digest=createHash('sha256'),chunks=[];let offset=0;try{for(let index=0;;index++){const buffer=Buffer.alloc(22*1024*1024),{bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(!bytesRead)break;const raw=buffer.subarray(0,bytesRead);digest.update(raw);const bytes=gzipSync(raw,{level:9}),name=prefix+'.'+label+'.part-'+String(index).padStart(3,'0')+'.gz';await writeFile(resolve(root,name),bytes);chunks.push({file:name,sha256:sha(bytes),uncompressedSha256:sha(raw),uncompressedBytes:raw.length});offset+=bytesRead;}}finally{await handle.close();}artifacts.push({label,file,uncompressedBytes:offset,uncompressedSha256:digest.digest('hex'),chunks});}
await archiveFile('oracle-stdout',stdoutFile);await archiveFile('oracle-stderr',stderrFile);await archiveFile('coverage',manifestFile);
const report={version:1,prepared:true,passed:comparison?.passed===true&&changedInputs.length===0,qualifiesFor10000Target:false,scope:manifest.scope,manifest:{file:manifestFile,sha256:sha(await readFile(manifestFile))},reference:{file:referenceFile,sha256:sha(referenceBytes)},sourceChanges,originalFunctionBytesPreserved:true,inputs:Object.fromEntries(tracked),changedInputs,execution:{...execution,command,wallMs},comparison,validationError,artifacts,next:'Generate Rust from this coverage manifest when the generator accepts a separate coverage path; no native trace build or Rust battle qualification has been performed.'};
await writeFile(resolve(root,reportFile),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:reportFile,manifest:manifestFile,passed:report.passed,execution,events:comparison?.eventCount,snapshots:comparison?.snapshotCount,firstDifference:comparison?.firstDifference,terminalDifference:comparison?.terminalDifference,validationError,changedInputs}));if(!report.passed)process.exitCode=1;
