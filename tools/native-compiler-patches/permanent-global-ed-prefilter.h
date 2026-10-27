#ifndef SIMX_PERMANENT_GLOBAL_ED_PREFILTER_H
#define SIMX_PERMANENT_GLOBAL_ED_PREFILTER_H
#include <stdint.h>
// Only an opaque, never-dereferenced runtime identity and SymbolID integers.
// The original guarded C++ bridge remains responsible for every admitted read.
typedef struct SimxGlobalEdHint {
  uintptr_t runtimeKey;
  uint32_t symbol;
  uint32_t valid;
} SimxGlobalEdHint;
#ifdef __cplusplus
extern "C" {
extern SHERMES_EXPORT thread_local SimxGlobalEdHint simx_global_ed_hint;
}
#else
extern _Thread_local SimxGlobalEdHint simx_global_ed_hint;
#endif
#endif
