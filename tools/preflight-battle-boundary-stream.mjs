import {readFile,writeFile} from 'node:fs/promises';
import {openSync,writeSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {emitBattleBoundaryNDJSON,decodeBattleBoundaryNDJSON} from './battle-boundary-ndjson.mjs';
import {compareBattleBoundaryTraces} from './battle-boundary-trace.mjs';
import {compareNativeReports} from './native-report-compare.mjs';
import {validateBattleBoundarySchema} from './validate-battle-boundary-schema.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=b=>createHash('sha256').update(b).digest('hex'),files=['tools/battle-boundary-ndjson.mjs','tools/preflight-battle-boundary-stream.mjs','tools/battle-boundary-trace.mjs','tools/validate-battle-boundary-schema.mjs','tools/native-report-compare.mjs',resolve(directory,'source-traced.json')],bindings=[];
for(const file of files)bindings.push({file,sha256:sha(await readFile(resolve(root,file)))});
const source=JSON.parse(await readFile(resolve(directory,'source-traced.json'))),output=resolve(directory,'source-export.ndjson'),fd=openSync(output,'w');let rows=0,maxCodeUnits=0,maxUtf8Bytes=0;
try{emitBattleBoundaryNDJSON(source,text=>{rows++;maxCodeUnits=Math.max(maxCodeUnits,text.length);maxUtf8Bytes=Math.max(maxUtf8Bytes,Buffer.byteLength(text));writeSync(fd,text+'\n');});}finally{closeSync(fd);}
const decoded=decodeBattleBoundaryNDJSON(await readFile(output,'utf8'),{exitCode:0}),ordered=compareBattleBoundaryTraces(source.trace,decoded.trace),schema=validateBattleBoundarySchema(decoded.trace);
const a={...source},b={...decoded};delete a.trace;delete b.trace;const terminalDifference=compareNativeReports(a,b);
for(const row of bindings)assert.equal(sha(await readFile(resolve(root,row.file))),row.sha256,'Codec input changed during preflight '+row.file);
const proof={version:1,passed:ordered.passed&&schema.passed&&terminalDifference===null,scope:'Post-battle transport preflight against COMPLETE actual original-source trace. Every snapshot/event is serialized into bounded records, decoded fail-closed, schema-checked, compared in order and terminal report compared without trace. No native execution or whole-program qualification claim.',qualifiesFor10000Target:false,rows,maxUtf16CodeUnits:maxCodeUnits,maxUtf8Bytes,utf16CodeUnitLimitPerRow:16*1024*1024,events:source.trace.events.length,snapshots:source.trace.snapshots.length,ordered,schema,terminalDifference,bindings,output:{file:output,sha256:sha(await readFile(output))}};
await writeFile(resolve(root,'benchmarks/validation/battle-boundary-stream-preflight.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:proof.passed,rows,maxCodeUnits,maxUtf8Bytes,events:proof.events,snapshots:proof.snapshots}));assert.equal(proof.passed,true);
