// Private experimental pointer-free dictionary hint. Bootstrap first includes
// original unmodified pinned headers. No class definitions or live VM edits.
#include "entity-sort-copy-host.inc"
#include "hermes/VM/IdentifierTable.h"
#include <array>
#include <atomic>
#include <memory>
#include <cstdio>
namespace hermes { namespace vm {
// C++ explicit-instantiation access exemption: access control is not applied to
// names used to specify an explicit instantiation (C++17 [temp.explicit]).
// This produces typed member pointers; no casts, offsets or class edits.
template<class Tag, typename Tag::type Member> struct SimxDictionaryMember {
 friend typename Tag::type simxDictionaryMember(Tag){return Member;}
};
struct SimxDictionaryPairsTag {
 using type=DictPropertyMap::DescriptorPair*(DictPropertyMap::*)();
 friend type simxDictionaryMember(SimxDictionaryPairsTag);
};
struct SimxDictionaryCountTag {
 using type=AtomicIfConcurrentGC<DictPropertyMap::size_type> DictPropertyMap::*;
 friend type simxDictionaryMember(SimxDictionaryCountTag);
};
struct SimxDictionaryMapTag {
 using type=GCPointer<DictPropertyMap> HiddenClass::*;
 friend type simxDictionaryMember(SimxDictionaryMapTag);
};
template struct SimxDictionaryMember<SimxDictionaryPairsTag,&DictPropertyMap::getDescriptorPairs>;
template struct SimxDictionaryMember<SimxDictionaryCountTag,&DictPropertyMap::numDescriptors_>;
template struct SimxDictionaryMember<SimxDictionaryMapTag,&HiddenClass::propertyMap_>;
static bool simxCurrentDictionaryDescriptor(HiddenClass *clazz,Runtime &runtime,
 SymbolID symbol,uint32_t &ordinal,NamedPropertyDescriptor &descriptor,bool &hintHit){
 hintHit=false;
 auto &mapField=clazz->*simxDictionaryMember(SimxDictionaryMapTag{});
 if(!mapField)return false;
 auto *map=mapField.getNonNull(runtime);
 auto count=(map->*simxDictionaryMember(SimxDictionaryCountTag{})).load(std::memory_order_relaxed);
 auto *pairs=(map->*simxDictionaryMember(SimxDictionaryPairsTag{}))();
 if(ordinal<count&&pairs[ordinal].first==symbol){descriptor=pairs[ordinal].second;hintHit=true;return true;}
 auto found=DictPropertyMap::find(map,symbol);
 if(!found)return false;
 const auto *pair=DictPropertyMap::getDescriptorPair(map,*found);
 ordinal=static_cast<uint32_t>(pair-pairs);descriptor=pair->second;return true;
}
struct SimxDictionaryHintEntry {uint32_t symbol=0,ordinal=UINT32_MAX;bool used=false;};
static std::atomic<uint64_t> simxDictionaryCreated{0},simxDictionaryDestroyed{0};
struct SimxDictionaryHintState {
 Runtime *owner;bool alive=true;
 std::array<SimxDictionaryHintEntry,512> entries{};
 uint64_t hits=0,learned=0,misses=0,rejected=0,nonDictionary=0,special=0,noOwn=0,empty=0;
 explicit SimxDictionaryHintState(Runtime *r):owner(r){++simxDictionaryCreated;}
 ~SimxDictionaryHintState(){++simxDictionaryDestroyed;}
};
static thread_local std::weak_ptr<SimxDictionaryHintState> simxDictionaryWeak;
static std::shared_ptr<SimxDictionaryHintState> simxDictionaryState(Runtime &runtime){
 auto state=simxDictionaryWeak.lock();
 if(state&&state->alive&&state->owner==&runtime)return state;
 state=std::make_shared<SimxDictionaryHintState>(&runtime);
 runtime.addPostShutdownDeleter([state](){state->alive=false;state->owner=nullptr;});
 simxDictionaryWeak=state;return state;
}
extern "C" SHERMES_EXPORT bool simx_dictionary_hint_init(SHRuntime *shr){return simxDictionaryState(getRuntime(shr))->alive;}
extern "C" SHERMES_EXPORT bool simx_try_dictionary_hint(SHRuntime *shr,const SHLegacyValue *source,SHSymbolID rawSymbol,SHLegacyValue *output){
 Runtime &runtime=getRuntime(shr);auto input=HermesValue::fromRaw(source->raw);
 if(!input.isObject())return false;
 GCScopeMarkerRAII marker(runtime);NoAllocScope noAlloc(runtime);
 auto *object=vmcast<JSObject>(input);
 if(object->getKind()!=CellKind::JSObjectKind||object->isLazy(runtime)||object->isProxyObject(runtime)||object->isHostObject(runtime))return false;
 auto *clazz=object->getClass(runtime);
 if(!clazz->isDictionary()||clazz->isTyped())return false;
 auto state=simxDictionaryState(runtime);
 auto symbol=SymbolID::unsafeCreate(rawSymbol);
 if(!symbol.isValid()||!symbol.isUniqued()){++state->special;++state->rejected;return false;}
 auto &entry=state->entries[(static_cast<uint32_t>(rawSymbol)*2654435761U)>>23];
 bool matching=entry.used&&entry.symbol==rawSymbol;
 if(!matching){entry.used=true;entry.symbol=rawSymbol;entry.ordinal=UINT32_MAX;}
 NamedPropertyDescriptor descriptor;bool ordinalHit=false;
 if(!simxCurrentDictionaryDescriptor(clazz,runtime,symbol,entry.ordinal,descriptor,ordinalHit)){
  ++state->noOwn;++state->misses;return false;
 }
 if(!descriptor.flags.isValid()||descriptor.flags.accessor||descriptor.flags.indexed||descriptor.flags.internalSetter||descriptor.flags.flagsTransition||descriptor.flags.hostObject||descriptor.flags.staticBuiltin||descriptor.flags.proxyObject||descriptor.flags.privateName){
  ++state->special;++state->rejected;return false;
 }
 // No pointers/flags/slots/values survive this call. The ordinal already passed
 // CURRENT count/key checks, and CURRENT descriptor supplies CURRENT slot.
 auto value=JSObject::getNamedSlotValueUnsafe(object,runtime,descriptor).unboxToHV(runtime);
 if(value.isEmpty()){++state->empty;++state->rejected;return false;}
 output->raw=value.getRaw();if(ordinalHit)++state->hits;else ++state->learned;
 return true;
}
// Probe-only export: temporarily install the VM Empty sentinel in one known
// data property, verify rejection without output modification, restore it before
// JS can resume. No allocation or JS call while the sentinel is installed.
extern "C" SHERMES_EXPORT bool simx_dictionary_hint_probe_empty(SHRuntime *shr){
 Runtime &runtime=getRuntime(shr);GCScope gcScope(runtime);NoAllocScope noAlloc(runtime);
 auto *object=runtime.getGlobal().get();auto *clazz=object->getClass(runtime);
 if(!clazz->isDictionary())return false;
 auto &mapField=clazz->*simxDictionaryMember(SimxDictionaryMapTag{});
 if(!mapField)return false;auto *map=mapField.getNonNull(runtime);
 auto count=(map->*simxDictionaryMember(SimxDictionaryCountTag{})).load(std::memory_order_relaxed);
 auto *pairs=(map->*simxDictionaryMember(SimxDictionaryPairsTag{}))();
 for(uint32_t i=0;i<count;i++){
  auto symbol=static_cast<SymbolID>(pairs[i].first);
  if(!symbol.isValid()||!symbol.isUniqued())continue;
  auto name=runtime.getIdentifierTable().getStringView(runtime,symbol);
  if(name.length()!=14)continue;
  const char expected[]="simxEmptyProbe";bool match=true;
  for(size_t j=0;j<14;j++)if(name[j]!=expected[j])match=false;
  if(!match)continue;
  auto descriptor=pairs[i].second;
  if(!descriptor.flags.isValid()||descriptor.flags.accessor||descriptor.flags.indexed)return false;
  auto saved=JSObject::getNamedSlotValueUnsafe(object,runtime,descriptor);
  SHLegacyValue source{runtime.getGlobal().getHermesValue().getRaw()};
  SHLegacyValue output{HermesValue::encodeTrustedNumberValue(123.25).getRaw()};auto prior=output.raw;
  JSObject::setNamedSlotValueUnsafe(object,runtime,descriptor,SmallHermesValue::encodeEmptyValue());
  bool accepted=simx_try_dictionary_hint(shr,&source,symbol.unsafeGetRaw(),&output);
  JSObject::setNamedSlotValueUnsafe(object,runtime,descriptor,saved);
  return !accepted&&output.raw==prior;
 }
 return false;
}
extern "C" SHERMES_EXPORT void simx_dictionary_hint_dump(SHRuntime *shr){auto s=simxDictionaryState(getRuntime(shr));
 std::fprintf(stderr,"dictionary_hint:{\"hits\":%llu,\"learned\":%llu,\"misses\":%llu,\"rejected\":%llu,\"special\":%llu,\"noOwn\":%llu,\"empty\":%llu}\n",(unsigned long long)s->hits,(unsigned long long)s->learned,(unsigned long long)s->misses,(unsigned long long)s->rejected,(unsigned long long)s->special,(unsigned long long)s->noOwn,(unsigned long long)s->empty);
}
extern "C" SHERMES_EXPORT void simx_dictionary_hint_lifecycle_dump(){std::fprintf(stderr,"dictionary_hint_lifecycle:{\"created\":%llu,\"destroyed\":%llu}\n",(unsigned long long)simxDictionaryCreated.load(),(unsigned long long)simxDictionaryDestroyed.load());}
}}
