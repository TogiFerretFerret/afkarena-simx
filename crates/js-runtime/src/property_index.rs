//! Lookup-only map. Observable JS key order always lives in Object.properties.
use crate::{PropertyKey,id_hash::IdBuildHasher};
use std::collections::HashMap;
pub const INLINE_CAPACITY:usize=2;
pub type LargePropertyIndex=HashMap<PropertyKey,usize,IdBuildHasher>;
#[cfg(not(feature="small-property-index"))]
pub type PropertyIndex=LargePropertyIndex;
#[cfg(feature="small-property-index")]
pub use small::PropertyIndex;
#[cfg(feature="small-property-index")]
mod small{
 use super::*;
 #[derive(Clone)]pub enum PropertyIndex{Small{entries:[(PropertyKey,usize);INLINE_CAPACITY],len:u8},Large(LargePropertyIndex)}
 impl Default for PropertyIndex{fn default()->Self{Self::Small{entries:[(PropertyKey(crate::StringId(0)),0);INLINE_CAPACITY],len:0}}}
 impl PropertyIndex{
  pub fn new()->Self{Self::default()}
  pub fn with_capacity(capacity:usize)->Self{if capacity<=INLINE_CAPACITY{Self::default()}else{Self::Large(LargePropertyIndex::with_capacity_and_hasher(capacity,IdBuildHasher::default()))}}
  #[inline]pub fn len(&self)->usize{match self{Self::Small{len,..}=>*len as usize,Self::Large(map)=>map.len()}}
  pub fn is_empty(&self)->bool{self.len()==0}
  pub fn capacity(&self)->usize{match self{Self::Small{..}=>INLINE_CAPACITY,Self::Large(map)=>map.capacity()}}
  #[inline]pub fn get(&self,key:&PropertyKey)->Option<&usize>{match self{Self::Small{entries,len}=>entries[..*len as usize].iter().find(|(k,_)|k==key).map(|(_,v)|v),Self::Large(map)=>map.get(key)}}
  pub fn get_mut(&mut self,key:&PropertyKey)->Option<&mut usize>{match self{Self::Small{entries,len}=>entries[..*len as usize].iter_mut().find(|(k,_)|k==key).map(|(_,v)|v),Self::Large(map)=>map.get_mut(key)}}
  pub fn contains_key(&self,key:&PropertyKey)->bool{self.get(key).is_some()}
  pub fn clear(&mut self){match self{Self::Small{len,..}=>*len=0,Self::Large(map)=>map.clear()}}
  fn grow(&mut self,capacity:usize){let old=std::mem::take(self);let mut map=LargePropertyIndex::with_capacity_and_hasher(capacity,IdBuildHasher::default());match old{Self::Small{entries,len}=>map.extend(entries.into_iter().take(len as usize)),Self::Large(previous)=>map.extend(previous)}*self=Self::Large(map);}
  pub fn reserve(&mut self,additional:usize){match self{Self::Small{len,..}=>{let capacity=(*len as usize).saturating_add(additional);if capacity>INLINE_CAPACITY{self.grow(capacity)}},Self::Large(map)=>map.reserve(additional)}}
  #[inline]pub fn insert(&mut self,key:PropertyKey,value:usize)->Option<usize>{match self{
   Self::Small{entries,len}=>{let size=*len as usize;if let Some((_,old))=entries[..size].iter_mut().find(|(k,_)|*k==key){return Some(std::mem::replace(old,value))}if size<INLINE_CAPACITY{entries[size]=(key,value);*len+=1;return None}self.grow(INLINE_CAPACITY+1);self.insert(key,value)},Self::Large(map)=>map.insert(key,value)}}
  pub fn remove(&mut self,key:&PropertyKey)->Option<usize>{match self{Self::Small{entries,len}=>{let size=*len as usize;let index=entries[..size].iter().position(|(k,_)|k==key)?;let value=entries[index].1;entries[index]=entries[size-1];*len-=1;Some(value)},Self::Large(map)=>map.remove(key)}}
  pub fn iter(&self)->Iter<'_>{match self{Self::Small{entries,len}=>Iter::Small(entries[..*len as usize].iter()),Self::Large(map)=>Iter::Large(map.iter())}}
  pub fn keys(&self)->impl Iterator<Item=&PropertyKey>{self.iter().map(|(key,_)|key)}
  pub fn values(&self)->impl Iterator<Item=&usize>{self.iter().map(|(_,value)|value)}
 }
 pub enum Iter<'a>{Small(std::slice::Iter<'a,(PropertyKey,usize)>),Large(std::collections::hash_map::Iter<'a,PropertyKey,usize>)}
 impl<'a>Iterator for Iter<'a>{type Item=(&'a PropertyKey,&'a usize);fn next(&mut self)->Option<Self::Item>{match self{Self::Small(iter)=>iter.next().map(|(k,v)|(k,v)),Self::Large(iter)=>iter.next()}}fn size_hint(&self)->(usize,Option<usize>){match self{Self::Small(iter)=>iter.size_hint(),Self::Large(iter)=>iter.size_hint()}}}
 impl ExactSizeIterator for Iter<'_>{}
 impl std::ops::Index<&PropertyKey> for PropertyIndex{type Output=usize;fn index(&self,key:&PropertyKey)->&usize{self.get(key).expect("no entry found for key")}}
 impl Extend<(PropertyKey,usize)> for PropertyIndex{fn extend<T:IntoIterator<Item=(PropertyKey,usize)>>(&mut self,iter:T){for(k,v)in iter{self.insert(k,v);}}}
 impl FromIterator<(PropertyKey,usize)> for PropertyIndex{fn from_iter<T:IntoIterator<Item=(PropertyKey,usize)>>(iter:T)->Self{let mut map=Self::default();map.extend(iter);map}}
 impl From<LargePropertyIndex>for PropertyIndex{fn from(map:LargePropertyIndex)->Self{if map.len()<=4{map.into_iter().collect()}else{Self::Large(map)}}}
}
#[cfg(test)]mod tests{
 use super::*;
 fn key(n:usize)->PropertyKey{PropertyKey(crate::StringId(n))}
 #[test]fn operations_match_reference_through_growth_deletion_clone_and_clear(){let mut actual=PropertyIndex::default();let mut reference=LargePropertyIndex::default();let mut state=21u64;for step in 0..20000{state=state.wrapping_mul(6364136223846793005).wrapping_add(1);let k=key((state>>32)as usize%17);match state%5{0=>assert_eq!(actual.remove(&k),reference.remove(&k)),1|2=>assert_eq!(actual.insert(k,step),reference.insert(k,step)),3=>{let copy=actual.clone();for(k,v)in &reference{assert_eq!(copy.get(k),Some(v))}},_=>assert_eq!(actual.get(&k),reference.get(&k))}assert_eq!(actual.len(),reference.len());for n in 0..17{assert_eq!(actual.contains_key(&key(n)),reference.contains_key(&key(n)));}if step%997==0{let capacity=actual.capacity();actual.clear();reference.clear();assert_eq!(actual.capacity(),capacity);}}}
 #[test]fn four_entry_replacement_removal_mutation_reserve_and_iteration(){let mut map=PropertyIndex::default();map.reserve(4);for n in 0..4{assert_eq!(map.insert(key(n),n+100),None)}assert_eq!(map.remove(&key(1)),Some(101));assert_eq!(map.get(&key(3)),Some(&103));assert_eq!(map.insert(key(9),109),None);assert_eq!(map.insert(key(0),200),Some(100));assert_eq!(map.len(),4);*map.get_mut(&key(9)).unwrap()=209;let mut entries=map.iter().map(|(k,v)|(k.0.0,*v)).collect::<Vec<_>>();entries.sort();assert_eq!(entries,vec![(0,200),(2,102),(3,103),(9,209)]);assert_eq!(map.keys().count(),4);assert_eq!(map.values().count(),4);map.reserve(10);assert!(map.capacity()>=14);for(k,v)in entries{assert_eq!(map.get(&key(k)),Some(&v))}assert_eq!(map.insert(key(5),105),None);assert_eq!(map.len(),5);let capacity=map.capacity();map.clear();assert!(map.is_empty());assert_eq!(map.capacity(),capacity);}
 #[cfg(feature="small-property-index")]
 #[test]fn inline_boundary_and_removal_stay_heap_free(){let mut map=PropertyIndex::default();assert!(matches!(map,PropertyIndex::Small{len:0,..}));for n in 0..INLINE_CAPACITY{map.insert(key(n),100+n);}assert!(matches!(map,PropertyIndex::Small{..}));assert_eq!(map.remove(&key(0)),Some(100));map.insert(key(90),190);assert_eq!(map.get(&key(90)),Some(&190));assert!(matches!(map,PropertyIndex::Small{..}));map.insert(key(91),191);assert!(matches!(map,PropertyIndex::Large(_)));assert_eq!(map.len(),INLINE_CAPACITY+1);}
 #[test]fn physical_property_tombstones_and_descriptors_survive_index_growth(){let mut object=crate::heap::Object::new(None);for n in 0..7{object.insert(key(n),crate::Descriptor::data(crate::Value::Number(n as f64),true,n%2==0,false));}object.remove(key(2));object.remove(key(0));object.insert(key(2),crate::Descriptor::data(crate::Value::Number(-0.0),false,true,true));let live=object.properties.iter().flatten().map(|(k,_)|k.0.0).collect::<Vec<_>>();assert_eq!(live,vec![1,3,4,5,6,2]);assert_eq!(object.property_index[&key(2)],7);let d=object.own(key(2)).unwrap();assert!(!matches!(d.kind,crate::PropertyKind::Data{writable:true,..}));let crate::PropertyKind::Data{value:crate::Value::Number(n),..}=d.kind else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());}
}
