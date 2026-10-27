import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports} from './native-report-compare.mjs';
import {validateBattleBoundaryTrace} from './battle-boundary-trace.mjs';
import {validateBattleBoundarySchema} from './validate-battle-boundary-schema.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
const proofFile=resolve(directory,'source-proof.json'),proof=JSON.parse(await readFile(proofFile));assert.equal(proof.passed,true);
for(const row of proof.dependenciesAtFinish){assert.equal(row.matched,true);assert.equal(await hash(row.file),row.sha256,'Stale source input '+row.file);}
assert.equal(await hash(proof.sourceHelper.file),proof.sourceHelper.sha256);
const baseline=JSON.parse(await readFile(resolve(root,proof.baseline.file))),manifest=JSON.parse(await readFile(resolve(root,baseline.sourceManifest.file))),metadata=JSON.parse(await readFile(manifest.input.file+'.metadata.json'));
const original=JSON.parse(await readFile(metadata.hostInputs.file));assert.equal(await readFile(proof.hostInputs.file,'utf8'),JSON.stringify({...original,clock:original.clock.slice(0,260)})+'\n');
const source=JSON.parse(await readFile(proof.reports.traced)),plain=JSON.parse(await readFile(proof.reports.untraced)),withoutTrace={...source};delete withoutTrace.trace;
const sourceTerminalDifference=compareNativeReports(withoutTrace,plain),integrity=validateBattleBoundaryTrace(source.trace),schema=validateBattleBoundarySchema(source.trace);
assert.equal(sourceTerminalDifference,null);assert.equal(integrity.passed,true);assert.equal(schema.passed,true);assert.equal(source.completed,1);assert.equal(source.totalCallbacks,15453);
const timestamp=new Date().toISOString().replaceAll(':','-'),prefix='benchmarks/results/'+timestamp+'-boundary-source-reference',artifacts=[];await mkdir(resolve(root,'benchmarks/results'),{recursive:true});
async function archive(label,file){
 const bytes=await readFile(file),chunkSize=22*1024*1024,chunks=[];
 for(let offset=0,index=0;offset<bytes.length;offset+=chunkSize,index++){
  const raw=bytes.subarray(offset,Math.min(offset+chunkSize,bytes.length)),compressed=gzipSync(raw,{level:9}),name=prefix+'.'+label+(bytes.length>chunkSize?'.part-'+String(index).padStart(3,'0'):'')+'.gz';assert.ok(compressed.length<24*1024*1024);await writeFile(resolve(root,name),compressed);chunks.push({file:name,sha256:sha(compressed),uncompressedSha256:sha(raw),uncompressedBytes:raw.length,bytes:compressed.length});
 }
 artifacts.push({label,original:file,uncompressedSha256:sha(bytes),uncompressedBytes:bytes.length,compression:'gzip-each-raw-chunk-then-concatenate-uncompressed',chunks});
}
for(const [label,file]of [['source-traced',proof.reports.traced],['source-untraced',proof.reports.untraced],['host-inputs',proof.hostInputs.file],['source-proof',proofFile],['source-progress',resolve(root,'work/battle-boundary-source.stderr')],['helper',resolve(root,proof.sourceHelper.file)]])await archive(label,file);
const modules=[];for(const file of ['tools/run-battle-boundary-source.mjs','tools/battle-boundary-state-trace.js','tools/battle-boundary-trace.mjs','tools/validate-battle-boundary-schema.mjs','tools/archive-battle-boundary-source.mjs','benchmarks/validation/battle-boundary-schema.json'])modules.push({file,sha256:await hash(file)});
const counts={};for(const event of source.trace.events)counts[event.kind]=(counts[event.kind]||0)+1;
const report={version:1,passed:true,sourceOnly:true,sourceTerminalReportMatched:true,sourceTerminalDifference,sourceIntegrity:integrity,sourceStrictSchema:schema,sourceInputDependenciesUnchanged:true,exactFrozenHostTapePrefix:true,completed:source.completed,callbacks:source.totalCallbacks,eventCounts:counts,events:source.trace.events.length,snapshotNodes:source.trace.snapshots.length,rootContract:source.trace.rootContract,scope:'Complete original-source narrow boundary trace. Every terminal report field except timing matches a fresh untraced original-source battle. All source inputs remain frozen. Actual reconstructable snapshots include selected own enumerable string-keyed data fields and numeric vectors, not a whole-program graph. This source-only result does not establish native parity.',qualifiesFor10000Target:false,completeProgramRootContract:false,nativeTraceMatched:null,limitations:source.trace.limitations,oracleProfile:proof.oracleProfile,sourceProof:{file:proofFile,sha256:await hash(proofFile)},modules,artifacts};
const output=prefix+'.json';await writeFile(resolve(root,output),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(directory,'source-archive.json'),JSON.stringify({file:output,sha256:await hash(output)},null,2)+'\n');console.log(JSON.stringify({passed:true,output,events:report.events,snapshotNodes:report.snapshotNodes,artifacts:artifacts.length}));
