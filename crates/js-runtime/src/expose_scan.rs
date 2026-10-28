//! Guarded acceleration of the exact source loader's callback-free name scan.
//! Getter installation, factory calls, recursion and their ordering stay source.
use crate::{Runtime,Value,EnvId,ObjectKind,PropertyKey,Descriptor,PropertyKind,JsResult};
#[derive(Clone)]pub(crate) struct ExposeScanGuard{methods:Vec<(PropertyKey,Descriptor)>}
impl ExposeScanGuard{pub(crate) fn reachability_roots(&self)->Vec<Value>{self.methods.iter().flat_map(|(k,d)|{let mut v=vec![Value::String(k.0)];if let PropertyKind::Data{value,..}=d.kind{v.push(value)}v}).collect()}}
fn equal(a:Descriptor,b:Descriptor)->bool{a.enumerable==b.enumerable&&a.configurable==b.configurable&&match(a.kind,b.kind){(PropertyKind::Data{value:a,writable:aw},PropertyKind::Data{value:b,writable:bw})=>a==b&&aw==bw,_=>false}}
impl Runtime{
 pub(crate) fn capture_expose_scan_guard(&mut self){let mut methods=vec![];for name in ["indexOf","slice","split"]{let key=PropertyKey(self.intern(name));let Some(d)=self.objects[self.string_prototype.0].own(key)else{return};methods.push((key,d));}self.expose_scan_guard=Some(ExposeScanGuard{methods});}
 fn expose_raw_binding(&mut self,mut env:EnvId,name:&str)->Option<Value>{let name=self.intern(name);loop{let e=self.environments.get(env.0)?;if let Some(&slot)=e.bindings.get(&name){let b=e.cells.get(slot)?;if !b.alive||!b.initialized{return None}if !b.object_backed{return Some(b.value)}break}if let Some(parent)=e.parent{env=parent}else{break}}let d=self.objects[self.global_object.0].own(PropertyKey(name))?;if let PropertyKind::Data{value,..}=d.kind{Some(value)}else{None}}
 pub fn try_native_expose_scan(&mut self,env:EnvId,parent:EnvId)->JsResult<bool>{
  if parent!=self.global_env{return Ok(false)}
  let Some(guard)=&self.expose_scan_guard else{return Ok(false)};
  for &(key,expected)in &guard.methods{let Some(actual)=self.objects[self.string_prototype.0].own(key)else{return Ok(false)};if !equal(actual,expected){return Ok(false)}}
  let Some(Value::String(prefix))=self.expose_raw_binding(env,"prefix")else{return Ok(false)};
  let Some(Value::Object(keys))=self.expose_raw_binding(env,"keys")else{return Ok(false)};
  let target=&self.objects[keys.0];if !matches!(target.kind,ObjectKind::Ordinary)||target.prototype.is_some()||!target.extensible||target.properties.iter().any(Option::is_some){return Ok(false)}
  let Some(Value::Object(names))=self.expose_raw_binding(env,"__nativeDefinitionNames")else{return Ok(false)};
  let array=&self.objects[names.0];let ObjectKind::Array{length,..}=array.kind else{return Ok(false)};
  if array.primary_numeric_mask()!=0||array.prototype!=Some(self.array_prototype){return Ok(false)}
  // Validate every read before doing any work. A hole/accessor/prototype read
  // must fall back without invoking any getter or performing a source write.
  // Sparse source arrays can have a huge logical length. Reject before sizing
  // temporary storage: the original loop can throw at its first missing read.
  if length as usize > array.properties.len(){return Ok(false)}
  let mut strings=Vec::with_capacity(length as usize);
  for index in 0..length{let Some(Some((key,desc)))=self.objects[names.0].properties.get(index as usize)else{return Ok(false)};let units=self.string_units(key.0);if units.is_empty()||(units.len()>1&&units[0]==48){return Ok(false)}let mut number=0u64;for &digit in units{if !(48..=57).contains(&digit){return Ok(false)}let Some(next)=number.checked_mul(10).and_then(|n|n.checked_add((digit-48)as u64))else{return Ok(false)};number=next;}if number!=index as u64{return Ok(false)}let PropertyKind::Data{value:Value::String(s),..}=desc.kind else{return Ok(false)};strings.push(s);}
  let mut needle=self.string_units(prefix).to_vec();needle.push(b'.' as u16);let offset=needle.len();let mut output=vec![];
  for &name in &strings{let full=self.string_units(name);if full.starts_with(&needle){let tail=&full[offset..];let end=tail.iter().position(|&x|x==b'.' as u16).unwrap_or(tail.len());output.push(tail[..end].to_vec());}}
  for units in output{let key=Value::String(self.intern_utf16(&units));self.define_data(Value::Object(keys),key,Value::Bool(true),true,true,true)?;}
  self.assign(env,"i",Value::Number(length as f64),false)?;
  if let Some(&last)=strings.last(){self.assign(env,"full",Value::String(last),false)?;}
  Ok(true)
 }
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn raw_guard_hits_and_mutated_methods_fall_back(){let mut rt=Runtime::new();let env=rt.child_env(rt.global_env);let prefix=rt.string("ed");let keys=Value::Object(rt.alloc_object(None));rt.declare(env,"prefix",prefix).unwrap();rt.declare(env,"keys",keys).unwrap();rt.declare(env,"i",Value::Undefined).unwrap();rt.declare(env,"full",Value::Undefined).unwrap();let a=rt.string("ed.a.x");let b=rt.string("ed.b");let names=rt.array(&[Some(a),Some(b)]);rt.declare(rt.global_env,"__nativeDefinitionNames",names).unwrap();assert!(rt.try_native_expose_scan(env,rt.global_env).unwrap());let akey=rt.string("a");assert_eq!(rt.get(keys,akey).unwrap(),Value::Bool(true));assert_eq!(rt.lookup(env,"i").unwrap(),Value::Number(2.0));assert_eq!(rt.lookup(env,"full").unwrap(),b);let key=rt.string("indexOf");rt.define_data(Value::Object(rt.string_prototype),key,Value::Null,true,true,true).unwrap();assert!(!rt.try_native_expose_scan(env,rt.global_env).unwrap());}
}
