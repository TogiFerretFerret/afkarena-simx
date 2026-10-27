import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const compiler=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8'));
const entity=JSON.parse(await readFile(resolve(root,'config/entity-translation.json'),'utf8'));
const sha=text=>createHash('sha256').update(text).digest('hex');
const source=await readFile(resolve(root,entity.source),'utf8');
assert.equal(sha(source.slice(entity.start,entity.end)),entity.sha256);
const checkout=`work/downloads/${compiler.source.directory}`;
const contracts=[
 ['include/hermes/VM/JSObject.h','meaning no property\n  ///   checks need to be made when reading an indexed value.','hasFastIndexProperties only proves fast reads; position writes additionally require writable storage.'],
 ['lib/VM/JSArray.cpp','if (LLVM_UNLIKELY(self->getClass(runtime)->isFrozen()))\n        indexedElementFlags.writable = 0;','Frozen dense arrays are not writable. A failed source assignment must remain a source fallback.'],
 ['include/hermes/VM/JSArray.h','and were never passed to user JS code.','unsafeSetExistingElementAt has a stronger ownership contract than source-created battle arrays satisfy.'],
 ['include/hermes/VM/ArrayStorage.h','data()[index].set(val, this, gc);','Existing indexed writes use GC-aware storage.set; no raw Rust pointer stores bypass this contract.'],
 ['include/hermes/VM/SmallHermesValue.h','A 32-bit representation\n/// inherently requires boxing doubles','A raw u64 slot ABI must be separately rejected when pointer compression or boxed doubles is enabled.'],
 ['include/hermes/VM/HermesValue.h','Some GCs still need to do a write barrier though','Even non-pointer writes retain the VM write barrier contract.'],
 ['include/hermes/VM/JSObject.h','self->directProps()[index].set<NeedsBarriers>','Named direction writes must preserve GC-aware direct/indirect slot storage.'],
];
const evidence=[];
for(const [file,needle,conclusion] of contracts){
 const text=await readFile(resolve(root,checkout,file),'utf8');
 const offset=text.indexOf(needle);assert.notEqual(offset,-1,`pinned VM contract changed: ${file}: ${needle}`);
 evidence.push({file,sha256:sha(text),line:text.slice(0,offset).split('\n').length,needle,conclusion});
}
const configFile='work/downloads/hermes-build/lib/config/libhermesvm-config.h';
const config=await readFile(resolve(root,configFile),'utf8');
for(const name of ['HERMESVM_BOXED_DOUBLES','HERMESVM_COMPRESSED_POINTERS'])assert.ok(config.includes(`/* #undef ${name} */`));
const report={version:1,source:{file:entity.source,start:entity.start,end:entity.end,sha256:entity.sha256},compilerSource:compiler.source,storageConfig:{file:configFile,sha256:sha(config),boxedDoubles:false,compressedPointers:false},evidence,
 nextGuardedBlock:'ed.Entity.update',
 canonicalState:'Keep original VM objects and arrays. Capture position/velocity references once, retain whole-vector identity, and reload velocity[0] after both position writes.',
 requiredGuard:['No Proxy/host object/accessor/coercing property reads; position, velocity and direction must be actual own ordinary data properties.','position/velocity must be dense plain Number arrays with actual own 0/1 slots; position slots writable.','direction must be a writable Number property, even if its write branch is not eventually taken, or use a separate no-write proof.','All inputs including dt finite; preserve ordered multiplication then addition without FMA or algebraic reassociation.','Guard current MXCSR; source fallback executes before any observable mutation if any guard fails.','No allocation, JS callback, GC safepoint, descriptor/prototype changes or reentrancy while borrowing storage; re-resolve after any such boundary.','Use the pinned VM encoding and GC-aware write helpers. Passing copied double bits into Rust is a scalar bridge, not a zero-copy canonical-slot borrow.'],
 finiteInputProof:'Finite vector components and finite dt produce finite or infinite deltas; adding a finite old component cannot produce NaN. Direction negation is finite. The comparison may transiently produce NaN after overflow times zero, but stores no NaN. This narrow guard avoids VM-specific NaN array-store policy without changing it.',
 implementationStatus:'Reviewed integration contract; no unused raw-slot Rust abstraction added. Existing Vec2Arena update is the alias-preserving arithmetic reference, not canonical VM integration.',
 qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/native-entity-slots.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceMatched:true,vmContracts:evidence.length,boxedDoubles:false,compressedPointers:false,integrated:false}));
