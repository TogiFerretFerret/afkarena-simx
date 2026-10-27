// Experimental numeric INTERIOR block only. The original prefix/continuation
// and all callback dispatch remain in the compiled original Unit.update.
#include "entity-sort-copy-host.inc"
#include <cmath>
namespace hermes { namespace vm {
extern "C" SHERMES_EXPORT uint32_t simx_unit_speeder(
 SHRuntime *shr,SHLegacyValue receiver,SHLegacyValue rawDt,const SHSymbolID *ids,
 SHLegacyValue *speederOutput,SHLegacyValue *actionOutput,
 unsigned char (*kernel)(const double*,uint32_t,double*)) {
#if defined(HERMESVM_BOXED_DOUBLES) || defined(HERMESVM_COMPRESSED_POINTERS)
 return false;
#else
 Runtime &runtime=getRuntime(shr);NoAllocScope noAlloc(runtime);
 auto ordinary=[&](JSObject *object){return object&&object->getKind()==CellKind::JSObjectKind&&
  !object->isLazy(runtime)&&!object->isProxyObject(runtime)&&!object->isHostObject(runtime)&&!object->getClass(runtime)->isTyped();};
 auto valid=[](const NamedPropertyDescriptor &d){return d.flags.isValid()&&!d.flags.accessor&&!d.flags.indexed&&
  !d.flags.internalSetter&&!d.flags.hostObject&&!d.flags.proxyObject&&!d.flags.privateName&&!d.flags.staticBuiltin&&!d.flags.flagsTransition;};
 auto read=[&](HermesValue object,unsigned key,PinnedHermesValue &value){
  if(!object.isObject())return false;
  auto *current=vmcast<JSObject>(object);
  for(unsigned depth=0;current&&depth<32;depth++,current=current->getParent(runtime)){
   if(!ordinary(current))return false;
   NamedPropertyDescriptor descriptor;
   auto found=JSObject::tryGetOwnNamedDescriptorFast(current,runtime,SymbolID::unsafeCreate(ids[key]),descriptor);
   if(!found.hasValue())return false;
   if(found.getValue()){
    if(!valid(descriptor))return false;
    value=JSObject::getNamedSlotValueUnsafe(current,runtime,descriptor).unboxToHV(runtime);
    return !value.isEmpty();
   }
  }
  if(current)return false;
  value=HermesValue::encodeUndefinedValue();return true;
 };
 auto truth=[](HermesValue value,bool &result){
  if(value.isUndefined()||value.isNull()){result=false;return true;}
  if(value.isBool()){result=value.getBool();return true;}
  if(value.isNumber()&&std::isfinite(value.getNumber())){result=value.getNumber()!=0.0;return true;}
  return false;
 };
 auto object=HermesValue::fromRaw(receiver.raw),dt=HermesValue::fromRaw(rawDt.raw);
 if(!object.isObject()||!ordinary(vmcast<JSObject>(object))||!dt.isNumber()||!std::isfinite(dt.getNumber()))return false;
 auto *unit=vmcast<JSObject>(object);NamedPropertyDescriptor speedDesc,actionDesc;
 if(unit->getClass(runtime)->isFrozen())return false;
 auto output=[&](unsigned key,NamedPropertyDescriptor &descriptor){
  auto found=JSObject::tryGetOwnNamedDescriptorFast(unit,runtime,SymbolID::unsafeCreate(ids[key]),descriptor);
  return found.hasValue()&&found.getValue()&&valid(descriptor)&&descriptor.flags.writable;
 };
 if(!output(13,speedDesc)||!output(14,actionDesc))return false;
 double input[4]={0.0,0.0,dt.getNumber(),0.0},result[3];uint32_t flags=0;
 PinnedHermesValue attribs,number,config,boss,skill,basic,info,set,lock,effects,frozen,motionless;
 bool bit=false;
 if(!read(object,0,attribs)||!read(attribs,1,number)||!number.isNumber()||!std::isfinite(number.getNumber()))return false;
 input[0]=number.getNumber();
 if(!read(object,2,config)||!read(config,3,boss)||!truth(boss,bit))return false;
 if(bit)flags|=1;
 if(!read(object,4,skill))return false;
 if(skill.isObject()){
  flags|=2;
  if(!read(skill,5,info)||!read(info,6,set))return false;
  if(set.isNumber()){if(!std::isfinite(set.getNumber()))return false;input[3]=set.getNumber();flags|=64;}
  else if(!set.isNull()&&!set.isUndefined())return false;
  if(!read(object,7,basic))return false;
  if(skill.getRaw()==basic.getRaw()){
   flags|=4;
   // Source rereads attribs only on this branch. Do not require ATKHAST otherwise.
   if(!read(object,0,attribs)||!read(attribs,8,number)||!number.isNumber()||!std::isfinite(number.getNumber()))return false;
   input[1]=number.getNumber();
  }
  if(!read(skill,9,lock)||!truth(lock,bit))return false;
  if(bit)flags|=8;
 }else if(!truth(skill,bit)||bit)return false;
 if(!read(object,10,effects)||!read(effects,11,frozen)||!truth(frozen,bit))return false;
 if(bit)flags|=16;
 else{
  if(!read(object,10,effects)||!read(effects,12,motionless)||!truth(motionless,bit))return false;
  if(bit)flags|=32;
 }
 if(!kernel(input,flags,result))return false;
 // All effect-free guards finished. This pinned layout encodes Number without
 // allocating. Preserve the source's speeder THEN dt_action store order.
 JSObject::setNamedSlotValueUnsafe(unit,runtime,speedDesc,SmallHermesValue::encodeNumberValue(result[1],runtime));
 JSObject::setNamedSlotValueUnsafe(unit,runtime,actionDesc,SmallHermesValue::encodeNumberValue(result[2],runtime));
 speederOutput->raw=HermesValue::encodeTrustedNumberValue(result[1]).getRaw();
 actionOutput->raw=HermesValue::encodeTrustedNumberValue(result[2]).getRaw();return 1U|(flags&2U);
#endif
}
}}
