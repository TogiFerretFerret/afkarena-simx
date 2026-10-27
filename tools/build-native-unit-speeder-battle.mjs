import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {buildPrivateVMHelper} from './native-private-vm.mjs';
import {patchUnitSpeederC} from './native-unit-speeder-patch.mjs';

// Preparation only: this may compile before the semantic gate, but never runs a
// battle. The separate runner requires the completed native semantic proof.
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-unit-speeder-battle');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=async file=>sha(await readFile(resolve(root,file)));
await mkdir(directory,{recursive:true});
const inputs={
 baseline:'benchmarks/results/2026-10-27T21-55-08.845Z-native-warm23-no-proxy.json',
 speeder:'benchmarks/validation/native-unit-speeder-build.json',
 cache:'benchmarks/validation/native-global-ed-prefilter-build.json',
 liveness:'benchmarks/validation/unit-speeder-liveness.json',
};
const records={};for(const [key,file]of Object.entries(inputs))records[key]=JSON.parse(await readFile(resolve(root,file)));
const {baseline,speeder,cache,liveness}=records;
assert.equal(baseline.semanticReportMatched,true);
for(const proof of [speeder,cache]){
 assert.equal(proof.passed,true);
 for(const [file,expected]of Object.entries(proof.sources))assert.equal(await hash(file),expected,'Stale source '+file);
 for(const row of Object.values(proof.libraries))assert.equal(await hash(row.path),row.sha256);
 assert.equal(await hash(proof.privateVM.output),proof.privateVM.privateSha256);
}
const helperFile=resolve(directory,'composed-host.inc');
const prefilter=await readFile(resolve(root,'tools/native-compiler-patches/permanent-global-ed-prefilter.inc'),'utf8');
assert.equal(prefilter.split('#include "entity-sort-copy-host.inc"').length,2);
assert.equal(prefilter.split('#include "permanent-global-ed-prefilter.h"').length,2);
const helper='#include '+JSON.stringify(resolve(root,'tools/native-compiler-patches/unit-speeder-host.inc'))+'\n'+prefilter
 .replace('#include "entity-sort-copy-host.inc"','// Entity/sort/copy helpers included exactly once by the UnitSpeeder host.')
 .replace('#include "permanent-global-ed-prefilter.h"','#include '+JSON.stringify(resolve(root,'tools/native-compiler-patches/permanent-global-ed-prefilter.h')));
await writeFile(helperFile,helper);
const privateVM=await buildPrivateVMHelper({root,directory,helperFile});
const unit=baseline.units[0],originalC=unit.compilation.ccArgs[unit.compilation.ccArgs.indexOf('-c')+1];
assert.equal(await hash(originalC),unit.compilation.patchedCSha256);
assert.equal(await hash(unit.object),unit.objectSha256);
const contract=JSON.parse(await readFile(resolve(root,'config/unit-translation.json')));
const original=(await readFile(resolve(root,contract.source),'utf8')).slice(contract.start,contract.end);
assert.equal(sha(original),contract.sha256);
const patched=await patchUnitSpeederC(await readFile(resolve(root,originalC),'utf8'),dirname(unit.poolFiles[0].file),original,{liveness});
const cFile=resolve(directory,'partition_0.speeder.c'),object=resolve(directory,'partition_0.speeder.o');
await writeFile(cFile,patched.source);
const args=[...unit.compilation.ccArgs];args[args.indexOf('-c')+1]=cFile;args[args.indexOf('-o')+1]=object;
const compiled=spawnSync('cc',args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(compiled.status,0,compiled.stderr);
for(const other of baseline.units.slice(1))assert.equal(await hash(other.object),other.objectSha256);
const sources={...speeder.sources,...cache.sources};
for(const file of ['tools/build-native-unit-speeder-battle.mjs','tools/native-unit-speeder-patch.mjs','tools/audit-unit-speeder-liveness.mjs','config/unit-translation.json'])sources[file]=await hash(file);
const prerequisites={};for(const [key,file]of Object.entries(inputs))prerequisites[key]={file,sha256:await hash(file)};
const report={version:1,passed:true,semanticProofPassed:false,integratedInBattle:false,qualifiesFor10000Target:false,
 scope:'BUILD ONLY composition: source-proven guarded Rust Unit.update numeric interior, original prefix and continuation, existing Entity/copy/TimSort/SHA and global ed prefilter. No battle run or throughput claim.',
 prerequisites,sources,privateVM,libraries:speeder.libraries,wrapper:cache.wrapper,
 helper:{file:helperFile,sha256:sha(helper)},
 patchedUnit:{...unit,object,objectSha256:await hash(object),originalObject:unit.object,originalObjectSha256:unit.objectSha256,cFile,cSha256:sha(patched.source),compileArgs:args,originalC,originalCSha256:await hash(originalC),functionSha256:patched.originalFunctionSha256,regionSha256:patched.blockSha256},
 sixOtherObjectsReused:true,liveness:{file:inputs.liveness,sha256:await hash(inputs.liveness),restore:liveness.analysis.assignedAndLiveAtContinuation}};
for(const [file,expected]of Object.entries(sources))assert.equal(await hash(file),expected,'Changed during build '+file);
const file='benchmarks/validation/native-unit-speeder-battle-build.json';await writeFile(resolve(root,file),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file,privateVM,object}));
