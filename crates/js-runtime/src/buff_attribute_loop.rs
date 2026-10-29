//! Exact-source loop splice. Source prefix callbacks have already executed.
//! Admit a bounded, callback-free numeric domain; validate every write first.
use crate::{Runtime,Value,ObjectId,ObjectKind,PropertyKey,PropertyKind,EnvId};
use battle_core::js_math::{add,mul};
impl Runtime {
 fn buff_plain(&self,id:ObjectId)->bool{self.objects.get(id.0).is_some_and(|o|matches!(o.kind,ObjectKind::Ordinary)&&!o.is_function&&o.arguments_map.is_empty())}
 fn buff_data(&self,mut id:ObjectId,key:PropertyKey,forbidden:Option<ObjectId>)->Option<Value>{let mut budget=self.objects.len();loop{if budget==0||Some(id)==forbidden||!self.buff_plain(id){return None}budget-=1;let o=&self.objects[id.0];if let Some(d)=o.own(key){return match d.kind{PropertyKind::Data{value,..}=>Some(value),_=>None}}match o.prototype{Some(p)=>id=p,None=>return Some(Value::Undefined)}}}
 fn buff_own_data(&self,id:ObjectId,key:PropertyKey)->Option<Value>{if !self.buff_plain(id){return None}match self.objects[id.0].own(key)?.kind{PropertyKind::Data{value,..}=>Some(value),_=>None}}
 fn buff_raw_binding(&self,mut env:EnvId,key:PropertyKey)->Option<Value>{let mut budget=self.environments.len();loop{if budget==0{return None}budget-=1;let e=self.environments.get(env.0)?;if let Some(&slot)=e.bindings.get(&key.0){let b=e.cells.get(slot)?;if !b.alive||!b.initialized{return None}return if b.object_backed{self.buff_own_data(self.global_object,key)}else{Some(b.value)}}env=e.parent?;}}
 /// `e,t,a,i,r,n` are source locals after the unchanged for initializer.
 /// A miss does no source-visible work, and continues at the original loop.
 pub fn try_native_buff_percent_loop(&mut self,this:Value,e:Value,t:Value,a:Value,i:Value,r:Value,n:Value,parent:EnvId)->bool{
  if !self.buff_attribute_loop_enabled{return false}self.buff_percent_loop_attempts=self.buff_percent_loop_attempts.wrapping_add(1);
  // The original initializer (including all callbacks) already completed.
  // With l=+0 and Number n, this failed first test executes no body reads.
  if matches!(n,Value::Number(length)if !(0.0<length)){self.buff_percent_loop_hits=self.buff_percent_loop_hits.wrapping_add(1);return true}
  if self.truthy(a){return false}
  let(Value::Object(receiver),Value::Object(info),Value::Object(target),Value::Number(length))=(this,e,t,n)else{return false};
  if !length.is_finite()||length<0.0||length>64.0||length.fract()!=0.0||!self.buff_plain(target)||receiver==target||info==target{return false}
  let names=["ed","attrib","attrib_names_x","attrib_names_a","caster_attribs","AddSource","owner","HPR","MPR"];let keys=names.map(|s|PropertyKey(self.intern(s)));
  let object=|v|if let Value::Object(id)=v{Some(id)}else{None};
  let Some(ed)=self.buff_raw_binding(parent,keys[0]).and_then(object)else{return false};
  let Some(list)=self.buff_own_data(receiver,keys[1]).and_then(object)else{return false};
  let Some(xmap)=self.buff_data(ed,keys[2],Some(target)).and_then(object)else{return false};
  let Some(amap)=self.buff_data(ed,keys[3],Some(target)).and_then(object)else{return false};
  let Some(caster)=self.buff_own_data(receiver,keys[4]).and_then(object)else{return false};if caster==target{return false}
  let Some(add_source)=self.buff_data(info,keys[5],Some(target))else{return false};
  if self.truthy(add_source)&&matches!(add_source,Value::String(id)if self.string_units(id)==[111,119,110,101,114]){return false}
  let Some(owner)=self.buff_own_data(receiver,keys[6]).and_then(object)else{return false};if owner==target{return false}
  let Some(array)=self.objects.get(list.0)else{return false};if array.is_function||!array.arguments_map.is_empty()||!matches!(array.kind,ObjectKind::Array{length:actual,..}if actual>=length as u32){return false}
  let mut plan=[None;64];let mut seen=[PropertyKey(crate::StringId(0));64];
  for index in 0..length as usize{
   let index_key=self.index_property_key(index);let Some(d)=self.objects[list.0].own(index_key)else{return false};let PropertyKind::Data{value:Value::String(attr),..}=d.kind else{return false};let key=PropertyKey(attr);if seen[..index].contains(&key){return false}seen[index]=key;
   let Some(Value::String(coefficient_key))=self.buff_data(xmap,key,Some(target))else{return false};let Some(coefficient)=self.buff_data(info,PropertyKey(coefficient_key),Some(target))else{return false};if !self.truthy(coefficient){continue}let Value::Number(coefficient)=coefficient else{return false};if !coefficient.is_finite(){return false}
   let Some(Value::String(basis_key))=self.buff_data(amap,key,Some(target))else{return false};let Some(Value::String(basis_name))=self.buff_data(info,PropertyKey(basis_key),Some(target))else{return false};let Some(basis)=self.buff_data(caster,PropertyKey(basis_name),Some(target))else{return false};let basis=if !self.truthy(basis){0.0}else if let Value::Number(n)=basis{n}else{return false};if !basis.is_finite(){return false}
   let amount=add(0.0,mul(basis,coefficient));if !amount.is_finite(){return false}if amount==0.0{continue}if key!=keys[7]&&key!=keys[8]&&!((amount>0.0&&!self.truthy(i))||(amount<0.0&&!self.truthy(r))){continue}
   let Some(&slot)=self.objects[target.0].property_index.get(&key)else{return false};let Some(d)=self.objects[target.0].own_slot(slot,key)else{return false};let PropertyKind::Data{value:Value::Number(current),writable:true}=d.kind else{return false};if !current.is_finite(){return false}let value=add(current,amount);if !value.is_finite(){return false}plan[index]=Some((slot,key,value));
  }
  // No callback, allocation, type guard, or fallible operation follows a write.
  for operation in plan.into_iter().flatten(){let(slot,key,value)=operation;assert!(self.objects[target.0].set_existing_data_slot(slot,key,Value::Number(value)),"validated descriptor")}
  self.buff_percent_loop_hits=self.buff_percent_loop_hits.wrapping_add(1);true
 }
}
#[cfg(test)]mod tests{
 use super::*;use crate::JsResult;
 fn put(rt:&mut Runtime,o:Value,key:&str,value:Value){let key=rt.string(key);rt.define_data(o,key,value,true,true,true).unwrap();}
 fn entry(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}let ed=rt.object();let xmap=rt.object();let amap=rt.object();let x=rt.string("ATK.x");let a=rt.string("ATK.a");put(rt,xmap,"ATK",x);put(rt,amap,"ATK",a);put(rt,ed,"attrib_names_x",xmap);put(rt,ed,"attrib_names_a",amap);rt.declare(parent,"ed",ed)?;let mut previous=std::collections::HashSet::new();let mut reused=0;
 for round in 0..23{let this=rt.object();let id=rt.object_id(this)?;if !previous.insert(id){reused+=1}let owner=rt.object();let target=rt.object();let info=rt.object();let caster=rt.object();let name=rt.string("ATK");put(rt,target,"ATK",Value::Number(10.0+round as f64));put(rt,caster,"ATK",Value::Number(8.0));put(rt,info,"ATK.x",Value::Number(0.5));put(rt,info,"ATK.a",name);put(rt,this,"owner",owner);put(rt,this,"caster_attribs",caster);let list=rt.array(&[Some(name)]);put(rt,this,"attrib",list);assert!(rt.try_native_buff_percent_loop(this,info,target,Value::Null,Value::Bool(false),Value::Bool(false),Value::Number(1.0),parent));let key=rt.string("ATK");let Value::Number(value)=rt.get(target,key)?else{panic!()};assert_eq!(value.to_bits(),(14.0+round as f64).to_bits());rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;}
 assert!(reused>0);assert!(rt.native_battle_gc_stats().objects_freed>23);assert_eq!(rt.buff_percent_loop_hits,23);Ok(Value::Number(23.0))}
 #[test]fn twenty_three_actual_source_safepoints_reuse_objects_without_stale_loop_slots(){let mut rt=Runtime::new();rt.diagnostics.enabled=false;rt.enable_native_battle_gc();let f=rt.make_closure_with_flags(entry,rt.global_env,0,"__nativeRun",false,None);rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();assert_eq!(rt.call(f,Value::Undefined,&[]).unwrap(),Value::Number(23.0));assert_eq!(rt.native_battle_gc_stats().collections,23);}
}
