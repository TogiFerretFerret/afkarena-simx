import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateBattleBoundarySchema} from './validate-battle-boundary-schema.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceOnly=process.argv.includes('--source-only');assert.ok(process.argv.slice(2).every(arg=>arg==='--source-only'),'Unsupported argument');
const bindings=new Map();
async function bind(file,expected){const bytes=await readFile(resolve(root,file));const actual=sha(bytes);if(expected!==undefined)assert.equal(actual,expected,'Changed archive input '+file);bindings.set(file,actual);return bytes;}
const producer='tools/review-battle-boundary-schema-archives.mjs',validator='tools/validate-battle-boundary-schema.mjs',testProof='benchmarks/validation/battle-boundary-schema.json';
for(const file of [producer,validator,testProof])await bind(file);
const tests=JSON.parse(await readFile(resolve(root,testProof)));assert.equal(tests.passed,true);assert.equal(bindings.get(validator),tests.inputs[validator]);
const sourceProofFile=resolve(directory,'source-proof.json'),sourceProof=JSON.parse(await bind(sourceProofFile));assert.equal(sourceProof.passed,true);assert.equal(sourceProof.completed,1);assert.equal(sourceProof.difference,null);
const helperSHA=sourceProof.sourceHelper.sha256;assert.equal(helperSHA,tests.inputs[sourceProof.sourceHelper.file]);
const sourceFile=sourceProof.reports.traced,source=JSON.parse(await bind(sourceFile));
const sourceValidation=validateBattleBoundarySchema(source.trace);assert.equal(sourceValidation.passed,true,JSON.stringify(sourceValidation));assert.equal(sourceValidation.events,sourceProof.events);assert.equal(sourceValidation.snapshotNodes,sourceProof.snapshots);
const results=[{side:'source',input:{file:sourceFile,sha256:bindings.get(sourceFile)},proof:{file:sourceProofFile,sha256:bindings.get(sourceProofFile)},validation:sourceValidation}];
if(!sourceOnly){
 const executionFile=resolve(directory,'native-execution.json'),execution=JSON.parse(await bind(executionFile));assert.equal(execution.passed,true);assert.equal(execution.execution.code,0);
 const nativeBuild=JSON.parse(await bind(execution.build.file,execution.build.sha256));assert.equal(nativeBuild.helper.sha256,helperSHA);
 const text=(await bind(execution.stdout.file,execution.stdout.sha256)).toString('utf8').trimEnd();const native=JSON.parse(text.slice(text.lastIndexOf('\n')+1));
 const validation=validateBattleBoundarySchema(native.trace);assert.equal(validation.passed,true,JSON.stringify(validation));
 results.push({side:'native',input:{file:execution.stdout.file,sha256:execution.stdout.sha256},proof:{file:executionFile,sha256:bindings.get(executionFile)},validation});
}
const dependenciesAtFinish=[];for(const[file,expected]of bindings){const actual=sha(await readFile(resolve(root,file)));dependenciesAtFinish.push({file,sha256:expected,matched:actual===expected});assert.equal(actual,expected,'Archive changed during supplemental review '+file);}
const report={version:1,passed:true,kind:'Independent supplemental typed trace schema validation against actual completed outputs',scope:'Validates actual JSON-decoded trace schemas, hashes, references, typed own enumerable string-keyed data fields and event/payload boundaries. Source original traced/untraced raw terminal parity is a prerequisite from its own proof. This review does not compare source/native ordered traces and does not qualify whole-program state, actor/effect/view lifecycle, broad battle mechanics or throughput.',sourceAndNativeArchivesValidated:!sourceOnly,nativePending:sourceOnly,sourceHelperSha256:helperSHA,results,dependenciesAtFinish,qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/battle-boundary-schema-archives-review.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,sourceAndNativeArchivesValidated:!sourceOnly,results:results.map(({side,validation})=>({side,...validation}))}));
