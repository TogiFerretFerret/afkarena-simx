//! Callback-free bulk movement for dense own object/function queue payloads.
//! Exotic/poisoned/holey arrays execute the original native shift algorithm.
use crate::{Runtime,Value,ObjectKind,PropertyKind,JsResult};
fn canonical_index(units:&[u16])->Option<u32>{if units.is_empty()||units.len()>10||(units.len()>1&&units[0]==48){return None}let mut n=0u64;for &digit in units{if !(48..=57).contains(&digit){return None}n=n*10+u64::from(digit-48);}if n<u32::MAX as u64{Some(n as u32)}else{None}}
impl Runtime{
 pub fn try_dense_array_shift(&mut self,receiver:Value)->JsResult<Option<Value>>{
  if !self.dense_array_shift_enabled||self.diagnostics.enabled{return Ok(None)}
  let Value::Object(id)=receiver else{return Ok(None)};let Some(object)=self.objects.get(id.0)else{return Ok(None)};
  let ObjectKind::Array{length,length_writable:true,..}=object.kind else{return Ok(None)};
  if object.is_function||!object.arguments_map.is_empty()||object.primary_numeric_mask()!=0||length==0{return Ok(None)}
  let length=length as usize;if object.properties.len()<length{return Ok(None)}
  // Validate ALL source reads/writes/deletes before making any change. Physical
  // dense-prefix restriction is conservative: non-prefix layouts fall back.
  for index in 0..length{
   let Some(Some((key,descriptor)))=object.properties.get(index)else{return Ok(None)};
   if object.property_index.get(key).copied()!=Some(index)||canonical_index(self.string_units(key.0))!=Some(index as u32)||!descriptor.configurable{return Ok(None)}
   let PropertyKind::Data{value:Value::Object(_)|Value::Function(_),writable:true}=descriptor.kind else{return Ok(None)};
  }
  // Extra ordinary names are untouched. Reject any additional numeric slots;
  // they could require source array-length deletion handling in a raw host.
  for (key,_)in object.properties[length..].iter().flatten(){if canonical_index(self.string_units(key.0)).is_some(){return Ok(None)}}
  let first=match object.properties[0].as_ref().unwrap().1.kind{PropertyKind::Data{value,..}=>value,_=>unreachable!()};
  let last=object.properties[length-1].as_ref().unwrap().0;
  let object=&mut self.objects[id.0];
  for index in 0..length-1{let value=match object.properties[index+1].as_ref().unwrap().1.kind{PropertyKind::Data{value,..}=>value,_=>unreachable!()};object.properties[index].as_mut().unwrap().1.kind=PropertyKind::Data{value,writable:true};}
  object.remove(last);object.kind=ObjectKind::Array{length:(length-1)as u32,length_writable:true,primary_numeric:false,numeric_presence:0};
  Ok(Some(first))
 }
}
#[cfg(test)]mod tests{
 use super::*;use crate::{EnvId,PropertyKey,Descriptor};
 fn noop(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Undefined)}
 #[test]fn accepts_dense_callbacks_preserves_destination_flags_and_aliases(){let mut rt=Runtime::new();rt.dense_array_shift_enabled=true;let a=rt.make_closure(noop,rt.global_env,0,"a");let b=rt.make_closure(noop,rt.global_env,0,"b");let c=rt.object();let array=rt.array(&[Some(a),Some(b),Some(c)]);let zero=PropertyKey(rt.intern("0"));let one=PropertyKey(rt.intern("1"));let two=PropertyKey(rt.intern("2"));rt.define_data(array,zero,a,true,false,true).unwrap();assert_eq!(rt.try_dense_array_shift(array).unwrap(),Some(a));let id=rt.object_id(array).unwrap();let descriptor=rt.objects[id.0].own(zero).unwrap();assert!(!descriptor.enumerable&&descriptor.configurable);assert!(matches!(descriptor.kind,PropertyKind::Data{value,writable:true}if value==b));assert!(matches!(rt.objects[id.0].own(one).unwrap().kind,PropertyKind::Data{value,..}if value==c));assert!(rt.objects[id.0].own(two).is_none());assert!(matches!(rt.objects[id.0].kind,ObjectKind::Array{length:2,length_writable:true,..}));assert_eq!(rt.try_dense_array_shift(array).unwrap(),Some(b));assert_eq!(rt.try_dense_array_shift(array).unwrap(),Some(c));assert_eq!(rt.try_dense_array_shift(array).unwrap(),None);}
 #[test]fn rejects_poison_holes_readonly_lengths_and_numeric_history_without_mutation(){let mut rt=Runtime::new();rt.dense_array_shift_enabled=true;let object=rt.object();let array=rt.array(&[Some(object),None,Some(object)]);assert_eq!(rt.try_dense_array_shift(array).unwrap(),None);let array=rt.array(&[Some(object),Some(Value::Number(f64::from_bits(0x7ff0000000000042)))]);assert_eq!(rt.try_dense_array_shift(array).unwrap(),None);let array=rt.array(&[Some(object),Some(object)]);let zero=PropertyKey(rt.intern("0"));let id=rt.object_id(array).unwrap();rt.objects[id.0].insert(zero,Descriptor::data(object,false,true,true));assert_eq!(rt.try_dense_array_shift(array).unwrap(),None);assert!(matches!(rt.objects[id.0].kind,ObjectKind::Array{length:2,..}));let array=rt.array(&[Some(object),Some(object)]);let length=rt.string("length");rt.define_data(array,length,Value::Number(2.0),false,false,false).unwrap();assert_eq!(rt.try_dense_array_shift(array).unwrap(),None);let array=rt.array(&[Some(object),Some(object)]);let one=PropertyKey(rt.intern("1"));let id=rt.object_id(array).unwrap();rt.objects[id.0].insert(one,Descriptor::data(object,true,true,false));assert_eq!(rt.try_dense_array_shift(array).unwrap(),None);}
 fn gc_rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}let mut dead=std::collections::HashSet::new();let mut reused=0;for round in 0..23{let a=rt.make_closure(noop,env,0,"a");let b=rt.object();let array=rt.array(&[Some(a),Some(b)]);let id=rt.object_id(array)?;if dead.contains(&id){reused+=1}assert_eq!(rt.try_dense_array_shift(array)?,Some(a));assert_eq!(rt.try_dense_array_shift(array)?,Some(b));dead.insert(id);rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;}assert!(reused>0);Ok(Value::Number(rt.native_battle_gc_stats().collections as f64))}
 #[test]fn repeated_dense_queues_survive_twenty_three_actual_collections_and_id_reuse(){let mut rt=Runtime::new();rt.dense_array_shift_enabled=true;let f=rt.make_closure(gc_rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(f,Value::Undefined,&[]).unwrap(),Value::Number(23.0));}
}
