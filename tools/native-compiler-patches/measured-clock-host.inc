// Profiling-only composition: game Date/clock behavior remains unchanged.
#include "entity-sort-copy-host.inc"
#include <time.h>
#include <cstdio>
namespace hermes { namespace vm {
CallResult<HermesValue> dateNow(void *,Runtime &);
static Runtime *simxMeasuredClockRuntime=nullptr;
static uint64_t simxMeasuredClockCalls=0;
static CallResult<HermesValue> simxMeasuredClock(void *,Runtime &runtime){
  if(&runtime!=simxMeasuredClockRuntime||simxMeasuredClockCalls>=2)
    return runtime.raiseTypeError("Measured profiler clock requires exactly two calls in one runtime");
  if(runtime.getCurrentFrame().getNativeArgs().getArgCount()!=0)
    return runtime.raiseTypeError("Measured profiler clock does not accept arguments");
  struct timespec value;
  if(clock_gettime(CLOCK_MONOTONIC,&value)!=0||value.tv_sec<0||value.tv_nsec<0||value.tv_nsec>=1000000000)
    return runtime.raiseTypeError("CLOCK_MONOTONIC is unavailable");
  const uint64_t ns=static_cast<uint64_t>(value.tv_sec)*1000000000ULL+static_cast<uint64_t>(value.tv_nsec);
  ++simxMeasuredClockCalls;
  std::fprintf(stderr,"simx_measure_%s_ns:%llu\n",simxMeasuredClockCalls==1?"start":"end",static_cast<unsigned long long>(ns));
  std::fflush(stderr);
  return HermesValue::encodeUntrustedNumberValue(static_cast<double>(ns)/1000000.0);
}
extern "C" SHERMES_EXPORT bool simx_install_measured_clock(SHRuntime *shr){
  Runtime &runtime=getRuntime(shr);GCScope scope(runtime);
  if(simxMeasuredClockRuntime){runtime.raiseTypeError("Measured profiler clock is already installed");return false;}
  auto *global=runtime.getGlobal().get();
  if(global->isProxyObject(runtime)||global->isHostObject(runtime)){runtime.raiseTypeError("Unsupported measured clock global");return false;}
  auto key=runtime.getIdentifierTable().getSymbolHandle(runtime,ASCIIRef("__nativeWallNow",15));
  if(key==ExecutionStatus::EXCEPTION)return false;
  NamedPropertyDescriptor descriptor;
  auto found=JSObject::tryGetOwnNamedDescriptorFast(global,runtime,**key,descriptor);
  if(!found.hasValue()||!found.getValue()||descriptor.flags.accessor||!descriptor.flags.writable){runtime.raiseTypeError("Measured clock requires an own writable data binding");return false;}
  auto original=JSObject::getNamedSlotValueUnsafe(global,runtime,descriptor).unboxToHV(runtime);
  if(!vmisa<NativeFunction>(original)||vmcast<NativeFunction>(original)->getFunctionPtr()!=dateNow){runtime.raiseTypeError("Measured clock requires the original Date.now binding");return false;}
  auto callback=NativeFunction::create(runtime,nullptr,simxMeasuredClock,Predefined::getSymbolID(Predefined::now),0);
  DefinePropertyFlags flags;flags.setValue=1;
  auto installed=JSObject::defineOwnProperty(runtime.getGlobal(),runtime,**key,flags,callback,PropOpFlags().plusThrowOnError());
  if(installed==ExecutionStatus::EXCEPTION||!*installed)return false;
  simxMeasuredClockRuntime=&runtime;return true;
}
extern "C" SHERMES_EXPORT uint64_t simx_measured_clock_calls(void){return simxMeasuredClockCalls;}
}}
