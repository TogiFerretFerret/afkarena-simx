// Diagnostic GNU-linker wrapper. No VM value, heap pointer, handle or cache
// pointer survives the counting scope. The original may SH-longjmp, so no C++
// RAII object is alive when __real__sh_ljs_get_by_id_rjs executes.
#include "hermes/VM/StaticHUtils.h"
#include "hermes/VM/JSObject.h"
#include <algorithm>
#include <cstdio>
#include <cinttypes>
#include <dlfcn.h>
#include <unordered_map>
#include <vector>
using namespace hermes::vm;

namespace {
constexpr size_t capacity=1u<<19;
struct Row {
  uintptr_t caller=0;
  uint64_t count=0;
  uint32_t symbol=0;
  uint16_t kind=0,classFlags=0;
  uint8_t cacheFlags=0,changes=0;
};
static Row rows[capacity];
static uint64_t total=0,overflow=0;
static size_t occupied=0;
// cache flags: present, class populated, negative class populated, own match,
// negative receiver match, immediate prototype match, property-map present.
static void count(SHRuntime *shr,const SHLegacyValue *source,SHSymbolID symbol,
                  SHReadPropertyCacheEntry *cache,uintptr_t caller){
  Runtime &runtime=getRuntime(shr);NoAllocScope noAlloc(runtime);
  Row key;key.symbol=symbol;key.caller=caller;
  if(cache){key.cacheFlags=1|(cache->clazz?2:0)|(cache->negMatchClazz?4:0);
    key.changes=cache->numChanges==0?0:cache->numChanges==1?1:cache->numChanges<5?2:
      cache->numChanges<16?3:cache->numChanges<64?4:cache->numChanges<255?5:6;}
  auto value=HermesValue::fromRaw(source->raw);
  if(value.isObject()){
    auto *object=vmcast<JSObject>(value);key.kind=static_cast<uint16_t>(object->getKind());
    auto *mirror=reinterpret_cast<SHJSObject *>(object);
    SHCompressedPointer classPointer{mirror->clazz};
    auto *clazz=reinterpret_cast<SHHiddenClass *>(_sh_cp_decode_non_null(shr,classPointer));
    key.classFlags=clazz->flags;
    if(clazz->propertyMap)key.cacheFlags|=64;
    if(cache){
      if(cache->clazz==mirror->clazz)key.cacheFlags|=8;
      if(cache->negMatchClazz==mirror->clazz){
        key.cacheFlags|=16;
        if(clazz->objectParent){
          SHCompressedPointer parentPointer{clazz->objectParent};
          auto *parent=reinterpret_cast<SHJSObject *>(_sh_cp_decode_non_null(shr,parentPointer));
          if(cache->clazz==parent->clazz)key.cacheFlags|=32;
        }
      }
    }
  }else key.kind=value.isNumber()?256:value.isString()?257:value.isUndefined()?258:
    value.isNull()?259:value.isBool()?260:value.isSymbol()?261:value.isBigInt()?262:263;
  uint64_t hash=key.symbol*UINT64_C(0x9e3779b97f4a7c15)^key.caller;
  hash^=static_cast<uint64_t>(key.kind)<<17;hash^=static_cast<uint64_t>(key.classFlags)<<33;
  hash^=static_cast<uint64_t>(key.cacheFlags)<<49;hash^=static_cast<uint64_t>(key.changes)<<57;
  hash^=hash>>30;hash*=UINT64_C(0xbf58476d1ce4e5b9);hash^=hash>>27;
  ++total;
  for(size_t probe=0;probe<capacity;probe++){
    Row &row=rows[(hash+probe)&(capacity-1)];
    if(!row.count){row=key;row.count=1;++occupied;return;}
    if(row.symbol==key.symbol&&row.caller==key.caller&&row.kind==key.kind&&
       row.classFlags==key.classFlags&&row.cacheFlags==key.cacheFlags&&row.changes==key.changes){++row.count;return;}
  }
  ++overflow;
}
static const char *kindName(unsigned kind){switch(kind){
#define CELL_KIND(name) case static_cast<unsigned>(CellKind::name##Kind):return #name;
#define SHARED_CELL_KIND(name) case static_cast<unsigned>(CellKind::name##Kind):return #name;
#include "hermes/VM/CellKinds.def"
  case 256:return "primitive:Number";case 257:return "primitive:String";
  case 258:return "primitive:Undefined";case 259:return "primitive:Null";
  case 260:return "primitive:Boolean";case 261:return "primitive:Symbol";
  case 262:return "primitive:BigInt";default:return "primitive:Other";}}
struct Name {const SHUnit *unit;uint32_t offset,length;bool utf16;};
static void printName(const Name &name){
  std::fputc('"',stderr);
  const auto length=std::min<uint32_t>(name.length,256);
  for(uint32_t i=0;i<length;i++){
    unsigned value=name.utf16?name.unit->u16_pool[name.offset+i]:static_cast<unsigned char>(name.unit->ascii_pool[name.offset+i]);
    if(value=='"'||value=='\\'){std::fputc('\\',stderr);std::fputc(value,stderr);}
    else if(value<32||value>=127)std::fprintf(stderr,"\\u%04x",value);
    else std::fputc(value,stderr);
  }
  std::fputc('"',stderr);
}
}

extern "C" uint64_t simx_measured_clock_calls(void);
extern "C" SHLegacyValue __real__sh_ljs_get_by_id_rjs(SHRuntime *,const SHLegacyValue *,SHSymbolID,SHReadPropertyCacheEntry *);
extern "C" SHLegacyValue __wrap__sh_ljs_get_by_id_rjs(SHRuntime *shr,const SHLegacyValue *source,SHSymbolID symbol,SHReadPropertyCacheEntry *cache){
  if(simx_measured_clock_calls()==1)
    count(shr,source,symbol,cache,reinterpret_cast<uintptr_t>(__builtin_return_address(0)));
  // count() has returned: NoAllocScope and all C++ scopes are destroyed here.
  return __real__sh_ljs_get_by_id_rjs(shr,source,symbol,cache);
}
extern "C" void simx_dump_get_by_id(SHRuntime *shr){
  // Names come from immutable AOT unit pools and their populated SymbolID
  // arrays. No string materialization, IdentifierTable handles, VM allocation,
  // source getter or native hidden symbol is needed. Unknown IDs stay numeric.
  std::unordered_map<uint32_t,Name> names;
  for(size_t i=0;i<sizeof(shr->units)/sizeof(shr->units[0]);i++)if(const auto *unit=shr->units[i])
    for(uint32_t j=0;j<unit->num_symbols;j++){
      const auto offset=unit->strings[j*3],length=unit->strings[j*3+1];
      names.emplace(unit->symbols[j],Name{unit,offset&0x7fffffff,length,(offset&0x80000000)!=0});
    }
  std::vector<const Row *> ordered;ordered.reserve(occupied);
  for(const auto &row:rows)if(row.count)ordered.push_back(&row);
  std::sort(ordered.begin(),ordered.end(),[](const Row *a,const Row *b){if(a->count!=b->count)return a->count>b->count;if(a->symbol!=b->symbol)return a->symbol<b->symbol;return a->caller<b->caller;});
  Dl_info image{};
  const bool imageKnown=dladdr(reinterpret_cast<void *>(&simx_dump_get_by_id),&image)!=0;
  const uintptr_t imageBase=imageKnown?reinterpret_cast<uintptr_t>(image.dli_fbase):0;
  std::fprintf(stderr,"get_by_id_histogram:{\"version\":1,\"calls\":%" PRIu64 ",\"overflow\":%" PRIu64 ",\"imageBase\":\"0x%" PRIxPTR "\",\"rows\":[",total,overflow,imageBase);
  bool first=true;
  for(const auto *row:ordered){
    std::fprintf(stderr,"%s{\"symbol\":%u,\"name\":",first?"":",",row->symbol);first=false;
    const auto name=names.find(row->symbol);if(name==names.end())std::fputs("null",stderr);else printName(name->second);
    std::fprintf(stderr,",\"nameTruncated\":%s,\"kind\":\"%s\",\"kindId\":%u,\"classFlags\":%u,\"cacheFlags\":%u,\"changesBucket\":%u,\"caller\":\"0x%" PRIxPTR "\",\"callerOffset\":\"0x%" PRIxPTR "\",\"count\":%" PRIu64 "}",name!=names.end()&&name->second.length>256?"true":"false",kindName(row->kind),row->kind,row->classFlags,row->cacheFlags,row->changes,row->caller,row->caller-imageBase,row->count);
  }
  std::fputs("]}\n",stderr);std::fflush(stderr);
}
