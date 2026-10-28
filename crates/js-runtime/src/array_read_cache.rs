//! Candidate only: bounded contiguous read cache for ordinary array data.
//! Generic descriptors remain authoritative for writes, reflection and holes.
use crate::{Runtime,Value,ObjectKind,ObjectId,Descriptor,PropertyKind};
use crate::heap::Object;

pub(crate) struct ArrayReadCache{
 pub(crate) length:u32,pub(crate) values:Option<Vec<Option<Value>>>,
 pub(crate) slots:Vec<Option<usize>>,
}
fn default_value(descriptor:Descriptor)->Option<Value>{if !descriptor.enumerable||!descriptor.configurable{return None}match descriptor.kind{PropertyKind::Data{value,writable:true}=>Some(value),_=>None}}
impl Object{
 pub(crate) fn update_array_read_cache(&mut self,slot:Option<usize>,descriptor:Descriptor){
  let Some(cache)=&mut self.array_read_cache else{return};
  let(Some(slot),Some(value))=(slot,default_value(descriptor))else{self.array_read_cache=None;return};
  if let Some(Some(index))=cache.slots.get(slot){if let Some(values)=&mut cache.values{values[*index]=Some(value);}}
 }
}
impl Runtime{
 /// Candidate benchmark switch; source-visible behavior is identical.
 pub fn set_array_read_cache_enabled(&mut self,enabled:bool){self.array_read_cache_enabled=enabled;if !enabled{for object in &mut self.objects{object.array_read_cache=None;}}}
 pub(crate) fn array_cached_number(&mut self,receiver:Value,index:f64)->Option<Value>{
  if !self.array_read_cache_enabled{return None}
  let Value::Object(id)=receiver else{return None};
  if !matches!(self.objects.get(id.0)?.kind,ObjectKind::Array{..})||!index.is_finite()||index<0.0||index.fract()!=0.0||index>=u32::MAX as f64{return None}
  // Number(-0) becomes property string "0", unlike the literal string "-0".
  self.array_cached_index(id,index as u32)
 }
 pub(crate) fn array_cached_index(&mut self,id:ObjectId,index:u32)->Option<Value>{
  if !self.array_read_cache_enabled{return None}
  let ObjectKind::Array{length,length_writable:true}=self.objects.get(id.0)?.kind else{return None};
  if length>64||index>=length{return None}
  if self.objects[id.0].array_read_cache.as_ref().is_some_and(|cache|cache.length!=length){self.objects[id.0].array_read_cache=None;}
  if self.objects[id.0].array_read_cache.is_none(){
   let object=&self.objects[id.0];let mut values=vec![None;length as usize];let mut eligible=object.properties.len()<=128;let mut slots=if eligible{vec![None;object.properties.len()]}else{vec![]};
   if eligible{for(slot,(key,descriptor))in object.properties.iter().enumerate().filter_map(|(i,item)|item.map(|item|(i,item))){
    let Some(value)=default_value(descriptor)else{eligible=false;break};
    if let Some(index)=self.array_cache_property_index(key){if index>=length{eligible=false;break}values[index as usize]=Some(value);slots[slot]=Some(index as usize);}
   }}
   self.objects[id.0].array_read_cache=Some(Box::new(ArrayReadCache{length,values:if eligible{Some(values)}else{None},slots}));
  }
  // Missing own positions always take the full live prototype/getter path.
  self.objects[id.0].array_read_cache.as_ref()?.values.as_ref()?.get(index as usize).copied().flatten()
 }
 fn array_cache_property_index(&self,key:crate::PropertyKey)->Option<u32>{
  let units=self.string_units(key.0);if units.is_empty()||units.len()>10||(units.len()>1&&units[0]==48){return None}
  let mut n=0u64;for unit in units{if !(48..=57).contains(unit){return None}n=n*10+u64::from(*unit-48);}if n<u32::MAX as u64{Some(n as u32)}else{None}
 }
}

#[cfg(test)]mod tests{
 use super::*;
 fn key(rt:&mut Runtime,n:u32)->Value{rt.string(&n.to_string())}
 fn getter(rt:&mut Runtime,_:Value,_:&[Value],_:crate::EnvId)->crate::JsResult<Value>{let env=rt.global_env;let Value::Number(n)=rt.lookup(env,"hits")?else{panic!()};rt.assign(env,"hits",Value::Number(n+1.0),false)?;Ok(Value::Number(77.0))}
 #[test]fn cached_values_follow_mutation_deletion_and_hole_prototype_getters(){
  let mut rt=Runtime::new();rt.declare(rt.global_env,"hits",Value::Number(0.0)).unwrap();let a=rt.array(&[Some(Value::Number(1.0)),Some(Value::Number(2.0))]);assert_eq!(rt.get(a,Value::Number(0.0)).unwrap(),Value::Number(1.0));rt.set(a,Value::Number(0.0),Value::Number(9.0),true).unwrap();assert_eq!(rt.get(a,Value::Number(0.0)).unwrap(),Value::Number(9.0));let k=key(&mut rt,0);rt.delete(a,k,true).unwrap();let read=rt.native_function("read",0,getter).unwrap();rt.define_accessor(Value::Object(rt.array_prototype),k,Some(read),None,true,true).unwrap();for _ in 0..2{assert_eq!(rt.get(a,Value::Number(-0.0)).unwrap(),Value::Number(77.0));}assert_eq!(rt.lookup(rt.global_env,"hits").unwrap(),Value::Number(2.0));let one=key(&mut rt,1);rt.define_accessor(a,one,Some(read),None,true,true).unwrap();assert_eq!(rt.get(a,Value::Number(1.0)).unwrap(),Value::Number(77.0));assert_eq!(rt.lookup(rt.global_env,"hits").unwrap(),Value::Number(3.0));
 }
 #[test]fn length_shrink_growth_nondefault_and_large_sparse_indices_deopt(){
  let mut rt=Runtime::new();let a=rt.array(&[Some(Value::Number(1.0)),Some(Value::Number(2.0)),Some(Value::Number(3.0))]);assert_eq!(rt.get(a,Value::Number(2.0)).unwrap(),Value::Number(3.0));let length=rt.string("length");rt.set(a,length,Value::Number(1.0),true).unwrap();assert_eq!(rt.get(a,Value::Number(2.0)).unwrap(),Value::Undefined);rt.set(a,length,Value::Number(3.0),true).unwrap();assert_eq!(rt.get(a,Value::Number(2.0)).unwrap(),Value::Undefined);let zero=key(&mut rt,0);rt.define_data(a,zero,Value::Number(8.0),false,true,false).unwrap();assert_eq!(rt.get(a,Value::Number(0.0)).unwrap(),Value::Number(8.0));rt.set(a,Value::Number(4_000_000_000.0),Value::Number(11.0),true).unwrap();assert_eq!(rt.get(a,Value::Number(4_000_000_000.0)).unwrap(),Value::Number(11.0));assert_eq!(rt.get(a,Value::Number(0.0)).unwrap(),Value::Number(8.0));
 }
 #[test]fn preserve_raw_numbers_and_string_minus_zero_is_a_named_property(){
  let mut rt=Runtime::new();let bits=[0x8000000000000000,0x7ff0000000001234,0xfff8000000005678];let a=rt.array(&bits.map(|v|Some(Value::Number(f64::from_bits(v)))));for(i,bits)in bits.into_iter().enumerate(){let Value::Number(value)=rt.get(a,Value::Number(i as f64)).unwrap()else{panic!()};assert_eq!(value.to_bits(),bits);}let minus_zero=rt.string("-0");rt.set(a,minus_zero,Value::Number(42.0),true).unwrap();assert_eq!(rt.get(a,minus_zero).unwrap(),Value::Number(42.0));let Value::Number(value)=rt.get(a,Value::Number(-0.0)).unwrap()else{panic!()};assert_eq!(value.to_bits(),0x8000000000000000);
 }
}
