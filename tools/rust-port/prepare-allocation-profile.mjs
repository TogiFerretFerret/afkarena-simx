// Link a diagnostic host wrapper against a verified, unchanged full Rust build.
// Never run battles here; the control agent reserves the measurement slot.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const stamp=new Date().toISOString().replaceAll(':','-');
const output=resolve(root,`benchmarks/validation/rust-allocation-profile-${stamp}.json`);
const preparation=output.replace('.json','.base.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const prepared=spawnSync(process.execPath,[resolve(root,'tools/rust-port/prepare-wall-profile.mjs'),'--output',preparation,...process.argv.slice(2)],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
assert.equal(prepared.status,0,prepared.stderr);
const proof=JSON.parse(await readFile(preparation));
const original=await readFile(proof.wrapper.file,'utf8');
const allocatorFile=resolve(root,'tools/rust-port/measured-allocator.rs');
const allocator=await readFile(allocatorFile,'utf8');
const before=' let original=rt.lookup(env,"parallelOriginalWallNow")?;';
assert.equal(original.split(before).length,2);
// Disable before any work in the second wallNow callback. Enable after all
// first-wallNow bookkeeping; the source battle loop starts when it returns.
let wrapper=original.replace(before,' if rt.lookup(env,"parallelWallCalls")?==Value::Number(1.0){allocation_boundary(1);}\n'+before);
const after=' eprintln!("PARALLEL_WALL_NOW:{}:{}",ordinal as u32,stamp);';
assert.equal(wrapper.split(after).length,2);
wrapper=wrapper.replace(after,after+'\n if ordinal==0.0{allocation_boundary(0);}')+'\n'+allocator;
await writeFile(proof.wrapper.file,wrapper);
const command=proof.command;
const compiled=spawnSync(command[0],command.slice(1),{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
await writeFile(output.replace('.json','.compile-stdout'),compiled.stdout??'');
await writeFile(output.replace('.json','.compile-stderr'),compiled.stderr??'');
assert.equal(compiled.status,0,compiled.stderr);
for(const row of proof.libraries)assert.equal(sha(await readFile(row.file)),row.sha256,'Changed linked library');
proof.basePreparation={file:preparation,sha256:sha(await readFile(preparation))};
proof.wrapper.sha256=sha(wrapper);
proof.binary.sha256=sha(await readFile(proof.binary.file));
proof.allocationCounter={file:allocatorFile,sha256:sha(allocator),marker:'MEASURED_ALLOCATIONS:',window:'Twenty original measured battles only, after three original warmups. First wallNow bookkeeping excluded; second callback entry disables counter.',counts:'Successful alloc/alloc_zeroed calls and requested bytes; dealloc calls and layout bytes; successful realloc calls and old/new requested bytes separately. Includes original source GC within measured loop. Not live/peak memory, not an uninstrumented speed result.'};
proof.scope+=' Instrumented allocator diagnostic only; validate full output against baseline reference before using counts.';
await writeFile(output,JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({output,binary:proof.binary,requiredEnvironment:proof.requiredEnvironment}));
