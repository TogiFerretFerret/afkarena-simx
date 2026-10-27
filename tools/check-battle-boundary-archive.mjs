import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {compareNativeReports} from './native-report-compare.mjs';
import {compareBattleBoundaryTraces} from './battle-boundary-trace.mjs';
import {validateBattleBoundarySchema} from './validate-battle-boundary-schema.mjs';
import {decodeBattleBoundaryNDJSON} from './battle-boundary-ndjson.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function checkBattleBoundaryArchive(sourceFile,nativeFile,{root=resolve(import.meta.dirname,'..')}={}){
 const sourceBytes=await readFile(resolve(root,sourceFile)),nativeBytes=await readFile(resolve(root,nativeFile)),sourceProof=JSON.parse(sourceBytes),nativeProof=JSON.parse(nativeBytes);
 assert.equal(nativeProof.sourceArchive.sha256,sha(sourceBytes),'Native evidence must bind this exact source archive');
 async function artifact(proof,label){const row=proof.artifacts.find(a=>a.label===label);assert.ok(row,label);const chunks=[];for(const item of row.chunks){const bytes=await readFile(resolve(root,item.file));assert.equal(sha(bytes),item.sha256);const raw=gunzipSync(bytes);assert.equal(raw.length,item.uncompressedBytes);assert.equal(sha(raw),item.uncompressedSha256);chunks.push(raw);}const raw=Buffer.concat(chunks);assert.equal(raw.length,row.uncompressedBytes);assert.equal(sha(raw),row.uncompressedSha256);return raw;}
 const source=JSON.parse(await artifact(sourceProof,'source-traced')),plain=JSON.parse(await artifact(sourceProof,'source-untraced')),execution=JSON.parse(await artifact(nativeProof,'native-execution'));
 const native=decodeBattleBoundaryNDJSON((await artifact(nativeProof,'native-traced')).toString('utf8'),{exitCode:execution.execution.code});
 const strip=report=>{const copy={...report};delete copy.trace;return copy;};
 const sourceTerminalDifference=compareNativeReports(strip(source),plain),nativeTerminalDifference=compareNativeReports(strip(native),plain),sourceSchema=validateBattleBoundarySchema(source.trace),nativeSchema=validateBattleBoundarySchema(native.trace),ordered=compareBattleBoundaryTraces(source.trace,native.trace);
 const passed=sourceProof.passed&&nativeProof.passed&&nativeProof.fastPathsObserved&&nativeProof.runtimeLifecycleMatched&&sourceTerminalDifference===null&&nativeTerminalDifference===null&&sourceSchema.passed&&nativeSchema.passed&&ordered.passed&&source.completed===1&&native.completed===1;
 return{version:1,passed,scope:'Rechecks complete committed raw source/native captures without requiring ignored compiler/build work files. Recomputes chunk integrity, fail-closed NDJSON transport, strict selected-state schema, every ordered snapshot/event and both terminal report comparisons. This replays diagnostic evidence, not a new simulator execution or a throughput benchmark.',source:{file:sourceFile,sha256:sha(sourceBytes)},native:{file:nativeFile,sha256:sha(nativeBytes)},sourceTerminalDifference,nativeTerminalDifference,sourceSchema,nativeSchema,ordered,completeProgramRootContract:false,qualifiesFor10000Target:false,limitations:source.trace.limitations};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [source,native,output]=process.argv.slice(2);if(!source||!native)throw Error('Usage: node --max-old-space-size=12288 tools/check-battle-boundary-archive.mjs SOURCE_ARCHIVE.json NATIVE_ARCHIVE.json [OUTPUT.json]');const proof=await checkBattleBoundaryArchive(source,native),text=JSON.stringify(proof,null,2)+'\n';if(output)await writeFile(output,text);process.stdout.write(text);if(!proof.passed)process.exitCode=1;}
