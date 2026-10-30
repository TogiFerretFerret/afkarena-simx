// Archive-only validation: no compiler, battle simulation or source mutation.
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import assert from 'node:assert/strict';
import {archiveInput,archiveBytes,SnapshotStore,BoundaryStreamReader,compareBoundaryStreams,hashFile,digest} from './boundary-stream-support.mjs';
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const repository=resolve(option('--repository',root)),prefixEvents=args.includes('--prefix-events')?Number(option('--prefix-events')):null;
assert.ok(prefixEvents===null||Number.isSafeInteger(prefixEvents)&&prefixEvents>0);
assert.ok(args.includes('--candidate-report'),'Require an archived witnessed candidate report');
const sourceFile=resolve(repository,option('--source-report','benchmarks/validation/rust-program-trace-preparation.json')),candidateFile=resolve(repository,option('--candidate-report'));
const output=resolve(root,option('--output','benchmarks/validation/'+new Date().toISOString().replaceAll(':','-')+'-boundary-stream.json')),work=resolve(root,option('--work','work/boundary-stream'));
assert.ok(output!==sourceFile&&output!==candidateFile,'Output must not overwrite input reports');
await mkdir(work,{recursive:true});const temporary=await mkdtemp(join(work,'comparison-'));
const producerFiles=[import.meta.filename,resolve(root,'tools/rust-port/boundary-stream-support.mjs'),resolve(root,'tools/validate-battle-boundary-schema.mjs'),resolve(root,'tools/native-report-compare.mjs')],producerInputs={};for(const file of producerFiles)producerInputs[file]=await hashFile(file);
const report={version:1,passed:false,qualifiesFor10000Target:false,scope:'Archive-only streaming validation of the complete selected-state boundary contract, or an explicitly limited prefix. No new battle is executed. This does not establish complete game-state coverage, executable provenance, 20k battle qualification or throughput.',mode:prefixEvents===null?'complete-selected-boundary-stream':'ordered-prefix',prefixEvents,startedAt:new Date().toISOString(),producerInputs};
let source,candidate,left,right;
try{
 source=await archiveInput(sourceFile,option('--source-label','oracle-stdout'),repository);assert.equal(source.report.passed,true,'Require accepted source archive');assert.equal(source.report.execution?.status,0,'Require completed source execution');
 candidate=await archiveInput(candidateFile,option('--candidate-label','native-stdout'),repository);candidate.witnessedExecution=candidate.report.execution;if(!candidate.witnessedExecution&&candidate.report.nativeExecution){const witness=candidate.report.nativeExecution,file=resolve(repository,witness.file),bytes=await readFile(file);assert.equal(digest(bytes),witness.sha256,'Changed linked execution evidence');const evidence=JSON.parse(bytes);assert.equal(evidence.passed,true);candidate.executionEvidence={file,sha256:witness.sha256};candidate.witnessedExecution={status:evidence.execution?.code,signal:evidence.execution?.signal};}assert.equal(candidate.witnessedExecution?.status,0,'Require witnessed candidate exit0');assert.ok(!candidate.witnessedExecution.signal&&!candidate.witnessedExecution.termination,'Candidate interrupted');
 left=await new SnapshotStore(join(temporary,'source.nodes')).start();right=await new SnapshotStore(join(temporary,'candidate.nodes')).start();
 const expected=new BoundaryStreamReader(archiveBytes(source),left),actual=new BoundaryStreamReader(archiveBytes(candidate),right,{prefixEvents});
 report.comparison=await compareBoundaryStreams(expected,actual,{prefixEvents});
 report.memory={policy:'Pull-based decompression/framing; disk-backed snapshot values; retain only hash/type/dependency metadata and one event per side. No event history or snapshot value pool retained in memory.',sourceSnapshotStoreBytes:left.bytes,candidateSnapshotStoreBytes:right.bytes,snapshotReadsForDifference:left.reads+right.reads,maxRssKiB:process.resourceUsage().maxRSS,heapUsedAtFinish:process.memoryUsage().heapUsed};
 report.passed=report.comparison.passed;
}catch(error){report.error=String(error.stack??error);}
report.changedInputs=[];
for(const [side,input]of[['source',source],['candidate',candidate]])if(input){report[side]={file:input.reportFile,sha256:input.reportSha256,label:input.artifact.label,rawBytes:input.rawBytes,rawSha256:input.rawSha256,archiveFiles:input.files,recordedExecutionStatus:input.witnessedExecution?.status??input.report.execution?.status,executionEvidence:input.executionEvidence,recordedScope:input.report.scope};if(await hashFile(input.reportFile)!==input.reportSha256)report.changedInputs.push(input.reportFile);if(input.executionEvidence&&await hashFile(input.executionEvidence.file)!==input.executionEvidence.sha256)report.changedInputs.push(input.executionEvidence.file);for(const row of input.files){assert.notEqual(row.file,output,'Output must not overwrite archive input');if(await hashFile(row.file)!==row.sha256)report.changedInputs.push(row.file);}}
for(const[file,hash]of Object.entries(producerInputs))if(await hashFile(file)!==hash)report.changedInputs.push(file);
report.passed=report.passed&&report.changedInputs.length===0;report.finishedAt=new Date().toISOString();await left?.close();await right?.close();if(!args.includes('--keep-store'))await rm(temporary,{recursive:true,force:true});await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,passed:report.passed,comparison:report.comparison,memory:report.memory,error:report.error}));if(!report.passed)process.exitCode=1;
