import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {Readable} from 'node:stream';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {compareNativeReports,firstDifference} from '../native-report-compare.mjs';

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
assert.ok(args.includes('--candidate')&&args.includes('--exit-code'),'Provide candidate NDJSON and its observed process exit code');
const candidateFile=resolve(root,option('--candidate')),exitCode=Number(option('--exit-code'));
const referenceFile=resolve(root,option('--reference','benchmarks/validation/rust-program-trace-preparation.json'));
const output=resolve(root,option('--output','benchmarks/validation/rust-program-trace-candidate.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const producerFiles=[import.meta.filename,resolve(root,'tools/native-report-compare.mjs')],producerInputs={};for(const file of producerFiles)producerInputs[file]=sha(await readFile(file));
const referenceBytes=await readFile(referenceFile),reference=JSON.parse(referenceBytes);assert.equal(reference.passed,true,'Source trace preparation must pass');
const referenceLabel=option('--reference-label','oracle-stdout'),artifact=reference.artifacts.find(row=>row.label===referenceLabel);assert.ok(artifact,'Missing trace archive label '+referenceLabel);
const archiveInputs=[];
async function* chunks(){const digest=createHash('sha256');let total=0;for(const chunk of artifact.chunks){const compressed=await readFile(resolve(root,chunk.file));assert.equal(sha(compressed),chunk.sha256);const raw=gunzipSync(compressed);assert.equal(sha(raw),chunk.uncompressedSha256);assert.equal(raw.length,chunk.uncompressedBytes);digest.update(raw);total+=raw.length;archiveInputs.push({file:chunk.file,sha256:chunk.sha256});yield raw;}assert.equal(total,artifact.uncompressedBytes);assert.equal(digest.digest('hex'),artifact.uncompressedSha256);}
async function hashFile(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}
function keys(record,expected){assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.deepEqual(Object.keys(record).sort(),[...expected].sort());}
async function collect(input,expected){
 const lines=createInterface({input,crlfDelay:Infinity}),snapshots=new Set(),events=[];let header=null,footer=null,phase='progress',firstDifference=null,lastProgress=0;
 for await(const line of lines){assert.ok(!footer,'Data after trace footer');assert.ok(line.length<=16*1024*1024,'Trace row exceeds export limit');const record=JSON.parse(line);
  if(record.status==='boundary_trace_progress'){keys(record,['status','events','frame','kind']);assert.equal(phase,'progress');assert.ok(Number.isSafeInteger(record.events)&&record.events>lastProgress&&record.events%1000===0);assert.ok(Number.isSafeInteger(record.frame)&&record.frame>=-1);assert.equal(typeof record.kind,'string');lastProgress=record.events;continue;}
  if(record.record==='report'){keys(record,['record','report','traceHeader','eventCount','snapshotCount']);assert.equal(phase,'progress');assert.equal(header,null);assert.equal(record.report.completed,1);assert.equal(record.traceHeader.rootContract,'primitive-vector-battle-boundaries-v1');header=record;phase='snapshots';continue;}
  if(record.record==='snapshot'){keys(record,['record','index','snapshot']);keys(record.snapshot,['hash','value']);assert.equal(phase,'snapshots');assert.equal(record.index,snapshots.size);assert.equal(sha(JSON.stringify(record.snapshot.value)),record.snapshot.hash);assert.ok(!snapshots.has(record.snapshot.hash));snapshots.add(record.snapshot.hash);if(expected&&!expected.snapshots.has(record.snapshot.hash)&&!firstDifference)firstDifference={kind:'snapshot',index:record.index,hash:record.snapshot.hash};continue;}
  if(record.record==='event'){keys(record,['record','index','event']);assert.ok(header&&['snapshots','events'].includes(phase));assert.equal(snapshots.size,header.snapshotCount);phase='events';assert.equal(record.index,events.length);assert.equal(record.event.sequence,events.length);assert.equal(sha(JSON.stringify(record.event.state)),record.event.stateHash);const digest=sha(JSON.stringify(record.event));events.push(digest);if(expected&&expected.events[record.index]!==digest&&!firstDifference)firstDifference={kind:'event',sequence:record.index,expectedSha256:expected.events[record.index]??null,actualSha256:digest,actualEvent:record.event};continue;}
  if(record.record==='end'){keys(record,['record','events','snapshots','completed']);assert.equal(phase,'events');assert.equal(record.completed,1);assert.equal(record.events,events.length);assert.equal(record.snapshots,snapshots.size);footer=record;continue;}
  throw Error('Unknown trace record');
 }
 assert.ok(header&&footer,'Missing trace header/footer');assert.equal(header.eventCount,events.length);assert.equal(header.snapshotCount,snapshots.size);
 return{snapshots,events,header,footer,firstDifference};
}
const candidateBefore=await hashFile(candidateFile);let comparison=null,error=null;
try{
 assert.equal(exitCode,0,'Candidate execution must finish successfully');
 const expected=await collect(Readable.from(chunks())),actual=await collect(createReadStream(candidateFile),expected);
 const terminalDifference=compareNativeReports(actual.header.report,expected.header.report),hostDifference=firstDifference(actual.header.report.hostInputConsumption,expected.header.report.hostInputConsumption,'$.hostInputConsumption'),traceHeaderMatched=JSON.stringify(actual.header.traceHeader)===JSON.stringify(expected.header.traceHeader);
 const sameSnapshotPool=actual.snapshots.size===expected.snapshots.size&&[...actual.snapshots].every(hash=>expected.snapshots.has(hash)),sameEventCount=actual.events.length===expected.events.length;
 comparison={passed:!terminalDifference&&!hostDifference&&traceHeaderMatched&&sameSnapshotPool&&sameEventCount&&!actual.firstDifference,terminalDifference,hostDifference,traceHeaderMatched,sameSnapshotPool,sameEventCount,firstDifference:actual.firstDifference,events:actual.events.length,snapshots:actual.snapshots.size,hostInputConsumption:actual.header.report.hostInputConsumption,rootContract:actual.header.traceHeader.rootContract};
}catch(value){error=String(value.stack??value);}
const candidateUnchanged=await hashFile(candidateFile)===candidateBefore,referenceUnchanged=sha(await readFile(referenceFile))===sha(referenceBytes),changedArchiveInputs=[];
for(const row of archiveInputs)if(sha(await readFile(resolve(root,row.file)))!==row.sha256)changedArchiveInputs.push(row.file);
const changedProducerInputs=[];for(const [file,digest] of Object.entries(producerInputs))if(sha(await readFile(file))!==digest)changedProducerInputs.push(file);
const report={version:1,passed:comparison?.passed===true&&candidateUnchanged&&referenceUnchanged&&changedArchiveInputs.length===0&&changedProducerInputs.length===0,qualifiesFor10000Target:false,scope:'Archived NDJSON comparison only. Every ordered selected-state event JSON and exact-bit snapshot pool matches the selected passed trace reference. Candidate exit code is caller-supplied, not independently witnessed by this checker. Does not establish executable provenance, full-program graph coverage or throughput.',candidate:{file:candidateFile,sha256:candidateBefore,unchanged:candidateUnchanged,callerReportedExitCode:exitCode},reference:{file:referenceFile,label:referenceLabel,sha256:sha(referenceBytes),unchanged:referenceUnchanged},producerInputs,changedProducerInputs,archiveInputs,changedArchiveInputs,comparison,error};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,passed:report.passed,comparison,error}));if(!report.passed)process.exitCode=1;
