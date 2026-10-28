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
#[derive(Clone,Default)]
pub(crate) struct CachedSlot { key:Option<PropertyKey>,index:Option<usize>,prototype:Option<PrototypeSlot> }
#[derive(Clone)]
struct PrototypeSlot { first:crate::ObjectId,path:Vec<(crate::ObjectId,Option<crate::ObjectId>)>,owner:crate::ObjectId,index:usize,mask:[(usize,u64);2] }
fn eligible(object:&crate::heap::Object)->bool{!object.is_function&&matches!(object.kind,ObjectKind::Ordinary)}
impl Runtime {
    /// Opt-in for audited generated program hosts. While enabled, raw public
    /// property containers must not be mutated; use normal JS property APIs.
    pub fn enable_trusted_generated_property_caches(&mut self){
        for object in &mut self.objects{object.own_key_bloom=[0;4];for (key,_)in object.properties.iter().flatten(){for(word,bit)in crate::heap::Object::bloom_mask(*key){object.own_key_bloom[word]|=bit;}}object.bloom_trusted=true;}self.trusted_property_caches=true;
    }
    /// Call before using public Rust fields to mutate property containers.
    pub fn disable_trusted_generated_property_caches(&mut self){self.trusted_property_caches=false;for object in &mut self.objects{object.bloom_trusted=false;}}
    pub fn set_prototype_property_slots_enabled(&mut self,enabled:bool){self.prototype_property_slots_enabled=enabled;}
    fn prototype_slot_value(&self,receiver:Value,key:PropertyKey,entry:&PrototypeSlot)->Option<Value>{
        let Value::Object(id)=receiver else{return None};let object=self.objects.get(id.0)?;
        if !eligible(object)||object.may_have_key(entry.mask)||object.prototype!=Some(entry.first){return None}
        for &(id,next)in &entry.path{let object=self.objects.get(id.0)?;if !eligible(object)||object.may_have_key(entry.mask)||object.prototype!=next{return None}}
        let owner=self.objects.get(entry.owner.0)?;if !eligible(owner){return None}
        let Some((actual,descriptor))=owner.properties.get(entry.index)?.as_ref()else{return None};
        if *actual!=key{return None}if let PropertyKind::Data{value,..}=descriptor.kind{Some(value)}else{None}
    }
    fn find_prototype_slot(&self,receiver:Value,key:PropertyKey)->Option<PrototypeSlot>{
        let Value::Object(id)=receiver else{return None};let object=self.objects.get(id.0)?;let mask=crate::heap::Object::bloom_mask(key);
        if !eligible(object)||object.may_have_key(mask){return None}let first=object.prototype?;let mut current=first;let mut path=Vec::new();
        for _ in 0..8{let object=self.objects.get(current.0)?;if !eligible(object){return None}
            if object.may_have_key(mask){let index=*object.property_index.get(&key)?;let Some((actual,descriptor))=object.properties.get(index)?.as_ref()else{return None};if *actual!=key||!matches!(descriptor.kind,PropertyKind::Data{..}){return None}return Some(PrototypeSlot{first,path,owner:current,index,mask})}
            let next=object.prototype;path.push((current,next));current=next?;
        }None
    }
}
impl Runtime {
    #[inline]
    pub fn get_literal_cached(&mut self,receiver:Value,site:&'static LiteralReadSite)->JsResult<Value>{
        if !self.literal_property_slots_enabled{let key=self.static_string(site.text);return self.get(receiver,key)}
        let id=site.index()?;
        if self.literal_property_slots.len()<=id{self.literal_property_slots.resize(id+1,CachedSlot::default());}
        let entry=&self.literal_property_slots[id];
        let own_index=entry.index;
        let key=match entry.key{Some(key)=>key,None=>{let key=PropertyKey(self.intern(site.text));self.literal_property_slots[id].key=Some(key);key}};
        if let Value::Object(object)=receiver {
            if let Some(object)=self.objects.get(object.0){
                if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..}){
                    if let Some(index)=own_index {
                        if let Some(Some((actual,descriptor)))=object.properties.get(index){
                            if *actual==key {if let PropertyKind::Data{value,..}=descriptor.kind{let result=Ok(value);self.record_get(receiver,KeyInput::Value(Value::String(key.0)),&result);return result}}
                        }
                    }
                }
            }
        }
        if self.trusted_property_caches&&self.prototype_property_slots_enabled{if let Some(entry)=&self.literal_property_slots[id].prototype{if let Some(value)=self.prototype_slot_value(receiver,key,entry){let result=Ok(value);self.record_get(receiver,KeyInput::Value(Value::String(key.0)),&result);return result}}}
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
        if self.trusted_property_caches&&self.prototype_property_slots_enabled{self.literal_property_slots[id].prototype=self.find_prototype_slot(receiver,key);}
        result
    }
}
