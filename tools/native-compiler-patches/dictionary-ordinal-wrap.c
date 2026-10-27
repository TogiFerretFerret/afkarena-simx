#include "hermes/VM/static_h.h"
extern bool simx_try_dictionary_hint(SHRuntime*,const SHLegacyValue*,SHSymbolID,SHLegacyValue*);
extern SHLegacyValue __real__sh_ljs_get_by_id_rjs(SHRuntime*,const SHLegacyValue*,SHSymbolID,SHReadPropertyCacheEntry*);
SHLegacyValue __wrap__sh_ljs_get_by_id_rjs(SHRuntime *shr,const SHLegacyValue *source,SHSymbolID name,SHReadPropertyCacheEntry *cache){
 SHLegacyValue result;
 if(simx_try_dictionary_hint(shr,source,name,&result))return result;
 // All C++ frames/scopes have returned before an original SH longjmp.
 return __real__sh_ljs_get_by_id_rjs(shr,source,name,cache);
}
