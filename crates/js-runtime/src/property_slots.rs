//! Guarded own-data slot reads. Cache entries contain locations, never Values.
//! Each generated read site owns a distinct mutable static ticket, so separate
//! modules and compileSource invocations cannot collide on local ordinals.
use std::sync::atomic::{AtomicUsize,Ordering};
use crate::{Runtime,Value,JsResult,JsError,ObjectKind,PropertyKey,PropertyKind,KeyInput};
static NEXT_SITE:AtomicUsize=AtomicUsize::new(1);
pub struct LiteralReadSite { ticket:AtomicUsize,text:&'static str,is_length:bool }
impl LiteralReadSite {
    pub const fn new(text:&'static str)->Self{Self{ticket:AtomicUsize::new(0),text,is_length:text.len()==6&&text.as_bytes()[0]==b'l'&&text.as_bytes()[1]==b'e'&&text.as_bytes()[2]==b'n'&&text.as_bytes()[3]==b'g'&&text.as_bytes()[4]==b't'&&text.as_bytes()[5]==b'h'}}
    #[inline]
    fn index(&self)->JsResult<usize>{
        let mut id=self.ticket.load(Ordering::Relaxed);
        if id==0{let next=NEXT_SITE.fetch_add(1,Ordering::Relaxed);if next==0||next==usize::MAX{return Err(JsError::Unsupported("literal read site space exhausted".into()))}id=match self.ticket.compare_exchange(0,next,Ordering::Relaxed,Ordering::Relaxed){Ok(_)=>next,Err(actual)=>actual};}
        Ok(id)
    }
}
// Canonical string IDs and physical property indices originate from non-ZST
// Vecs, whose valid indices cannot reach usize::MAX. No Values are cached.
#[derive(Clone,Copy)]
pub(crate) struct CachedSlot { key:usize,index:usize }
impl Default for CachedSlot{fn default()->Self{Self{key:usize::MAX,index:usize::MAX}}}
impl Runtime {
 pub(crate) fn invalidate_reclaimed_literal_string_keys(&mut self,reclaimed:&[bool]){for entry in &mut self.literal_property_slots{if reclaimed.get(entry.key).copied().unwrap_or(false){*entry=CachedSlot::default();}}}

    #[inline]
    pub fn get_literal_cached(&mut self,receiver:Value,site:&'static LiteralReadSite)->JsResult<Value>{
        if !self.literal_property_slots_enabled{let key=self.static_string(site.text);return self.get(receiver,key)}
        // These nonconfigurable own virtual descriptors precede every raw
        // property/prototype lookup and cannot invoke a source callback.
        if site.is_length&&self.literal_length_fast_path_enabled {
            let length=match receiver{
                Value::String(id)=>Some(self.string_units(id).len()),
                Value::Object(id)=>self.objects.get(id.0).filter(|object|!object.is_function).and_then(|object|match object.kind{ObjectKind::Array{length,..}=>Some(length as usize),ObjectKind::BoxedString(id)=>Some(self.string_units(id).len()),_=>None}),
                _=>None,
            };
            if let Some(length)=length{let result=Ok(Value::Number(length as f64));if self.diagnostics.enabled{let key=self.static_string(site.text);self.record_get(receiver,KeyInput::Value(key),&result);}return result}
        }
        let id=site.index()?;
        if self.literal_property_slots.len()<=id{self.literal_property_slots.resize(id+1,CachedSlot::default());}
        let entry=self.literal_property_slots[id];
        let key=if entry.key!=usize::MAX{PropertyKey(crate::StringId(entry.key))}else{let key=PropertyKey(self.intern(site.text));self.literal_property_slots[id].key=key.0.0;key};
        if let Value::Object(object)=receiver {
            if let Some(object)=self.objects.get(object.0){
                if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..}){
                        if let Some(Some((actual,descriptor)))=object.properties.get(entry.index){
                            if *actual==key {if let PropertyKind::Data{value,..}=descriptor.kind{let result=Ok(value);self.record_get(receiver,KeyInput::Value(Value::String(key.0)),&result);return result}}
                        }
                }
            }
        }
        let result=self.get(receiver,Value::String(key.0));
        // A callback on the slow path can mutate the object. Only the current
        // physical own descriptor determines what may be cached for next time.
        if let Value::Object(object)=receiver {
            if let Some(object)=self.objects.get(object.0){
                if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..}){
                    if let Some(index)=object.property_index.get(&key).copied(){if matches!(object.properties.get(index),Some(Some((actual,crate::Descriptor{kind:PropertyKind::Data{..},..})))if *actual==key){self.literal_property_slots[id].index=index;}}
                }
            }
        }
        result
    }
}

#[cfg(test)]mod length_tests{use super::*;static LENGTH:LiteralReadSite=LiteralReadSite::new("length");
#[test]fn fast_length_records_exactly_one_get_and_zero_has_positive_zero_bits(){let mut rt=Runtime::new();rt.diagnostics=crate::diagnostics::Diagnostics::from_env();rt.diagnostics.enabled=true;let array=rt.array(&[]);let before=rt.diagnostics.reachability_roots().len();let Value::Number(n)=rt.get_literal_cached(array,&LENGTH).unwrap()else{panic!()};assert_eq!(n.to_bits(),0);let after=rt.diagnostics.reachability_roots().len();assert_eq!(after,before+3);}
}

#[cfg(test)]mod packed_slot_tests{
 use super::*;
 #[test]fn empty_sentinels_and_reclaimed_keys_clear_physical_hints(){
  assert_eq!(std::mem::size_of::<CachedSlot>(),2*std::mem::size_of::<usize>());
  let mut rt=Runtime::new();let key=rt.intern("packed-key");
  rt.literal_property_slots=vec![CachedSlot::default(),CachedSlot{key:key.0,index:7}];
  let mut reclaimed=vec![false;key.0+1];rt.invalidate_reclaimed_literal_string_keys(&reclaimed);
  assert_eq!(rt.literal_property_slots[0].key,usize::MAX);assert_eq!(rt.literal_property_slots[1].index,7);
  reclaimed[key.0]=true;rt.invalidate_reclaimed_literal_string_keys(&reclaimed);
  assert_eq!(rt.literal_property_slots[1].key,usize::MAX);assert_eq!(rt.literal_property_slots[1].index,usize::MAX);
 }
}
