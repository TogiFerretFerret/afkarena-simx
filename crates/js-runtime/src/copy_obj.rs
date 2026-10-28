//! Exact-source ed.copyObj acceleration for callback-free shapes. Unknown
//! constructors, accessors, inherited writes and recursive values use source.
use crate::{Runtime,Value,EnvId,ObjectId,ObjectKind,PropertyKey,Descriptor,PropertyKind,JsResult};

#[derive(Clone)]pub(crate) struct CopyObjGuard{
 object_name:crate::StringId,constructor_key:PropertyKey,
 properties:Vec<(ObjectId,PropertyKey,Descriptor)>,
}
fn same(a:Descriptor,b:Descriptor)->bool{a.enumerable==b.enumerable&&a.configurable==b.configurable&&match(a.kind,b.kind){(PropertyKind::Data{value:a,writable:aw},PropertyKind::Data{value:b,writable:bw})=>a==b&&aw==bw,(PropertyKind::Accessor{get:a,set:b},PropertyKind::Accessor{get:c,set:d})=>a==c&&b==d,_=>false}}
impl Runtime{
 pub(crate) fn capture_copy_obj_guard(&mut self){
  let object_name=self.intern("Object");let constructor_key=PropertyKey(self.intern("constructor"));let mut properties=vec![];
  let mut capture=|rt:&mut Self,object:ObjectId,name:&str|->Option<Value>{let key=PropertyKey(rt.intern(name));let desc=rt.objects[object.0].own(key)?;let PropertyKind::Data{value,..}=desc.kind else{return None};properties.push((object,key,desc));Some(value)};
  let Some(object)=capture(self,self.global_object,"Object")else{return};let Ok(object)=self.object_id(object)else{return};
  let Some(array)=capture(self,self.global_object,"Array")else{return};let Ok(array)=self.object_id(array)else{return};
  for(object,name)in[(object,"keys"),(object,"prototype"),(array,"prototype"),(self.object_prototype,"constructor"),(self.array_prototype,"constructor")]{if capture(self,object,name).is_none(){return}}
  self.copy_obj_guard=Some(CopyObjGuard{object_name,constructor_key,properties});
 }
 fn copy_obj_intrinsics_intact(&self,parent:EnvId)->bool{
  let Some(guard)=&self.copy_obj_guard else{return false};let mut cursor=Some(parent);
  while let Some(id)=cursor{let Some(env)=self.environments.get(id.0)else{return false};if let Some(&slot)=env.bindings.get(&guard.object_name){let Some(cell)=env.cells.get(slot)else{return false};if id!=self.global_env||!cell.initialized||!cell.object_backed||!cell.alive{return false}}
   if id==self.global_env{break}cursor=env.parent;
  }
  if cursor!=Some(self.global_env){return false}
  for &(object,key,expected)in &guard.properties{let Some(actual)=self.objects[object.0].own(key)else{return false};if !same(actual,expected){return false}}
  self.objects[self.object_prototype.0].prototype.is_none()&&self.objects[self.array_prototype.0].prototype==Some(self.object_prototype)
 }
 pub fn try_native_copy_obj(&mut self,input:Value,parent:EnvId)->JsResult<Option<Value>>{
  if !self.copy_obj_intrinsics_intact(parent){return Ok(None)}
  let Value::Object(id)=input else{return Ok(None)};let Some(object)=self.objects.get(id.0)else{return Ok(None)};
  let guard=self.copy_obj_guard.as_ref().expect("checked guard");
  if !object.extensible||object.own(guard.constructor_key).is_some(){return Ok(None)}
  if let ObjectKind::Array{length:0,length_writable:true,..}=object.kind{
   if object.prototype!=Some(self.array_prototype)||object.primary_numeric_mask()!=0||object.properties.iter().any(Option::is_some){return Ok(None)}
   return Ok(Some(self.array(&[])))
  }
  if !matches!(object.kind,ObjectKind::Ordinary)||object.prototype!=Some(self.object_prototype)||!object.arguments_map.is_empty(){return Ok(None)}
  for (key,desc)in object.properties.iter().flatten(){
   if !desc.enumerable||!desc.configurable{return Ok(None)}
   let PropertyKind::Data{value:Value::Number(number),writable:true}=desc.kind else{return Ok(None)};
   if !number.is_finite()||self.objects[self.object_prototype.0].own(*key).is_some(){return Ok(None)}
  }
  // Standard descriptors and no inherited conflicts make each source write
  // an ordinary fresh own property. Numeric key ordering remains own_keys's
  // responsibility, just as for the original source-created object.
  let properties=object.properties.clone();let property_index=object.property_index.clone();
  let target=self.alloc_object(Some(self.object_prototype));self.objects[target.0].properties=properties;self.objects[target.0].property_index=property_index;
  Ok(Some(Value::Object(target)))
 }
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn fresh_copy_preserves_order_descriptors_and_negative_zero(){let mut rt=Runtime::new();let source=rt.object();for(name,value)in[("12",3.0),("1",-0.0),("x",4.5)]{let key=rt.string(name);rt.define_data(source,key,Value::Number(value),true,true,true).unwrap();}let output=rt.try_native_copy_obj(source,rt.global_env).unwrap().unwrap();assert_ne!(output,source);assert_eq!(rt.own_keys(source,true).unwrap(),rt.own_keys(output,true).unwrap());let key=rt.string("1");let Value::Number(n)=rt.get(output,key).unwrap()else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());}
 #[test]fn empty_arrays_and_factory_parent_work_without_callbacks(){let mut rt=Runtime::new();let input=rt.array(&[]);let parent=rt.child_env(rt.global_env);let output=rt.try_native_copy_obj(input,parent).unwrap().unwrap();assert_ne!(input,output);let key=rt.string("length");assert_eq!(rt.get(output,key).unwrap(),Value::Number(0.0));}
 #[test]fn unknown_shapes_and_observable_mutations_fall_back(){let mut rt=Runtime::new();let input=rt.object();let key=rt.string("x");rt.define_data(input,key,Value::Number(f64::NAN),true,true,true).unwrap();assert_eq!(rt.try_native_copy_obj(input,rt.global_env).unwrap(),None);let input=rt.object();let key=rt.string("constructor");rt.define_data(input,key,Value::Undefined,true,true,true).unwrap();assert_eq!(rt.try_native_copy_obj(input,rt.global_env).unwrap(),None);let input=rt.array(&[]);let parent=rt.child_env(rt.global_env);rt.declare(parent,"Object",Value::Undefined).unwrap();assert_eq!(rt.try_native_copy_obj(input,parent).unwrap(),None);}
}

impl CopyObjGuard {pub(crate) fn reachability_roots(&self)->Vec<Value>{let mut out=vec![Value::String(self.object_name),Value::String(self.constructor_key.0)];for(object,key,d)in &self.properties{out.push(Value::Object(*object));out.push(Value::String(key.0));match d.kind{PropertyKind::Data{value,..}=>out.push(value),PropertyKind::Accessor{get,set}=>{out.extend(get);out.extend(set)}}}out}}

impl Runtime {
 /// Only skips the exact createDataObj primitive-only instanceof loop. Its
 /// source copy call and every subsequently-created closure remain original.
 pub fn try_native_data_obj_scan(&mut self,env:EnvId,parent:EnvId)->JsResult<bool>{
  if !self.native_data_obj_scan_enabled||!self.copy_obj_intrinsics_intact(parent){return Ok(false)}
  let array_key=self.intern("Array");let target_key=self.intern("t");let result_key=self.intern("r");
  let Some(array)=self.data_obj_raw_binding(env,array_key)else{return Ok(false)};
  let Some(Descriptor{kind:PropertyKind::Data{value:original_array,..},..})=self.objects[self.global_object.0].own(PropertyKey(array_key))else{return Ok(false)};
  if array!=original_array||!matches!(array,Value::Function(_)){return Ok(false)}
  let Some(Value::Object(target))=self.data_obj_raw_binding(env,target_key)else{return Ok(false)};
  let Some(record)=self.environments.get(env.0)else{return Ok(false)};let Some(&slot)=record.bindings.get(&result_key)else{return Ok(false)};let Some(binding)=record.cells.get(slot)else{return Ok(false)};
  if !binding.alive||!binding.initialized||binding.object_backed{return Ok(false)}
  let object=&self.objects[target.0];if !matches!(object.kind,ObjectKind::Ordinary)||object.prototype!=Some(self.object_prototype)||!object.arguments_map.is_empty(){return Ok(false)}
  // An inherited enumerable entry or an own accessor can execute arbitrary
  // source work. Reject all such shapes before advancing the source loop.
  if self.objects[self.object_prototype.0].properties.iter().flatten().any(|(_,d)|d.enumerable){return Ok(false)}
  for(_,descriptor)in object.properties.iter().flatten(){if !descriptor.enumerable{continue}let PropertyKind::Data{value,..}=descriptor.kind else{return Ok(false)};if matches!(value,Value::Object(_)|Value::Function(_)){return Ok(false)}}
  if let Some(last)=self.own_keys(Value::Object(target),true)?.last().copied(){self.assign_id(env,result_key,last,false)?;}
  Ok(true)
 }
 fn data_obj_raw_binding(&self,mut env:EnvId,name:crate::StringId)->Option<Value>{loop{let record=self.environments.get(env.0)?;if let Some(&slot)=record.bindings.get(&name){let binding=record.cells.get(slot)?;if !binding.alive||!binding.initialized{return None}if !binding.object_backed{return Some(binding.value)}break}if let Some(parent)=record.parent{env=parent}else{break}}match self.objects[self.global_object.0].own(PropertyKey(name))?.kind{PropertyKind::Data{value,..}=>Some(value),_=>None}}
}
