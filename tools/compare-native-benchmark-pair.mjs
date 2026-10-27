import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {compareNativeReports} from './native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),[baselineFile,candidateFile,outputFile]=process.argv.slice(2);
assert.ok(baselineFile&&candidateFile&&outputFile,'Expected baseline report, candidate report, output JSON');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function load(file){const bytes=await readFile(resolve(root,file)),report=JSON.parse(bytes);assert.equal(report.semanticReportMatched,true);assert.equal(report.measuredBattles,20);assert.equal(report.warmupBattles,3);assert.equal(report.qualifiesFor10000Target,false);const artifact=report.artifacts.find(r=>r.file.endsWith('.actual.gz'));assert.ok(artifact);const compressed=await readFile(resolve(root,artifact.file));assert.equal(sha(compressed),artifact.sha256);const raw=gunzipSync(compressed);assert.equal(sha(raw),artifact.uncompressedSha256);return{file,sha256:sha(bytes),report,actual:JSON.parse(raw.toString().trim().split('\n').at(-1))};}
const baseline=await load(baselineFile),candidate=await load(candidateFile);
assert.equal(compareNativeReports(baseline.actual,candidate.actual),null);
for(const key of ['sourceManifest','reference','hostInputs','fastPathHits'])assert.deepEqual(baseline.report[key],candidate.report[key],key+' differs');
assert.deepEqual(baseline.report.units.map(u=>u.objectSha256),candidate.report.units.map(u=>u.objectSha256));
const measurement=r=>({file:r.file,sha256:r.sha256,elapsedMs:r.report.elapsedMs,battlesPerSecond:r.report.battlesPerSecond,executionWallMs:r.report.executionWallMs,privateVMSha256:r.report.privateVMSha256});
const result={version:1,passed:true,baseline:measurement(baseline),candidate:measurement(candidate),sourceManifest:baseline.report.sourceManifest,reference:baseline.report.reference,hostInputs:baseline.report.hostInputs,totalCallbacks:baseline.actual.totalCallbacks,allRawSemanticFieldsEqual:true,allSevenObjectHashesEqual:true,allOriginalFastPathCountsEqual:true,observedThroughputRatio:candidate.report.battlesPerSecond/baseline.report.battlesPerSecond,observedElapsedMsReduction:baseline.report.elapsedMs-candidate.report.elapsedMs,sequence:'Baseline first, candidate second; separate processes with three warmups and20 measured battles each.',scope:'One adjacent diagnostic pair. Individual runs pass all raw source-reference fields except timings. This does not establish a repeatable speedup, full-scene/random-roster fidelity or the10k/s target.',qualifiesFor10000Target:false,producer:{file:'tools/compare-native-benchmark-pair.mjs',sha256:sha(await readFile(resolve(root,'tools/compare-native-benchmark-pair.mjs')))}};
await writeFile(resolve(root,outputFile),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
