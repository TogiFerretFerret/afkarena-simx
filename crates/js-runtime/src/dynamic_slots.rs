//! Runtime-wide canonical-key to physical-slot hints, never cached values.
use crate::{Runtime,Value,PropertyKey,ObjectKind};
const MAX_KEYS:usize=65_536;
impl Runtime {
 #[inline]
 fn dynamic_slot_object(&self,receiver:Value,key:PropertyKey)->Option<&crate::heap::Object>{
  let Value::Object(id)=receiver else{return None};let object=self.objects.get(id.0)?;
  if object.is_function||!object.arguments_map.is_empty(){return None}
  match object.kind {ObjectKind::Ordinary=>Some(object),ObjectKind::Array{..} if self.string_units(key.0)!=[108,101,110,103,116,104]=>Some(object),_=>None}
 }
 #[inline]
 pub(crate) fn dynamic_slot_get(&self,receiver:Value,key:PropertyKey)->Option<Value>{
  if !self.dynamic_own_slots_enabled{return None}let slots=self.dynamic_own_slots.get(key.0.0)?;let first=slots[0]?.get()-1;let object=self.dynamic_slot_object(receiver,key)?;
  if let Some(value)=object.data_slot(first,key){return Some(value)}
  object.data_slot(slots[1]?.get()-1,key)
 }
 #[inline]
 pub(crate) fn dynamic_slot_learn(&mut self,receiver:Value,key:PropertyKey){
  if !self.dynamic_own_slots_enabled||key.0.0>=MAX_KEYS{return}self.dynamic_slot_learn_enabled(receiver,key)
 }
 #[cold]
 #[inline(never)]
 fn dynamic_slot_learn_enabled(&mut self,receiver:Value,key:PropertyKey){
  let Some(object)=self.dynamic_slot_object(receiver,key)else{return};let Some(index)=object.property_index.get(&key).copied()else{return};
  if object.data_slot(index,key).is_none(){return}
  if self.dynamic_own_slots.len()<=key.0.0{self.dynamic_own_slots.resize(key.0.0+1,[None;2])}let index=index.checked_add(1).and_then(std::num::NonZeroUsize::new);let slots=&mut self.dynamic_own_slots[key.0.0];if slots[0]!=index&&slots[1]!=index{slots[1]=slots[0];slots[0]=index;}
 }
}
#[cfg(test)]mod tests {
 use super::*;
 #[test]fn key_hints_read_fresh_values_across_layout_mutation_and_reused_object_ids(){
  let mut rt=Runtime::new();rt.diagnostics.enabled=false;let key=rt.string("dynamicKey");let a=rt.object();rt.set(a,key,Value::Number(1.0),true).unwrap();assert_eq!(rt.get(a,key).unwrap(),Value::Number(1.0));rt.set(a,key,Value::Number(-0.0),true).unwrap();let Value::Number(v)=rt.get(a,key).unwrap()else{panic!()};assert_eq!(v.to_bits(),(-0.0f64).to_bits());
  let b=rt.object();let other=rt.string("other");rt.set(b,other,Value::Number(9.0),true).unwrap();rt.set(b,key,Value::Number(2.0),true).unwrap();assert_eq!(rt.get(b,key).unwrap(),Value::Number(2.0));assert_eq!(rt.get(a,key).unwrap(),Value::Number(-0.0));
  let old=rt.object_id(a).unwrap();
  fn collect(rt:&mut Runtime,_:Value,_:&[Value],parent:crate::EnvId)->crate::JsResult<Value>{let env=rt.child_env(parent);for(name,value)in[("battles",1.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}rt.collect_native_battle_backedge(env,parent)?;Ok(Value::Undefined)}
  let collector=rt.make_closure(collect,rt.global_env,0,"__nativeRun");rt.set_function_source(collector,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();rt.call(collector,Value::Undefined,&[]).unwrap();assert_eq!(rt.native_battle_gc_stats().collections,1);let mut reused=false;for _ in 0..3{let fresh=rt.object();rt.set(fresh,other,Value::Number(8.0),true).unwrap();rt.set(fresh,key,Value::Number(3.0),true).unwrap();assert_eq!(rt.get(fresh,key).unwrap(),Value::Number(3.0));reused|=rt.object_id(fresh).unwrap()==old;}assert!(reused);
 }
 #[test]fn dynamic_hint_table_is_bounded(){
  let mut rt=Runtime::new();rt.diagnostics.enabled=false;for i in 0..MAX_KEYS{rt.intern(&format!("unique-key-{i}"));}let key=rt.string("beyond-hint-bound");let object=rt.object();rt.set(object,key,Value::Number(4.0),true).unwrap();assert_eq!(rt.get(object,key).unwrap(),Value::Number(4.0));assert!(rt.dynamic_own_slots.len()<=MAX_KEYS);
 }
}
