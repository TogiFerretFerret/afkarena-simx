//! Candidate only: precomputed property keys for small numeric Array reads.
//! Values and descriptors always use the complete ordinary property machinery.
use crate::{Runtime,Value,ObjectKind,PropertyKey};
impl Runtime{
 pub fn set_array_read_cache_enabled(&mut self,enabled:bool){self.array_read_cache_enabled=enabled;}
 pub(crate) fn array_prepared_number_key(&self,receiver:Value,index:f64)->Option<PropertyKey>{
  if !self.array_read_cache_enabled||!index.is_finite()||index<0.0||index>=64.0||index.fract()!=0.0{return None}
  let Value::Object(id)=receiver else{return None};if !matches!(self.objects.get(id.0)?.kind,ObjectKind::Array{..}){return None}
  // Abstract ToString(Number) is pure. For these exact integers it is the
  // decimal key already interned at startup, including Number(-0) -> "0".
  Some(PropertyKey(self.small_array_index_keys.as_ref()?[index as usize]))
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
