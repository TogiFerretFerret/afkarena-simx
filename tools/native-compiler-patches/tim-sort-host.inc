// Private host installer: binds a NativeCallable before original unit startup.
// The original Array.prototype.sort is pristine at this boundary; all later
// JS method reads, own overrides and captured aliases follow normal VM rules.
#include "tim-sort.inc"
#include "diagnostic-sha256-host.inc"
namespace hermes { namespace vm {
CallResult<HermesValue> arrayPrototypeSort(void *,Runtime &);
static SimxSmallSort simxHostSort=nullptr;
static uint64_t simxSortCalls=0,simxSortHandled=0,simxSortFallbacks=0;
static bool simxSortStrict=true;
extern "C" SHERMES_EXPORT uint64_t simx_sort_calls(){return simxSortCalls;}
extern "C" SHERMES_EXPORT uint64_t simx_sort_hits(){return simxSortHandled;}
extern "C" SHERMES_EXPORT uint64_t simx_sort_fallbacks(){return simxSortFallbacks;}
extern "C" SHERMES_EXPORT void simx_sort_set_strict(bool strict){simxSortStrict=strict;}
static CallResult<HermesValue> simxHostSortCall(void *,Runtime &runtime){
  auto args=runtime.getCurrentFrame().getNativeArgs();simxSortCalls++;
  auto result=simxSmallSortImpl(runtime,args.getThisArg(),args.getArg(0),simxHostSort);
  if(result==ExecutionStatus::EXCEPTION){simxSortHandled++;return ExecutionStatus::EXCEPTION;}
  if(!result->isUndefined()){simxSortHandled++;return result;}
  // Admission has not called user JS. Strict mode is the default and fails
  // closed. An explicit diagnostic fallback mode calls the original native
  // builtin with the SAME current NativeArgs frame, and counts every use.
  simxSortFallbacks++;
  if(simxSortStrict)return runtime.raiseTypeError("Unsupported native TimSort admission");
  return arrayPrototypeSort(nullptr,runtime);
}
extern "C" SHERMES_EXPORT bool simx_install_v8_sort(SHRuntime *shr,SimxSmallSort sort){
  Runtime &runtime=getRuntime(shr);GCScope scope(runtime);
  if(!sort||(simxHostSort&&simxHostSort!=sort)){
    runtime.raiseTypeError("Conflicting private TimSort kernel");return false;
  }
  const auto key=Predefined::getSymbolID(Predefined::sort);
  NamedPropertyDescriptor descriptor;
  if(!JSObject::getOwnNamedDescriptor(runtime.arrayPrototype,runtime,key,descriptor)||
      descriptor.flags.accessor||!descriptor.flags.writable||
      descriptor.flags.enumerable||!descriptor.flags.configurable){
    runtime.raiseTypeError("Pristine Array.prototype.sort descriptor required");return false;
  }
  auto original=JSObject::getNamedSlotValueUnsafe(runtime.arrayPrototype.get(),runtime,descriptor).unboxToHV(runtime);
  if(!vmisa<NativeFunction>(original)||vmcast<NativeFunction>(original)->getFunctionPtr()!=arrayPrototypeSort){
    runtime.raiseTypeError("Pristine original Array.prototype.sort required");return false;
  }
  auto replacement=NativeFunction::create(runtime,nullptr,simxHostSortCall,key,1);
  DefinePropertyFlags flags;flags.setValue=1;
  auto defined=JSObject::defineOwnProperty(runtime.arrayPrototype,runtime,key,flags,replacement,PropOpFlags().plusThrowOnError());
  if(defined==ExecutionStatus::EXCEPTION||!*defined)return false;
  simxHostSort=sort;
  return true;
}
}}
