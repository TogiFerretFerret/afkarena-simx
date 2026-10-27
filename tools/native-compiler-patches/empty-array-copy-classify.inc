// Diagnostic-only private DSO: do not broaden either copy helper's admission.
#define simx_empty_array_copy simx_empty_array_copy_unobserved
#include "entity-sort-copy-host.inc"
#undef simx_empty_array_copy
#include "hermes/VM/JSProxy.h"
#include <cstdio>

namespace hermes { namespace vm {
enum class SimxCopyShape : unsigned {
  Primitive, OtherObject, ProxyRevoked, ProxyEmptyArray, ProxyNonemptyArray,
  ProxyOtherTarget, ArrayNonempty, EmptyClass, EmptyPrototype, EmptyNotExtensible,
  EmptyIntrinsics, EligibleEmpty, Count
};
static uint64_t simxCopyShapeCounts[static_cast<unsigned>(SimxCopyShape::Count)]={};
static uint64_t simxCopyShapeCalls=0,simxCopyShapeHits=0;

static SimxCopyShape simxClassifyCopyInput(SHRuntime *shr,SHLegacyValue input){
  Runtime &runtime=getRuntime(shr);
  NoAllocScope noAlloc(runtime);
  auto value=HermesValue::fromRaw(input.raw);
  if(!value.isObject())return SimxCopyShape::Primitive;
  auto *object=vmcast<JSObject>(value);
  if(object->isProxyObject(runtime)){
    // These access private GC slots only: no [[Get]], IsArray, trap, JS call,
    // recursion, exception or allocation. Revoked proxies remain untouched.
    if(JSProxy::isRevoked(object,runtime))return SimxCopyShape::ProxyRevoked;
    auto target=JSProxy::getTarget(object,runtime);
    if(target&&vmisa<JSArray>(target.get()))
      return JSArray::getLength(vmcast<JSArray>(target.get()),runtime)==0
        ?SimxCopyShape::ProxyEmptyArray:SimxCopyShape::ProxyNonemptyArray;
    return SimxCopyShape::ProxyOtherTarget;
  }
  if(!vmisa<JSArray>(object))return SimxCopyShape::OtherObject;
  auto *array=vmcast<JSArray>(object);
  if(JSArray::getLength(array,runtime)!=0)return SimxCopyShape::ArrayNonempty;
  if(array->getClass(runtime)!=runtime.classJSArray.get())return SimxCopyShape::EmptyClass;
  if(array->getParent(runtime)!=runtime.arrayPrototype.get())return SimxCopyShape::EmptyPrototype;
  if(!array->isExtensible(runtime))return SimxCopyShape::EmptyNotExtensible;
  auto ownData=[&](JSObject *object,SymbolID key,PinnedHermesValue &value){
    if(object->isProxyObject(runtime)||object->isHostObject(runtime))return false;
    NamedPropertyDescriptor descriptor;
    auto found=JSObject::tryGetOwnNamedDescriptorFast(object,runtime,key,descriptor);
    if(!found.hasValue()||!found.getValue()||descriptor.flags.accessor)return false;
    value=JSObject::getNamedSlotValueUnsafe(object,runtime,descriptor).unboxToHV(runtime);
    return true;
  };
  PinnedHermesValue constructor,globalObject,keys;
  if(!ownData(runtime.arrayPrototype.get(),Predefined::getSymbolID(Predefined::constructor),constructor)||
     constructor.getRaw()!=runtime.arrayConstructor.getHermesValue().getRaw()||
     !ownData(runtime.getGlobal().get(),Predefined::getSymbolID(Predefined::Object),globalObject)||
     globalObject.getRaw()!=runtime.objectConstructor.getHermesValue().getRaw()||
     !ownData(vmcast<JSObject>(globalObject),Predefined::getSymbolID(Predefined::keys),keys)||
     !vmisa<NativeFunction>(keys)||vmcast<NativeFunction>(keys)->getFunctionPtr()!=objectKeys)
    return SimxCopyShape::EmptyIntrinsics;
  return SimxCopyShape::EligibleEmpty;
}

extern "C" SHERMES_EXPORT SHLegacyValue simx_empty_array_copy(SHRuntime *shr,SHLegacyValue input){
  auto shape=simxClassifyCopyInput(shr,input);
  simxCopyShapeCounts[static_cast<unsigned>(shape)]++;simxCopyShapeCalls++;
  // Original helper and its original fallback decisions execute unchanged.
  auto result=simx_empty_array_copy_unobserved(shr,input);
  if(!HermesValue::fromRaw(result.raw).isUndefined())simxCopyShapeHits++;
  return result;
}

__attribute__((destructor)) static void simxDumpCopyShapes(){
  if(!simxCopyShapeCalls)return;
  const char *names[]={"primitive","otherObject","proxyRevoked","proxyEmptyArray",
    "proxyNonemptyArray","proxyOtherTarget","arrayNonempty","emptyClass",
    "emptyPrototype","emptyNotExtensible","emptyIntrinsics","eligibleEmpty"};
  std::fprintf(stderr,"empty_copy_classification:{\"calls\":%llu,\"hits\":%llu,\"categories\":{",
    static_cast<unsigned long long>(simxCopyShapeCalls),static_cast<unsigned long long>(simxCopyShapeHits));
  for(unsigned i=0;i<static_cast<unsigned>(SimxCopyShape::Count);i++)
    std::fprintf(stderr,"%s\"%s\":%llu",i?",":"",names[i],static_cast<unsigned long long>(simxCopyShapeCounts[i]));
  std::fprintf(stderr,"}}\n");
}
}}
