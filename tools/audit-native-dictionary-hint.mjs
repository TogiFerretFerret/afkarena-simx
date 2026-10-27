// Source/design audit only. The model below is NOT a native VM or battle test.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'), sha=b=>createHash('sha256').update(b).digest('hex');
const cf='config/native-compiler-static-hermes.json',cb=await readFile(resolve(root,cf)),config=JSON.parse(cb);
assert.equal(config.commit,'4f1db42d71d0839254c7154fc8c282bcea466206');
const checkout='work/downloads/'+config.source.directory,inputs={},contexts={};
async function context(name,file,anchor,length=1000){
 const path=checkout+'/'+file,bytes=await readFile(resolve(root,path)),s=bytes.toString();inputs[path]=sha(bytes);
 const start=s.indexOf(anchor);assert.ok(start>=0,name);const text=s.slice(start,start+length);
 contexts[name]={file:path,start,startLine:s.slice(0,start).split('\n').length,sha256:sha(text),text};
}
await context('mapLayoutAndMutation','include/hermes/VM/DictPropertyMap.h','/// - an open addressing hash table',2600);
await context('opaquePositionIsHashBucket','include/hermes/VM/DictPropertyMap.h','class PropertyPos {',400);
await context('eraseInvalidatesPositions','include/hermes/VM/DictPropertyMap.h','/// Remove the property at the specified position.',300);
await context('privateDescriptorBounds','include/hermes/VM/DictPropertyMap.h','/// Total size of the descriptor array.',600);
await context('descriptorLookupRequiresValidPosition','include/hermes/VM/DictPropertyMap.h','inline DictPropertyMap::DescriptorPair *DictPropertyMap::getDescriptorPair(',700);
await context('hashProbeCost','include/hermes/VM/DictPropertyMap.h','inline std::pair<bool, DictPropertyMap::HashPair *>\nDictPropertyMap::lookupEntryFor(',1500);
await context('uniqueInsertion','lib/VM/DictPropertyMap.cpp','DictPropertyMap::findOrAdd(',2600);
await context('growthCompactsAndChecksUnique','lib/VM/DictPropertyMap.cpp','ExecutionStatus DictPropertyMap::grow(',1900);
await context('eraseChangesKeyBeforeSlotReuse','lib/VM/DictPropertyMap.cpp','void DictPropertyMap::erase(',1300);
await context('currentOwnMapAccess','include/hermes/VM/HiddenClass.h','inline OptValue<bool> HiddenClass::tryFindPropertyFast(',750);
await context('ownDescriptorDelegation','include/hermes/VM/JSObject.h','inline OptValue<bool> JSObject::tryGetOwnNamedDescriptorFast(',390);
await context('currentNamedSlotLoad','include/hermes/VM/JSObject.h','inline SmallHermesValue JSObject::getNamedSlotValueUnsafe(',1300);
await context('flags','include/hermes/VM/PropertyDescriptor.h','struct PropertyFlags {',3100);
await context('existingInlineFastpath','include/hermes/VM/static_h.h','static inline SHLegacyValue _sh_ljs_get_by_id_rjs_inline(',1450);
// Model the proposed proof obligation: an ordinal is only a hint, never identity.
// Slots, flags and value are always read from the current receiver's current map.
const deleted=Symbol('deleted'), invalid=Symbol('invalid'), accessor=16,indexed=32,privateName=2048;
const rejected=1|accessor|indexed|64|128|256|512|1024|privateName;
function hintRead(map,storage,key,hint){
 if(!Number.isInteger(hint)||hint<0||hint>=map.length)return {hit:false};
 const pair=map[hint];if(pair.key!==key||(pair.flags&rejected)!==0)return {hit:false};
 return {hit:true,value:storage[pair.slot]};
}
const fixtures=[];
function check(name,map,storage,key,hint,hit,value){const actual=hintRead(map,storage,key,hint);assert.equal(actual.hit,hit,name);if(hit)assert.ok(Object.is(actual.value,value),name);fixtures.push(name);}
check('currentValue', [{key:'k',flags:14,slot:0}],[7],'k',0,true,7);
check('sameOrdinalDifferentMapCurrentSlot', [{key:'k',flags:0,slot:2}],[1,2,-0],'k',0,true,-0);
check('sameOrdinalDifferentMapDifferentKey', [{key:'other',flags:14,slot:0}],[7],'k',0,false);
check('deletedKeyRejectsOverloadedFlags', [{key:deleted,flags:0,slot:0}],[7],'k',0,false);
check('invalidKeyRejects', [{key:invalid,flags:0,slot:0}],[7],'k',0,false);
check('compactedOrdinalMiss', [{key:'k',flags:14,slot:0}],[7],'k',1,false);
check('reinsertCurrentSlot', [{key:deleted,flags:0,slot:0},{key:'k',flags:14,slot:2}],[1,2,NaN],'k',1,true,NaN);
check('accessorMutationRejects', [{key:'k',flags:accessor,slot:0}],[7],'k',0,false);
check('indexedRejects', [{key:'k',flags:indexed,slot:0}],[7],'k',0,false);
check('privateRejects', [{key:'k',flags:privateName,slot:0}],[7],'k',0,false);
check('negativeOrdinal', [],[],'k',-1,false);
check('largeOrdinal', [],[],'k',0xffffffff,false);
let state=0x5915eabe;function rand(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
let modelCases=0;
for(let i=0;i<20000;i++){
 const length=rand()%30,map=[],storage=[];
 for(let j=0;j<length;j++){map.push({key:'k'+j,flags:(rand()%5===0)?accessor:14,slot:rand()%32});}
 for(let j=0;j<32;j++)storage.push([NaN,-0,Infinity,-Infinity,rand()/3][rand()%5]);
 const key='k'+(rand()%35),hint=rand()%35,actual=hintRead(map,storage,key,hint),found=map.find(p=>p.key===key);
 if(actual.hit){assert.ok(found);assert.equal(found.flags&rejected,0);assert.ok(Object.is(actual.value,storage[found.slot]));}
 modelCases++;
}
const report={version:1,passed:true,implemented:false,nativeTested:false,qualifiesFor10000Target:false,config:{file:cf,sha256:sha(cb),commit:config.commit},inputs,contexts,
 algorithm:'Per-runtime bounded cache of only (AOT read-site token, SymbolID, uint32 descriptor ordinal). On every probe admit ordinary nonlazy nonHost nonProxy nonTyped dictionary receiver, read its CURRENT class and CURRENT propertyMap, bounds-check ordinal against CURRENT numDescriptors_, check CURRENT key exactly equals requested valid nonprivate normal SymbolID, copy CURRENT descriptor, reject unsupported flags, load CURRENT receiver CURRENT storage CURRENT slot and decode exactly as original. Empty sentinel falls back. No inherited or missing properties are cached. Miss uses original current-map lookup to learn a new ordinal; fallback invokes original SH helper only after every C++ RAII scope has ended.',
 noHeapIdentityNeeded:'The hint need not identify a map or hidden class. Every valid map has unique valid property keys. A matching CURRENT key proves the current descriptor is the requested own property regardless of which map supplied the hint. Deletion invalidates its key; growth/compaction may move it and cause a miss; reinsertion or cross-map same-key placement can safely hit using its CURRENT descriptor and slot. Thus no weak/strong GC root, descriptor pointer, receiver pointer, map pointer, HiddenClass pointer, cached flags, cached slot or cached JS value is retained.',
 sourceChangeRequired:'Public PropertyPos is a hash-bucket position, not descriptor ordinal. Its API explicitly says erase invalidates all positions, and getDescriptorPair assumes validity before indexing. Add checked accessor methods INSIDE DictPropertyMap and HiddenClass; do not cast layouts, use private/public macro tricks or call getDescriptorPair with stale PropertyPos. Suggested non-installed patch design is tools/native-compiler-patches/dictionary-ordinal-design.inc.',
 lifecycle:'Use bounded per-runtime state, initialized on owning mutator, released after runtime shutdown. Read-site token is opaque address used only for equality; never dereference saved tokens, and never share Runtime SymbolIDs. Integer-only stale hint is semantically safe after GC or ordinal reuse but runtime ownership still avoids cross-runtime identifiers and stale state. Access current raw heap pointers only inside NoAllocScope; no JS, native allocation triggering VM GC, or original helper invocation until scopes end. No hooks in GC visitors are needed.',
 cost:'Hit removes dictionary hash probing and most generic own/prototype dispatch. It still loads receiver/class/map/count/key/flags/slot/current value and probes a bounded hint table. On first miss learn via normal hash find then derive ordinal from current descriptor array. A direct-mapped or small call-site-local hint table avoids linear scan; actual admission/hit/miss counts and unprofiled full-report matched battle timing are mandatory. No performance claim follows from this audit.',
 requiredNativeEvidence:['Private source/header/DSO ABI pinning; original live VM unchanged.','At least 20k actual native reads with same-map value replacement, changed descriptor flags, deletion/reinsertion, map growth/compaction, current-storage growth, prototype getters/Proxy traps and exact exceptions.','Signed zero, NaN payload policy as original SH decoder, infinities, object aliases, Empty/TDZ fallback and indexed/private rejection.','Forced moving young and old/concurrent GC, independent Runtime teardown/recreation and mixed maps sharing hint ordinals.','All raw source-oracle battle fields including host tape/RNG/callback counters before any rate claim.'],
 fixtures:{directed:fixtures,modelCases,scope:'Pure JS model of descriptor-hint validity only; not a JS engine differential, native cache test or battle qualification.'},producer:{file:'tools/audit-native-dictionary-hint.mjs',sha256:sha(await readFile(resolve(root,'tools/audit-native-dictionary-hint.mjs')))}};
await writeFile(resolve(root,'benchmarks/validation/native-dictionary-hint-assessment.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,contexts:Object.keys(contexts).length,directedFixtures:fixtures.length,modelCases,implemented:false,nativeTested:false,heapRootsRequired:false}));
