import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{spawnSync}from'node:child_process';
import{gunzipSync}from'node:zlib';
import assert from'node:assert/strict';
const file=process.argv[2];assert.ok(file,'qualification report required');
const r=JSON.parse(await readFile(file)),sha=b=>createHash('sha256').update(b).digest('hex');
const artifact=r.artifacts.find(x=>x.label==='expected'),bytes=await readFile(artifact.file);assert.equal(sha(bytes),artifact.sha256);
const expected=gunzipSync(bytes).toString(),rows=[];
for(let pair=0;pair<3;pair++)for(const variant of pair%2?['native','baseline']:['baseline','native']){
 const binary=r.binaries.find(x=>x.variant===variant);assert.equal(sha(await readFile(binary.file)),binary.sha256);
 const run=spawnSync(binary.file,[],{encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(run.status,0,run.stderr);
 for(const line of run.stdout.trim().split('\n')){const[label,trial,ns,...text]=line.split('\t');assert.equal(text.join('\t'),expected);rows.push({pair,variant,generatedEntry:label,trial:Number(trial),elapsedNs:Number(ns),updates:r.updatesPerTrial});}
}
const totals=Object.fromEntries(['baseline','native'].map(variant=>{const a=rows.filter(x=>x.variant===variant),elapsedNs=a.reduce((n,x)=>n+x.elapsedNs,0),updates=a.reduce((n,x)=>n+x.updates,0);return[variant,{updates,elapsedNs,updatesPerSecond:updates/(elapsedNs/1e9)}]}));
const report={version:1,passed:true,sourceReport:file,sourceReportSha256:sha(await readFile(file)),binaries:r.binaries,rows,totals,observedThroughputRatio:totals.native.updatesPerSecond/totals.baseline.updatesPerSecond,allOrderedEventsAndSelectedStateBitsMatched:true,eventsPerTrial:r.eventCountPerTrial,qualifiesFor10000Target:false,scope:'Same previously qualified generated Unit.update fixture and exact binaries. Alternating baseline/native process order across three pairs; each process executes six fresh-runtime trials. Shared-host contention remains uncontrolled. Component updates, not battles/sec.'};
const output='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-rust-unit-update-function-tag-alternating.json';await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:output,totals,observedThroughputRatio:report.observedThroughputRatio}));
