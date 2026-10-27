// Source audit of a potential permanent OWN data-slot cache, not a cache itself.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const configFile='config/native-compiler-static-hermes.json',configBytes=await readFile(resolve(root,configFile)),config=JSON.parse(configBytes);
assert.equal(config.commit,'4f1db42d71d0839254c7154fc8c282bcea466206');
const checkout='work/downloads/'+config.source.directory,inputs={},contexts={};
async function context(name,path,needle,length=1300){
 const file=checkout+'/'+path,bytes=await readFile(resolve(root,file)),text=bytes.toString('utf8');inputs[file]=sha(bytes);
 const start=text.indexOf(needle);assert.ok(start>=0,name+' anchor missing');const end=Math.min(text.length,start+length),value=text.slice(start,end);
 contexts[name]={file,start,end,startLine:text.slice(0,start).split('\n').length,sha256:sha(value),text:value};return value;
}
await context('physicalGlobalCreatedOnce','lib/VM/Runtime.cpp','  global_ =',180);
await context('scriptGlobalDeclaration','lib/VM/StaticH.cpp','extern "C" void _sh_ljs_declare_global_var(',1200);
await context('globalPrototypeImmutable','lib/VM/JSObject.cpp','// ES2022 10.4.7 Immutable Prototype Exotic Objects',980);
await context('nonconfigurableDeletionRejected','lib/VM/JSObject.cpp','  // If the property isn\'t configurable, fail.',1050);
await context('nonconfigurableTypeConversionRejected','lib/VM/JSObject.cpp','  // 8.12.9 [7]',2600);
await context('privilegedOverrideEscape','lib/VM/JSObject.cpp','  // The InternalForce() flag indicate',450);
await context('actualPrivilegedOverrideCaller','lib/VM/JSArrayBuffer.cpp','void JSArrayBuffer::setExternalFinalizer(',900);
await context('dictionaryGrowPreservesLiveSlot','lib/VM/DictPropertyMap.cpp','    dst->second = src->second;',520);
await context('dictionaryGrowPreservesDeletedSlot','lib/VM/DictPropertyMap.cpp','      dst->second.slot = src->second.slot;',500);
await context('deleteOnlyFreelistsDeletedSlot','lib/VM/DictPropertyMap.cpp','void DictPropertyMap::erase(',1100);
await context('allocateOnlyReusesDeletedSlot','lib/VM/DictPropertyMap.cpp','SlotIndex DictPropertyMap::allocatePropertySlot(',1100);
await context('dictionaryConversionMovesMap','lib/VM/HiddenClass.cpp','Handle<HiddenClass> HiddenClass::copyToNewDictionary(',1800);
await context('deletionChangesOnlyDeletedProperty','lib/VM/HiddenClass.cpp','Handle<HiddenClass> HiddenClass::deleteProperty(',1100);
await context('dictionaryAddUsesFreelist','lib/VM/HiddenClass.cpp','CallResult<std::pair<Handle<HiddenClass>, SlotIndex>> HiddenClass::addProperty(',1600);
await context('mapReconstructionInsertionSlots','lib/VM/HiddenClass.cpp','  // Add the collected entries in reverse order.',1100);
await context('namedStorageGrowth','lib/VM/JSObject.cpp','ExecutionStatus JSObject::allocateNewSlotStorage(',3100);
await context('storageResizeDoesNotShift','include/hermes/VM/ArrayStorage.h','  static ExecutionStatus resize(',1050);
await context('genericStorageCanShiftExcluded','lib/VM/ArrayStorage.cpp','ExecutionStatus ArrayStorageBase<HVType>::resizeLeft(',920);
await context('storageGrowthCopiesMatchingIndices','lib/VM/ArrayStorage.cpp','ExecutionStatus ArrayStorageBase<HVType>::reallocateToLarger(',1850);
await context('storageGcTrimDisabled','lib/VM/ArrayStorage.cpp','    // ArrayStorage trimming is disabled for now.',370);
await context('gcPreservesCellLayout','lib/VM/gcs/HadesGC.cpp','    // Copy the contents of the existing cell over',480);
await context('currentNamedSlotRead','include/hermes/VM/JSObject.h','inline SmallHermesValue JSObject::getNamedSlotValueUnsafe(',1100);
await context('ordinaryReadUsesSameDecoder','lib/VM/StaticH.cpp','      return JSObject::getNamedSlotValueUnsafe(obj, runtime, desc)',220);
await context('staticUnitRootsSymbols','lib/VM/StaticHUnit.cpp','void hermes::vm::sh_unit_mark_roots(',670);
await context('descriptorFlagKinds','include/hermes/VM/PropertyDescriptor.h','struct PropertyFlags {',2500);
await context('ordinaryReadCacheShapeDependency','include/hermes/VM/PropertyCache.h','struct ReadPropertyCacheEntry {',1200);

const directed=[];
function check(name,code,predicate){const realm=vm.createContext(vm.constants.DONT_CONTEXTIFY),result=vm.runInContext(code,realm);predicate(result);directed.push({name,passed:true,result});}
check('permanent_data_survives_unrelated_growth_and_deletes',`Object.defineProperty(globalThis,'permanent',{value:1,writable:true,configurable:false});for(let i=0;i<1000;i++)globalThis['temp'+i]=i;for(let i=0;i<1000;i+=2)delete globalThis['temp'+i];permanent=2;({value:permanent,configurable:Object.getOwnPropertyDescriptor(globalThis,'permanent').configurable,deleted:delete globalThis.permanent});`,r=>{assert.equal(r.value,2);assert.equal(r.configurable,false);assert.equal(r.deleted,false);});
check('nonconfigurable_data_cannot_become_getter',`Object.defineProperty(globalThis,'permanent',{value:1,writable:true,configurable:false});let rejected=false;try{Object.defineProperty(globalThis,'permanent',{get(){return 9;}})}catch(e){rejected=e instanceof TypeError;}({rejected,value:permanent});`,r=>{assert.equal(r.rejected,true);assert.equal(r.value,1);});
check('current_value_and_identity_must_be_read',`Object.defineProperty(globalThis,'permanent',{value:{old:true},writable:true,configurable:false});const old=permanent;permanent={new:true};({same:old===permanent,current:permanent.new});`,r=>{assert.equal(r.same,false);assert.equal(r.current,true);});
check('writable_can_become_false_without_changing_reads',`Object.defineProperty(globalThis,'permanent',{value:-0,writable:true,configurable:false});Object.defineProperty(globalThis,'permanent',{writable:false});Reflect.set(globalThis,'permanent',7);({negativeZero:Object.is(permanent,-0),writable:Object.getOwnPropertyDescriptor(globalThis,'permanent').writable});`,r=>{assert.equal(r.negativeZero,true);assert.equal(r.writable,false);});
check('configurable_property_is_not_permanent',`Object.defineProperty(globalThis,'volatile',{value:1,writable:true,configurable:true});const old=volatile;delete globalThis.volatile;globalThis.other=2;({old,present:Object.hasOwn(globalThis,'volatile'),current:globalThis.volatile,other});`,r=>{assert.equal(r.old,1);assert.equal(r.present,false);assert.equal(r.current,undefined);assert.equal(r.other,2);});

const report={version:1,passed:true,implemented:false,qualifiesFor10000Target:false,kind:'Pinned permanent-global named-slot stability assessment',config:{file:configFile,sha256:sha(configBytes),commit:config.commit},inputs,contexts,directed,
 conclusion:'The audited ordinary named-property paths preserve a surviving nonconfigurable own data property\'s integer slot. No named-storage compaction/reindex operation was found in these pinned paths. This supports a narrowly guarded native experiment, not immediate activation or general object-layout caching.',
 proofChain:[
  'Runtime creates its physical global once. Cache ownership must be per Runtime; each call compares the actual receiver with the current runtime.getGlobal() root. A globalThis property reassignment does not replace this physical object.',
  'An initially real OWN nonconfigurable named DATA descriptor cannot be deleted or converted to an accessor by normal JS operations. Writable may become false and current values may change; both remain correct when every read fetches the current slot value.',
  'Only successful deletion puts a property slot on the dictionary freelist. Since the target cannot be deleted, later property additions cannot reuse its slot.',
  'DictPropertyMap growth compacts descriptor positions but copies each live descriptor.slot unchanged. Descriptor index and property slot are different; cache only the latter.',
  'Non-dictionary property-map rebuilding recovers first insertion-order slots; flag transitions update existing entries without allocating new slots. Dictionary conversion transfers the property map rather than renumbering values.',
  'Ordinary named storage grows using resize/reallocate with fromFirst=toFirst=0, preserving existing indices. Generic ArrayStorage resizeLeft DOES shift entries, but is not used by the audited named-property storage paths.',
  'Moving GC copies object/storage contents and updates pointers. It does not renumber named slots; ArrayStorage GC trimming is disabled in this pinned build. A reader must reload the physical global and current indirect storage, never a cached object/storage address.',
  'The ordinary source read already uses getNamedSlotValueUnsafe(...).unboxToHV(runtime). A fast read must use that exact representation/decoder, preserving signed zero, NaN bits, undefined and object identity without arithmetic or cached values.'
 ],
 admission:[
  'The first miss must establish a REAL own named descriptor on the actual runtime global, with configurable=false and accessor=false. Do not infer permanence merely from a var declaration or property name.',
  'Restrict to ordinary JSObject global receiver; reject lazy, Proxy, HostObject, typed/exotic and indexed/synthetic descriptors. Start with normal compiled string SymbolIDs; reject private names and unsupported special flags.',
  'Use a bounded per-Runtime table of SymbolID plus SlotIndex integers only. Compiled Unit symbol IDs remain rooted by registered units; do not reuse IDs across runtimes or cache any GC pointer.',
  'Load the CURRENT value every hit using the current runtime global and its current storage. Never freeze the binding or memoize an ed/cc/value pointer. Fail back for internal Empty/uninitialized sentinels and unsupported representation.',
  'Default generic behavior must run exactly once on non-global, configurable, accessor, inherited, missing or otherwise unsupported inputs. Admission itself must be getter-free.',
  'Keep integer-cache ownership alive for the Runtime and clear/remove per-Runtime registration at teardown to avoid address-reuse collisions. No custom GC root callback is needed if the cache truly contains no heap references.'
 ],
 exclusions:[
  'Privileged InternalForce bypasses ordinary descriptor validation. Its pinned VM caller found here is ArrayBuffer external-finalizer setup, not a global mutation. Untrusted/future native embedders, debugger machinery or custom internal global storage rewrites are outside this proof unless explicitly invalidated.',
  'This does not justify slot-only caching of configurable properties, arbitrary object instances, arrays/typed storage, inherited reads or properties that can be deleted.',
  'This is a source audit plus five standard semantic fixtures, not an actual native slot-cache stress result. Runtime/header ABI, native dictionary churn, storage growth, GC movement, read-only transitions, malformed admission and full battle/report equality must be tested before any promotion.',
  'Native profile/histogram evidence must establish actual permanent-global eligibility and meaningful cost. Existing configurable/global setup can make a candidate property ineligible; no ed/cc admission rate is assumed.'
 ],producer:{file:'tools/audit-native-global-slot.mjs',sha256:sha(await readFile(resolve(root,'tools/audit-native-global-slot.mjs')))}};
await writeFile(resolve(root,'benchmarks/validation/native-global-slot-assessment.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,contexts:Object.keys(contexts).length,directed:directed.length,implemented:false,eligibleForNativeExperiment:true}));
