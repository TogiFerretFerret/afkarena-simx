import { readFile,readdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { compareNativeReports,compareHostInputConsumption } from './native-report-compare.mjs';
import { validateNativeReplayContract } from './native-replay-contract.mjs';
const root=resolve(import.meta.dirname,'..'),fixtures=resolve(root,'benchmarks/fixtures');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),results=[];
for(const entry of await readdir(fixtures,{withFileTypes:true})){
 if(!entry.isDirectory())continue;
 const directory=resolve(fixtures,entry.name),manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')),decoded=new Map();
 for(const artifact of manifest.artifacts){
  const bytes=await readFile(resolve(directory,artifact.file));assert.equal(bytes.length,artifact.bytes,artifact.file);assert.equal(sha(bytes),artifact.sha256,artifact.file);
  const plain=gunzipSync(bytes);assert.equal(plain.length,artifact.uncompressedBytes,artifact.file);assert.equal(sha(plain),artifact.uncompressedSha256,artifact.file);decoded.set(artifact.file,plain);
 }
 const metadata=JSON.parse(decoded.get('metadata.json.gz')),inputs=JSON.parse(decoded.get('host-inputs.json.gz'));
 assert.equal(inputs.random.length,metadata.hostInputs.randomCount);assert.equal(inputs.clock.length,metadata.hostInputs.clockCount);
 assert.equal(sha(decoded.get('host-inputs.json.gz')),metadata.hostInputs.sha256);
 const reference=JSON.parse(decoded.get('reference.json.gz')),candidate=JSON.parse(decoded.get('node.stdout.gz').toString('utf8').trim().split('\n').at(-1));
 const replayContract=validateNativeReplayContract(manifest,metadata,{root,fixtureDirectory:directory,reference});
 const difference=compareNativeReports(candidate,reference)||compareHostInputConsumption(candidate.hostInputConsumption,metadata.hostInputs);
 if(manifest.nodeGate)assert.equal(difference===null,manifest.nodeGate.passed,'Archived gate status changed: '+entry.name);
 if(decoded.has('emitter-source.mjs.gz'))assert.equal(sha(decoded.get('emitter-source.mjs.gz')),metadata.adapterInputs['tools/emit-native-oracle.mjs']);
 results.push({fixture:entry.name,integrityValid:true,replayContract,nodeComparisonPassed:difference===null,difference,pinnedSourceProfile:!!metadata.oracleProfile,completed:reference.completed,randomInputs:inputs.random.length,clockInputs:inputs.clock.length,qualifiesForThroughputTarget:false});
}
const report={version:1,passed:true,fixtures:results.length,results,meaning:'Integrity and recorded source-versus-Node comparison only. Declared failed gates remain negative evidence; these fixtures do not establish complete battle fidelity or throughput qualification.'};
await writeFile(resolve(root,'benchmarks/validation/native-fixture-integrity.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
