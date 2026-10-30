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
   if object.prototype!=Some(self.array_prototype)||object.primary_numeric_mask()!=0||object.iter_properties().next().is_some(){return Ok(None)}
   return Ok(Some(self.array(&[])))
  }
  if let ObjectKind::Array{length,length_writable:true,..}=object.kind{
   if !(1..=4).contains(&length)||object.prototype!=Some(self.array_prototype)||!object.arguments_map.is_empty(){return Ok(None)}
   // Runtime reserves canonical IDs 0..3 for the four numeric keys. Reading
   // own() includes virtual primary numeric slots as well as dictionary data.
   let mut values=[None;4];
   for(index,value)in values.iter_mut().enumerate().take(length as usize){
    let key=PropertyKey(crate::StringId(index));
    let Some(Descriptor{enumerable:true,configurable:true,kind:PropertyKind::Data{value:Value::Number(number),writable:true}})=object.own(key)else{return Ok(None)};
    if !number.is_finite()||self.objects[self.array_prototype.0].own(key).is_some()||self.objects[self.object_prototype.0].own(key).is_some(){return Ok(None)}
    *value=Some(Value::Number(number));
   }
   if object.iter_properties().any(|(key,_)|key.0.0>=length as usize)||object.primary_numeric_mask()&!((1u8<<length)-1)!=0{return Ok(None)}
   // All guards finish before allocation. Dense Number leaves trigger no
   // recursive source calls, and the guarded Array constructor creates the
   // same default own index descriptors and length in numeric key order.
   if self.native_battle_gc.free_objects.last().copied()==Some(id.0){return Ok(None)}
   return Ok(Some(self.array(&values[..length as usize])))
  }
  if !matches!(object.kind,ObjectKind::Ordinary)||object.prototype!=Some(self.object_prototype)||!object.arguments_map.is_empty(){return Ok(None)}
  for (key,desc)in object.iter_properties(){
   if !desc.enumerable||!desc.configurable{return Ok(None)}
   let PropertyKind::Data{value:Value::Number(number),writable:true}=desc.kind else{return Ok(None)};
   if !number.is_finite()||self.objects[self.object_prototype.0].own(key).is_some(){return Ok(None)}
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
   destination.clone_property_storage_from(source);
   destination.property_index.clone_from(&source.property_index);
   target
  }else{
   let storage=object.clone_property_storage();let property_index=object.property_index.clone();
   let target=self.alloc_object(Some(self.object_prototype));self.objects[target.0].replace_property_storage(storage);self.objects[target.0].property_index=property_index;target
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
  if self.objects[self.object_prototype.0].iter_properties().any(|(_,d)|d.enumerable){return Ok(false)}
  for(_,descriptor)in object.iter_properties(){if !descriptor.enumerable{continue}let PropertyKind::Data{value,..}=descriptor.kind else{return Ok(false)};if matches!(value,Value::Object(_)|Value::Function(_)){return Ok(false)}}
  if let Some(last)=self.own_keys(Value::Object(target),true)?.last().copied(){self.assign_id(env,result_key,last,false)?;}
  Ok(true)
 }
 fn data_obj_raw_binding(&self,mut env:EnvId,name:crate::StringId)->Option<Value>{loop{let record=self.environments.get(env.0)?;if let Some(&slot)=record.bindings.get(&name){let binding=record.cells.get(slot)?;if !binding.alive||!binding.initialized{return None}if !binding.object_backed{return Some(binding.value)}break}if let Some(parent)=record.parent{env=parent}else{break}}match self.objects[self.global_object.0].own(PropertyKey(name))?.kind{PropertyKind::Data{value,..}=>Some(value),_=>None}}
}

#[cfg(test)]mod data_obj_scan_tests {
 use super::*;
 fn fixture()->(Runtime,EnvId,Value){let mut rt=Runtime::new();rt.native_data_obj_scan_enabled=true;let env=rt.child_env(rt.global_env);let target=rt.object();for(name,bits)in[("9",0x7ff0000000000042),("2",0x8000000000000000),("z",4.0f64.to_bits()),("a",5.0f64.to_bits())]{let key=rt.string(name);rt.define_data(target,key,Value::Number(f64::from_bits(bits)),true,true,true).unwrap();}rt.declare(env,"t",target).unwrap();rt.declare(env,"r",Value::Undefined).unwrap();(rt,env,target)}
 #[test]fn primary_scan_hits_preserves_raw_values_and_final_ordered_binding(){let(mut rt,env,target)=fixture();assert!(rt.try_native_data_obj_scan(env,rt.global_env).unwrap());let last=rt.string("a");assert_eq!(rt.lookup(env,"r").unwrap(),last);let key=rt.string("9");let Value::Number(n)=rt.get(target,key).unwrap()else{panic!()};assert_eq!(n.to_bits(),0x7ff0000000000042);let key=rt.string("2");let Value::Number(n)=rt.get(target,key).unwrap()else{panic!()};assert_eq!(n.to_bits(),0x8000000000000000);}
 #[test]fn scans_reject_source_observers_before_any_binding_write(){for mode in 0..5{let(mut rt,env,target)=fixture();match mode{0=>{let key=rt.string("x");let object=rt.object();rt.define_data(target,key,object,true,true,true).unwrap();},1=>{let key=rt.string("extra");rt.define_data(Value::Object(rt.object_prototype),key,Value::Number(4.0),true,true,true).unwrap();},2=>{rt.declare(env,"Array",Value::Undefined).unwrap();},3=>{rt.native_data_obj_scan_enabled=false;},_=>{let key=rt.string("x");rt.define_accessor(target,key,None,None,true,true).unwrap();}}assert!(!rt.try_native_data_obj_scan(env,rt.global_env).unwrap());assert_eq!(rt.lookup(env,"r").unwrap(),Value::Undefined);}}
 #[test]fn empty_scan_leaves_original_r_untouched(){let(mut rt,env,_)=fixture();let empty=rt.object();rt.assign(env,"t",empty,false).unwrap();rt.assign(env,"r",Value::Number(7.0),false).unwrap();assert!(rt.try_native_data_obj_scan(env,rt.global_env).unwrap());assert_eq!(rt.lookup(env,"r").unwrap(),Value::Number(7.0));}
}
#[cfg(test)]mod capacity_reuse_tests{
 use super::*;
 fn rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{
  let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}
  let source=rt.object();for(index,bits)in[0x8000000000000000u64,1,0x7fefffffffffffff,0x0010000000000000].into_iter().cycle().take(47).enumerate(){let key=rt.string(&format!("k{index}"));rt.define_data(source,key,Value::Number(f64::from_bits(bits)),true,true,true)?;}rt.declare(env,"keptSource",source)?;
  let source_id=rt.object_id(source)?;let mut seen=std::collections::HashSet::new();let mut reused=0;
  for round in 0..23{
   let output=rt.try_native_copy_obj(source,env)?.expect("flat finite numeric source");let id=rt.object_id(output)?;assert_ne!(id,source_id);if !seen.insert(id){reused+=1;}
   let input=&rt.objects[source_id.0];let output=&rt.objects[id.0];assert_eq!(input.property_index,output.property_index);assert_eq!(input.properties.len(),output.properties.len());
   for((ka,da),(kb,db))in input.iter_properties().zip(output.iter_properties()){assert_eq!(ka,kb);assert_eq!((da.enumerable,da.configurable),(db.enumerable,db.configurable));let(PropertyKind::Data{value:Value::Number(a),writable:wa},PropertyKind::Data{value:Value::Number(b),writable:wb})=(da.kind,db.kind)else{panic!()};assert_eq!(a.to_bits(),b.to_bits());assert_eq!(wa,wb);}
   rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;
  }assert!(reused>=22,"copy destinations recycled: {reused}");Ok(Value::Number(reused as f64))
 }
 #[test]fn exact_source_23_safepoints_recycle_numeric_copy_capacity(){let mut rt=Runtime::new();let function=rt.make_closure(rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(function,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(function,Value::Undefined,&[]).unwrap(),Value::Number(22.0));assert_eq!(rt.native_battle_gc_stats().collections,23);}
 #[test]fn corrupt_free_source_is_rejected_before_allocation(){let mut rt=Runtime::new();let source=rt.object();let key=rt.string("x");rt.define_data(source,key,Value::Number(-0.0),true,true,true).unwrap();let id=rt.object_id(source).unwrap();rt.native_battle_gc.free_objects.push(id.0);let length=rt.objects.len();assert!(rt.try_native_copy_obj(source,rt.global_env).unwrap().is_none());assert_eq!(rt.objects.len(),length);let key=crate::PropertyKey(rt.intern("x"));assert!(rt.objects[id.0].own(key).is_some());}
}

#[cfg(test)]mod small_array_tests{
 use super::*;
 #[test]fn dense_lengths_and_finite_raw_bits_are_fresh(){for primary in[false,true]{for length in 1..=4{let mut rt=Runtime::new();rt.primary_numeric_arrays_enabled=primary;let numbers=[-0.0,f64::from_bits(1),f64::MAX,-17.25];let values:Vec<_>=numbers[..length].iter().map(|&n|Some(Value::Number(n))).collect();let source=rt.array(&values);let output=rt.try_native_copy_obj(source,rt.global_env).unwrap().unwrap();assert_ne!(source,output);assert_eq!(rt.own_keys(source,true).unwrap(),rt.own_keys(output,true).unwrap());for i in 0..length{let key=rt.string(&i.to_string());let Value::Number(n)=rt.get(output,key).unwrap()else{panic!()};assert_eq!(n.to_bits(),numbers[i].to_bits());}}}}
 #[test]fn observable_shapes_fallback_without_allocating(){for mode in 0..12{let mut rt=Runtime::new();let source=rt.array(&[Some(Value::Number(-0.0)),Some(Value::Number(2.0))]);let id=rt.object_id(source).unwrap();let zero=rt.string("0");let key=rt.string("extra");match mode{
 0=>{rt.define_data(source,zero,Value::Number(f64::NAN),true,true,true).unwrap();},
 1=>{rt.objects[id.0].remove(PropertyKey(crate::StringId(0)));},
 2=>{rt.define_data(source,key,Value::Number(3.0),true,false,true).unwrap();},
 3=>{rt.define_data(source,zero,Value::Number(3.0),false,true,true).unwrap();},
 4=>{rt.define_accessor(source,zero,None,None,true,true).unwrap();},
 5=>{let key=rt.string("constructor");rt.define_data(source,key,Value::Undefined,true,true,true).unwrap();},
 6=>{rt.define_data(Value::Object(rt.array_prototype),zero,Value::Number(3.0),false,true,true).unwrap();},
 7=>{rt.define_accessor(Value::Object(rt.object_prototype),zero,None,None,true,true).unwrap();},
 8=>{if let ObjectKind::Array{length_writable,..}=&mut rt.objects[id.0].kind{*length_writable=false;}},
 9=>{rt.objects[id.0].extensible=false;},
 10=>{rt.objects[id.0].prototype=Some(rt.object_prototype);},
 _=>{rt.native_battle_gc.free_objects.push(id.0);}}
 let count=rt.objects.len();assert!(rt.try_native_copy_obj(source,rt.global_env).unwrap().is_none(),"mode {mode}");assert_eq!(count,rt.objects.len());}}
 fn rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}let source=rt.array(&[Some(Value::Number(-0.0)),Some(Value::Number(f64::from_bits(1)))]);rt.declare(env,"keptSource",source)?;let mut ids=std::collections::HashSet::new();let mut reused=0;for round in 0..23{let output=rt.try_native_copy_obj(source,env)?.unwrap();assert_ne!(source,output);if !ids.insert(rt.object_id(output)?){reused+=1;}for(index,bits)in[(-0.0f64).to_bits(),1].into_iter().enumerate(){let key=rt.string(&index.to_string());let Value::Number(n)=rt.get(output,key)?else{panic!()};assert_eq!(n.to_bits(),bits);}rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;}assert_eq!(reused,22);Ok(Value::Undefined)}
 #[test]fn source_23_gc_safepoints_preserve_fresh_array_bits(){let mut rt=Runtime::new();let f=rt.make_closure(rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();rt.call(f,Value::Undefined,&[]).unwrap();assert_eq!(rt.native_battle_gc_stats().collections,23);}
}

#[cfg(test)]mod small_index_copy_tests{
 use super::*;
 #[test]fn tiny_copy_clones_logical_slots_with_empty_maps_and_reused_large_destination_storage(){for reuse in[false,true]{let mut rt=Runtime::new();rt.diagnostics.enabled=false;let source=rt.object();let source_id=rt.object_id(source).unwrap();let x=rt.string("x");let y=rt.string("y");let x_key=rt.to_property_key(x).unwrap();let y_key=rt.to_property_key(y).unwrap();rt.define_data(source,x,Value::Number(-0.0),true,true,true).unwrap();rt.define_data(source,y,Value::Number(f64::from_bits(1)),true,true,true).unwrap();assert!(rt.objects[source_id.0].property_index.is_empty());let garbage=rt.object();let garbage_id=rt.object_id(garbage).unwrap();for name in["a","b","c"]{let key=rt.string(name);rt.define_data(garbage,key,Value::Null,true,true,true).unwrap();}rt.native_battle_gc.free_objects.push(garbage_id.0);let copy=rt.try_native_copy_obj_with_capacity_reuse(source,rt.global_env,reuse).unwrap().unwrap();let copy_id=rt.object_id(copy).unwrap();assert_eq!(copy_id,garbage_id);assert!(rt.objects[copy_id.0].property_index.is_empty());for(key,bits)in[(x_key,(-0.0f64).to_bits()),(y_key,1)]{assert_eq!(rt.objects[source_id.0].slot_index(key),rt.objects[copy_id.0].slot_index(key));let Some(Descriptor{kind:PropertyKind::Data{value:Value::Number(n),..},..})=rt.objects[copy_id.0].own(key)else{panic!()};assert_eq!(n.to_bits(),bits);}rt.set(copy,x,Value::Number(9.0),true).unwrap();let Some(Descriptor{kind:PropertyKind::Data{value:Value::Number(n),..},..})=rt.objects[source_id.0].own(x_key)else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());rt.delete(copy,x,true).unwrap();rt.define_data(copy,x,Value::Number(7.0),true,true,true).unwrap();assert_eq!(rt.objects[copy_id.0].slot_index(x_key),Some(2));assert_eq!(rt.objects[copy_id.0].slot_index(y_key),Some(1));assert!(!rt.objects[copy_id.0].property_index.is_empty());assert!(rt.objects[source_id.0].property_index.is_empty());}}
}
