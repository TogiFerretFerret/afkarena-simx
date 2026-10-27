// Performance-only fixture: original mechanics, diagnostic table Proxies off.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import assert from 'node:assert/strict';
import { compareNativeReports, compareHostInputConsumption, semanticNativeReport, firstDifference } from './native-report-compare.mjs';
const traverse=traverseModule.default??traverseModule,root=resolve(import.meta.dirname,'..');
const sha=b=>createHash('sha256').update(b).digest('hex'),read=file=>readFile(resolve(root,file));
const fresh=resolve(root,process.argv[2]??'work/native-oracle-warm23-no-proxy.js');
const directory=resolve(root,process.argv[3]??'work/native-warm23-no-proxy-partition');await mkdir(directory,{recursive:true});
const baselinePath='work/native-worker-strong-map/manifest.json',baselineBytes=await read(baselinePath),base=JSON.parse(baselineBytes);assert.equal(base.passed,true);assert.equal(base.units.length,7);
const metadataBytes=await read(fresh+'.metadata.json'),metadata=JSON.parse(metadataBytes),oldMetadata=JSON.parse(await read(base.input.file+'.metadata.json'));
assert.equal(sha(await read(fresh)),metadata.outputSha256);assert.equal(metadata.battles,20);assert.equal(metadata.warmup,3);
assert.equal(metadata.tableMembraneEnabled,false);assert.equal(metadata.trackMutable,false);assert.deepEqual(metadata.mutableTables,[]);
assert.equal(metadata.traceEnabled,false);assert.equal(metadata.captureMode,'final');assert.equal(metadata.eagerBattle,true);assert.equal(metadata.observeClassManager,true);
assert.equal(metadata.scenario.sha256,oldMetadata.scenario.sha256);assert.equal(metadata.hostInputs.sha256,oldMetadata.hostInputs.sha256);assert.equal(metadata.hostInputs.randomCount,2);assert.equal(metadata.hostInputs.clockCount,5980);
assert.equal(metadata.tableBundle.sha256,oldMetadata.tableBundle.sha256);
const records=metadata.originalRecords.map(({name,file,start,end,sha256})=>({name,file,start,end,sha256}));
assert.deepEqual(records,oldMetadata.originalRecords.map(({name,file,start,end,sha256})=>({name,file,start,end,sha256})));
for(const record of records){const source=(await read(record.file)).toString('utf8').slice(record.start,record.end);assert.equal(sha(source),record.sha256);}
const sourceReference=JSON.parse(await read(metadata.reference.file)),emittedNode=JSON.parse((await read(fresh+'.node.stdout')).toString().trim().split('\n').at(-1));
assert.equal(compareNativeReports(emittedNode,sourceReference),null);assert.equal(compareHostInputConsumption(emittedNode.hostInputConsumption,metadata.hostInputs),null);
assert.equal(Object.hasOwn(sourceReference,'tableBoundary'),false);assert.equal(Object.hasOwn(emittedNode,'tableBoundary'),false);
const guardedReference=JSON.parse(await read(oldMetadata.reference.file));assert.equal(Object.hasOwn(guardedReference,'tableBoundary'),true);
// This is an EXPLICIT cross-contract check, never the candidate fidelity gate.
// Preserve both raw reports. Sole diagnostic field absence is reported below.
const guardedSemantic=semanticNativeReport(guardedReference),rawSemantic=semanticNativeReport(sourceReference);
const absentKeys=Object.keys(guardedSemantic).filter(key=>!Object.hasOwn(rawSemantic,key)),addedKeys=Object.keys(rawSemantic).filter(key=>!Object.hasOwn(guardedSemantic,key));
assert.deepEqual(absentKeys,['tableBoundary']);assert.deepEqual(addedKeys,[]);
const mechanicsFields=Object.keys(rawSemantic);for(const key of mechanicsFields)assert.equal(firstDifference(rawSemantic[key],guardedSemantic[key]),null,'Cross-contract mechanics changed: '+key);
function inspect(source){const assignments=[],functions=[];traverse(parse(source,{sourceType:'script'}),{AssignmentExpression(p){if(p.node.left.type==='Identifier'&&p.node.left.name==='__nativeTableBoundary')assignments.push(p.node.right);},VariableDeclarator(p){if(p.node.id.type==='Identifier'&&p.node.id.name==='__nativeTableBoundary'&&p.node.init)assignments.push(p.node.init);},Function(p){functions.push(sha(source.slice(p.node.start,p.node.end)));p.skip();}});return{assignments,functions:functions.sort()};}
const units=[],functionInventory=[];let replacementProof;
for(let index=0;index<base.units.length;index++){
 const old=base.units[index],bytes=await read(old.file);assert.equal(sha(bytes),old.sha256);let file=old.file,text=bytes.toString('utf8');
 const before=inspect(text);functionInventory.push(...before.functions);
 if(index===0){assert.equal(before.assignments.length,1);const initializer=before.assignments[0];assert.equal(initializer.type,'CallExpression');assert.equal(initializer.callee.type,'Identifier');assert.equal(initializer.callee.name,'installQualificationTablePolicy');
  const previous=text.slice(initializer.start,initializer.end);assert.equal(previous,'installQualificationTablePolicy({trackMutable:true,mutableTables:["AnimAtkFrame","UnitPeriod"],digest:globalThis.__nativeDiagnosticDigest||portableTraceSha256})');
  const prefix=text.slice(0,initializer.start),suffix=text.slice(initializer.end);text=prefix+'void 0'+suffix;
  assert.deepEqual(inspect(text).functions,before.functions,'No function bytes may change');
  file=resolve(directory,'combined.js');await writeFile(file,text);
  replacementProof={start:initializer.start,end:initializer.end,previous,previousSha256:sha(previous),replacement:'void 0',unchangedPrefixSha256:sha(prefix),unchangedSuffixSha256:sha(suffix),allOtherBytesUnchanged:true,allOriginalAndHarnessFunctionBytesUnchanged:true};
 }else assert.equal(before.assignments.length,0);
 units.push({...old,file,sha256:sha(text),bytes:Buffer.byteLength(text),unchangedFromBaseline:index!==0});
}
const loader='const fs=require("node:fs"),vm=require("node:vm");globalThis.hermescli={loadFile:p=>new Uint8Array(fs.readFileSync(p))};globalThis.__nativeDiagnosticDigest=text=>require("node:crypto").createHash("sha256").update(text).digest("hex");for(const file of JSON.parse(process.argv[1]))vm.runInThisContext(fs.readFileSync(file,"utf8"),{filename:file});';
const node=spawnSync(process.execPath,[...metadata.oracleProfile.rawBitReferenceFlags,'-e',loader,JSON.stringify(units.map(u=>u.file))],{cwd:root,env:{...process.env,NODE_OPTIONS:metadata.oracleProfile.rawBitReferenceNodeOptions},encoding:'utf8',maxBuffer:128*1024*1024});
await writeFile(resolve(directory,'node.stdout'),node.stdout??'');await writeFile(resolve(directory,'node.stderr'),node.stderr??'');if(node.error)throw node.error;assert.equal(node.status,0,node.stderr);
const actual=JSON.parse(node.stdout.trim().split('\n').at(-1)),difference=compareNativeReports(actual,sourceReference)||compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs);
assert.equal(difference,null,JSON.stringify(difference));assert.equal(Object.hasOwn(actual,'tableBoundary'),false);assert.equal(actual.completed,20);assert.equal(actual.totalCallbacks,309060);
const manifest={version:1,passed:true,difference:null,performanceOnly:true,instrumentationOff:true,qualifiesFor10000Target:false,
 scope:'INSTRUMENTATION-OFF performance fixture: one frozen callback-only scenario, three warmups then twenty measured battles. Original callbacks, mechanics, f64 captures, source RNG, host tape and ClassMgr counters remain exact. Diagnostic table Proxies and tableBoundary report field are absent by contract. Actor/effect/view lifecycle, broad random-team and full ordered trace qualification remain outstanding.',
 input:{file:fresh,sha256:metadata.outputSha256,metadataSha256:sha(metadataBytes)},baselineManifest:{file:baselinePath,sha256:sha(baselineBytes)},
 transformation:{file:'tools/prepare-uninstrumented-native-partition.mjs',sha256:sha(await read('tools/prepare-uninstrumented-native-partition.mjs'))},
 reference:{file:metadata.reference.file,sha256:metadata.reference.sha256},hostInputs:metadata.hostInputs,
 sourceGameRecordInventory:{count:records.length,sha256:sha(JSON.stringify(records)),allOriginalRecordsEqualGuardedSource:true},
 functionInventory:{count:functionInventory.length,sha256:sha(JSON.stringify(functionInventory.sort())),unchangedFromGuardedWorkerMap:true},
 replacementProof,unchangedUnits:6,units,
 independentSourceAndEmittedNodeGate:{passed:true,comparedFields:Object.keys(semanticNativeReport(sourceReference)),sourceElapsedMs:sourceReference.elapsedMs,emittedNodeElapsedMs:emittedNode.elapsedMs},
 derivedSevenNodeGate:{passed:true,elapsedMs:actual.elapsedMs,completed:actual.completed,totalCallbacks:actual.totalCallbacks,classManagerCounters:actual.classManagerCounters,hostInputConsumption:actual.hostInputConsumption},
 crossContractMechanicsCheck:{passed:true,guardedReference:{file:oldMetadata.reference.file,sha256:oldMetadata.reference.sha256},rawSemanticDifference:firstDifference(rawSemantic,guardedSemantic),absentDiagnosticFields:absentKeys,addedFields:addedKeys,mechanicsFieldsCheckedExactly:mechanicsFields,explanation:'These raw reports intentionally have different diagnostic contracts. The candidate gate above compares ALL fields against its independent uninstrumented source reference. This additional check projects explicitly named mechanics fields only; it does not suppress a field inside the candidate gate.'},
 tableInput:{sha256:metadata.tableBundle.sha256,sameRawBundleAsGuarded:true,mutableTablesExecuteOriginalRawWrites:['AnimAtkFrame','UnitPeriod']},
 qualification:'Performance-only; no 10k/sec or full-simulator fidelity qualification.'};
await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(resolve(root,'benchmarks/validation/warm23-no-proxy-source-node.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({passed:true,sourceElapsedMs:sourceReference.elapsedMs,derivedNodeElapsedMs:actual.elapsedMs,completed:actual.completed,totalCallbacks:actual.totalCallbacks,unchangedUnits:6,manifest:resolve(directory,'manifest.json')}));
