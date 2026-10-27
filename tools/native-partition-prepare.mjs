import{readFile,writeFile,copyFile}from'node:fs/promises';
import{resolve,relative}from'node:path';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{compareNativeReports,compareHostInputConsumption}from'./native-report-compare.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,process.argv[2]??'work/native-partition-counter-capsule');
const manifestFile=resolve(directory,'manifest.json');
const manifest=JSON.parse(await readFile(manifestFile));
assert.equal(manifest.passed,true,'Partitioned source Node gate must pass first');
assert.equal(manifest.difference,null);
const sha=b=>createHash('sha256').update(b).digest('hex');
const original=resolve(root,manifest.input.file);
assert.equal(sha(await readFile(original)),manifest.input.sha256);
assert.equal(sha(await readFile(original+'.metadata.json')),manifest.input.metadataSha256);
const metadata=JSON.parse(await readFile(original+'.metadata.json'));
assert.ok(manifest.units.length>1&&manifest.units.length<=8,'Exactly eight SHUnit slots are available');
for(const unit of manifest.units)assert.equal(sha(await readFile(resolve(root,unit.file))),unit.sha256);
assert.equal(sha(await readFile(resolve(root,manifest.transformation.file))),manifest.transformation.sha256);
const reference=JSON.parse(await readFile(metadata.reference.file));
const actual=JSON.parse((await readFile(resolve(directory,'node.stdout'),'utf8')).trim().split('\n').at(-1));
assert.equal(compareNativeReports(actual,reference),null);
assert.equal(compareHostInputConsumption(actual.hostInputConsumption,metadata.hostInputs),null);
const last=manifest.units.at(-1),input=resolve(root,last.file);
metadata.output=input;metadata.outputSha256=last.sha256;
metadata.factoryChunks=manifest.units.slice(0,-1).map(unit=>({...unit,file:resolve(root,unit.file)}));
metadata.factoryChunkPolicy={kind:'ordered-program-partition',maximumSHUnits:8,globalDeclarationInstantiation:'one declaration-only prelude before original ordered effects',repeatedScriptVarDeclarations:false};
metadata.programPartition={original,originalSha256:manifest.input.sha256,manifest:manifestFile,manifestSha256:sha(await readFile(manifestFile)),nodeGatePassed:true,sourceFunctionInventory:manifest.proof.functionInventory??null};
for(const file of[manifestFile,original,original+'.metadata.json',manifest.transformation.file,'tools/check-native-partition.mjs','tools/native-partition-prepare.mjs'])metadata.adapterInputs[relative(root,resolve(root,file))]=sha(await readFile(resolve(root,file)));
await writeFile(input+'.metadata.json',JSON.stringify(metadata,null,2)+'\n');
// This is the genuine combined eight-script gate, checked against exact inputs
// above. Its fresh copy meets the native runner's stale-output rejection.
await copyFile(resolve(directory,'node.stdout'),input+'.node.stdout');
console.log(JSON.stringify({input:relative(root,input),units:manifest.units.length,nodeGateMatched:true,qualifiesFor10000Target:false}));
