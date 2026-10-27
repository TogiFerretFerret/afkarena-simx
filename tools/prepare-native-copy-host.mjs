import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Run native-flat-copy-probe.mjs --combined first. This binds its actual private
// DSO to the already-proved Entity/sort Rust archives without rebuilding them.
const root=resolve(import.meta.dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const base=JSON.parse(await readFile(resolve(root,'benchmarks/validation/native-entity-sort-host.json')));
const copyPath='benchmarks/validation/native-combined-copy.json';
const copy=JSON.parse(await readFile(resolve(root,copyPath)));
assert.equal(base.passed,true);assert.equal(copy.matched,true);
assert.equal(copy.untouchedNativeMatched,true);assert.equal(copy.liveVMPreserved,true);
const report={...base,
 scope:'Private Entity+TimSort+SHA+emptycopy DSO composition with independently proved copy guard. Build/helper availability only; actual combined battle report parity requires a separate run.',
 privateVM:copy.privateVM,
 sources:{...base.sources,...copy.sourceHashes,'tools/prepare-native-copy-host.mjs':sha(await readFile(import.meta.filename))},
 prerequisites:{...base.prerequisites,[copyPath]:{sha256:sha(await readFile(resolve(root,copyPath))),scope:copy.scope}},
 requiredExports:[...base.requiredExports,'simx_empty_array_copy','simx_flat_numeric_copy']};
for(const [file,expected] of Object.entries(report.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale source: '+file);
for(const library of Object.values(report.libraries))assert.equal(sha(await readFile(library.path)),library.sha256,'Stale Rust archive');
assert.equal(sha(await readFile(report.privateVM.output)),report.privateVM.privateSha256,'Stale private DSO');
const symbols=spawnSync('nm',['-D','--defined-only',report.privateVM.output],{encoding:'utf8'});
assert.equal(symbols.status,0,symbols.stderr);
for(const name of report.requiredExports)assert.ok(symbols.stdout.split('\n').some(line=>line.endsWith(' '+name)),'Missing helper '+name);
const output='benchmarks/validation/native-entity-sort-copy-host.json';
await writeFile(resolve(root,output),JSON.stringify(report,null,2)+'\n');
console.log(output);
