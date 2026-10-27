#include <node.h>
#include <v8.h>
#include <string>
using namespace v8;
static_assert(NODE_MODULE_VERSION==137,"Pinned Node24 ABI required");
namespace {
enum {ArrayProto,IndexOf,OwnKeys,Descriptor,PrototypeOf,TrustedArray,Tainted,DataLength};
Local<String> S(Isolate *i,const char *s){return String::NewFromUtf8(i,s).ToLocalChecked();}
bool Ordinary(Local<Object> o,Local<Context> c){
 if(o->IsProxy()||o->IsModuleNamespaceObject()||o->IsApiWrapper()||o->HasNamedLookupInterceptor()||o->HasIndexedLookupInterceptor()||o->InternalFieldCount()!=0)return false;
 Local<Context> home;if(!o->GetCreationContext().ToLocal(&home))return false;
 auto global=home->Global();
 return !o->StrictEquals(global)&&!o->StrictEquals(global->GetPrototypeV2());
}
MaybeLocal<Object> Desc(Local<Context> c,Local<Object> o,Local<Name> key){
 Local<Value> d;if(!o->GetOwnPropertyDescriptor(c,key).ToLocal(&d)||!d->IsObject())return {};
 return d.As<Object>();
}
bool DataValue(Local<Context> c,Local<Object>d,Local<Value>&out){
 auto key=S(c->GetIsolate(),"value");
 if(!d->HasOwnProperty(c,key).FromMaybe(false))return false;
 return d->Get(c,key).ToLocal(&out);
}
void Inspect(const FunctionCallbackInfo<Value>&args){
 auto i=args.GetIsolate();HandleScope hs(i);auto c=i->GetCurrentContext();auto data=args.Data().As<Array>();
 auto get=[&](int n){return data->Get(c,n).ToLocalChecked();};
 auto fallback=[&](){data->Set(c,Tainted,True(i)).Check();};
 if(get(Tainted)->IsTrue())return;
 if(args.Length()!=5||!args[0]->IsFunction()||!args[1]->IsArray()){fallback();return;}
 // The observer's captured callables must remain the original realm intrinsics.
 for(int n=2;n<5;n++)if(!args[n]->StrictEquals(get(n))){fallback();return;}
 auto fn=args[0].As<Object>();auto standards=args[1].As<Array>();
 if(!Ordinary(fn,c)||standards->IsProxy()||!standards->GetPrototypeV2()->StrictEquals(get(ArrayProto))){fallback();return;}
 Local<Value> ownIndex;if(!standards->GetOwnPropertyDescriptor(c,S(i,"indexOf")).ToLocal(&ownIndex)){fallback();return;}
 if(!ownIndex->IsUndefined()){fallback();return;}
 Local<Object> idxDesc;Local<Value> idx;
 if(!Desc(c,get(ArrayProto).As<Object>(),S(i,"indexOf")).ToLocal(&idxDesc)||!DataValue(c,idxDesc,idx)||!idx->StrictEquals(get(IndexOf))){fallback();return;}
 auto trusted=get(TrustedArray);
 if(trusted->IsUndefined()){
  if(standards->Length()!=4){fallback();return;}
  const char *expected[]={"length","name","arguments","caller"};
  for(int n=0;n<4;n++){
   Local<Object>d;Local<Value>v;
   if(!Desc(c,standards,S(i,std::to_string(n).c_str())).ToLocal(&d)||!DataValue(c,d,v)||!v->StrictEquals(S(i,expected[n]))){fallback();return;}
  }
  data->Set(c,TrustedArray,standards).Check();
 }else if(!trusted->StrictEquals(standards)){fallback();return;}
 // All fallback paths taint this inspector permanently. Thus an original
 // observer callback can never expose/mutate this array and then regain a
 // fast path after restoring a prototype method.
 Local<Array> keys;
 if(!fn->GetOwnPropertyNames(c,ALL_PROPERTIES,KeyConversionMode::kConvertToString).ToLocal(&keys)){fallback();return;}
 Local<Value> parent=True(i);
 for(uint32_t n=0;n<keys->Length();n++){
  Local<Value>key;if(!keys->Get(c,n).ToLocal(&key)){fallback();return;}
  if(key->StrictEquals(S(i,"length"))||key->StrictEquals(S(i,"name"))||key->StrictEquals(S(i,"arguments"))||key->StrictEquals(S(i,"caller")))continue;
  if(!key->StrictEquals(S(i,"prototype"))){args.GetReturnValue().Set(False(i));return;}
  Local<Object>d;Local<Value>proto;
  if(!Desc(c,fn,key.As<Name>()).ToLocal(&d)||!DataValue(c,d,proto)){fallback();return;}
  Local<Value>w,e,conf;
  if(!d->Get(c,S(i,"writable")).ToLocal(&w)||!d->Get(c,S(i,"enumerable")).ToLocal(&e)||!d->Get(c,S(i,"configurable")).ToLocal(&conf)){fallback();return;}
  if(!w->BooleanValue(i)||e->BooleanValue(i)||conf->BooleanValue(i)||!proto->IsObject()){args.GetReturnValue().Set(False(i));return;}
  auto p=proto.As<Object>();if(!Ordinary(p,c)){fallback();return;}
  Local<Array>pk;if(!p->GetOwnPropertyNames(c,ALL_PROPERTIES,KeyConversionMode::kConvertToString).ToLocal(&pk)){fallback();return;}
  if(pk->Length()!=1){args.GetReturnValue().Set(False(i));return;}
  Local<Value>first;if(!pk->Get(c,0).ToLocal(&first)){fallback();return;}
  if(!first->StrictEquals(S(i,"constructor"))){args.GetReturnValue().Set(False(i));return;}
  Local<Object>ctor;Local<Value>constructor;
  if(!Desc(c,p,S(i,"constructor")).ToLocal(&ctor)){args.GetReturnValue().Set(False(i));return;}
  if(!DataValue(c,ctor,constructor)){fallback();return;}
  if(!ctor->Get(c,S(i,"writable")).ToLocal(&w)||!ctor->Get(c,S(i,"enumerable")).ToLocal(&e)||!ctor->Get(c,S(i,"configurable")).ToLocal(&conf)){fallback();return;}
  if(!constructor->StrictEquals(fn)||!w->IsTrue()||!e->IsFalse()||!conf->IsTrue()){args.GetReturnValue().Set(False(i));return;}
  parent=p->GetPrototypeV2();
 }
 args.GetReturnValue().Set(parent);
}
void Factory(const FunctionCallbackInfo<Value>&args){
 auto i=args.GetIsolate();HandleScope hs(i);
 if(args.Length()!=1||!args[0]->IsObject()||args[0]->IsProxy())return;
 Local<Context>c;if(!args[0].As<Object>()->GetCreationContext().ToLocal(&c))return;
 Context::Scope scope(c);auto global=c->Global();auto d=Array::New(i,DataLength);
 auto property=[&](Local<Value>v,const char*name){return v.As<Object>()->Get(c,S(i,name)).ToLocalChecked();};
 auto arrayProto=property(property(global,"Array"),"prototype");
 d->Set(c,ArrayProto,arrayProto).Check();d->Set(c,IndexOf,property(arrayProto,"indexOf")).Check();
 d->Set(c,OwnKeys,property(property(global,"Reflect"),"ownKeys")).Check();
 d->Set(c,Descriptor,property(property(global,"Object"),"getOwnPropertyDescriptor")).Check();
 d->Set(c,PrototypeOf,property(property(global,"Object"),"getPrototypeOf")).Check();
 d->Set(c,TrustedArray,Undefined(i)).Check();d->Set(c,Tainted,False(i)).Check();
 Local<Function>fn;if(Function::New(c,Inspect,d).ToLocal(&fn))args.GetReturnValue().Set(fn);
}
void Init(Local<Object>exports){NODE_SET_METHOD(exports,"createInspectorFor",Factory);}
NODE_MODULE(NODE_GYP_MODULE_NAME,Init)
}
