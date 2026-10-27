import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {buildPrivateVMHelper} from './native-private-vm.mjs';

const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const directory=resolve(root,process.argv[2]??'work/native-copy-classification');
const baseline='benchmarks/validation/native-entity-sort-copy-host.json';
const proof=JSON.parse(await readFile(resolve(root,baseline)));
assert.equal(proof.passed,true);
for(const [file,expected] of Object.entries(proof.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale prerequisite source '+file);
const files=['tools/build-native-copy-classification.mjs','tools/native-compiler-patches/empty-array-copy-classify.inc',
 'work/downloads/hermes-4f1db42d71d0839254c7154fc8c282bcea466206/include/hermes/VM/JSProxy.h'];
const sources={...proof.sources};for(const file of files)sources[file]=sha(await readFile(resolve(root,file)));
const privateVM=await buildPrivateVMHelper({root,directory,helperFile:'tools/native-compiler-patches/empty-array-copy-classify.inc'});
const symbols=spawnSync('nm',['-D','--defined-only',privateVM.output],{encoding:'utf8'});assert.equal(symbols.status,0,symbols.stderr);
for(const name of [...proof.requiredExports,'simx_empty_array_copy_unobserved'])assert.ok(symbols.stdout.split('\n').some(line=>line.endsWith(' '+name)),'Missing helper '+name);
const report={...proof,scope:'Diagnostic private DSO build only. Getter-free VM metadata classifies copy input shape before the unchanged original helper. Does not broaden admission or establish new battle parity. Destructor emits only stderr counters; all existing executable objects can be reused with the private DSO selected via LD_LIBRARY_PATH.',privateVM,sources,
 prerequisites:{...proof.prerequisites,[baseline]:{sha256:sha(await readFile(resolve(root,baseline))),scope:proof.scope}},
 classification:{noJSCalls:true,noAllocation:true,proxyTargets:'Immediate internal target only; revoked/nested/other targets are not traversed or evaluated.',output:'One stderr empty_copy_classification JSON line at DSO unload.'}};
const output='benchmarks/validation/native-copy-classification-build.json';
await writeFile(resolve(root,output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,privateVM}));
