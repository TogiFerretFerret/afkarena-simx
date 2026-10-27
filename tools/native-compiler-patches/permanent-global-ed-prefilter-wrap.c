#include "hermes/VM/static_h.h"
#include "permanent-global-ed-prefilter.h"
extern bool simx_try_permanent_global_slot(SHRuntime*,const SHLegacyValue*,SHSymbolID,SHLegacyValue*);
extern SHLegacyValue __real__sh_ljs_get_by_id_rjs(SHRuntime*,const SHLegacyValue*,SHSymbolID,SHReadPropertyCacheEntry*);
SHLegacyValue __wrap__sh_ljs_get_by_id_rjs(SHRuntime *shr,const SHLegacyValue *source,SHSymbolID name,SHReadPropertyCacheEntry *cache){
  const SimxGlobalEdHint *hint=&simx_global_ed_hint;
  if(hint->valid&&hint->runtimeKey==(uintptr_t)shr&&hint->symbol!=name)
    return __real__sh_ljs_get_by_id_rjs(shr,source,name,cache);
  SHLegacyValue result;
  if(simx_try_permanent_global_slot(shr,source,name,&result))return result;
  // C only: the complete C++ bridge and all RAII scopes have already returned.
  return __real__sh_ljs_get_by_id_rjs(shr,source,name,cache);
}
