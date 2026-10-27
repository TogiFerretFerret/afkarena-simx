import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {buildPrivateVMHelper} from './native-private-vm.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,process.argv[2]||'work/native-entity-sort-host');
await mkdir(directory,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
const run=(command,args)=>{const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result.stdout;};
const prerequisites={};
for(const path of ['benchmarks/validation/native-sort-host.json','benchmarks/validation/native-entity-update.json','benchmarks/validation/native-diagnostic-sha256-host.json']){
 const bytes=await readFile(resolve(root,path)),proof=JSON.parse(bytes);
 assert.equal(proof.passed??proof.matched,true,path+' prerequisite must pass');
 prerequisites[path]={sha256:sha(bytes),scope:proof.scope??'See original independent proof'};
}
const sources={};
for(const path of ['tools/build-native-entity-sort-host.mjs','tools/native-private-vm.mjs','tools/native-compiler-patches/entity-sort-host.inc','tools/native-compiler-patches/tim-sort-host.inc','tools/native-compiler-patches/tim-sort.inc','tools/native-compiler-patches/small-sort.inc','tools/native-compiler-patches/diagnostic-sha256-host.inc','tools/native-compiler-patches/diagnostic-sha256.inc','tools/native-compiler-patches/entity-update.inc','tools/native-entity-update.rs','tools/native-small-sort.rs','crates/battle-core/src/v8_tim_sort.rs','crates/battle-core/src/js_math.rs'])sources[path]=sha(await readFile(resolve(root,path)));
// Fail closed when the code independently exercised by the prerequisite proofs
// has changed. This composition build is not itself a battle equivalence gate.
for(const [path,fields] of [['benchmarks/validation/native-sort-host.json',['inputHashes']],['benchmarks/validation/native-entity-update.json',['sourceHashes']]]){
 const proof=JSON.parse(await readFile(resolve(root,path)));
 for(const field of fields)for(const [source,expected] of Object.entries(proof[field]||{}))if(source in sources)assert.equal(sources[source],expected,'Stale prerequisite: '+source);
}
const privateVM=await buildPrivateVMHelper({root,directory,helperFile:'tools/native-compiler-patches/entity-sort-host.inc'});
const rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc');
const libraries={};
for(const [name,source,extra] of [['libentity.a','tools/native-entity-update.rs',['-C','panic=abort']],['libsmall_sort.a','tools/native-small-sort.rs',['--cfg','simx_full_sort']]]){
 const path=resolve(directory,name);run(rustc,['--edition=2024','--crate-type=staticlib','-O',...extra,resolve(root,source),'-o',path]);libraries[name]={path,sha256:sha(await readFile(path))};
}
const exported=run('nm',['-D','--defined-only',privateVM.output]);
const requiredExports=['simx_entity_update','simx_install_v8_sort','simx_install_diagnostic_digest','simx_sort_hits','simx_sort_fallbacks'];
for(const name of requiredExports)assert.match(exported,new RegExp('\\b'+name+'$','m'));
const report={version:1,passed:true,scope:'Private DSO composition/build and independent prerequisite validation only. Combined actual battle report parity must be established by a separate run; this is not a new semantic equivalence proof or throughput result.',qualifiesFor10000Target:false,privateVM,libraries,requiredExports,sources,prerequisites,rustcSha256:sha(await readFile(rustc)),liveVMPreserved:true};
const text=JSON.stringify(report,null,2)+'\n';
await writeFile(resolve(directory,'proof.json'),text);
await writeFile(resolve(root,'benchmarks/validation/native-entity-sort-host.json'),text);
console.log(JSON.stringify({directory,proof:'benchmarks/validation/native-entity-sort-host.json',privateVM,libraries},null,2));
