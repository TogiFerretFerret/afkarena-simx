//! Guarded, callback-free numeric assignment at the original source point.
use crate::{Runtime,Value,ObjectKind,PropertyKey,PropertyKind};
impl Runtime {
 /// Implements exactly `this.position[i] += m[i] * r`. A miss performs no
 /// source Get/Put/coercion, so the caller executes the original expression.
 pub fn try_unit_motion_axis(&mut self,receiver:Value,motion:Value,scale:Value,index:usize)->Option<Value>{
  if self.diagnostics.enabled||index>1{return None}
  self.unit_motion_attempts+=1;
  let (Value::Object(receiver),Value::Object(motion),Value::Number(scale))=(receiver,motion,scale)else{return None};
  let plain=|o:&crate::heap::Object|!o.is_function&&o.arguments_map.is_empty()&&matches!(o.kind,ObjectKind::Ordinary|ObjectKind::Array{..});
  if !plain(self.objects.get(receiver.0)?)||!plain(self.objects.get(motion.0)?){return None}
  let position_key=PropertyKey(self.intern("position"));
  let PropertyKind::Data{value:Value::Object(position),..}=self.objects[receiver.0].own(position_key)?.kind else{return None};
  if !plain(self.objects.get(position.0)?){return None}
  let key=PropertyKey(crate::StringId(index));
  let mut descriptor=self.objects[position.0].own(key)?;
  let PropertyKind::Data{value:Value::Number(old),writable:true}=descriptor.kind else{return None};
  let PropertyKind::Data{value:Value::Number(delta),..}=self.objects[motion.0].own(key)?.kind else{return None};
  if !old.is_finite()||!delta.is_finite()||!scale.is_finite(){return None}
  // Existing own writable Number data shadows all prototype hooks. No calls,
  // allocations or coercions occur between these reads and the single commit.
  let value=Value::Number(crate::numeric_arithmetic::add(old,crate::numeric_arithmetic::mul(delta,scale)));
  descriptor.kind=PropertyKind::Data{value,writable:true};
  self.objects[position.0].insert(key,descriptor);
  self.unit_motion_hits+=1;
  Some(value)
 }
}

#[cfg(test)]mod tests{
 use super::*;use crate::{Descriptor,EnvId,JsResult};
 fn number_bits(value:Value)->u64{let Value::Number(n)=value else{panic!()};n.to_bits()}
 fn setup(rt:&mut Runtime,old:u64,delta:u64)->(Value,Value,Value){let p=rt.array(&[Some(Value::Number(f64::from_bits(old))),Some(Value::Number(-0.0))]);let m=rt.array(&[Some(Value::Number(f64::from_bits(delta))),Some(Value::Number(2.0))]);let receiver=rt.object();let key=rt.string("position");rt.define_data(receiver,key,p,true,true,true).unwrap();(receiver,p,m)}
 #[test]fn guarded_axis_matches_original_arithmetic_and_storage_bits(){
  for primary in[false,true]{for old in[0,0x8000000000000000,0x3ff0000000000000,0x7ff0000000000000,0x7ff0000000000042,0xfff8000000000123]{for delta in[0,0x8000000000000000,0x3ff0000000000000,0x7ff0000000000043]{
   let mut rt=Runtime::new();rt.diagnostics.enabled=false;rt.primary_numeric_arrays_enabled=primary;let(receiver,p,m)=setup(&mut rt,old,delta);
   let expected=crate::numeric_arithmetic::add(f64::from_bits(old),crate::numeric_arithmetic::mul(f64::from_bits(delta),-0.0));
   let result=rt.try_unit_motion_axis(receiver,m,Value::Number(-0.0),0);if !f64::from_bits(old).is_finite()||!f64::from_bits(delta).is_finite(){assert_eq!(result,None);let key=rt.string("0");assert_eq!(number_bits(rt.get(p,key).unwrap()),old);continue;}let result=result.unwrap();assert_eq!(number_bits(result),expected.to_bits());let key=rt.string("0");assert_eq!(number_bits(rt.get(p,key).unwrap()),expected.to_bits());
  }}}
 }
 fn bomb(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{panic!("guard invoked getter")}
 #[test]fn rejected_shapes_do_not_get_or_write_or_allocate(){for mode in 0..7{let mut rt=Runtime::new();rt.diagnostics.enabled=false;let(receiver,p,m)=setup(&mut rt,1.0f64.to_bits(),2.0f64.to_bits());let key=rt.string("0");match mode{0=>{let getter=rt.native_function("bomb",0,bomb).unwrap();let k=rt.string("position");rt.define_accessor(receiver,k,Some(getter),None,true,true).unwrap();},1=>{let getter=rt.native_function("bomb",0,bomb).unwrap();rt.define_accessor(p,key,Some(getter),None,true,true).unwrap();},2=>{rt.define_data(p,key,Value::Number(1.0),false,true,true).unwrap();},3=>{rt.delete(p,key,true).unwrap();},4=>{rt.define_data(m,key,Value::Null,true,true,true).unwrap();},5=>rt.diagnostics.enabled=true,6=>{let id=rt.object_id(m).unwrap();rt.objects[id.0].is_function=true;},_=>unreachable!()};let before=rt.objects.len();assert_eq!(rt.try_unit_motion_axis(receiver,m,Value::Number(1.0),0),None);assert_eq!(before,rt.objects.len());}}
 #[test]fn aliasing_reads_after_previous_axis_write_and_descriptor_flags_survive(){let mut rt=Runtime::new();rt.diagnostics.enabled=false;let(receiver,p,_)=setup(&mut rt,1.0f64.to_bits(),2.0f64.to_bits());let id=rt.object_id(p).unwrap();let key=PropertyKey(crate::StringId(0));rt.objects[id.0].insert(key,Descriptor::data(Value::Number(3.0),true,false,false));assert_eq!(rt.try_unit_motion_axis(receiver,p,Value::Number(2.0),0),Some(Value::Number(9.0)));assert_eq!(rt.try_unit_motion_axis(receiver,p,Value::Number(2.0),0),Some(Value::Number(27.0)));let descriptor=rt.objects[id.0].own(key).unwrap();assert!(!descriptor.enumerable&&!descriptor.configurable);}
}
