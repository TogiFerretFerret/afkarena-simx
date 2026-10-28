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
 pub fn try_native_copy_obj(&mut self,input:Value,parent:EnvId)->JsResult<Option<Value>>{self.try_native_copy_obj_with_capacity_reuse(input,parent,true)}
 /// The false branch retains the original allocation strategy for diagnostics.
 pub fn try_native_copy_obj_with_capacity_reuse(&mut self,input:Value,parent:EnvId,reuse:bool)->JsResult<Option<Value>>{
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
  // A valid live source cannot also be an unused heap slot. Reject defensively
  // before allocation rather than aliasing the source and destination borrows.
  if self.native_battle_gc.free_objects.last().copied()==Some(id.0){return Ok(None)}
  let target=if reuse{
   let target=self.alloc_object(Some(self.object_prototype));
   let(source,destination)=if id.0<target.0{let(left,right)=self.objects.split_at_mut(target.0);(&left[id.0],&mut right[0])}else{let(left,right)=self.objects.split_at_mut(id.0);(&right[0],&mut left[target.0])};
   destination.properties.clone_from(&source.properties);
   destination.property_index.clone_from(&source.property_index);
   target
  }else{
   let properties=object.properties.clone();let property_index=object.property_index.clone();
   let target=self.alloc_object(Some(self.object_prototype));self.objects[target.0].properties=properties;self.objects[target.0].property_index=property_index;target
  };
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

#[cfg(test)]mod capacity_reuse_tests{
 use super::*;
 fn rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{
  let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}
  let source=rt.object();for(index,bits)in[0x8000000000000000u64,1,0x7fefffffffffffff,0x0010000000000000].into_iter().cycle().take(47).enumerate(){let key=rt.string(&format!("k{index}"));rt.define_data(source,key,Value::Number(f64::from_bits(bits)),true,true,true)?;}rt.declare(env,"keptSource",source)?;
  let source_id=rt.object_id(source)?;let mut seen=std::collections::HashSet::new();let mut reused=0;
  for round in 0..23{
   let output=rt.try_native_copy_obj(source,env)?.expect("flat finite numeric source");let id=rt.object_id(output)?;assert_ne!(id,source_id);if !seen.insert(id){reused+=1;}
   let input=&rt.objects[source_id.0];let output=&rt.objects[id.0];assert_eq!(input.property_index,output.property_index);assert_eq!(input.properties.len(),output.properties.len());
   for(a,b)in input.properties.iter().zip(&output.properties){let(Some((ka,da)),Some((kb,db)))=(a,b)else{panic!()};assert_eq!(ka,kb);assert_eq!((da.enumerable,da.configurable),(db.enumerable,db.configurable));let(PropertyKind::Data{value:Value::Number(a),writable:wa},PropertyKind::Data{value:Value::Number(b),writable:wb})=(da.kind,db.kind)else{panic!()};assert_eq!(a.to_bits(),b.to_bits());assert_eq!(wa,wb);}
   rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;
  }assert!(reused>=22,"copy destinations recycled: {reused}");Ok(Value::Number(reused as f64))
 }
 #[test]fn exact_source_23_safepoints_recycle_numeric_copy_capacity(){let mut rt=Runtime::new();let function=rt.make_closure(rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(function,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(function,Value::Undefined,&[]).unwrap(),Value::Number(22.0));assert_eq!(rt.native_battle_gc_stats().collections,23);}
 #[test]fn corrupt_free_source_is_rejected_before_allocation(){let mut rt=Runtime::new();let source=rt.object();let key=rt.string("x");rt.define_data(source,key,Value::Number(-0.0),true,true,true).unwrap();let id=rt.object_id(source).unwrap();rt.native_battle_gc.free_objects.push(id.0);let length=rt.objects.len();assert!(rt.try_native_copy_obj(source,rt.global_env).unwrap().is_none());assert_eq!(rt.objects.len(),length);let key=crate::PropertyKey(rt.intern("x"));assert!(rt.objects[id.0].own(key).is_some());}
}
