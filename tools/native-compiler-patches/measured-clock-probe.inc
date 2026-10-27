// Probe-only binding access; production timer helper is included unchanged.
#include "measured-clock-host.inc"
namespace hermes { namespace vm {
static CallResult<HermesValue> simxProbeClockInstall(void *,Runtime &runtime){
  if(!simx_install_measured_clock(getSHRuntime(runtime)))return ExecutionStatus::EXCEPTION;
  return HermesValue::encodeBoolValue(true);
}
static CallResult<HermesValue> simxProbeClockCalls(void *,Runtime &){
  return HermesValue::encodeUntrustedNumberValue(static_cast<double>(simx_measured_clock_calls()));
}
extern "C" SHERMES_EXPORT bool simx_install_clock_probe(SHRuntime *shr){
  Runtime &runtime=getRuntime(shr);GCScope scope(runtime);
  auto install=runtime.getIdentifierTable().getSymbolHandle(runtime,ASCIIRef("__probeInstallClock",19));
  if(install==ExecutionStatus::EXCEPTION)return false;
  auto callback=NativeFunction::create(runtime,nullptr,simxProbeClockInstall,**install,0);
  auto first=JSObject::defineOwnProperty(runtime.getGlobal(),runtime,**install,DefinePropertyFlags::getDefaultNewPropertyFlags(),callback);
  if(first==ExecutionStatus::EXCEPTION||!*first)return false;
  auto calls=runtime.getIdentifierTable().getSymbolHandle(runtime,ASCIIRef("__probeClockCalls",17));
  if(calls==ExecutionStatus::EXCEPTION)return false;
  auto reader=NativeFunction::create(runtime,nullptr,simxProbeClockCalls,**calls,0);
  auto second=JSObject::defineOwnProperty(runtime.getGlobal(),runtime,**calls,DefinePropertyFlags::getDefaultNewPropertyFlags(),reader);
  return second!=ExecutionStatus::EXCEPTION&&*second;
}
}}
