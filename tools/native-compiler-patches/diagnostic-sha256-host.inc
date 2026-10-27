// Opt-in private VM host binding, matching the Node diagnostic loader's
// primitive-string SHA256 contract. No original game or emitter code changes.
#include "diagnostic-sha256.inc"
#include "hermes/VM/Callable.h"
#include "hermes/VM/IdentifierTable.h"
namespace hermes { namespace vm {
static CallResult<HermesValue> simxDiagnosticHostCall(void *,Runtime &runtime){
  auto args=runtime.getCurrentFrame().getNativeArgs();
  auto input=args.getArg(0);
  if(!input.isString())return runtime.raiseTypeError("Diagnostic SHA256 requires a primitive string");
  return simxDiagnosticDigestString(runtime,input);
}
extern "C" SHERMES_EXPORT bool simx_install_diagnostic_digest(SHRuntime *shr){
  Runtime &runtime=getRuntime(shr);GCScope scope(runtime);
  auto symbol=runtime.getIdentifierTable().getSymbolHandle(runtime,ASCIIRef("__nativeDiagnosticDigest",24));
  if(symbol==ExecutionStatus::EXCEPTION)return false;
  // Ordinary assignment could encounter an inherited setter. Before any JS
  // runs, reject every existing binding in the complete prototype chain using
  // descriptor-only VM operations; never invoke a getter or proxy trap.
  for(JSObject *object=runtime.getGlobal().get();object;object=object->getParent(runtime)){
    if(object->isProxyObject(runtime)||object->isHostObject(runtime)){runtime.raiseTypeError("Unsupported diagnostic host global prototype");return false;}
    NamedPropertyDescriptor descriptor;
    auto found=JSObject::tryGetOwnNamedDescriptorFast(object,runtime,**symbol,descriptor);
    if(!found.hasValue()||found.getValue()){runtime.raiseTypeError("Diagnostic SHA256 host binding already exists");return false;}
  }
  auto callback=NativeFunction::create(runtime,nullptr,simxDiagnosticHostCall,**symbol,1);
  auto installed=JSObject::defineOwnProperty(runtime.getGlobal(),runtime,**symbol,DefinePropertyFlags::getDefaultNewPropertyFlags(),callback);
  return installed!=ExecutionStatus::EXCEPTION&&*installed;
}
}}
