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
pub enum ObjectKind { Ordinary, Arguments, Math, Json, Error, Date(f64), RegExp(usize), Collection(usize),CollectionIterator(usize), ArrayBuffer{buffer:crate::binary::BufferId}, DataView{buffer:crate::binary::BufferId,byte_offset:usize,byte_length:usize}, TypedArray{buffer:crate::binary::BufferId,byte_offset:usize,length:usize,kind:crate::binary::TypedArrayKind}, Array{length:u32,length_writable:bool,primary_numeric:bool,numeric_presence:u8}, BoxedString(StringId), BoxedNumber(f64), BoxedBoolean(bool) }
pub struct Object {
 pub prototype:Option<ObjectId>, pub extensible:bool, pub kind:ObjectKind,
 pub(crate) is_function:bool,
 // Authoritative Number bits for active small arrays; retained on deopt/reuse.
 pub(crate) numeric_elements:Option<Box<[u64;4]>>,
 pub properties:Vec<Option<(PropertyKey,Descriptor)>>,
 pub property_index:HashMap<PropertyKey,usize,IdBuildHasher>,
 pub arguments_map:HashMap<PropertyKey,BindingRef>,
}
pub type HeapObject=Object;
impl Object {
 pub fn new(prototype:Option<ObjectId>)->Self{Self{prototype,extensible:true,kind:ObjectKind::Ordinary,is_function:false,numeric_elements:None,properties:vec![],property_index:HashMap::default(),arguments_map:HashMap::new()}}
 pub(crate) fn reset_for_reuse(&mut self,prototype:Option<ObjectId>){self.prototype=prototype;self.extensible=true;self.kind=ObjectKind::Ordinary;self.is_function=false;self.properties.clear();self.property_index.clear();self.arguments_map.clear();}
 /// Primary values have no duplicate dictionary descriptors. Masked-out bits
 /// (including all bits after reuse/deopt) are not source properties or GC roots.
 pub(crate) fn primary_numeric_mask(&self)->u8{match self.kind{ObjectKind::Array{primary_numeric:true,numeric_presence,..}=>numeric_presence&15,_=>0}}
 pub(crate) fn primary_numeric_properties(&self)->impl Iterator<Item=(PropertyKey,Descriptor)>+'_ {
  let mask=self.primary_numeric_mask();(0..4).filter_map(move |index|{if mask&(1<<index)==0{return None}let bits=self.numeric_elements.as_ref()?[index];Some((PropertyKey(StringId(index)),Descriptor::data(Value::Number(f64::from_bits(bits)),true,true,true)))})
 }
 pub fn own(&self,key:PropertyKey)->Option<Descriptor>{
  let index=key.0.0;if index<4&&self.primary_numeric_mask()&(1<<index)!=0{if let Some(bits)=&self.numeric_elements{return Some(Descriptor::data(Value::Number(f64::from_bits(bits[index])),true,true,true))}}
  self.property_index.get(&key).and_then(|i|self.properties[*i].map(|(_,d)|d))
 }
 fn dictionary_insert(&mut self,key:PropertyKey,descriptor:Descriptor){if let Some(i)=self.property_index.get(&key).copied(){self.properties[i]=Some((key,descriptor))}else{let i=self.properties.len();self.properties.push(Some((key,descriptor)));self.property_index.insert(key,i);}}
 /// General descriptors, other value types and keys leave the primary domain.
 /// Materialization changes locations only; key order and Number bits survive.
 pub(crate) fn materialize_primary_numeric(&mut self){
  let mask=self.primary_numeric_mask();
  if let ObjectKind::Array{primary_numeric,numeric_presence,..}=&mut self.kind{*primary_numeric=false;*numeric_presence=0;}
  if mask!=0{let bits=**self.numeric_elements.as_ref().expect("present primary elements have storage");for(index,bits)in bits.into_iter().enumerate(){if mask&(1<<index)!=0{self.dictionary_insert(PropertyKey(StringId(index)),Descriptor::data(Value::Number(f64::from_bits(bits)),true,true,true));}}}
 }
 pub fn insert(&mut self,key:PropertyKey,descriptor:Descriptor){
  if matches!(self.kind,ObjectKind::Array{primary_numeric:true,..}){
   if key.0.0<4&&descriptor.enumerable&&descriptor.configurable{if let PropertyKind::Data{value:Value::Number(number),writable:true}=descriptor.kind{
    let values=self.numeric_elements.get_or_insert_with(||Box::new([0;4]));values[key.0.0]=number.to_bits();
    if let ObjectKind::Array{numeric_presence,..}=&mut self.kind{*numeric_presence|=1<<key.0.0;}return
   }}
   self.materialize_primary_numeric();
  }
  self.dictionary_insert(key,descriptor)
 }
 pub fn remove(&mut self,key:PropertyKey){
  if key.0.0<4{if let ObjectKind::Array{primary_numeric:true,numeric_presence,..}=&mut self.kind{*numeric_presence&=!(1<<key.0.0);}}
  if let Some(i)=self.property_index.remove(&key){self.properties[i]=None;}self.arguments_map.remove(&key);
 }

}

/// For-in caches each object's own keys when reached, but checks its current
/// descriptor before yielding. Deletion therefore does not yield stale keys.
pub struct ForInIterator {pub(crate) object:Option<ObjectId>,pub(crate) keys:Vec<PropertyKey>,pub(crate) cursor:usize,pub(crate) visited:std::collections::HashSet<PropertyKey>,pub(crate) prepared:bool}

#[cfg(test)]
mod primary_numeric_tests {
 use super::*;
 fn array()->Object{let mut o=Object::new(None);o.kind=ObjectKind::Array{length:4,length_writable:true,primary_numeric:true,numeric_presence:0};o}
 fn key(index:usize)->PropertyKey{PropertyKey(StringId(index))}
 fn number(bits:u64)->Descriptor{Descriptor::data(Value::Number(f64::from_bits(bits)),true,true,true)}
 fn bits(o:&Object,index:usize)->u64{let PropertyKind::Data{value:Value::Number(value),..}=o.own(key(index)).unwrap().kind else{panic!()};value.to_bits()}
 #[test]fn primary_numbers_are_authoritative_and_bit_exact(){let mut o=array();for(index,value)in[0x8000000000000000,0x7ff0000000000001,0xfff0000000001234,0x7ff8000000001234].into_iter().enumerate(){o.insert(key(index),number(value));assert_eq!(bits(&o,index),value)}assert_eq!(o.primary_numeric_mask(),15);assert!(o.properties.is_empty());assert!(o.property_index.is_empty());assert_eq!(o.primary_numeric_properties().count(),4);o.remove(key(1));assert!(o.own(key(1)).is_none());assert_eq!(o.primary_numeric_mask(),13);o.insert(key(1),number(7));assert_eq!(bits(&o,1),7);}
 #[test]fn nonnumber_and_nondefault_descriptors_materialize(){for mode in 0..5{let mut o=array();o.insert(key(0),number(0xfff0000000001234));o.insert(key(1),number(0x8000000000000000));let d=match mode{0=>Descriptor::data(Value::Null,true,true,true),1=>Descriptor::data(Value::Number(8.0),false,true,true),2=>Descriptor::data(Value::Number(8.0),true,false,true),3=>Descriptor::data(Value::Number(8.0),true,true,false),_=>Descriptor{kind:PropertyKind::Accessor{get:None,set:None},enumerable:true,configurable:true}};o.insert(key(2),d);assert_eq!(o.primary_numeric_mask(),0);assert!(matches!(o.kind,ObjectKind::Array{primary_numeric:false,..}));assert_eq!(bits(&o,0),0xfff0000000001234);assert_eq!(bits(&o,1),0x8000000000000000);assert!(o.own(key(2)).is_some());assert_eq!(o.property_index.len(),3);assert!(o.numeric_elements.is_some());}}
 #[test]fn out_of_domain_key_deopts_and_reset_retains_storage(){let mut o=array();o.insert(key(0),number(0x8000000000000000));let pointer=o.numeric_elements.as_ref().unwrap().as_ptr();o.insert(key(4),number(3));assert_eq!(o.primary_numeric_mask(),0);assert_eq!(bits(&o,0),0x8000000000000000);assert_eq!(bits(&o,4),3);o.reset_for_reuse(None);assert!(o.own(key(0)).is_none());assert_eq!(o.primary_numeric_mask(),0);assert_eq!(o.numeric_elements.as_ref().unwrap().as_ptr(),pointer);o.kind=ObjectKind::Array{length:2,length_writable:true,primary_numeric:true,numeric_presence:0};o.insert(key(1),number(9));assert_eq!(o.numeric_elements.as_ref().unwrap().as_ptr(),pointer);assert!(o.own(key(0)).is_none());assert_eq!(bits(&o,1),9);}
}
