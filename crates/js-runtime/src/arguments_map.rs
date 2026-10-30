//! Sparse mapped-arguments bindings. Ordinary objects keep only a null pointer.
//! The first mapped insertion allocates; clear/remove retain storage for GC reuse.
use std::collections::{HashMap,hash_map};
use crate::{heap::PropertyKey,env::BindingRef,id_hash::IdBuildHasher};

pub type BindingMap=HashMap<PropertyKey,BindingRef,IdBuildHasher>;
#[derive(Clone,Debug,Default)]
pub struct ArgumentsMap(Option<Box<BindingMap>>);
impl ArgumentsMap {
 #[inline]pub fn is_empty(&self)->bool{self.0.as_ref().is_none_or(|map|map.is_empty())}
 #[inline]pub fn len(&self)->usize{self.0.as_ref().map_or(0,|map|map.len())}
 #[inline]pub fn capacity(&self)->usize{self.0.as_ref().map_or(0,|map|map.capacity())}
 #[inline]pub fn get(&self,key:&PropertyKey)->Option<&BindingRef>{self.0.as_ref()?.get(key)}
 #[inline]pub fn get_mut(&mut self,key:&PropertyKey)->Option<&mut BindingRef>{self.0.as_mut()?.get_mut(key)}
 #[inline]pub fn contains_key(&self,key:&PropertyKey)->bool{self.get(key).is_some()}
 #[inline]pub fn insert(&mut self,key:PropertyKey,value:BindingRef)->Option<BindingRef>{self.0.get_or_insert_with(||Box::new(BindingMap::default())).insert(key,value)}
 #[inline]pub fn remove(&mut self,key:&PropertyKey)->Option<BindingRef>{self.0.as_mut()?.remove(key)}
 #[inline]pub fn clear(&mut self){if let Some(map)=&mut self.0{map.clear();}}
 #[inline]pub fn iter(&self)->hash_map::Iter<'_,PropertyKey,BindingRef>{self.0.as_deref().map_or_else(Default::default,BindingMap::iter)}
 #[inline]pub fn iter_mut(&mut self)->hash_map::IterMut<'_,PropertyKey,BindingRef>{self.0.as_deref_mut().map_or_else(Default::default,BindingMap::iter_mut)}
 #[inline]pub fn values(&self)->hash_map::Values<'_,PropertyKey,BindingRef>{self.0.as_deref().map_or_else(Default::default,BindingMap::values)}
 #[inline]pub fn values_mut(&mut self)->hash_map::ValuesMut<'_,PropertyKey,BindingRef>{self.0.as_deref_mut().map_or_else(Default::default,BindingMap::values_mut)}
 #[inline]pub fn keys(&self)->hash_map::Keys<'_,PropertyKey,BindingRef>{self.0.as_deref().map_or_else(Default::default,BindingMap::keys)}
}
impl From<BindingMap> for ArgumentsMap {fn from(map:BindingMap)->Self{Self(if map.capacity()==0{None}else{Some(Box::new(map))})}}
impl<'a> IntoIterator for &'a ArgumentsMap {type Item=(&'a PropertyKey,&'a BindingRef);type IntoIter=hash_map::Iter<'a,PropertyKey,BindingRef>;fn into_iter(self)->Self::IntoIter{self.iter()}}
impl<'a> IntoIterator for &'a mut ArgumentsMap {type Item=(&'a PropertyKey,&'a mut BindingRef);type IntoIter=hash_map::IterMut<'a,PropertyKey,BindingRef>;fn into_iter(self)->Self::IntoIter{self.iter_mut()}}
impl IntoIterator for ArgumentsMap {type Item=(PropertyKey,BindingRef);type IntoIter=hash_map::IntoIter<PropertyKey,BindingRef>;fn into_iter(self)->Self::IntoIter{self.0.map_or_else(||BindingMap::default().into_iter(),|map|(*map).into_iter())}}
impl Extend<(PropertyKey,BindingRef)> for ArgumentsMap {fn extend<T:IntoIterator<Item=(PropertyKey,BindingRef)>>(&mut self,items:T){for(key,value)in items{self.insert(key,value);}}}
impl FromIterator<(PropertyKey,BindingRef)> for ArgumentsMap {fn from_iter<T:IntoIterator<Item=(PropertyKey,BindingRef)>>(items:T)->Self{let mut map=Self::default();map.extend(items);map}}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn header_shrinks_and_empty_reads_never_allocate(){assert_eq!(std::mem::size_of::<ArgumentsMap>(),8);assert_eq!(std::mem::size_of::<crate::heap::Object>(),136);assert_eq!(std::mem::size_of::<crate::stored_property::StoredProperty>(),24);let mut map=ArgumentsMap::default();let key=PropertyKey(crate::StringId(0));assert!(map.is_empty());assert_eq!((map.len(),map.capacity(),map.iter().len(),map.values().len()),(0,0,0,0));assert!(map.get(&key).is_none());assert!(map.get_mut(&key).is_none());assert!(map.remove(&key).is_none());map.clear();assert!(map.0.is_none());}
 #[test]fn first_insert_then_clear_retains_box_table_and_binding_identity(){let mut map=ArgumentsMap::default();let key=PropertyKey(crate::StringId(0));let binding=BindingRef::Cell{env:crate::EnvId(7),index:3};assert_eq!(map.insert(key,binding),None);let allocation=map.0.as_deref().unwrap()as*const BindingMap;let capacity=map.capacity();assert_eq!(map.get(&key),Some(&binding));assert_eq!(map.iter().len(),1);assert_eq!(map.values().next(),Some(&binding));assert_eq!((&map).into_iter().next(),Some((&key,&binding)));assert_eq!(map.remove(&key),Some(binding));assert!(map.is_empty());assert_eq!(map.capacity(),capacity);map.insert(key,binding);map.clear();assert_eq!(map.0.as_deref().unwrap()as*const BindingMap,allocation);assert_eq!(map.capacity(),capacity);assert_eq!(map.iter().count(),0);assert_eq!(map.values().count(),0);}

 fn weak_method(rt:&mut crate::Runtime,weak:crate::Value,name:&str,args:&[crate::Value])->crate::JsResult<crate::Value>{let key=rt.string(name);let function=rt.get(weak,key)?;rt.call(function,weak,args)}
 fn mapped_rounds(rt:&mut crate::Runtime,_:crate::Value,_:&[crate::Value],parent:crate::EnvId)->crate::JsResult<crate::Value>{
  use crate::Value;let env=rt.child_env(parent);for(name,n)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(n))?;}
  let constructor=rt.lookup(parent,"WeakMap")?;let weak=rt.construct(constructor,&[])?;rt.declare(env,"weak",weak)?;
  let live_env=rt.child_env(parent);rt.declare(live_env,"p",Value::Undefined)?;rt.declare(live_env,"raw",Value::Undefined)?;
  let live_args=rt.arguments_object(live_env,&["p","raw"],&[Value::Undefined,Value::Undefined],false)?;rt.declare(env,"liveArguments",live_args)?;
  let live_key=rt.object();let live_value=rt.object();rt.assign(live_env,"p",live_key,false)?;weak_method(rt,weak,"set",&[live_key,live_value])?;
  rt.declare(env,"transientArguments",Value::Undefined)?;let zero=rt.string("0");let one=rt.string("1");let mut seen=std::collections::HashSet::new();let mut reused=0;
  for round in 0..23{
   let bits=[0x8000000000000000,0x7ff0000000000042,0xfff8000000000043,1][round%4];rt.assign(live_env,"raw",Value::Number(f64::from_bits(bits)),false)?;
   let dead_key=rt.object();let dead_value=rt.object();let dead_key_id=rt.object_id(dead_key)?;let dead_value_id=rt.object_id(dead_value)?;if !seen.insert(dead_key_id){reused+=1;}
   let dead_env=rt.child_env(parent);rt.declare(dead_env,"p",Value::Undefined)?;let args=rt.arguments_object(dead_env,&["p"],&[Value::Undefined],false)?;let id=rt.object_id(args)?;rt.assign(env,"transientArguments",args,false)?;rt.assign(dead_env,"p",dead_key,false)?;weak_method(rt,weak,"set",&[dead_key,dead_value])?;
   let capacity=rt.objects[id.0].arguments_map.capacity();assert!(capacity>0);match round%3{0=>{rt.delete(args,zero,true)?;},1=>{rt.define_data(args,zero,Value::Number(-0.0),false,true,true)?;},_=>{rt.define_accessor(args,zero,None,None,true,true)?;}}
   assert!(rt.objects[id.0].arguments_map.is_empty());assert_eq!(rt.objects[id.0].arguments_map.capacity(),capacity);
   rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;
   assert!(rt.native_battle_gc.free_envs.contains(&dead_env.0));assert!(rt.native_battle_gc.free_objects.contains(&dead_key_id.0));assert!(rt.native_battle_gc.free_objects.contains(&dead_value_id.0));
   assert_eq!(weak_method(rt,weak,"has",&[dead_key])?,Value::Bool(false));assert_eq!(weak_method(rt,weak,"get",&[live_key])?,live_value);assert_eq!(rt.get(live_args,zero)?,live_key);
   let Value::Number(value)=rt.get(live_args,one)?else{panic!()};assert_eq!(value.to_bits(),bits);assert_eq!(rt.objects[id.0].arguments_map.capacity(),capacity);
  }assert!(reused>0,"dead WeakMap key IDs must actually recycle");Ok(Value::Number(23.0))
 }
 #[test]fn mapped_bindings_and_cleared_arenas_have_exact_weak_roots_across_23_source_collections(){let mut rt=crate::Runtime::new();rt.diagnostics.enabled=false;let f=rt.make_closure(mapped_rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(f,crate::Value::Undefined,&[]).unwrap(),crate::Value::Number(23.0));assert_eq!(rt.native_battle_gc_stats().collections,23);}
}
