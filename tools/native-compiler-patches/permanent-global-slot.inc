// Experimental integer-only cache. This bridge never calls the original SH
// helper: the C GNU-wrap trampoline does so AFTER all C++ scopes have returned.
#include "entity-sort-copy-host.inc"
#include "hermes/VM/IdentifierTable.h"
#include <array>
#include <atomic>
#include <cstdio>
#include <memory>

namespace hermes { namespace vm {
struct SimxPermanentGlobalEntry { uint32_t symbol,slot; };
struct SimxPermanentGlobalState {
  Runtime *owner;
  bool alive=true;
  size_t used=0;
  std::array<SimxPermanentGlobalEntry,64> entries{};
  uint64_t hits=0,misses=0,rejected=0,capacity=0,notOwn=0,configurable=0;
  uint64_t special=0,noMap=0,empty=0;
  bool edSeen=false,edPresent=false;
  uint16_t edFlags=0;
  uint32_t edSlot=0,globalKind=0;
  explicit SimxPermanentGlobalState(Runtime *runtime):owner(runtime){}
  ~SimxPermanentGlobalState();
};
static std::atomic<uint64_t> simxGlobalContextsCreated{0},simxGlobalContextsDestroyed{0};
SimxPermanentGlobalState::~SimxPermanentGlobalState(){++simxGlobalContextsDestroyed;}
static thread_local std::weak_ptr<SimxPermanentGlobalState> simxGlobalWeakOwner;
static std::shared_ptr<SimxPermanentGlobalState> simxGlobalState(Runtime &runtime){
  auto state=simxGlobalWeakOwner.lock();
  if(state&&state->alive&&state->owner==&runtime)return state;
  state=std::make_shared<SimxPermanentGlobalState>(&runtime);
  ++simxGlobalContextsCreated;
  runtime.addPostShutdownDeleter([state](){state->alive=false;state->owner=nullptr;});
  simxGlobalWeakOwner=state;
  return state;
}
extern "C" SHERMES_EXPORT bool simx_global_slot_init(SHRuntime *shr){
  auto state=simxGlobalState(getRuntime(shr));return state->alive;
}
extern "C" SHERMES_EXPORT bool simx_try_permanent_global_slot(
    SHRuntime *shr,const SHLegacyValue *source,SHSymbolID rawSymbol,
    SHLegacyValue *output){
  Runtime &runtime=getRuntime(shr);
  auto input=HermesValue::fromRaw(source->raw);
  // No state lookup, handle, descriptor operation or JS effect for other objects.
  if(!input.isObject()||input.getRaw()!=runtime.getGlobal().getHermesValue().getRaw())return false;
  auto state=simxGlobalState(runtime);
  GCScopeMarkerRAII marker(runtime);
  NoAllocScope noAlloc(runtime);
  auto *global=runtime.getGlobal().get();
  state->globalKind=static_cast<uint32_t>(global->getKind());
  if(global->getKind()!=CellKind::JSObjectKind||global->isLazy(runtime)||
      global->isProxyObject(runtime)||global->isHostObject(runtime)||global->getClass(runtime)->isTyped()){
    ++state->special;++state->rejected;return false;
  }
  for(size_t i=0;i<state->used;i++)if(state->entries[i].symbol==rawSymbol){
    // No descriptor/class/storage pointer is retained. Load through CURRENT
    // runtime global and CURRENT property storage, using the normal SH decoder.
    auto value=JSObject::getNamedSlotValueUnsafe(global,runtime,state->entries[i].slot).unboxToHV(runtime);
    if(value.isEmpty()){++state->empty;++state->rejected;return false;}
    output->raw=value.getRaw();++state->hits;return true;
  }
  ++state->misses;
  auto symbol=SymbolID::unsafeCreate(rawSymbol);
  if(!symbol.isValid()||!symbol.isUniqued()){++state->special;++state->rejected;return false;}
  auto name=runtime.getIdentifierTable().getStringView(runtime,symbol);
  // Conservative normal identifier names only. Numeric/index-like names and
  // symbols/private names are outside this initial experiment.
  if(name.empty()||!((name[0]>='A'&&name[0]<='Z')||(name[0]>='a'&&name[0]<='z')||name[0]=='_'||name[0]=='$')){
    ++state->special;++state->rejected;return false;
  }
  NamedPropertyDescriptor descriptor;
  auto own=JSObject::tryGetOwnNamedDescriptorFast(global,runtime,symbol,descriptor);
  const bool ed=name.length()==2&&name[0]=='e'&&name[1]=='d';
  if(ed&&!state->edSeen){
    state->edSeen=true;state->edPresent=own.hasValue()&&own.getValue();
    if(state->edPresent){state->edFlags=descriptor.flags._flags;state->edSlot=descriptor.slot;}
  }
  if(!own.hasValue()){++state->noMap;++state->rejected;return false;}
  if(!own.getValue()){++state->notOwn;++state->rejected;return false;}
  if(descriptor.flags.configurable){++state->configurable;++state->rejected;return false;}
  if(descriptor.flags.accessor||descriptor.flags.indexed||descriptor.flags.hostObject||
      descriptor.flags.proxyObject||descriptor.flags.privateName||descriptor.flags.internalSetter||
      descriptor.flags.staticBuiltin||!descriptor.flags.isValid()){
    ++state->special;++state->rejected;return false;
  }
  auto value=JSObject::getNamedSlotValueUnsafe(global,runtime,descriptor).unboxToHV(runtime);
  if(value.isEmpty()){++state->empty;++state->rejected;return false;}
  if(state->used==state->entries.size()){++state->capacity;++state->rejected;return false;}
  state->entries[state->used++]={rawSymbol,descriptor.slot};
  output->raw=value.getRaw();return true;
}
extern "C" SHERMES_EXPORT void simx_global_slot_dump(SHRuntime *shr){
  auto state=simxGlobalState(getRuntime(shr));
  std::fprintf(stderr,"global_slot_cache:{\"hits\":%llu,\"misses\":%llu,\"rejected\":%llu,\"capacityRejected\":%llu,\"notOwn\":%llu,\"configurable\":%llu,\"special\":%llu,\"noMap\":%llu,\"empty\":%llu,\"entries\":%zu,\"globalKind\":%u,\"edSeen\":%s,\"edPresent\":%s,\"edFlags\":%u,\"edSlot\":%u}\n",
    (unsigned long long)state->hits,(unsigned long long)state->misses,(unsigned long long)state->rejected,
    (unsigned long long)state->capacity,(unsigned long long)state->notOwn,(unsigned long long)state->configurable,
    (unsigned long long)state->special,(unsigned long long)state->noMap,(unsigned long long)state->empty,
    state->used,state->globalKind,state->edSeen?"true":"false",state->edPresent?"true":"false",state->edFlags,state->edSlot);
}
extern "C" SHERMES_EXPORT void simx_global_slot_lifecycle_dump(){
  std::fprintf(stderr,"global_slot_lifecycle:{\"created\":%llu,\"destroyed\":%llu}\n",
    (unsigned long long)simxGlobalContextsCreated.load(),(unsigned long long)simxGlobalContextsDestroyed.load());
}
}}
