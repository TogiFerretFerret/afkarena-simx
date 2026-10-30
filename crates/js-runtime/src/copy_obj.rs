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
   let PropertyKind::Data{value,writable:true}=desc.kind else{return Ok(None)};
   // Source recurses only for truthy typeof-object leaves. Copy primitive
   // StringId/FunctionId values unchanged, without conversion or invocation.
   // Preserve the existing non-finite Number fallback until raw-bit proof.
   if matches!(value,Value::Object(_))||matches!(value,Value::Number(number)if !number.is_finite())||self.objects[self.object_prototype.0].own(key).is_some(){return Ok(None)}
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
 fn retained_leaf(rt:&mut Runtime,_:Value,_:&[Value],env:EnvId)->JsResult<Value>{rt.lookup(env,"leaf")}
 fn primitive_copy_gc_entry(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{
  let battle_env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(battle_env,name,Value::Number(value))?;}let mut units=vec![0xd800;524_288];units[1]=0xdfff;let text=Value::String(rt.intern_utf16(&units));let env=rt.child_env(rt.global_env);rt.declare(env,"leaf",text).unwrap();let function=rt.make_closure(retained_leaf,env,0,"retained");let source=rt.object();
  for(name,value)in[("12",Value::Null),("1",Value::Number(-0.0)),("text",text),("flag",Value::Bool(false)),("absent",Value::Undefined),("fn",function)]{let key=rt.string(name);rt.define_data(source,key,value,true,true,true).unwrap();}
  let output=rt.try_native_copy_obj(source,rt.global_env).unwrap().expect("mixed ordinary leaves admitted");assert_ne!(source,output);assert_eq!(rt.own_keys(source,true).unwrap(),rt.own_keys(output,true).unwrap());rt.enable_native_battle_gc_with_roots(&[output]);
  for index in 0..23{let _garbage=rt.object();rt.assign(battle_env,"battleIndex",Value::Number(index as f64),false)?;rt.collect_native_battle_backedge(battle_env,parent)?;let key=rt.string("text");assert_eq!(rt.get(output,key).unwrap(),text);let Value::String(id)=text else{panic!()};assert_eq!(rt.string_units(id),units.as_slice());let key=rt.string("fn");let copied=rt.get(output,key).unwrap();assert_eq!(copied,function);assert_eq!(rt.call(copied,Value::Undefined,&[]).unwrap(),text);let key=rt.string("1");let Value::Number(n)=rt.get(output,key).unwrap()else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());}
  assert_eq!(rt.native_battle_gc_stats().collections,23);Ok(Value::Undefined)
 }
 #[test]fn primitive_copy_roots_strings_and_callable_identity_across_23_actual_safepoints(){let mut rt=Runtime::new();rt.diagnostics.enabled=false;let entry=rt.make_closure_with_flags(primitive_copy_gc_entry,rt.global_env,0,"__nativeRun",false,None);rt.set_function_source(entry,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.call(entry,Value::Undefined,&[]).unwrap();assert_eq!(rt.native_battle_gc_stats().collections,23);}
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


// The plan records occurrences, never deduplicates source object identities.
// Thus a shared child is copied independently for every source-recursion path.
const NESTED_COPY_MAX_DEPTH:usize=3;
const NESTED_COPY_MAX_NODES:usize=32;
const NESTED_COPY_MAX_PROPERTIES:usize=256;
const NESTED_COPY_MAX_ARRAY:usize=64;
enum NestedCopyValue {Leaf(Value),Child(usize)}
struct NestedCopyNode {source:ObjectId,array:bool,entries:Vec<(PropertyKey,NestedCopyValue)>}
fn nested_copy_index(units:&[u16])->Option<u32>{if units.is_empty()||units.len()>10||(units.len()>1&&units[0]==48){return None}let mut n=0u64;for &unit in units{if !(48..=57).contains(&unit){return None}n=n*10+u64::from(unit-48);}if n<u32::MAX as u64{Some(n as u32)}else{None}}
impl Runtime {
 /// Optional source-pinned region; the unchanged flat helper runs first.
 /// Debug traces retain every original recursive call and property Get.
 #[inline]pub fn try_native_nested_copy_obj(&mut self,input:Value,parent:EnvId)->JsResult<Option<Value>>{
  if !self.native_nested_copy_obj_enabled||self.diagnostics.enabled{return Ok(None)}
  self.try_native_nested_copy_obj_enabled(input,parent)
 }
 fn nested_copy_namespace_intact(&self,parent:EnvId,ed_name:crate::StringId,copy_key:PropertyKey)->bool{
  let Some(&active)=self.call_stack.last()else{return false};let Some(function)=self.functions.get(active.0)else{return false};
  if !self.objects.get(function.object.0).is_some_and(|o|o.is_function){return false}
  let mut cursor=parent;let mut value=None;
  for _ in 0..=self.environments.len(){
   let Some(env)=self.environments.get(cursor.0)else{return false};
   if let Some(&index)=env.bindings.get(&ed_name){let Some(cell)=env.cells.get(index)else{return false};if !cell.alive||!cell.initialized{return false}
    if !cell.object_backed{value=Some(cell.value);break}
    if cursor!=self.global_env{return false}
    value=match self.objects[self.global_object.0].own(PropertyKey(ed_name)).map(|d|d.kind){Some(PropertyKind::Data{value,..})=>Some(value),_=>None};break
   }
   if cursor==self.global_env{value=match self.objects[self.global_object.0].own(PropertyKey(ed_name)).map(|d|d.kind){Some(PropertyKind::Data{value,..})=>Some(value),_=>None};break}
   let Some(next)=env.parent else{return false};cursor=next;
  }
  let Some(Value::Object(ed))=value else{return false};let Some(object)=self.objects.get(ed.0)else{return false};
  if object.is_function||!matches!(object.kind,ObjectKind::Ordinary)||!object.arguments_map.is_empty(){return false}
  matches!(object.own(copy_key).map(|d|d.kind),Some(PropertyKind::Data{value:Value::Function(id),..})if id==active)
 }
 fn preflight_nested_copy(&self,id:ObjectId,depth:usize,path:&mut Vec<ObjectId>,nodes:&mut Vec<NestedCopyNode>,properties:&mut usize)->Option<usize>{
  if depth>NESTED_COPY_MAX_DEPTH||nodes.len()>=NESTED_COPY_MAX_NODES||path.contains(&id){return None}
  let object=self.objects.get(id.0)?;let guard=self.copy_obj_guard.as_ref()?;
  if object.is_function||!object.extensible||!object.arguments_map.is_empty()||object.own(guard.constructor_key).is_some(){return None}
  let array=match object.kind{ObjectKind::Ordinary if object.prototype==Some(self.object_prototype)=>None,ObjectKind::Array{length,length_writable:true,..}if object.prototype==Some(self.array_prototype)&&(length as usize)<=NESTED_COPY_MAX_ARRAY=>Some(length as usize),_=>return None};
  // Bound physical tombstones as well as live keys: no unbounded scan on misses.
  let count=object.properties.len()+object.primary_numeric_mask().count_ones()as usize;
  *properties=properties.checked_add(count)?;if *properties>NESTED_COPY_MAX_PROPERTIES{return None}
  let mut raw:Vec<_>=object.iter_properties().chain(object.primary_numeric_properties()).collect();
  raw.sort_by_key(|(key,_)|nested_copy_index(self.string_units(key.0)).map(|n|(0,n)).unwrap_or((1,0)));
  if array.is_some_and(|length|length!=raw.len()){return None}
  for(index,(key,descriptor))in raw.iter().enumerate(){
   if !descriptor.enumerable||!descriptor.configurable{return None}
   let PropertyKind::Data{value,writable:true}=descriptor.kind else{return None};if matches!(value,Value::Number(n)if !n.is_finite()){return None}
   if self.objects[self.object_prototype.0].own(*key).is_some(){return None}
   if array.is_some()&&(nested_copy_index(self.string_units(key.0))!=Some(index as u32)||self.objects[self.array_prototype.0].own(*key).is_some()){return None}
  }
  let node=nodes.len();nodes.push(NestedCopyNode{source:id,array:array.is_some(),entries:Vec::with_capacity(raw.len())});path.push(id);
  for(key,descriptor)in raw{let PropertyKind::Data{value,..}=descriptor.kind else{unreachable!()};let value=if let Value::Object(child)=value{NestedCopyValue::Child(self.preflight_nested_copy(child,depth+1,path,nodes,properties)?)}else{NestedCopyValue::Leaf(value)};nodes[node].entries.push((key,value));}
  path.pop();Some(node)
 }
 fn emit_nested_copy(&mut self,nodes:&[NestedCopyNode],index:usize)->Value{
  let node=&nodes[index];let output=if node.array{self.array(&[])}else{self.object()};let Value::Object(id)=output else{unreachable!()};
  for(position,(key,value))in node.entries.iter().enumerate(){let value=match value{NestedCopyValue::Leaf(value)=>*value,NestedCopyValue::Child(child)=>self.emit_nested_copy(nodes,*child)};self.objects[id.0].insert(*key,Descriptor::data(value,true,true,true));if node.array{if let ObjectKind::Array{length,..}=&mut self.objects[id.0].kind{*length=position as u32+1;}}}
  output
 }
 fn try_native_nested_copy_obj_enabled(&mut self,input:Value,parent:EnvId)->JsResult<Option<Value>>{
  let Value::Object(root)=input else{return Ok(None)};
  if !self.copy_obj_intrinsics_intact(parent){return Ok(None)}
  // These names already belong to the executing source/namespace. Interning is
  // internal canonical lookup, never a source Get or a callback invocation.
  let ed_name=self.intern("ed");let copy_key=PropertyKey(self.intern("copyObj"));
  if !self.nested_copy_namespace_intact(parent,ed_name,copy_key){return Ok(None)}
  let mut nodes=Vec::new();let mut path=Vec::new();let mut properties=0;
  if self.preflight_nested_copy(root,0,&mut path,&mut nodes,&mut properties).is_none(){return Ok(None)}
  // Allocation uses exactly one object per occurrence. Reject corrupt/free
  // source aliases and duplicate pool slots before allocating ANY JS object.
  let next:Vec<_>=self.native_battle_gc.free_objects.iter().rev().take(nodes.len()).copied().collect();
  for(index,&id)in next.iter().enumerate(){if id>=self.objects.len()||next[..index].contains(&id)||nodes.iter().any(|node|node.source.0==id){return Ok(None)}}
  Ok(Some(self.emit_nested_copy(&nodes,0)))
 }
}

#[cfg(test)]mod nested_copy_tests{
 use super::*;
 const SOURCE:&str="function(e){for(var t=e.constructor?new e.constructor:{},r=Object.keys(e),i=0;i<r.length;i++){var a=r[i],n=e[a];t[a]=\"object\"==typeof n&&n?ed.copyObj(n):n}return t}";
 fn entry(rt:&mut Runtime,_:Value,args:&[Value],parent:EnvId)->JsResult<Value>{Ok(rt.try_native_nested_copy_obj(args.first().copied().unwrap_or(Value::Undefined),parent)?.unwrap_or(Value::Undefined))}
 fn install(rt:&mut Runtime)->Value{rt.native_nested_copy_obj_enabled=true;rt.diagnostics.enabled=false;let ed=rt.object();rt.declare(rt.global_env,"ed",ed).unwrap();let f=rt.make_closure(entry,rt.global_env,1,"copyObj");rt.set_function_source(f,&SOURCE.encode_utf16().collect::<Vec<_>>()).unwrap();let key=rt.string("copyObj");rt.define_data(ed,key,f,true,true,true).unwrap();f}
 fn put(rt:&mut Runtime,object:Value,name:&str,value:Value){let key=rt.string(name);rt.define_data(object,key,value,true,true,true).unwrap();}
 fn get(rt:&mut Runtime,object:Value,name:&str)->Value{let key=rt.string(name);rt.get(object,key).unwrap()}
 fn copy(rt:&mut Runtime,f:Value,input:Value)->Value{rt.call(f,Value::Undefined,&[input]).unwrap()}
 fn rejected(rt:&mut Runtime,f:Value,input:Value){let before=rt.objects.len();assert_eq!(copy(rt,f,input),Value::Undefined);assert_eq!(rt.objects.len(),before,"preflight must reject before ANY JS allocation");}
 fn bomb(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{panic!("preflight executed a getter")}
 #[test]fn nested_shared_children_duplicate_per_path_and_dense_mixed_arrays_preserve_leaves(){let mut rt=Runtime::new();let f=install(&mut rt);let child=rt.object();put(&mut rt,child,"n",Value::Number(-0.0));let text=rt.string_utf16(&[0xd800,0,0xdfff]);put(&mut rt,child,"s",text);put(&mut rt,child,"fn",f);let array=rt.array(&[Some(Value::Number(1.0)),Some(text),Some(Value::Null),Some(Value::Bool(false)),Some(Value::Undefined),Some(child)]);let input=rt.object();put(&mut rt,input,"a",child);put(&mut rt,input,"b",child);put(&mut rt,input,"1",array);let output=copy(&mut rt,f,input);assert!(matches!(output,Value::Object(_)));assert_ne!(output,input);let a=get(&mut rt,output,"a");let b=get(&mut rt,output,"b");assert_ne!(a,b);assert_ne!(a,child);assert_ne!(b,child);let arr=get(&mut rt,output,"1");assert_ne!(arr,array);let nested=get(&mut rt,arr,"5");assert_ne!(nested,a);assert_ne!(nested,b);assert_ne!(nested,child);assert_eq!(get(&mut rt,arr,"length"),Value::Number(6.0));assert_eq!(get(&mut rt,a,"fn"),f);assert_eq!(get(&mut rt,a,"s"),text);let Value::Number(n)=get(&mut rt,a,"n")else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());assert_eq!(rt.own_keys(input,true).unwrap(),rt.own_keys(output,true).unwrap());}
 #[test]fn cycle_depth_node_property_and_array_bounds_fall_back_before_allocating(){let mut rt=Runtime::new();let f=install(&mut rt);let cycle=rt.object();put(&mut rt,cycle,"self",cycle);rejected(&mut rt,f,cycle);let root=rt.object();let mut tail=root;for _ in 0..4{let child=rt.object();put(&mut rt,tail,"next",child);tail=child;}rejected(&mut rt,f,root);let root=rt.object();for i in 0..32{let child=rt.object();put(&mut rt,root,&format!("k{i}"),child);}rejected(&mut rt,f,root);let root=rt.object();for i in 0..257{put(&mut rt,root,&format!("k{i}"),Value::Number(i as f64));}rejected(&mut rt,f,root);let array=rt.array(&vec![Some(Value::Number(1.0));65]);rejected(&mut rt,f,array);}
 #[test]fn late_getter_and_mutable_recursive_target_reject_without_prefix_effects(){let mut rt=Runtime::new();let f=install(&mut rt);let root=rt.object();let good=rt.object();put(&mut rt,good,"n",Value::Number(3.0));put(&mut rt,root,"first",good);let bad=rt.object();let getter=rt.native_function("bomb",0,bomb).unwrap();let key=rt.string("trap");rt.define_accessor(bad,key,Some(getter),None,true,true).unwrap();put(&mut rt,root,"last",bad);rejected(&mut rt,f,root);let root=rt.object();put(&mut rt,root,"child",good);let ed=rt.lookup(rt.global_env,"ed").unwrap();let key=rt.string("copyObj");let replacement=rt.native_function("replacement",0,bomb).unwrap();rt.set(ed,key,replacement,true).unwrap();rejected(&mut rt,f,root);rt.define_accessor(ed,key,Some(getter),None,true,true).unwrap();rejected(&mut rt,f,root);}
 #[test]fn holes_nonfinite_nondefault_descriptors_and_corrupt_free_pool_reject_before_allocating(){let mut rt=Runtime::new();let f=install(&mut rt);let array=rt.array(&[Some(Value::Number(1.0)),None]);rejected(&mut rt,f,array);let root=rt.object();let child=rt.object();put(&mut rt,root,"child",child);put(&mut rt,child,"nan",Value::Number(f64::from_bits(0x7ff0000000000042)));rejected(&mut rt,f,root);let key=rt.string("nan");rt.define_data(child,key,Value::Number(-0.0),false,true,true).unwrap();rejected(&mut rt,f,root);rt.define_data(child,key,Value::Number(-0.0),true,true,true).unwrap();let garbage=rt.object();let Value::Object(garbage)=garbage else{panic!()};let Value::Object(child_id)=child else{panic!()};rt.native_battle_gc.free_objects.push(child_id.0);rt.native_battle_gc.free_objects.push(garbage.0);rejected(&mut rt,f,root);}
 fn leaf(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{rt.lookup(parent,"leaf")}
 fn rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,n)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(n))?;}let f=install(rt);let units=vec![0xd800;524_288];let text=rt.string_utf16(&units);let captured=rt.child_env(parent);rt.declare(captured,"leaf",text)?;let function=rt.make_closure(leaf,captured,0,"retained");let source=rt.object();let child=rt.object();put(rt,child,"text",text);put(rt,child,"fn",function);put(rt,child,"zero",Value::Number(-0.0));put(rt,child,"tiny",Value::Number(f64::from_bits(1)));put(rt,source,"a",child);put(rt,source,"b",child);let mut input=source;rt.declare(env,"kept",input)?;let mut seen=std::collections::HashSet::new();let mut reused=0;for round in 0..23{let output=copy(rt,f,input);assert_ne!(output,input);let Value::Object(id)=output else{panic!()};if !seen.insert(id){reused+=1;}let a=get(rt,output,"a");let b=get(rt,output,"b");assert_ne!(a,b);assert_eq!(get(rt,a,"text"),text);let value=get(rt,a,"fn");assert_eq!(value,function);assert_eq!(rt.call(value,Value::Undefined,&[])?,text);for(name,bits)in[("zero",(-0.0f64).to_bits()),("tiny",1)]{let Value::Number(n)=get(rt,a,name)else{panic!()};assert_eq!(n.to_bits(),bits);}rt.assign(env,"kept",output,false)?;input=output;rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;let Value::String(id)=text else{panic!()};assert_eq!(rt.string_units(id),units.as_slice());}assert!(reused>0);Ok(Value::Number(23.0))}
 #[test]fn returned_nested_strings_functions_and_per_path_identities_survive_23_source_collections(){let mut rt=Runtime::new();let f=rt.make_closure(rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(f,Value::Undefined,&[]).unwrap(),Value::Number(23.0));assert_eq!(rt.native_battle_gc_stats().collections,23);}
}
