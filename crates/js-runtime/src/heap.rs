//! Stable identity object heap. Property order and descriptors are observable.
use std::collections::HashMap;
use crate::id_hash::IdBuildHasher;
use crate::value::{Value,StringId,ObjectId};
use crate::env::BindingRef;

#[derive(Clone,Copy,Debug,PartialEq,Eq,Hash)]
pub struct PropertyKey(pub StringId);
#[derive(Clone,Copy,Debug)]
pub enum KeyInput { Value(Value), Prepared(PropertyKey) }
impl From<Value> for KeyInput {fn from(v:Value)->Self{Self::Value(v)}}
impl From<PropertyKey> for KeyInput {fn from(v:PropertyKey)->Self{Self::Prepared(v)}}
impl From<StringId> for KeyInput {fn from(v:StringId)->Self{Self::Prepared(PropertyKey(v))}}

#[derive(Clone,Copy,Debug)]
pub enum PropertyKind { Data{value:Value,writable:bool}, Accessor{get:Option<Value>,set:Option<Value>} }
#[derive(Clone,Copy,Debug)]
pub struct Descriptor { pub kind:PropertyKind,pub enumerable:bool,pub configurable:bool }
impl Descriptor {
 pub fn data(value:Value,writable:bool,enumerable:bool,configurable:bool)->Self{Self{kind:PropertyKind::Data{value,writable},enumerable,configurable}}
}
#[derive(Clone,Copy,Debug)]
pub enum ObjectKind { Ordinary, Arguments, Math, Json, Error, Date(f64), RegExp(usize), Collection(usize),CollectionIterator(usize), ArrayBuffer{buffer:crate::binary::BufferId}, DataView{buffer:crate::binary::BufferId,byte_offset:usize,byte_length:usize}, TypedArray{buffer:crate::binary::BufferId,byte_offset:usize,length:usize,kind:crate::binary::TypedArrayKind}, Array{length:u32,length_writable:bool}, BoxedString(StringId), BoxedNumber(f64), BoxedBoolean(bool) }
pub struct Object {
 pub prototype:Option<ObjectId>, pub extensible:bool, pub kind:ObjectKind,
 pub properties:Vec<Option<(PropertyKey,Descriptor)>>,
 pub property_index:HashMap<PropertyKey,usize,IdBuildHasher>,
 pub arguments_map:HashMap<PropertyKey,BindingRef>,
}
pub type HeapObject=Object;
impl Object {
 pub fn new(prototype:Option<ObjectId>)->Self{Self{prototype,extensible:true,kind:ObjectKind::Ordinary,properties:vec![],property_index:HashMap::default(),arguments_map:HashMap::new()}}
 pub fn own(&self,key:PropertyKey)->Option<Descriptor>{self.property_index.get(&key).and_then(|i|self.properties[*i].map(|(_,d)|d))}
 pub fn insert(&mut self,key:PropertyKey,descriptor:Descriptor){if let Some(i)=self.property_index.get(&key).copied(){self.properties[i]=Some((key,descriptor))}else{let i=self.properties.len();self.properties.push(Some((key,descriptor)));self.property_index.insert(key,i);}}
 pub fn remove(&mut self,key:PropertyKey){if let Some(i)=self.property_index.remove(&key){self.properties[i]=None;}self.arguments_map.remove(&key);}
}

/// For-in caches each object's own keys when reached, but checks its current
/// descriptor before yielding. Deletion therefore does not yield stale keys.
pub struct ForInIterator {pub(crate) object:Option<ObjectId>,pub(crate) keys:Vec<PropertyKey>,pub(crate) cursor:usize,pub(crate) visited:std::collections::HashSet<PropertyKey>,pub(crate) prepared:bool}
