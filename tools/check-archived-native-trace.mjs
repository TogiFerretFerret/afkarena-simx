import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {comparePortableBattleTraces} from './battle-trace-portable.mjs';
import {compareNativeReports,compareHostInputConsumption} from './native-report-compare.mjs';

// Native stdout may contain progress diagnostics before its final JSON report.
// Hash the original archive bytes, then compare every ordered captured state.
export async function checkArchivedNativeTrace(referencePath,candidatePath,metadataPath){
 async function load(file){
  const bytes=await readFile(file),text=(file.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8');
  const report=JSON.parse(text.trim().split('\n').at(-1));
  return{report,artifact:{file:resolve(file),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}};
 }
 const [reference,candidate]=await Promise.all([load(referencePath),load(candidatePath)]);
 const metadataBytes=await readFile(metadataPath),metadata=JSON.parse(metadataBytes);
 const hostInputDifference=compareHostInputConsumption(candidate.report.hostInputConsumption,metadata.hostInputs);
 const traceGate=comparePortableBattleTraces(reference.report.trace,candidate.report.trace);
 const contract=reference.report.trace?.rootContract;
 const difference=compareNativeReports(candidate.report,reference.report);
 return{version:1,passed:traceGate.passed&&contract==='ed-cc-source-globals'&&difference===null&&hostInputDifference===null,
  reference:reference.artifact,candidate:candidate.artifact,traceGate,semanticReportDifference:difference,
  metadata:{file:resolve(metadataPath),sha256:createHash('sha256').update(metadataBytes).digest('hex')},hostInputDifference,
  completeProgramRootContract:contract==='ed-cc-source-globals',qualifiesFor10000Target:false,
  limitations:['This checks archived diagnostic fidelity, not throughput or missing actor/effect/view coverage.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [reference,candidate,metadata,output]=process.argv.slice(2);
 if(!reference||!candidate||!metadata)throw new Error('Usage: node tools/check-archived-native-trace.mjs reference.stdout[.gz] candidate.stdout[.gz] metadata.json [report.json]');
 const gate=await checkArchivedNativeTrace(reference,candidate,metadata),json=JSON.stringify(gate,null,2)+'\n';
 if(output)await writeFile(output,json);
 process.stdout.write(json);if(!gate.passed)process.exitCode=1;
}
