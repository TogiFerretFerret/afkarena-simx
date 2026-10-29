//! Exact-source parser acceleration. All accepted calls allocate fresh language
//! objects; the optional plan retains only canonical tokens and integer bounds.
use crate::{Runtime,Value,StringId,ObjectId,ObjectKind,PropertyKey,Descriptor,PropertyKind,EnvId,JsResult};
pub(crate) struct StageRangeGuard{bindings:Vec<(StringId,Value)>,properties:Vec<(ObjectId,PropertyKey,Descriptor)>}
pub(crate) struct StageRangePlan{tokens:Vec<StringId>,ranges:Vec<(StringId,u32,u32)>}
fn same(a:Descriptor,b:Descriptor)->bool{a.enumerable==b.enumerable&&a.configurable==b.configurable&&match(a.kind,b.kind){(PropertyKind::Data{value:a,writable:aw},PropertyKind::Data{value:b,writable:bw})=>a==b&&aw==bw,_=>false}}
fn uint(units:&[u16])->Option<u32>{if units.is_empty()||units.len()>10{return None}let mut n=0u32;for &unit in units{if !(48..=57).contains(&unit){return None}n=n.checked_mul(10)?.checked_add(u32::from(unit-48))?;}Some(n)}
fn mode(units:&[u16])->bool{if units.is_empty()||units.len()>64{return false}let letter=|c:u16|c==95||(65..=90).contains(&c)||(97..=122).contains(&c);letter(units[0])&&units[1..].iter().all(|&c|letter(c)||(48..=57).contains(&c))}
impl Runtime {
 pub(crate) fn capture_stage_range_guard(&mut self){
  let mut bindings=Vec::new();let mut properties=Vec::new();let mut array=None;
  for name in ["Array","parseInt","isNaN","isFinite"]{let key=PropertyKey(self.intern(name));let Some(d)=self.objects[self.global_object.0].own(key)else{return};let PropertyKind::Data{value:Value::Function(f),..}=d.kind else{return};bindings.push((key.0,Value::Function(f)));properties.push((self.global_object,key,d));if name=="Array"{array=self.object_id(Value::Function(f)).ok();}}
  let Some(array)=array else{return};for(object,name)in[(array,"isArray"),(self.array_prototype,"push")]{let key=PropertyKey(self.intern(name));let Some(d)=self.objects[object.0].own(key)else{return};if !matches!(d.kind,PropertyKind::Data{value:Value::Function(_),..}){return}properties.push((object,key,d));}
  self.stage_range_guard=Some(StageRangeGuard{bindings,properties});
 }
 fn stage_range_raw_binding(&self,mut env:EnvId,name:StringId)->Option<Value>{loop{let e=self.environments.get(env.0)?;if let Some(&slot)=e.bindings.get(&name){let b=e.cells.get(slot)?;if !b.alive||!b.initialized{return None}if !b.object_backed{return Some(b.value)}break}if let Some(parent)=e.parent{env=parent}else{break}}match self.objects[self.global_object.0].own(PropertyKey(name))?.kind{PropertyKind::Data{value,..}=>Some(value),_=>None}}
 fn stage_range_intrinsics_intact(&self,parent:EnvId)->bool{
  let Some(guard)=&self.stage_range_guard else{return false};for &(name,value)in &guard.bindings{if self.stage_range_raw_binding(parent,name)!=Some(value){return false}}
  for &(object,key,expected)in &guard.properties{let Some(actual)=self.objects[object.0].own(key)else{return false};if !same(actual,expected){return false}}
  if self.objects[self.object_prototype.0].prototype.is_some()||self.objects[self.array_prototype.0].prototype!=Some(self.object_prototype){return false}
  for id in [self.object_prototype,self.array_prototype]{if self.objects[id.0].primary_numeric_mask()!=0{return false}for(key,_)in self.objects[id.0].iter_properties(){let u=self.string_units(key.0);if !u.is_empty()&&u.iter().all(|c|(48..=57).contains(c)){return false}}}true
 }
 pub fn try_native_stage_range_parser(&mut self,input:Value,parent:EnvId)->JsResult<Option<Value>>{
  if !self.native_stage_range_parser_enabled||!self.stage_range_intrinsics_intact(parent){return Ok(None)}
  let Value::Object(input)=input else{return Ok(None)};let Some(object)=self.objects.get(input.0)else{return Ok(None)};let ObjectKind::Array{length,..}=object.kind else{return Ok(None)};if length>128{return Ok(None)}
  let mut tokens=[StringId(0);128];for index in 0..length as usize{let key=self.index_property_key(index);let Some(Descriptor{kind:PropertyKind::Data{value:Value::String(token),..},..})=self.objects[input.0].own(key)else{return Ok(None)};tokens[index]=token;}
  let tokens=&tokens[..length as usize];
  if !self.stage_range_plan.as_ref().is_some_and(|plan|plan.tokens==tokens){
   let mut ranges=Vec::new();let mut current=None;let mut index=0;
   while index<tokens.len(){let token=tokens[index];let units=self.string_units(token);if let Some(lo)=uint(units){let Some(name)=current else{return Ok(None)};let Some(&next)=tokens.get(index+1)else{return Ok(None)};let Some(hi)=uint(self.string_units(next))else{return Ok(None)};ranges.push((name,lo,hi));index+=2;}else if mode(units){current=Some(token);index+=1;}else{return Ok(None)}}
   self.stage_range_plan=Some(StageRangePlan{tokens:tokens.to_vec(),ranges});
  }
  // Revalidate inherited destinations even on a canonical-token plan hit.
  let plan=self.stage_range_plan.as_ref().expect("installed plan");for &(name,_,_)in &plan.ranges{if self.objects[self.object_prototype.0].own(PropertyKey(name)).is_some(){return Ok(None)}}
  let plan=self.stage_range_plan.take().expect("installed plan");let output=self.object();let output_id=self.object_id(output)?;
  for &(name,lo,hi)in &plan.ranges{
   let key=PropertyKey(name);let group=match self.objects[output_id.0].own(key){Some(Descriptor{kind:PropertyKind::Data{value,..},..})=>value,_=>{let value=self.array(&[]);self.objects[output_id.0].insert(key,Descriptor::data(value,true,true,true));value}};
   let pair=self.array(&[Some(Value::Number(lo as f64)),Some(Value::Number(hi as f64))]);let group_id=self.object_id(group)?;let ObjectKind::Array{length,..}=self.objects[group_id.0].kind else{unreachable!()};let key=self.index_property_key(length as usize);self.define_data(group,key,pair,true,true,true)?;
  }
  self.stage_range_plan=Some(plan);Ok(Some(output))
 }
}
impl StageRangeGuard{pub(crate)fn reachability_roots(&self)->Vec<Value>{let mut out=Vec::new();for &(name,value)in &self.bindings{out.push(Value::String(name));out.push(value)}for &(object,key,descriptor)in &self.properties{out.push(Value::Object(object));out.push(Value::String(key.0));if let PropertyKind::Data{value,..}=descriptor.kind{out.push(value)}}out}}
impl StageRangePlan{pub(crate)fn reachability_roots(&self)->impl Iterator<Item=Value>+'_ {self.tokens.iter().copied().map(Value::String)}}
#[cfg(test)]mod tests {
 use super::*;
 fn input(rt:&mut Runtime,tokens:&[&str])->Value{let values=tokens.iter().map(|v|Some(rt.string(v))).collect::<Vec<_>>();rt.array(&values)}
 fn range(rt:&mut Runtime,parsed:Value,name:&str)->Value{let key=rt.string(name);let groups=rt.get(parsed,key).unwrap();let key=rt.string("0");rt.get(groups,key).unwrap()}
 #[test]fn plan_hits_allocate_fresh_objects_and_preserve_exact_uint_bits(){let mut rt=Runtime::new();rt.native_stage_range_parser_enabled=true;let input=input(&mut rt,&["stage","0000000000","4294967295"]);let a=rt.try_native_stage_range_parser(input,rt.global_env).unwrap().unwrap();let plan=rt.stage_range_plan.as_ref().unwrap().ranges.as_ptr();let pair=range(&mut rt,a,"stage");let zero=rt.string("0");let one=rt.string("1");let Value::Number(lo)=rt.get(pair,zero).unwrap()else{panic!()};let Value::Number(hi)=rt.get(pair,one).unwrap()else{panic!()};assert_eq!(lo.to_bits(),0);assert_eq!(hi.to_bits(),4294967295f64.to_bits());rt.set(pair,zero,Value::Number(99.0),true).unwrap();let b=rt.try_native_stage_range_parser(input,rt.global_env).unwrap().unwrap();assert_ne!(a,b);assert_eq!(plan,rt.stage_range_plan.as_ref().unwrap().ranges.as_ptr());let fresh=range(&mut rt,b,"stage");assert_ne!(pair,fresh);assert_eq!(rt.get(fresh,zero).unwrap(),Value::Number(0.0));}
 #[test]fn strict_domain_rejects_minus_zero_warnings_and_changed_destinations(){for tokens in [&["stage","-0","2"][..],&["1","2"][..],&["stage","1"][..],&["stage","1","bad"][..],&["constructor","1","2"][..],&["stage","1e3","2"][..]]{let mut rt=Runtime::new();rt.native_stage_range_parser_enabled=true;let input=input(&mut rt,tokens);assert!(rt.try_native_stage_range_parser(input,rt.global_env).unwrap().is_none());}}
 fn gc_entry(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,n)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(n))?;}let input=input(rt,&["stage","1","9000"]);rt.declare(env,"input",input)?;rt.declare(env,"result",Value::Undefined)?;let mut previous=std::collections::HashSet::new();let mut reuse=0;for i in 0..23{let result=rt.try_native_stage_range_parser(input,parent)?.unwrap();let id=rt.object_id(result)?;if previous.contains(&id){reuse+=1}previous.insert(id);rt.assign(env,"result",result,false)?;rt.assign(env,"battleIndex",Value::Number(i as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;let pair=range(rt,result,"stage");let key=rt.string("1");assert_eq!(rt.get(pair,key)?,Value::Number(9000.0));}assert!(reuse>0);Ok(Value::Number(rt.native_battle_gc_stats().collections as f64))}
 #[test]fn cached_tokens_and_fresh_outputs_survive_twenty_three_actual_safepoints(){let mut rt=Runtime::new();rt.native_stage_range_parser_enabled=true;let f=rt.make_closure(gc_entry,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(f,Value::Undefined,&[]).unwrap(),Value::Number(23.0));}
}
