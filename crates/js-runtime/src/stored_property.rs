//! Compact internal descriptors. Number payloads are raw bits, never NaN boxed.
use crate::{Descriptor,PropertyKind,PropertyKey,Value,StringId,ObjectId};
use crate::value::FunctionId;
pub type AccessorStorage=Option<Box<Vec<Option<(Option<Value>,Option<Value>)>>>>;
const TAG_MASK:u8=7;const WRITABLE:u8=8;const ENUMERABLE:u8=16;const CONFIGURABLE:u8=32;const TOMBSTONE:u8=128;const ACCESSOR:u8=7;
#[derive(Clone,Copy,Debug)]
pub struct StoredProperty{key:PropertyKey,payload:u64,flags:u8}
impl StoredProperty{
 #[inline]
 pub(crate) fn data(key:PropertyKey,value:Value,writable:bool,enumerable:bool,configurable:bool)->Self{let(tag,payload)=encode_value(value);Self{key,payload,flags:tag|if writable{WRITABLE}else{0}|if enumerable{ENUMERABLE}else{0}|if configurable{CONFIGURABLE}else{0}}}
 #[inline]
 pub(crate) fn accessor(key:PropertyKey,index:usize,enumerable:bool,configurable:bool)->Self{Self{key,payload:index as u64,flags:ACCESSOR|if enumerable{ENUMERABLE}else{0}|if configurable{CONFIGURABLE}else{0}}}
 #[inline]
 pub fn is_deleted(&self)->bool{self.flags&TOMBSTONE!=0}
 #[inline]
 pub fn key(&self)->Option<PropertyKey>{if self.is_deleted(){None}else{Some(self.key)}}
 #[inline]
 pub(crate) fn accessor_index(&self)->Option<usize>{if !self.is_deleted()&&self.flags&TAG_MASK==ACCESSOR{Some(self.payload as usize)}else{None}}
 #[inline]
 pub fn data_value(&self)->Option<Value>{if self.is_deleted()||self.flags&TAG_MASK==ACCESSOR{None}else{Some(decode_value(self.flags&TAG_MASK,self.payload))}}
 #[inline]
 pub(crate) fn writable(&self)->bool{self.flags&WRITABLE!=0}
 #[inline]
 pub(crate) fn set_data_value(&mut self,value:Value){let(tag,payload)=encode_value(value);self.flags=(self.flags&!TAG_MASK)|tag;self.payload=payload;}
 #[inline]
 pub(crate) fn tombstone(&mut self){self.flags=TOMBSTONE;self.payload=0;}
 #[inline]
 pub(crate) fn descriptor(&self,accessors:&AccessorStorage)->Option<Descriptor>{if self.is_deleted(){return None}let kind=if self.flags&TAG_MASK==ACCESSOR{let(get,set)=accessors.as_ref().and_then(|slots|slots.get(self.payload as usize)).and_then(|slot|*slot).expect("live accessor has a live arena slot");PropertyKind::Accessor{get,set}}else{PropertyKind::Data{value:decode_value(self.flags&TAG_MASK,self.payload),writable:self.flags&WRITABLE!=0}};Some(Descriptor{kind,enumerable:self.flags&ENUMERABLE!=0,configurable:self.flags&CONFIGURABLE!=0})}
}
#[inline]
 fn encode_value(value:Value)->(u8,u64){match value{Value::Undefined=>(0,0),Value::Null=>(1,0),Value::Bool(value)=>(2,value as u64),Value::Number(value)=>(3,value.to_bits()),Value::String(id)=>(4,id.0 as u64),Value::Object(id)=>(5,id.0 as u64),Value::Function(id)=>(6,id.0 as u64)}}
#[inline]
 fn decode_value(tag:u8,payload:u64)->Value{match tag{0=>Value::Undefined,1=>Value::Null,2=>Value::Bool(payload!=0),3=>Value::Number(f64::from_bits(payload)),4=>Value::String(StringId(payload as usize)),5=>Value::Object(ObjectId(payload as usize)),6=>Value::Function(FunctionId(payload as usize)),_=>unreachable!("accessors use their per-object arena")}}
#[cfg(test)]mod tests{use super::*;#[test]fn layout_and_all_number_bit_patterns_preserve_flags(){assert_eq!(std::mem::size_of::<StoredProperty>(),24);for bits in[0,1,0x8000000000000000,0x7ff0000000000000,0xfff0000000000000,0x7ff0000000000001,0xfff0000000001234,0x7ff8000000001234,u64::MAX]{for writable in[false,true]{for enumerable in[false,true]{for configurable in[false,true]{let stored=StoredProperty::data(PropertyKey(StringId(9)),Value::Number(f64::from_bits(bits)),writable,enumerable,configurable);let descriptor=stored.descriptor(&None).unwrap();let PropertyKind::Data{value:Value::Number(n),writable:w}=descriptor.kind else{panic!()};assert_eq!(n.to_bits(),bits);assert_eq!((w,descriptor.enumerable,descriptor.configurable),(writable,enumerable,configurable));}}}}}#[test]fn nonnumeric_values_and_tombstones(){for value in[Value::Undefined,Value::Null,Value::Bool(false),Value::Bool(true),Value::String(StringId(usize::MAX)),Value::Object(ObjectId(usize::MAX)),Value::Function(FunctionId(usize::MAX))]{let mut stored=StoredProperty::data(PropertyKey(StringId(2)),value,true,true,true);assert_eq!(stored.data_value(),Some(value));stored.tombstone();assert!(stored.key().is_none()&&stored.data_value().is_none()&&stored.descriptor(&None).is_none());}}}
