// Public V8 metadata only. No callback execution, bound argument/receiver
// inspection, retained raw pointers, internal headers or object layout access.
#include <node.h>
#include <v8.h>
using namespace v8;
static_assert(NODE_MODULE_VERSION==137,"Pinned Node24 ABI required");
namespace {
Local<String> S(Isolate*i,const char*s){return String::NewFromUtf8(i,s).ToLocalChecked();}
void Resolve(const FunctionCallbackInfo<Value>&args){
 auto i=args.GetIsolate();HandleScope scope(i);auto c=i->GetCurrentContext();
 Local<Value> target=args.Length()?args[0]:Local<Value>(Undefined(i));
 uint32_t depth=0;const char *kind="non-function";const char *targetKind="non-function";int scriptId=0;
 if(target->IsProxy()){kind="proxy";targetKind="proxy";}
 else if(target->IsFunction()){
  for(;;){
   if(target->IsProxy()){kind="bound-proxy-target";targetKind="proxy";break;}
   if(!target->IsFunction()){kind="unsupported-bound-target";targetKind="non-function";break;}
   auto fn=target.As<Function>();
   auto next=fn->GetBoundFunction();
   if(next->IsUndefined()){
    kind=depth?"bound":"unbound";scriptId=fn->ScriptId();
    targetKind=scriptId>0?"script":"no-script-id";break;
   }
   if(depth==4096){kind="depth-limit";targetKind="unresolved";break;}
   target=next;++depth;
  }
 }
 auto out=Object::New(i);
 auto set=[&](const char*key,Local<Value>value){return out->CreateDataProperty(c,S(i,key),value).FromMaybe(false);};
 if(!set("kind",S(i,kind))||!set("targetKind",S(i,targetKind))||!set("depth",Integer::NewFromUnsigned(i,depth))||!set("scriptId",Integer::New(i,scriptId))||!set("target",target))return;
 args.GetReturnValue().Set(out);
}
void Init(Local<Object>exports){NODE_SET_METHOD(exports,"resolveTarget",Resolve);}
NODE_MODULE(NODE_GYP_MODULE_NAME,Init)
}
