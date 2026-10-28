//! Guarded own-data slot reads. Cache entries contain locations, never Values.
//! Each generated read site owns a distinct mutable static ticket, so separate
//! modules and compileSource invocations cannot collide on local ordinals.
use std::sync::atomic::{AtomicUsize,Ordering};
use crate::{Runtime,Value,JsResult,JsError,ObjectKind,PropertyKey,PropertyKind,KeyInput};
static NEXT_SITE:AtomicUsize=AtomicUsize::new(1);
pub struct LiteralReadSite { ticket:AtomicUsize,text:&'static str }
impl LiteralReadSite {
    pub const fn new(text:&'static str)->Self{Self{ticket:AtomicUsize::new(0),text}}
    #[inline]
    fn index(&self)->JsResult<usize>{
        let mut id=self.ticket.load(Ordering::Relaxed);
        if id==0{let next=NEXT_SITE.fetch_add(1,Ordering::Relaxed);if next==0||next==usize::MAX{return Err(JsError::Unsupported("literal read site space exhausted".into()))}id=match self.ticket.compare_exchange(0,next,Ordering::Relaxed,Ordering::Relaxed){Ok(_)=>next,Err(actual)=>actual};}
        Ok(id)
    }
}
#[derive(Clone,Copy,Default)]
pub(crate) struct CachedSlot { key:Option<PropertyKey>,index:Option<usize> }
impl Runtime {
    #[inline]
    pub fn get_literal_cached(&mut self,receiver:Value,site:&'static LiteralReadSite)->JsResult<Value>{
        if !self.literal_property_slots_enabled{let key=self.static_string(site.text);return self.get(receiver,key)}
        let id=site.index()?;
        if self.literal_property_slots.len()<=id{self.literal_property_slots.resize(id+1,CachedSlot::default());}
        let entry=self.literal_property_slots[id];
        let key=match entry.key{Some(key)=>key,None=>{let key=PropertyKey(self.intern(site.text));self.literal_property_slots[id].key=Some(key);key}};
        if let Value::Object(object)=receiver {
            if let Some(object)=self.objects.get(object.0){
                if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..}){
                    if let Some(index)=entry.index {
                        if let Some(Some((actual,descriptor)))=object.properties.get(index){
                            if *actual==key {if let PropertyKind::Data{value,..}=descriptor.kind{let result=Ok(value);self.record_get(receiver,KeyInput::Value(Value::String(key.0)),&result);return result}}
                        }
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
                    if let Some(index)=object.property_index.get(&key).copied(){if matches!(object.properties.get(index),Some(Some((actual,crate::Descriptor{kind:PropertyKind::Data{..},..})))if *actual==key){self.literal_property_slots[id].index=Some(index);}}
                }
            }
        }
        result
    }
}
