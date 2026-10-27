import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-dictionary-hint-review');
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const assessmentPath='benchmarks/validation/native-dictionary-hint-assessment.json',assessment=JSON.parse(await readFile(resolve(root,assessmentPath)));
assert.equal(assessment.passed,true);
assert.equal(sha(await readFile(resolve(root,assessment.config.file))),assessment.config.sha256);
for(const[file,expected]of Object.entries(assessment.inputs))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale VM source audit '+file);
assert.ok(assessment.contexts.uniqueInsertion);
const buildPath='benchmarks/validation/native-dictionary-hint-build.json',build=JSON.parse(await readFile(resolve(root,buildPath)));
for(const[file,expected]of Object.entries(build.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale native build '+file);
for(const header of Object.values(build.headers))assert.equal(sha(await readFile(header.original)),header.originalSha256,'Original VM header changed');
const wrapperPath='tools/native-compiler-patches/dictionary-ordinal-wrap.c',wrapper=await readFile(resolve(root,wrapperPath),'utf8');
assert.ok(wrapper.includes('if(simx_try_dictionary_hint(shr,source,name,&result))return result;'));
assert.ok(wrapper.includes('return __real__sh_ljs_get_by_id_rjs(shr,source,name,cache);'));
assert.ok(wrapper.indexOf('if(simx_try_dictionary_hint')<wrapper.indexOf('return __real__sh_ljs_get_by_id_rjs'));
const bridgePath='tools/native-compiler-patches/dictionary-ordinal-host.inc',bridge=await readFile(resolve(root,bridgePath),'utf8');
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
 'runtime.addPostShutdownDeleter([state](){state->alive=false;state->owner=nullptr;});'
];
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
const artifact={version:1,passed:true,kind:'Independent source review and C++ access-language smoke check',scope:'This review is not the native differential proof and does not establish full-battle fidelity or speed. It checks source guard/current-map structure and original header identity, plus a separate two-translation-unit example of the C++17 explicit-instantiation private-access exemption. Original class definitions remain identical across translation units; no offset casts or header overlays. Native semantics and GC/lifecycle behavior require the separate native-dictionary-hint.json proof and actual source-reference battle gate.',reviewed:{sourceAssessment:{file:assessmentPath,sha256:sha(await readFile(resolve(root,assessmentPath))),config:assessment.config,inputs:assessment.inputs},build:{file:buildPath,sha256:sha(await readFile(resolve(root,buildPath)))},bridge:{file:bridgePath,sha256:sha(bridge)},wrapper:{file:wrapperPath,sha256:sha(wrapper)},headers:build.headers,contexts:fragments.length},findings:[
 'Only ordinary nonlazy nonProxy nonHost JSObject receivers with dictionary nonTyped current HiddenClass are eligible.',
 'Each call reloads current HiddenClass map, current descriptor count, current descriptor key, current descriptor flags and slot, and current receiver storage value.',
 'The pinned original findOrAdd insertion path preserves unique valid property keys, as recorded by the source assessment uniqueInsertion context. Ordinal hints contain only SymbolID and integer ordinal. A stale ordinal either matches the same unique current key or invokes original current-map find. No map, class, receiver or descriptor pointer survives a call.',
 'All unsupported descriptor flags and Empty values fall back. Source SmallHermesValue decoder is retained.',
 'The guarded source path performs no VM allocation or JS calls between map/key validation and value load. NoAllocScope expresses and debug-checks this requirement; it is a no-op in release builds and is not a runtime GC lock. The C trampoline invokes original SH fallback after the entire C++ bridge returns, including all RAII scopes.',
 'Runtime-owned shutdown lease keeps integer state alive through VM finalization and releases it afterward; no custom roots or VM object retention are introduced.'
],accessSmoke:{compiler:version.stdout.trim(),flags:args,positive:{args:positiveArgs,status:positive.status,stderr:positive.stderr,stdout:executed.stdout,binarySha256:sha(await readFile(binary))},negative:{args:negativeArgs,status:negative.status,stderr:negative.stderr},sourceSha256:{header:sha(header),helper:sha(helper),main:sha(main),forbidden:sha(forbidden)}},source:{file:'tools/review-native-dictionary-hint.mjs',sha256:sha(await readFile(resolve(root,'tools/review-native-dictionary-hint.mjs')))},qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/native-dictionary-hint-independent-review.json'),JSON.stringify(artifact,null,2)+'\n');console.log(JSON.stringify({passed:true,contexts:fragments.length,positive:executed.stdout.trim(),negativeRejected:true}));
