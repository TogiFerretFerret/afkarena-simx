import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { partitionNativeProgram } from './partition-native-program.mjs';
import { compareNativeReports,compareHostInputConsumption } from './native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),input=resolve(root,process.argv[2]??'work/native-oracle-capsule-flatcopy.js');
const directory=resolve(root,process.argv[3]??'work/native-partition');
await mkdir(directory,{recursive:true});
const source=await readFile(input,'utf8'),metadata=JSON.parse(await readFile(input+'.metadata.json','utf8'));
assert.equal(metadata.factoryChunks?.length??0,0,'Partition an ordinary single emitted script, without pre-existing factory units');
const result=partitionNativeProgram(source),units=[];
for(const unit of result.units){const file=resolve(directory,'unit-'+unit.index+'.js');await writeFile(file,unit.source);const {source:ignored,...description}=unit;units.push({file,...description});}
const loader='const fs=require("node:fs"),vm=require("node:vm");globalThis.hermescli={loadFile:p=>new Uint8Array(fs.readFileSync(p))};globalThis.__nativeDiagnosticDigest=text=>require("node:crypto").createHash("sha256").update(text).digest("hex");for(const file of JSON.parse(process.argv[1]))vm.runInThisContext(fs.readFileSync(file,"utf8"),{filename:file});';
// Parsing and writing the transformation is outside the oracle. The child alone
// executes every source statement under the captured raw-bit reference policy.
const child=spawnSync(process.execPath,[...metadata.oracleProfile.rawBitReferenceFlags,'-e',loader,JSON.stringify(units.map(u=>u.file))],{cwd:root,env:{...process.env,NODE_OPTIONS:metadata.oracleProfile.rawBitReferenceNodeOptions},encoding:'utf8',maxBuffer:128*1024*1024});
await writeFile(resolve(directory,'node.stdout'),child.stdout??'');await writeFile(resolve(directory,'node.stderr'),child.stderr??'');
if(child.error)throw child.error;assert.equal(child.status,0,'Partition execution failed: '+child.stderr);
const actual=JSON.parse(child.stdout.trim().split('\n').at(-1)),reference=JSON.parse(await readFile(input+'.reference.json','utf8'));
const difference=compareNativeReports(actual,reference)||compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs);
const report={version:1,passed:difference===null,difference,input:{file:relative(root,input),sha256:result.proof.originalSha256,metadataSha256:createHash('sha256').update(await readFile(input+'.metadata.json')).digest('hex')},proof:result.proof,units:units.map(({file,...unit})=>({file:relative(root,file),...unit})),observed:{completed:actual.completed,results:(actual.results??[]).map(({ticks,callbacks,rngBits})=>({ticks,callbacks,rngBits})),classManagerCounters:actual.classManagerCounters??null},qualifiesFor10000Target:false,limitations:['Node multi-script equivalence only; native multiunit compilation is not yet checked.','Original driver discards script completion values; exception stack filenames and source positions differ.','This fixed workload excludes complete actor/effect/view lifecycle.']};
await writeFile(resolve(directory,'manifest.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(root,'benchmarks/validation/native-program-partition.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));assert.equal(difference,null,'Partitioned Node semantics differ');
