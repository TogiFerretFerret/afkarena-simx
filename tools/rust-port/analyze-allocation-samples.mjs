import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const file=resolve(root,process.argv[2]??'benchmarks/results/2026-10-28T21-22-31.989Z-rust-measured-allocations.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reportBytes=await readFile(file),report=JSON.parse(reportBytes);
assert.equal(report.passed,true);
const proofBytes=await readFile(report.preparation.file),proof=JSON.parse(proofBytes);
assert.equal(sha(proofBytes),report.preparation.sha256);
assert.equal(proof.allocationSampling.everySuccessfulAllocation,131072);
const artifact=report.artifacts.find(row=>row.file.endsWith('.stderr.gz'));
const compressed=await readFile(artifact.file);assert.equal(sha(compressed),artifact.sha256);
const bytes=gunzipSync(compressed);assert.equal(sha(bytes),artifact.uncompressedSha256);
const text=bytes.toString(),blocks=[...text.matchAll(/ALLOCATION_STACK_BEGIN:(\d+)\n([\s\S]*?)\nALLOCATION_STACK_END:\1/g)];
assert.equal(blocks.length,Math.floor(report.counts.allocations/131072));
const groups=new Map();
for(let index=0;index<blocks.length;index++){
  const [,,stack]=blocks[index];
  assert.equal(Number(blocks[index][1]),(index+1)*131072);
  const frame=stack.split('\n').find(line=>/js_runtime::|battle_unit_/.test(line))?.replace(/^\s*\d+: /,'')??'unattributed';
  groups.set(frame,(groups.get(frame)??0)+1);
}
const output=file.replace(/\.json$/,'.sample-attribution.json');
const result={version:1,passed:true,scope:'Fixed-period allocation stack samples from the exact full native battle diagnostic. Groups use the first stack frame mentioning js_runtime or battle_unit; generic container frames may therefore be grouped ahead of their caller. These are allocation-count samples, not CPU percentages, allocated-byte percentages or unbiased probability estimates. Observer allocations are excluded. Full report and host-input checks passed separately in the linked diagnostic.',diagnostic:{file,sha256:sha(reportBytes)},stderr:artifact,sampling:proof.allocationSampling,samples:blocks.length,totalSuccessfulAllocations:report.counts.allocations,groups:[...groups].sort((a,b)=>b[1]-a[1]).map(([frame,samples])=>({frame,samples,percent:100*samples/blocks.length}))};
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,samples:blocks.length,groups:result.groups.slice(0,8)}));
