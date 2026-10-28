//! Hash policy only for lookup-only canonical string caches. Canonical IDs still
//! come from insertion order in Runtime::strings; full key equality is retained.
//! No JS enumeration iterates these maps. The selector keeps comparison builds
//! on the same runtime layout and generated code.
use std::collections::hash_map::{RandomState,DefaultHasher};
use std::hash::{BuildHasher,Hasher};
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum StringHashMode{Sip,Fx}
#[derive(Clone)]
pub enum StringBuildHasher{Sip(RandomState),Fx}
impl StringBuildHasher{pub fn new(mode:StringHashMode)->Self{match mode{StringHashMode::Sip=>Self::Sip(RandomState::new()),StringHashMode::Fx=>Self::Fx}}}
pub enum StringHasher{Sip(DefaultHasher),Fx(FxHasher)}
impl BuildHasher for StringBuildHasher{type Hasher=StringHasher;#[inline]fn build_hasher(&self)->Self::Hasher{match self{Self::Sip(seed)=>StringHasher::Sip(seed.build_hasher()),Self::Fx=>StringHasher::Fx(FxHasher::default())}}}
macro_rules! dispatch{($self:ident,$method:ident,$value:expr)=>{match $self{Self::Sip(h)=>h.$method($value),Self::Fx(h)=>h.$method($value)}}}
impl Hasher for StringHasher{
 #[inline]fn finish(&self)->u64{match self{Self::Sip(h)=>h.finish(),Self::Fx(h)=>h.finish()}}
 #[inline]fn write(&mut self,v:&[u8]){dispatch!(self,write,v)}
 #[inline]fn write_u8(&mut self,v:u8){dispatch!(self,write_u8,v)}
 #[inline]fn write_u16(&mut self,v:u16){dispatch!(self,write_u16,v)}
 #[inline]fn write_u32(&mut self,v:u32){dispatch!(self,write_u32,v)}
 #[inline]fn write_u64(&mut self,v:u64){dispatch!(self,write_u64,v)}
 #[inline]fn write_usize(&mut self,v:usize){dispatch!(self,write_usize,v)}
}
#[derive(Default)]
pub struct FxHasher(u64);
impl FxHasher{#[inline]fn word(&mut self,value:u64){self.0=(self.0.rotate_left(5)^value).wrapping_mul(0x517c_c1b7_2722_0a95);}}
impl Hasher for FxHasher{
 #[inline]fn finish(&self)->u64{self.0}
 #[inline]fn write(&mut self,mut bytes:&[u8]){
  while bytes.len()>=8{self.word(u64::from_le_bytes(bytes[..8].try_into().unwrap()));bytes=&bytes[8..];}
  if bytes.len()>=4{self.word(u32::from_le_bytes(bytes[..4].try_into().unwrap())as u64);bytes=&bytes[4..];}
  if bytes.len()>=2{self.word(u16::from_le_bytes(bytes[..2].try_into().unwrap())as u64);bytes=&bytes[2..];}
  if let Some(&byte)=bytes.first(){self.word(byte as u64);}
 }
 #[inline]fn write_u8(&mut self,v:u8){self.word(v as u64)}
 #[inline]fn write_u16(&mut self,v:u16){self.word(v as u64)}
 #[inline]fn write_u32(&mut self,v:u32){self.word(v as u64)}
 #[inline]fn write_u64(&mut self,v:u64){self.word(v)}
 #[inline]fn write_usize(&mut self,v:usize){self.word(v as u64)}
}
#[cfg(test)]mod tests{
 use super::*;use crate::{Runtime,Value};use std::hash::Hash;
 #[test]fn canonical_id_sequence_matches_sip_for_unicode_nuls_surrogates_and_static_forms(){
  let mut sip=Runtime::new_with_string_hash(StringHashMode::Sip);let mut fx=Runtime::new_with_string_hash(StringHashMode::Fx);
  for text in["","x","position","\0","a\0b","é","e\u{301}","中","😀","123456789012345678901234567890123456789"]{assert_eq!(sip.intern(text),fx.intern(text));let u=text.encode_utf16().collect::<Vec<_>>();assert_eq!(sip.intern_utf16(&u),fx.intern_utf16(&u));}
  let mut state=0x1234abcdu32;for i in 0..20000{let mut units=Vec::new();for _ in 0..i%39{state^=state<<13;state^=state>>17;state^=state<<5;units.push(state as u16);}assert_eq!(sip.intern_utf16(&units),fx.intern_utf16(&units));assert_eq!(sip.intern_utf16(&units),fx.intern_utf16(&units));assert_eq!(sip.intern("repeat"),fx.intern("repeat"));}
  assert_ne!(fx.intern_utf16(&[0xd800]),fx.intern_utf16(&[0xfffd]));assert_eq!(sip.static_string("position"),fx.static_string("position"));assert_eq!(sip.static_string_utf16(&[112,111,115,105,116,105,111,110]),fx.static_string_utf16(&[112,111,115,105,116,105,111,110]));assert_eq!(fx.static_string("position"),Value::String(fx.intern("position")));
 }
 #[test]fn deliberate_full_fx_collision_still_keeps_distinct_canonical_strings(){
  let mut start=FxHasher::default();start.write_usize(8);let mut a=FxHasher(start.0);a.word(0);let mut b=FxHasher(start.0);b.word(1);let second=a.0.rotate_left(5)^b.0.rotate_left(5);
  let units=|first:u64,last:u64|[first.to_le_bytes(),last.to_le_bytes()].concat().chunks_exact(2).map(|p|u16::from_le_bytes([p[0],p[1]])).collect::<Vec<_>>();let left=units(0,0);let right=units(1,second);let digest=|u:&Vec<u16>|{let mut h=FxHasher::default();u.hash(&mut h);h.finish()};assert_ne!(left,right);assert_eq!(digest(&left),digest(&right));let mut rt=Runtime::new_with_string_hash(StringHashMode::Fx);let x=rt.intern_utf16(&left);let y=rt.intern_utf16(&right);assert_ne!(x,y);assert_eq!(rt.intern_utf16(&left),x);assert_eq!(rt.intern_utf16(&right),y);
 }
}
