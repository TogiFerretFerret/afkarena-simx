// Isolated opt-in VM adapter. No original compiler/VM file is modified.
#include "hermes/VM/StaticHUtils.h"
#include "hermes/VM/JSArray.h"
#include "hermes/VM/Callable.h"
#include "hermes/VM/Operations.h"
#include <cmath>
#include <vector>
#ifndef SIMX_SORT_LIMIT
#define SIMX_SORT_LIMIT 63
#endif

namespace hermes { namespace vm {
using SimxSmallCompare=int(*)(void*,uint32_t,uint32_t,double*);
using SimxSmallSort=int(*)(uint32_t*,size_t,void*,SimxSmallCompare);
static uint64_t simxSmallCalls=0,simxSmallGCs=0,simxSmallGCPeriod=0;
extern "C" SHERMES_EXPORT void simx_small_sort_set_gc_period(uint64_t period){simxSmallGCPeriod=period;}
extern "C" SHERMES_EXPORT uint64_t simx_small_sort_gc_count(){return simxSmallGCs;}
struct SimxSmallSortContext {Runtime &runtime;Handle<JSArray> work;Handle<Callable> comparator;};
static int simxSmallCompare(void *opaque,uint32_t a,uint32_t b,double *number){
  auto &context=*static_cast<SimxSmallSortContext*>(opaque);
  Runtime &runtime=context.runtime;GCScope scope(runtime);
  const bool stress=simxSmallGCPeriod&&++simxSmallCalls%simxSmallGCPeriod==0;
  if(stress){runtime.getHeap().collect("small-sort rooted snapshot stress");simxSmallGCs++;}
  // Callable::executeCall2 routes native JS functions through _callWrapper's
  // own SHJmpBuf. It converts JS throws to ExecutionStatus *inside this C++
  // callback*, never jumping through the Rust sort frame beneath it.
  auto result=Callable::executeCall2(context.comparator,runtime,
      Runtime::getUndefinedValue(),context.work->at(runtime,a).unboxToHV(runtime),
      context.work->at(runtime,b).unboxToHV(runtime));
  if(result==ExecutionStatus::EXCEPTION)return 1;
  auto rootedResult=runtime.makeHandle(result->getHermesValue());
  if(stress){runtime.getHeap().collect("small-sort comparator result stress");simxSmallGCs++;}
  auto converted=toNumber_RJS(runtime,rootedResult);
  if(converted==ExecutionStatus::EXCEPTION)return 1;
  *number=converted->getNumber();if(std::isnan(*number))*number=0.0;
  return 0;
}
static CallResult<HermesValue> simxSmallSortImpl(
    Runtime &runtime,HermesValue value,HermesValue compare,SimxSmallSort sort){
  GCScope scope(runtime);
  auto unsupported=HermesValue::encodeUndefinedValue();
  // Admission is descriptor-only. No user callbacks, getters, prototype
  // lookups or proxy traps may execute until every guard has succeeded.
  if(!vmisa<JSArray>(value)||!vmisa<NativeJSFunction>(compare)||
      vmcast<NativeJSFunction>(compare)->getKind()!=CellKind::NativeJSFunctionKind)
    return unsupported;
  auto receiver=runtime.makeHandle<JSArray>(value);
  auto comparator=runtime.makeHandle<Callable>(compare);
  const uint32_t length=JSArray::getLength(*receiver,runtime);
  if(length>SIMX_SORT_LIMIT||receiver->getParent(runtime)!=runtime.arrayPrototype.get()||
      !receiver->hasFastIndexProperties(runtime))return unsupported;
  NamedPropertyDescriptor lengthDescriptor;
  auto ownLength=JSObject::getOwnNamedDescriptor(receiver,runtime,
      Predefined::getSymbolID(Predefined::length),lengthDescriptor);
  if(!ownLength||
      lengthDescriptor.flags.accessor||!lengthDescriptor.flags.writable)
    return unsupported;
  for(uint32_t i=0;i<length;i++){
    ComputedPropertyDescriptor descriptor;
    auto key=runtime.makeHandle(HermesValue::encodeTrustedNumberValue(i));
    auto found=JSObject::getOwnComputedDescriptor(receiver,runtime,key,descriptor);
    if(found==ExecutionStatus::EXCEPTION)return ExecutionStatus::EXCEPTION;
    if(!*found||descriptor.flags.accessor||!descriptor.flags.writable||
        receiver->at(runtime,i).isEmpty())return unsupported;
  }
  // No more admission fallback is possible from this point. Snapshot every
  // defined value into this private GC-rooted array before any comparison.
  auto created=JSArray::create(runtime,length,length);
  if(created==ExecutionStatus::EXCEPTION)return ExecutionStatus::EXCEPTION;
  auto work=runtime.makeHandle(std::move(*created));
  uint32_t defined=0;
  for(uint32_t i=0;i<length;i++){
    auto element=receiver->at(runtime,i);
    if(element.unboxToHV(runtime).isUndefined())continue;
    JSArray::unsafeSetExistingElementAt(*work,runtime,defined++,element);
  }
  // Tokens carry no GC pointers and can move independently of rooted values.
  std::vector<uint32_t> tokens(defined?defined:1);
  for(uint32_t i=0;i<defined;i++)tokens[i]=i;
  SimxSmallSortContext context{runtime,work,comparator};
  int status=sort(tokens.data(),defined,&context,simxSmallCompare);
  if(status==1)return ExecutionStatus::EXCEPTION;
  if(status!=0)return runtime.raiseTypeError("Native small sort internal contract failed");
  // Use generic ThrowOnError Put after callbacks. This preserves index
  // setters, deletions, freezes, shorter/grown arrays and partial writeback.
  // The original dense receiver had no holes, so exactly initialLength writes
  // are required; callback-added tail elements are never deleted or truncated.
  for(uint32_t i=0;i<length;i++){
    auto key=runtime.makeHandle(HermesValue::encodeTrustedNumberValue(i));
    auto element=runtime.makeHandle(i<defined?
        work->at(runtime,tokens[i]).unboxToHV(runtime):HermesValue::encodeUndefinedValue());
    if(JSObject::putComputed_RJS(receiver,runtime,key,element,
         PropOpFlags().plusThrowOnError())==ExecutionStatus::EXCEPTION)
      return ExecutionStatus::EXCEPTION;
  }
  return receiver.getHermesValue();
}
extern "C" SHERMES_EXPORT SHLegacyValue simx_v8_small_sort(
    SHRuntime *shr,SHLegacyValue input,SHLegacyValue comparator,SimxSmallSort sort){
  Runtime &runtime=getRuntime(shr);
  // Destroy the internal GCScope/handles before propagating the retained VM
  // exception into SH code. Rust has already returned before this can throw.
  auto result=simxSmallSortImpl(runtime,HermesValue::fromRaw(input.raw),
      HermesValue::fromRaw(comparator.raw),sort);
  if(result==ExecutionStatus::EXCEPTION)_sh_throw_current(shr);
  if(result->isUndefined())_sh_throw_type_error_ascii(shr,"Unsupported native small sort admission");
  return SHLegacyValue{result->getRaw()};
}
}}
