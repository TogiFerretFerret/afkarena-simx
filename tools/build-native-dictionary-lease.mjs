import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {buildPrivateVMHelper} from './native-private-vm.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-dictionary-lease'),sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(directory,{recursive:true});
const prerequisite='benchmarks/validation/native-entity-sort-copy-host.json',baseBytes=await readFile(resolve(root,prerequisite)),base=JSON.parse(baseBytes);assert.equal(base.passed,true);
for(const [file,expected]of Object.entries(base.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale prerequisite '+file);
assert.equal(sha(await readFile(base.privateVM.output)),base.privateVM.privateSha256);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),checkout=resolve(root,'work/downloads',config.source.directory),build=resolve(root,'work/downloads/hermes-build');
const headers={};
for(const name of ['DictPropertyMap','HiddenClass']){
 const file=resolve(checkout,'include/hermes/VM/'+name+'.h'),bytes=await readFile(file);
 headers[name]={original:file,originalSha256:sha(bytes)};
}
const helperFile='tools/native-compiler-patches/dictionary-lease-host.inc';
const privateVM=await buildPrivateVMHelper({root,directory,helperFile});
for(const row of Object.values(headers))assert.equal(sha(await readFile(row.original)),row.originalSha256,'Original toolchain header changed');
const file='tools/native-compiler-patches/dictionary-lease-wrap.c',output=resolve(directory,'dictionary-lease-wrap.o');
const args=['-O2','-g0','-DNDEBUG','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(checkout,'include'),'-c',resolve(root,file),'-o',output];
const cc=spawnSync('cc',args,{cwd:root,encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
const sources={...base.sources};for(const f of ['tools/build-native-dictionary-lease.mjs',helperFile,file])sources[f]=sha(await readFile(resolve(root,f)));
const proof={...base,scope:'Build-only checked CURRENT dictionary ordinal hints with a single TLS owning lease and no per-read shared refcount operations; second live Runtime on the mutator thread falls back. No retained heap pointers or descriptor/slot/value cache; actual native proof and full raw battle gate required.',privateVM,headers,sources,prerequisites:{...base.prerequisites,[prerequisite]:{sha256:sha(baseBytes),scope:base.scope}},wrapper:{file,sourceSha256:sources[file],output,sha256:sha(await readFile(output)),compileArgs:args,linkFlag:'-Wl,--wrap=_sh_ljs_get_by_id_rjs'},apis:{init:'bool simx_dictionary_lease_init(SHRuntime*)',dump:'void simx_dictionary_lease_dump(SHRuntime*) BEFORE _sh_done',lifecycleDump:'void simx_dictionary_lease_lifecycle_dump() AFTER _sh_done',releaseDead:'bool simx_dictionary_lease_release_dead() AFTER _sh_done BEFORE lifecycle dump (only resets dead TLS ownership)' },implemented:true,semanticProofPassed:false,qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/native-dictionary-lease-build.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({privateVM,wrapper:proof.wrapper}));
