//! Non-observing guards for the exact-source UTF-8 table decoder fast path.
//! Every failed guard returns to the generated original function body.
use crate::{Runtime,Value,ObjectId,PropertyKey,Descriptor,PropertyKind,EnvId,ObjectKind};
#[derive(Clone)]pub(crate) struct Utf8LoaderGuard{
 bindings:Vec<crate::StringId>,properties:Vec<(ObjectId,PropertyKey,Option<Descriptor>)>,
 prototypes:Vec<(ObjectId,Option<ObjectId>)>,uint8_prototype:ObjectId,length_key:PropertyKey,
}
fn descriptor_same(a:Option<Descriptor>,b:Option<Descriptor>)->bool{match(a,b){(None,None)=>true,(Some(a),Some(b))=>a.enumerable==b.enumerable&&a.configurable==b.configurable&&match(a.kind,b.kind){(PropertyKind::Data{value:a,writable:aw},PropertyKind::Data{value:b,writable:bw})=>a==b&&aw==bw,(PropertyKind::Accessor{get:a,set:b},PropertyKind::Accessor{get:c,set:d})=>a==c&&b==d,_=>false},_=>false}}
impl Runtime{
 pub(crate) fn capture_utf8_loader_guard(&mut self){
  let Some(&uint8_prototype)=self.binary_prototypes.get("Uint8Array")else{return};let Some(&typed_prototype)=self.binary_prototypes.get("TypedArray")else{return};
  let mut properties=Vec::new();let mut prototypes=Vec::new();let mut bindings=Vec::new();let global=self.global_object;
  let mut snapshot=|rt:&mut Self,object:ObjectId,name:&str|{let key=PropertyKey(rt.intern(name));let desc=rt.objects[object.0].own(key);properties.push((object,key,desc));desc};
  let string_key=self.intern("String");let error_key=self.intern("Error");bindings.extend([string_key,error_key]);
  let Some(Descriptor{kind:PropertyKind::Data{value:string,..},..})=snapshot(self,global,"String")else{return};
  snapshot(self,global,"Error");let Ok(string)=self.object_id(string)else{return};
  let Some(Descriptor{kind:PropertyKind::Data{value:from_char,..},..})=snapshot(self,string,"fromCharCode")else{return};let Ok(from_char)=self.object_id(from_char)else{return};
  snapshot(self,from_char,"apply");snapshot(self,self.function_prototype,"apply");snapshot(self,self.array_prototype,"push");snapshot(self,self.array_prototype,"join");
  snapshot(self,typed_prototype,"length");snapshot(self,uint8_prototype,"length");
  for object in [self.object_prototype,self.array_prototype,self.function_prototype,string,from_char,uint8_prototype,typed_prototype]{prototypes.push((object,self.objects[object.0].prototype));}
  let length_key=PropertyKey(self.intern("length"));self.utf8_loader_guard=Some(Utf8LoaderGuard{bindings,properties,prototypes,uint8_prototype,length_key});
 }
 pub(crate) fn utf8_loader_intrinsics_intact(&self,bytes:Value,parent:EnvId)->bool{
  let Some(guard)=&self.utf8_loader_guard else{return false};if parent!=self.global_env{return false}
  let Some(env)=self.environments.get(parent.0)else{return false};
  // A global lexical String/Error shadows the object even when the object's
  // descriptors remain pristine. Reject rather than running any binding read.
  for name in &guard.bindings{if let Some(&slot)=env.bindings.get(name){let Some(cell)=env.cells.get(slot)else{return false};if !cell.initialized||!cell.object_backed||!cell.alive{return false}}}
  for &(object,key,expected)in &guard.properties{if !descriptor_same(self.objects[object.0].own(key),expected){return false}}
  for &(object,expected)in &guard.prototypes{if self.objects[object.0].prototype!=expected{return false}}
  for object in [self.array_prototype,self.object_prototype]{for(key,_)in self.objects[object.0].properties.iter().flatten(){let units=self.string_units(key.0);if !units.is_empty()&&(units.len()==1||units[0]!=48)&&units.iter().all(|u|(48..=57).contains(u)){return false}}}
  let Value::Object(object)=bytes else{return false};let Some(record)=self.objects.get(object.0)else{return false};
  if record.prototype!=Some(guard.uint8_prototype)||record.own(guard.length_key).is_some(){return false}
  let ObjectKind::TypedArray{buffer,byte_offset,length,kind:crate::TypedArrayKind::Uint8}=record.kind else{return false};
  let Some(buffer)=self.buffers.get(buffer.0)else{return false};!buffer.detached&&byte_offset.checked_add(length).is_some_and(|end|end<=buffer.bytes.len())
 }
}
#[cfg(test)]mod tests{
 use super::*;
 fn bytes(rt:&mut Runtime)->Value{let global=Value::Object(rt.global_object);let key=rt.string("Uint8Array");let ctor=rt.get(global,key).unwrap();rt.uint8_array_from_bytes(ctor,vec![65]).unwrap()}
 #[test]fn pristine_bytes_pass_but_raw_mutations_and_shadowing_fall_back(){let mut rt=Runtime::new();let value=bytes(&mut rt);assert!(rt.utf8_loader_intrinsics_intact(value,rt.global_env));let key=rt.string("length");rt.define_data(value,key,Value::Number(0.0),true,true,true).unwrap();assert!(!rt.utf8_loader_intrinsics_intact(value,rt.global_env));let mut rt=Runtime::new();let value=bytes(&mut rt);let global=rt.global_env;rt.declare_lexical(global,"String",true).unwrap();assert!(!rt.utf8_loader_intrinsics_intact(value,global));}
 #[test]fn modified_intrinsics_force_original_source_without_observers(){
  fn never(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->crate::JsResult<Value>{panic!("guard ran getter")}
  for which in 0..7{let mut rt=Runtime::new();let value=bytes(&mut rt);let global=Value::Object(rt.global_object);let key=rt.string("String");let string=rt.get(global,key).unwrap();let key=rt.string("fromCharCode");let from_char=rt.get(string,key).unwrap();let(target,name)=match which{0=>(global,"String"),1=>(global,"Error"),2=>(string,"fromCharCode"),3=>(from_char,"apply"),4=>(Value::Object(rt.function_prototype),"apply"),5=>(Value::Object(rt.array_prototype),"push"),_=>(Value::Object(rt.array_prototype),"join")};let getter=rt.native_function("poison",0,never).unwrap();let key=rt.string(name);rt.define_accessor(target,key,Some(getter),None,true,true).unwrap();assert!(!rt.utf8_loader_intrinsics_intact(value,rt.global_env));}
 }
 #[test]fn prototype_numeric_poison_is_rejected_without_getter_invocation(){fn never(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->crate::JsResult<Value>{panic!("guard ran getter")};let mut rt=Runtime::new();let value=bytes(&mut rt);let getter=rt.native_function("poison",0,never).unwrap();let key=rt.string("0");rt.define_accessor(Value::Object(rt.array_prototype),key,Some(getter),None,true,true).unwrap();assert!(!rt.utf8_loader_intrinsics_intact(value,rt.global_env));}
}
