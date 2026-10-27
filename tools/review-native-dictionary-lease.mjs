import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-dictionary-lease-review');
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const assessmentPath='benchmarks/validation/native-dictionary-hint-assessment.json',assessment=JSON.parse(await readFile(resolve(root,assessmentPath)));
assert.equal(assessment.passed,true);
assert.equal(sha(await readFile(resolve(root,assessment.config.file))),assessment.config.sha256);
for(const[file,expected]of Object.entries(assessment.inputs))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale VM source audit '+file);
assert.ok(assessment.contexts.uniqueInsertion);
const buildPath='benchmarks/validation/native-dictionary-lease-build.json',build=JSON.parse(await readFile(resolve(root,buildPath)));
for(const[file,expected]of Object.entries(build.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale native build '+file);
for(const header of Object.values(build.headers))assert.equal(sha(await readFile(header.original)),header.originalSha256,'Original VM header changed');
const wrapperPath='tools/native-compiler-patches/dictionary-lease-wrap.c',wrapper=await readFile(resolve(root,wrapperPath),'utf8');
assert.ok(wrapper.includes('if(simx_try_dictionary_lease(shr,source,name,&result))return result;'));
assert.ok(wrapper.includes('return __real__sh_ljs_get_by_id_rjs(shr,source,name,cache);'));
assert.ok(wrapper.indexOf('if(simx_try_dictionary_lease')<wrapper.indexOf('return __real__sh_ljs_get_by_id_rjs'));
const bridgePath='tools/native-compiler-patches/dictionary-lease-host.inc',bridge=await readFile(resolve(root,bridgePath),'utf8');
const fragments=[
 'template struct SimxDictionaryMember<SimxDictionaryPairsTag,&DictPropertyMap::getDescriptorPairs>;',
 'template struct SimxDictionaryMember<SimxDictionaryCountTag,&DictPropertyMap::numDescriptors_>;',
 'template struct SimxDictionaryMember<SimxDictionaryMapTag,&HiddenClass::propertyMap_>;',
 'auto &mapField=clazz->*simxDictionaryMember(SimxDictionaryMapTag{});',
 'auto count=(map->*simxDictionaryMember(SimxDictionaryCountTag{})).load(std::memory_order_relaxed);',
 'if(ordinal<count&&pairs[ordinal].first==symbol)',
 'auto found=DictPropertyMap::find(map,symbol);',
 'ordinal=static_cast<uint32_t>(pair-pairs);descriptor=pair->second;',
 'GCScopeMarkerRAII marker(runtime);NoAllocScope noAlloc(runtime);',
 'object->getKind()!=CellKind::JSObjectKind',
 'object->isLazy(runtime)', 'object->isProxyObject(runtime)', 'object->isHostObject(runtime)',
 '!clazz->isDictionary()||clazz->isTyped()',
 '!symbol.isValid()||!symbol.isUniqued()',
 'descriptor.flags.flagsTransition', 'descriptor.flags.accessor',
 'descriptor.flags.indexed', 'descriptor.flags.internalSetter',
 'descriptor.flags.hostObject', 'descriptor.flags.staticBuiltin',
 'descriptor.flags.proxyObject', 'descriptor.flags.privateName',
 'JSObject::getNamedSlotValueUnsafe(object,runtime,descriptor).unboxToHV(runtime)',
 'if(value.isEmpty())',
 'std::array<SimxDictionaryHintEntry,512> entries{};',
 'lease->alive=false;lease->owner=nullptr;',
 'if(simxDictionaryLease.get()==lease.get())simxDictionaryLease.reset();',
 'static thread_local std::shared_ptr<SimxDictionaryHintState> simxDictionaryLease;',
 'static SimxDictionaryHintState *simxDictionaryState(Runtime &runtime)',
 'auto *state=simxDictionaryLease.get();',
 'if(state->owner==&runtime)return state;',
 '++simxOtherRuntimeFallbacks;return nullptr;',
 'auto *state=simxDictionaryState(runtime);',
 'if(!state)return false;',
 'extern "C" SHERMES_EXPORT bool simx_dictionary_lease_release_dead()'
];
assert.equal(bridge.includes('std::weak_ptr'),false);
assert.equal(bridge.includes('.lock()'),false);
const stateStart=bridge.indexOf('static SimxDictionaryHintState *simxDictionaryState'),stateEnd=bridge.indexOf('\n}',stateStart),stateBody=bridge.slice(stateStart,stateEnd);
const fastPath=stateBody.slice(0,stateBody.indexOf('simxDictionaryLease.reset();'));
assert.ok(fastPath.includes('simxDictionaryLease.get()'));assert.ok(fastPath.includes('if(state->owner==&runtime)return state;'));assert.equal(fastPath.includes('make_shared'),false);assert.equal(fastPath.includes('auto lease='),false);
for(const fragment of fragments)assert.ok(bridge.includes(fragment),'Reviewed context changed '+fragment);
const header='class Original { int value_=17; int method_(){return value_+20;} public: int publicValue()const{return value_;} };\n';
const helper=`#include "original.h"
template<class Tag, typename Tag::type Member> struct Access {friend typename Tag::type readMember(Tag){return Member;}};
struct FieldTag {using type=int Original::*;friend type readMember(FieldTag);};
struct MethodTag {using type=int(Original::*)();friend type readMember(MethodTag);};
template struct Access<FieldTag,&Original::value_>;
template struct Access<MethodTag,&Original::method_>;
int readOriginal(Original &object){return object.*readMember(FieldTag{})+(object.*readMember(MethodTag{}))();}
`;
const main='#include "original.h"\n#include <cstdio>\nextern int readOriginal(Original&);\nint main(){Original object;std::printf("%d %d\\n",object.publicValue(),readOriginal(object));}\n';
const forbidden='#include "original.h"\nint forbidden(Original &object){return object.value_;}\n';
for(const[name,text]of Object.entries({'original.h':header,'helper.cpp':helper,'main.cpp':main,'forbidden.cpp':forbidden}))await writeFile(resolve(directory,name),text);
const args=['-std=c++17','-pedantic-errors','-Wall','-Wextra','-O2','-fno-exceptions','-fno-rtti','-ffp-contract=off'];
const binary=resolve(directory,'access-smoke');
const positiveArgs=[...args,resolve(directory,'helper.cpp'),resolve(directory,'main.cpp'),'-o',binary];
const positive=spawnSync('c++',positiveArgs,{encoding:'utf8'});assert.equal(positive.status,0,positive.stderr);
const executed=spawnSync(binary,[],{encoding:'utf8'});assert.equal(executed.status,0);assert.equal(executed.stdout,'17 54\n');
const negativeArgs=[...args,'-c',resolve(directory,'forbidden.cpp'),'-o',resolve(directory,'forbidden.o')];
const negative=spawnSync('c++',negativeArgs,{encoding:'utf8'});assert.notEqual(negative.status,0);assert.match(negative.stderr,/private/);
const version=spawnSync('c++',['--version'],{encoding:'utf8'});assert.equal(version.status,0);
const nativeProofPath='benchmarks/validation/native-dictionary-lease.json',nativeProof=JSON.parse(await readFile(resolve(root,nativeProofPath)));
assert.equal(nativeProof.passed,true);assert.equal(nativeProof.semanticProofPassed,true);assert.equal(nativeProof.noPerReadSharedRefcounts,true);assert.equal(nativeProof.sameMutatorThreadRequired,true);assert.equal(nativeProof.emptyGuardTested,true);assert.equal(nativeProof.untouchedNativeMatched,true);assert.equal(nativeProof.nodeMatched,true);assert.ok(nativeProof.iterations>=8);assert.ok(nativeProof.mutationCasesPerIteration>=20000);
assert.equal(nativeProof.buildProof.sha256,sha(await readFile(resolve(root,buildPath))));
for(const[file,expected]of Object.entries(nativeProof.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale native lease proof '+file);
const pair=nativeProof.interleavedRuntimeProof;assert.equal(pair.passed,true);assert.equal(pair.runtimes,2);assert.ok(pair.interleavedChecks>=20000);assert.ok(pair.adoptionChecks>=20000);assert.equal(pair.secondRuntimeOriginalFallback,true);assert.equal(pair.automaticShutdownRelease,true);assert.equal(pair.releaseDeadIdempotent,true);assert.equal(pair.releaseWhileAliveRejected,true);assert.equal(pair.boundedLiveContexts,1);
assert.deepEqual(pair.lifecycle.map(x=>[x.created,x.destroyed,x.liveContexts]),[[9,8,1],[9,9,0],[10,9,1],[10,10,0],[10,10,0]]);
const previousReviewPath='benchmarks/validation/native-dictionary-hint-independent-review.json';
const previousReview={commit:'639c9e3',file:previousReviewPath,sha256:sha(await readFile(resolve(root,previousReviewPath)))};
const artifact={version:1,previousReview,nativeProofReference:{file:nativeProofPath,sha256:sha(await readFile(resolve(root,nativeProofPath))),interleavedRuntimeProof:pair,iterations:nativeProof.iterations,mutationCasesPerIteration:nativeProof.mutationCasesPerIteration,emptyGuardTested:nativeProof.emptyGuardTested},passed:true,kind:'Independent dictionary TLS ownership and source-access review',scope:'This review is not the native differential proof and does not establish full-battle fidelity or speed. It checks source guard/current-map structure and original header identity, plus a separate two-translation-unit example of the C++17 explicit-instantiation private-access exemption. Original class definitions remain identical across translation units; no offset casts or header overlays. Native semantics and GC/lifecycle behavior require the separate native-dictionary-lease.json proof and actual source-reference battle gate.',reviewed:{sourceAssessment:{file:assessmentPath,sha256:sha(await readFile(resolve(root,assessmentPath))),config:assessment.config,inputs:assessment.inputs},build:{file:buildPath,sha256:sha(await readFile(resolve(root,buildPath)))},bridge:{file:bridgePath,sha256:sha(bridge)},wrapper:{file:wrapperPath,sha256:sha(wrapper)},headers:build.headers,contexts:fragments.length},findings:[
 'Only ordinary nonlazy nonProxy nonHost JSObject receivers with dictionary nonTyped current HiddenClass are eligible.',
 'Each call reloads current HiddenClass map, current descriptor count, current descriptor key, current descriptor flags and slot, and current receiver storage value.',
 'The pinned original findOrAdd insertion path preserves unique valid property keys, as recorded by the source assessment uniqueInsertion context. Ordinal hints contain only SymbolID and integer ordinal. A stale ordinal either matches the same unique current key or invokes original current-map find. No map, class, receiver or descriptor pointer survives a call.',
 'All unsupported descriptor flags and Empty values fall back. Source SmallHermesValue decoder is retained.',
 'The guarded source path performs no VM allocation or JS calls between map/key validation and value load. NoAllocScope expresses and debug-checks this requirement; it is a no-op in release builds and is not a runtime GC lock. The C trampoline invokes original SH fallback after the entire C++ bridge returns, including all RAII scopes.',
 'One thread-local owning shared_ptr lease supplies borrowed raw state pointers on reads; no weak_ptr lock or shared ownership copy occurs on the existing-owner fast path. The runtime shutdown callback marks the captured state dead and clears its opaque Runtime owner pointer. The same-thread callback clears matching TLS ownership while its captured strong lease keeps the integer state alive until the callback is destroyed. At most one cache context exists per worker thread; optional release_dead is idempotent after shutdown and rejects a live lease. A second LIVE Runtime on the same thread deliberately uses original-helper fallback and creates no additional cache context. No custom GC roots or retained GC objects are introduced.',
 'Worker scope requires each Runtime initialization, use and shutdown on the same mutator thread, with shutdown completed before that thread exits. Independent Runtime-per-worker parallelism is allowed; migration of a Runtime across threads and concurrent use of a Runtime are outside this unsynchronized cache contract.'
],accessSmoke:{compiler:version.stdout.trim(),flags:args,positive:{args:positiveArgs,status:positive.status,stderr:positive.stderr,stdout:executed.stdout,binarySha256:sha(await readFile(binary))},negative:{args:negativeArgs,status:negative.status,stderr:negative.stderr},sourceSha256:{header:sha(header),helper:sha(helper),main:sha(main),forbidden:sha(forbidden)}},source:{file:'tools/review-native-dictionary-lease.mjs',sha256:sha(await readFile(resolve(root,'tools/review-native-dictionary-lease.mjs')))},qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/native-dictionary-lease-independent-review.json'),JSON.stringify(artifact,null,2)+'\n');console.log(JSON.stringify({passed:true,contexts:fragments.length,positive:executed.stdout.trim(),negativeRejected:true}));
