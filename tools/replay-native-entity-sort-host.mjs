// Rerun the existing, source-pinned native component executables with the new
// private composition DSO; compare their original canonical output hashes.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-entity-sort-host');
const sha=value=>createHash('sha256').update(value).digest('hex');
const composition=JSON.parse(await readFile(resolve(directory,'proof.json')));
assert.equal(composition.passed,true);
assert.equal(sha(await readFile(resolve(directory,'libhermesvm.so'))),composition.privateVM.privateSha256);
const results=[];
for(const [name,binary,proofPath] of [['entity','work/native-entity-update/probe','benchmarks/validation/native-entity-update.json'],['sort','work/native-sort-host-proof/probe','benchmarks/validation/native-sort-host.json']]){
 const proofBytes=await readFile(resolve(root,proofPath)),proof=JSON.parse(proofBytes);
 assert.equal(sha(proofBytes),composition.prerequisites[proofPath].sha256);
 const binarySha256=sha(await readFile(resolve(root,binary)));
 if(name==='sort')assert.equal(binarySha256,proof.binarySha256);
 const environment={...process.env,LD_LIBRARY_PATH:directory};
 const execution=spawnSync(resolve(root,binary),['-Xhermes-internal-test-methods'],{cwd:root,env:environment,encoding:'utf8',maxBuffer:64*1024*1024});
 if(execution.error)throw execution.error;assert.equal(execution.status,0,execution.stderr);
 const actual=JSON.parse(execution.stdout);
 // The original sort proof records unsupported-domain rejection rows separately.
 if(name==='sort'){assert.deepEqual(actual.unsupported,proof.unsupported);delete actual.unsupported;}
 const canonicalOutputSha256=sha(JSON.stringify(actual));
 const expectedOutputSha256=name==='entity'?proof.actualOutputSha256:proof.candidateCanonicalSha256;
 assert.equal(canonicalOutputSha256,expectedOutputSha256);
 const loaded=spawnSync('ldd',[resolve(root,binary)],{env:environment,encoding:'utf8'});assert.equal(loaded.status,0);assert.ok(loaded.stdout.includes(directory+'/libhermesvm.so'));
 const archive='benchmarks/validation/native-entity-sort-host-'+name+'.stdout.json.gz';
 const compressed=gzipSync(execution.stdout,{level:9});await writeFile(resolve(root,archive),compressed);
 results.push({name,binarySha256,proof:proofPath,proofSha256:sha(proofBytes),canonicalOutputSha256,expectedOutputSha256,archive,archiveSha256:sha(compressed),stderr:execution.stderr,loadedCombinedPrivateVM:true});
}
const report={version:1,passed:true,scope:'Existing independently qualified Entity and installed sort native probes rerun against combined Entity+sort+SHA DSO; exact original canonical report hashes. Not full battle qualification or throughput.',qualifiesFor10000Target:false,privateVMSha256:composition.privateVM.privateSha256,replayToolSha256:sha(await readFile(import.meta.filename)),results};
await writeFile(resolve(root,'benchmarks/validation/native-entity-sort-host-replay.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
