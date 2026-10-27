#include "hermes/VM/static_h.h"
extern bool simx_try_permanent_global_slot(SHRuntime*,const SHLegacyValue*,SHSymbolID,SHLegacyValue*);
extern SHLegacyValue __real__sh_ljs_get_by_id_rjs(SHRuntime*,const SHLegacyValue*,SHSymbolID,SHReadPropertyCacheEntry*);
SHLegacyValue __wrap__sh_ljs_get_by_id_rjs(SHRuntime *shr,const SHLegacyValue *source,SHSymbolID name,SHReadPropertyCacheEntry *cache){
  SHLegacyValue result;
  if(simx_try_permanent_global_slot(shr,source,name,&result))return result;
  // C only: no RAII, handles, shared_ptr, or NoAllocScope can cross SH longjmp.
  return __real__sh_ljs_get_by_id_rjs(shr,source,name,cache);
}
