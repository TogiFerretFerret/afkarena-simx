// Audit only: existence of root APIs is not an implemented or verified cache.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const configFile='config/native-compiler-static-hermes.json',configBytes=await readFile(resolve(root,configFile)),config=JSON.parse(configBytes);
assert.equal(config.commit,'4f1db42d71d0839254c7154fc8c282bcea466206');
const checkout='work/downloads/'+config.source.directory,inputs={},contexts={};
async function context(name,path,needle,length=1200){
 const file=checkout+'/'+path,bytes=await readFile(resolve(root,file)),text=bytes.toString('utf8');inputs[file]=sha(bytes);
 const start=text.indexOf(needle);assert.ok(start>=0,name+' source anchor missing');
 const end=Math.min(text.length,start+length),value=text.slice(start,end);
 contexts[name]={file,start,end,startLine:text.slice(0,start).split('\n').length,sha256:sha(value),text:value};return value;
}
await context('strongRootAPI','include/hermes/VM/Runtime.h','/// Add a custom function that will be executed at the start of every garbage',440);
await context('postShutdownAPI','include/hermes/VM/Runtime.h','/// Register a deleter invoked from ~Runtime() AFTER',620);
await context('registrationStorage','include/hermes/VM/Runtime.h','inline void Runtime::addCustomRootsFunction(',1050);
await context('rootPointerUpdateAPI','include/hermes/VM/RootAcceptor.h','/// When we want to call an acceptor on "raw" root pointers',530);
await context('weakRootUpdateAPI','include/hermes/VM/RootAcceptor.h','/// NOTE: This is called acceptWeak',420);
await context('runtimeCustomRootInvocation','lib/VM/Runtime.cpp','MarkRootsPhaseTimer timer(*this, RootAcceptor::Section::Custom);',620);
await context('runtimeWeakCachesAndCustomRoots','lib/VM/Runtime.cpp','void Runtime::markWeakRoots(',2100);
await context('runtimeShutdownOrdering','lib/VM/Runtime.cpp','Runtime::~Runtime() {',1150);
await context('completeMarkingRuntimeSubset','lib/VM/Runtime.cpp','void Runtime::markRootsForCompleteMarking(',600);
await context('atomicOldGenerationRoots','lib/VM/gcs/HadesGC.cpp','// Roots are marked before a marking thread is spun up',620);
await context('youngGenerationRoots','lib/VM/gcs/HadesGC.cpp','uint64_t HadesGC::youngGenEvacuateImpl(',540);
await context('stopTheWorldCompletion','lib/VM/gcs/HadesGC.cpp','void HadesGC::completeMarking() {',1800);
await context('hiddenClassTracedEdges','lib/VM/HiddenClass.cpp','void HiddenClassBuildMeta(',560);
await context('propertyMapMayMove','include/hermes/VM/HiddenClass.h','/// Property Maps',1050);
await context('dictionaryAndTypedSemantics','include/hermes/VM/HiddenClass.h','/// Dictionary Mode',1550);
await context('singlePropertyFlagMutation','lib/VM/HiddenClass.cpp','Handle<HiddenClass> HiddenClass::updateProperty(',1900);
await context('bulkPropertyFlagMutation','lib/VM/HiddenClass.cpp','Handle<HiddenClass> HiddenClass::updatePropertyFlagsWithoutTransitions(',1650);
await context('typedShapeMutatesInPlace','lib/VM/HiddenClass.cpp','SlotIndex HiddenClass::addNewTypedPublicProperty(',1400);
await context('objectParentDictionaryMutation','lib/VM/HiddenClass.cpp','HiddenClass *HiddenClass::updateObjectParentSlowPath(',1900);
await context('objectParentHistoryEdge','lib/VM/HiddenClass.cpp','// Create a new HiddenClass with the new objectParent.',500);
await context('forInCacheIncludesPrototypeShapes','lib/VM/JSObject.cpp','// Layout of a JSArray stored in the for-in cache:',1800);
const report={version:1,passed:true,implemented:false,qualifiesFor10000Target:false,kind:'Pinned native metadata-cache API and lifetime assessment',config:{file:configFile,sha256:sha(configBytes),commit:config.commit},inputs,contexts,
 correction:'GC-updated root storage APIs are available in the pinned Runtime. The earlier lookup audit described rooting as unresolved because no native cache/lifecycle proof existed; API absence is not the blocker.',
 lifecycle:[
  'One separately owned bounded context per Runtime; never share SymbolIDs, HiddenClasses or cache entries across independent runtimes.',
  'Register root callbacks on the owning mutator before any cached pointer is published. Registration appends to a std::vector and provides no deregistration token or locking; never register or alter the callback vector from inside GC.',
  'A strong-root callback can visit each occupied HiddenClass*& with RootAcceptor::acceptPtr; this permits GC to update the stored pointer in place. Invoke only the acceptor on initialized non-null entries; no JS calls, allocation, cache filling, registry lookup or callback registration inside the callback.',
  'Hades old-generation roots are scanned atomically before the background marker begins; young evacuation roots and complete marking occur during GC/STW. This supports same-mutator cache access, not arbitrary cross-thread access to one Runtime.',
  'Keep the context alive through shutdown callbacks and finalizeAll. A captured raw State* may be deleted in addPostShutdownDeleter after finalizeAll; that deleter must not allocate, call JS, trigger GC or inspect dead heap objects. The remaining callback closure must have a trivial/non-dereferencing destructor.',
  'Registration alone is not a proof for publication during concurrent marking. Runtime::markRootsForCompleteMarking does not invoke custom root callbacks. New entries must be learned from currently live handled objects with the pinned collector root/barrier discipline, then stress-tested during concurrent collections.',
  'After any operation that can allocate or invoke JS, reload cache pointers updated by GC or use proper handles. Do not retain a copied raw shape/object pointer or descriptor pointer across an allocation.'
 ],
 shapePolicy:[
  'Only cache copied slot indices, names/SymbolIDs and descriptor flag values after ordinary-object/no-Proxy/no-exotic admission. Always read current object values, including all 47 numeric clone fields, on every hit.',
  'Reject every dictionary shape, including nominally cacheable dictionary mode, because flags, parent and property maps can mutate in place. Reject typed shapes: addNewTypedPublicProperty mutates the same typed class during construction.',
  'For ordinary non-dictionary classes, property flag changes transition to a different HiddenClass. updateProperty may temporarily mutate and transfer the old propertyMap to a child and clear the old map; GC can also trim maps. Never cache DictPropertyMap or NamedPropertyDescriptor* addresses.',
  'Bulk updatePropertyFlagsWithoutTransitions converts a non-dictionary class to a new dictionary class, or mutates an existing dictionary. A previously cached ordinary class cannot be reused after the object changes to that new dictionary.',
  'Prototype changes transition ordinary shapes but mutate dictionary parents in place. Recheck the current prototype chain and all source constructor/intrinsic assumptions per hit; shape rooting does not freeze public prototypes.',
  'Recheck finite raw numeric values and original property constraints every hit. A stable shape identifies storage layout, not field values; do not memoize numbers, aliases, descriptors from other shapes or arbitrary instance objects.'
 ],
 retentionAssessment:{
  strongRootsNotMetadataOnly:true,
  findings:[
   'HiddenClassBuildMeta strongly traces objectParent, parent, propertyMap and forInCache. A shape root can therefore extend the lifetime of public prototype graphs.',
   'updateObjectParentSlowPath retains the previous class as parent. An object changed from prototype P back to Object.prototype can have a current canonical prototype while its shape ancestry still retains P.',
   'forInCache contains object/prototype HiddenClasses before property names. Stale for-in metadata can retain historical prototype-class graphs; it is not merely an array of strings.',
   'A limit of 16 shape pointers does not bound their transitive metadata or public-object retention. Canonical current prototype alone is insufficient.'
  ],
  conservativeStrongRootRequirements:[
   'Reject dictionary/typed classes and shape/prototype histories with parentChangeCounter!=0; also bind canonical intrinsic prototype chains and audit the traced ancestor/forIn-cache graph before claiming no extra public retention.',
   'A stricter alternative rejects non-null forInCache edges that cannot be proven intrinsic-only; this may reject common shapes and needs actual admission profiling.',
   'Do not claim public lifetime equivalence from shape count or current prototype checks alone.'
  ],
  weakAlternative:'The pinned Runtime already uses weak HiddenClass property-cache roots and offers addCustomWeakRootsFunction plus WeakRootAcceptor::acceptWeak. A bounded weak cache can update/clear dead shapes without retaining prototype graphs. It still needs the same lifecycle, moving-GC, null-invalidation and no-allocation-across-raw-pointer proofs.'
 },
 requiredNativeEvidence:[
  'Private-VM ABI/header/source binding and isolated actual GC stress, including young movement, old collection, concurrent marking, cache eviction and Runtime teardown.',
  'Descriptor/prototype mutations, deletion/dictionary conversion, typed/exotic/Proxy rejection, finite/nonfinite field changes and alias/reference reloads must fall back before effects or return current exact values.',
  'Native profile must first demonstrate meaningful cost and actual hit rates; then full raw battle differential checks and an uncontended matched throughput run. This audit establishes neither.'
 ],
 scope:'Source/API assessment only; no cache is installed, no C++ helper is changed, and no native lifetime/equivalence/performance result is claimed.',producer:{file:'tools/audit-native-shape-cache.mjs',sha256:sha(await readFile(resolve(root,'tools/audit-native-shape-cache.mjs')))}};
await writeFile(resolve(root,'benchmarks/validation/native-shape-cache-assessment.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,contexts:Object.keys(contexts).length,implemented:false,rootAPIsAvailable:true,strongRetentionProven:false}));
