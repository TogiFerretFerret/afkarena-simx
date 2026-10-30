//! Guarded own-data slot reads. Cache entries contain locations, never Values.
//! Each generated read site owns a distinct mutable static ticket, so separate
//! modules and compileSource invocations cannot collide on local ordinals.
use std::sync::atomic::{AtomicUsize,Ordering};
use crate::{Runtime,Value,JsResult,JsError,ObjectKind,ObjectId,PropertyKey,KeyInput};
static NEXT_SITE:AtomicUsize=AtomicUsize::new(1);
pub struct LiteralReadSite { ticket:AtomicUsize,text:&'static str,is_length:bool,prototype_hint:bool }
impl LiteralReadSite {
    pub const fn new(text:&'static str)->Self{Self{ticket:AtomicUsize::new(0),text,prototype_hint:false,is_length:text.len()==6&&text.as_bytes()[0]==b'l'&&text.as_bytes()[1]==b'e'&&text.as_bytes()[2]==b'n'&&text.as_bytes()[3]==b'g'&&text.as_bytes()[4]==b't'&&text.as_bytes()[5]==b'h'}}
    pub const fn new_with_prototype_hint(text:&'static str,hint:bool)->Self{let mut site=Self::new(text);site.prototype_hint=hint;site}
    #[inline]
    fn index(&self)->JsResult<usize>{let id=self.ticket.load(Ordering::Relaxed);if id==0{self.initialize_index()}else{Ok(id)}}
    #[cold]
    #[inline(never)]
    fn initialize_index(&self)->JsResult<usize>{let next=NEXT_SITE.fetch_add(1,Ordering::Relaxed);if next==0||next==usize::MAX{return Err(JsError::Unsupported("literal read site space exhausted".into()))}Ok(match self.ticket.compare_exchange(0,next,Ordering::Relaxed,Ordering::Relaxed){Ok(_)=>next,Err(actual)=>actual})}

}
// Non-ZST Vec indices cannot reach usize::MAX; sentinel slots carry no Values.
#[derive(Clone,Copy)]
pub(crate) struct CachedSlot { key:usize,index:usize,owner:usize }
impl Default for CachedSlot{fn default()->Self{Self{key:usize::MAX,index:usize::MAX,owner:usize::MAX}}}
impl CachedSlot{
 fn key(self)->Option<PropertyKey>{(self.key!=usize::MAX).then_some(PropertyKey(crate::StringId(self.key)))}
 fn index(self)->Option<usize>{(self.index!=usize::MAX).then_some(self.index)}
 fn owner(self)->Option<ObjectId>{(self.owner!=usize::MAX).then_some(ObjectId(self.owner))}
}
impl Runtime {
 pub(crate) fn invalidate_reclaimed_literal_string_keys(&mut self,reclaimed:&[bool]){for entry in &mut self.literal_property_slots{if entry.key().is_some_and(|key|reclaimed.get(key.0.0).copied().unwrap_or(false)){*entry=CachedSlot::default();}}}

    #[inline]
    pub fn get_literal_cached(&mut self,receiver:Value,site:&'static LiteralReadSite)->JsResult<Value>{self.get_literal_cached_impl::<false>(receiver,site)}
    #[inline]
    pub fn get_literal_cached_with_prototype_hint(&mut self,receiver:Value,site:&'static LiteralReadSite)->JsResult<Value>{debug_assert!(site.prototype_hint);self.get_literal_cached_impl::<true>(receiver,site)}
    #[inline]
    fn get_literal_cached_impl<const PROTOTYPE:bool>(&mut self,receiver:Value,site:&'static LiteralReadSite)->JsResult<Value>{
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
        let entry=if self.literal_property_slots.len()<=id{self.grow_literal_cache(id)}else{self.literal_property_slots[id]};
        let key=match entry.key(){Some(key)=>key,None=>self.intern_literal_cache_key(id,site)};
        if let Value::Object(object)=receiver {
            if let Some(object)=self.objects.get(object.0){
                if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..}){
                    if let Some(index)=entry.index() {
                        if let Some(value)=object.data_slot(index,key){let result=Ok(value);self.record_get(receiver,KeyInput::Value(Value::String(key.0)),&result);return result}
                    }
                }
            }
        }
        // Function identities are resolved afresh: caches never retain a FnId,
        // ObjectId or Value. Legacy reflection must use own_descriptor.
        if let Some(value)=self.function_literal_own_hit(receiver,site,key,entry){
            let result=Ok(value);self.record_get(receiver,KeyInput::Value(Value::String(key.0)),&result);return result
        }
        if PROTOTYPE&&self.one_hop_literal_slots_enabled{
            if let (Value::Object(receiver_id),Some(owner_id),Some(index))=(receiver,entry.owner(),entry.index()){
                if let Some(object)=self.objects.get(receiver_id.0){
                    if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..})
                        &&!(site.is_length&&matches!(object.kind,ObjectKind::Array{..}))
                        &&object.prototype==Some(owner_id){
                        if let Some(owner)=self.objects.get(owner_id.0){
                            if !owner.is_function&&matches!(owner.kind,ObjectKind::Ordinary)&&owner.arguments_map.is_empty(){
                                if let Some(value)=owner.data_slot(index,key){if object.own(key).is_none(){let result=Ok(value);self.record_get(receiver,KeyInput::Value(Value::String(key.0)),&result);return result}}
                            }
                        }
                    }
                }
            }
        }
        self.get_literal_cached_slow::<PROTOTYPE>(receiver,site,id,key)
    }
    #[inline]
    fn function_literal_object(&self,receiver:Value,site:&LiteralReadSite)->Option<ObjectId>{
        if !self.function_own_literal_slots_enabled||matches!(site.text,"arguments"|"caller"){return None}
        let object=match receiver{
            Value::Function(id)=>self.functions.get(id.0)?.object,
            Value::Object(id) if self.objects.get(id.0)?.is_function=>id,
            _=>return None,
        };
        let record=self.objects.get(object.0)?;
        (record.is_function&&matches!(record.kind,ObjectKind::Ordinary)&&record.arguments_map.is_empty()).then_some(object)
    }
    #[inline]
    fn function_literal_own_hit(&self,receiver:Value,site:&LiteralReadSite,key:PropertyKey,entry:CachedSlot)->Option<Value>{
        let index=entry.index()?;
        let object=self.function_literal_object(receiver,site)?;
        self.objects.get(object.0)?.data_slot(index,key)
    }
    #[cold]
    #[inline(never)]
    fn grow_literal_cache(&mut self,id:usize)->CachedSlot{self.literal_property_slots.resize(id+1,CachedSlot::default());self.literal_property_slots[id]}
    #[cold]
    #[inline(never)]
    fn intern_literal_cache_key(&mut self,id:usize,site:&'static LiteralReadSite)->PropertyKey{let key=PropertyKey(self.intern(site.text));self.literal_property_slots[id].key=key.0.0;key}
    #[cold]
    #[inline(never)]
    fn get_literal_cached_slow<const PROTOTYPE:bool>(&mut self,receiver:Value,site:&'static LiteralReadSite,id:usize,key:PropertyKey)->JsResult<Value>{
        let result=self.get(receiver,Value::String(key.0));
        // A callback on the slow path can mutate the object. Only the current
        // physical own descriptor determines what may be cached for next time.
        if let Value::Object(object)=receiver {
            if let Some(object)=self.objects.get(object.0){
                if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..}){
                    if let Some(index)=object.property_index.get(&key).copied(){if object.data_slot(index,key).is_some(){self.literal_property_slots[id].index=index;self.literal_property_slots[id].owner=usize::MAX;}}
                }
            }
        }
        // Resolve again AFTER the slow getter: source callbacks may replace
        // descriptors, function records and physical layouts.
        if let Some(object)=self.function_literal_object(receiver,site){
            let object=&self.objects[object.0];
            if let Some(index)=object.property_index.get(&key).copied(){
                if object.data_slot(index,key).is_some(){self.literal_property_slots[id].index=index;self.literal_property_slots[id].owner=usize::MAX;}
            }
        }
        // A slow-path getter may mutate every relevant relationship. Learn
        // only the CURRENT one-hop data layout; preserve its actual result.
        // Missing optional fields are common: do not add two fresh hashes just
        // to discover their absence again. Undefined/throw results may stay cold.
        if PROTOTYPE&&self.one_hop_literal_slots_enabled&&!matches!(result,Ok(Value::Undefined)|Err(_)){
            if let Value::Object(receiver_id)=receiver{
                if let Some(object)=self.objects.get(receiver_id.0){
                    if !object.is_function&&matches!(object.kind,ObjectKind::Ordinary|ObjectKind::Array{..})
                        &&!(site.is_length&&matches!(object.kind,ObjectKind::Array{..})){
                        if let Some(owner_id)=object.prototype{if let Some(owner)=self.objects.get(owner_id.0){
                            if !owner.is_function&&matches!(owner.kind,ObjectKind::Ordinary)&&owner.arguments_map.is_empty()&&object.own(key).is_none(){
                                if let Some(index)=owner.property_index.get(&key).copied(){
                                    if owner.data_slot(index,key).is_some(){self.literal_property_slots[id].index=index;self.literal_property_slots[id].owner=owner_id.0;}
                                }
                            }
                        }}
                    }
                }
            }
        }
        result
    }
}

#[cfg(test)]mod length_tests{use super::*;static LENGTH:LiteralReadSite=LiteralReadSite::new("length");
#[test]fn fast_length_records_exactly_one_get_and_zero_has_positive_zero_bits(){let mut rt=Runtime::new();rt.diagnostics=crate::diagnostics::Diagnostics::from_env();rt.diagnostics.enabled=true;let array=rt.array(&[]);let before=rt.diagnostics.reachability_roots().len();let Value::Number(n)=rt.get_literal_cached(array,&LENGTH).unwrap()else{panic!()};assert_eq!(n.to_bits(),0);let after=rt.diagnostics.reachability_roots().len();assert_eq!(after,before+3);}
}

#[cfg(test)]mod one_hop_tests{
 use super::*;use crate::EnvId;static X:LiteralReadSite=LiteralReadSite::new_with_prototype_hint("x",true);static LENGTH:LiteralReadSite=LiteralReadSite::new_with_prototype_hint("length",true);
 #[test]fn metadata_only_layout_and_live_owner_values(){if cfg!(target_pointer_width="64"){assert_eq!(std::mem::size_of::<crate::heap::Object>(),160);assert_eq!(std::mem::size_of::<CachedSlot>(),24);}let mut rt=Runtime::new();rt.one_hop_literal_slots_enabled=true;let owner=rt.object();let receiver=rt.object();rt.set_prototype(receiver,owner).unwrap();let key=rt.string("x");rt.define_data(owner,key,Value::Number(-0.0),true,true,true).unwrap();for bits in[0x8000000000000000,0x7ff0000000000042]{rt.define_data(owner,key,Value::Number(f64::from_bits(bits)),true,true,true).unwrap();for _ in 0..2{let Value::Number(n)=rt.get_literal_cached_with_prototype_hint(receiver,&X).unwrap()else{panic!()};assert_eq!(n.to_bits(),bits);}}let slot=X.index().unwrap();assert_eq!(rt.literal_property_slots[slot].owner(),Some(rt.object_id(owner).unwrap()));}
 #[test]fn array_length_virtual_descriptor_beats_cached_parent_even_when_length_fast_disabled(){let mut rt=Runtime::new();rt.one_hop_literal_slots_enabled=true;rt.literal_length_fast_path_enabled=false;let owner=rt.object();let key=rt.string("length");rt.define_data(owner,key,Value::Number(999.0),true,true,true).unwrap();let object=rt.object();rt.set_prototype(object,owner).unwrap();assert_eq!(rt.get_literal_cached_with_prototype_hint(object,&LENGTH).unwrap(),Value::Number(999.0));let array=rt.array(&[]);rt.set_prototype(array,owner).unwrap();for _ in 0..2{let Value::Number(n)=rt.get_literal_cached_with_prototype_hint(array,&LENGTH).unwrap()else{panic!()};assert_eq!(n.to_bits(),0);}}
 #[test]fn primary_numeric_own_beats_hinted_parent_data(){static ZERO:LiteralReadSite=LiteralReadSite::new_with_prototype_hint("0",true);let mut rt=Runtime::new();rt.one_hop_literal_slots_enabled=true;let owner=rt.object();let key=rt.string("0");rt.define_data(owner,key,Value::Number(99.0),true,true,true).unwrap();let ordinary=rt.object();rt.set_prototype(ordinary,owner).unwrap();assert_eq!(rt.get_literal_cached_with_prototype_hint(ordinary,&ZERO).unwrap(),Value::Number(99.0));let array=rt.array(&[Some(Value::Number(-0.0))]);rt.set_prototype(array,owner).unwrap();for _ in 0..2{let Value::Number(n)=rt.get_literal_cached_with_prototype_hint(array,&ZERO).unwrap()else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());}}
 fn rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}let keep=rt.string("x");rt.declare(env,"keepKey",keep)?;let mut freed=std::collections::HashSet::new();let mut reused=0;let mut weak_hint_reused=0;let initial=rt.objects.len();for round in 0..23{let owner=rt.object();let owner_id=rt.object_id(owner)?;if freed.contains(&owner_id){reused+=1}if rt.literal_property_slots.get(X.index()?).is_some_and(|entry|entry.owner()==Some(owner_id)){weak_hint_reused+=1}if round%2==1{let y=rt.string("y");rt.define_data(owner,y,Value::Null,true,true,true)?;}let key=rt.string("x");let bits=if round==0{0x8000000000000000}else{0x7ff0000000000042+round};rt.define_data(owner,key,Value::Number(f64::from_bits(bits)),true,true,true)?;let receiver=rt.object();rt.set_prototype(receiver,owner)?;for _ in 0..2{let Value::Number(value)=rt.get_literal_cached_with_prototype_hint(receiver,&X)?else{panic!()};assert_eq!(value.to_bits(),bits);}rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;assert!(rt.native_battle_gc.free_objects.contains(&owner_id.0),"cache must not strongly retain prototype owner");freed.insert(owner_id);}assert!(reused>0);assert!(weak_hint_reused>0,"weak cached owner ID must actually be recycled");assert!(rt.objects.len()<initial+16);Ok(Value::Number(rt.native_battle_gc_stats().collections as f64))}
 #[test]fn weak_owner_ids_survive_twenty_three_collections_and_reuse(){let mut rt=Runtime::new();rt.one_hop_literal_slots_enabled=true;rt.diagnostics.enabled=false;let f=rt.make_closure(rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(f,Value::Undefined,&[]).unwrap(),Value::Number(23.0));}
}

#[cfg(test)]mod function_own_tests{
 use super::*;use crate::{EnvId,FunctionId};
 static X:LiteralReadSite=LiteralReadSite::new_with_prototype_hint("x",true);
 static LENGTH:LiteralReadSite=LiteralReadSite::new("length");
 static ARGUMENTS:LiteralReadSite=LiteralReadSite::new("arguments");
 static CALLER:LiteralReadSite=LiteralReadSite::new("caller");
 fn noop(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Undefined)}
 fn replace(rt:&mut Runtime,receiver:Value,_:&[Value])->JsResult<Value>{let x=rt.string("x");rt.define_data(receiver,x,Value::Number(-0.0),true,true,true)?;Ok(Value::Number(77.0))}
 #[test]fn function_slots_remain_live_and_legacy_fields_stay_cold(){let mut rt=Runtime::new();let f=rt.make_closure(noop,rt.global_env,3,"f");let id=rt.object_id(f).unwrap();let x=rt.string("x");rt.define_data(f,x,Value::Number(-0.0),true,true,true).unwrap();for receiver in[f,Value::Object(id)]{for bits in[0x8000000000000000,0x7ff0000000000042]{rt.define_data(f,x,Value::Number(f64::from_bits(bits)),true,true,true).unwrap();for _ in 0..2{let Value::Number(n)=rt.get_literal_cached_with_prototype_hint(receiver,&X).unwrap()else{panic!()};assert_eq!(n.to_bits(),bits);}}}let entry=rt.literal_property_slots[X.index().unwrap()];assert!(entry.index().is_some()&&entry.owner().is_none());for _ in 0..2{assert_eq!(rt.get_literal_cached(f,&LENGTH).unwrap(),Value::Number(3.0));}for site in[&ARGUMENTS,&CALLER]{let _=rt.get_literal_cached(f,site);assert!(rt.literal_property_slots[site.index().unwrap()].index().is_none());}assert!(rt.get_literal_cached(Value::Function(FunctionId(usize::MAX)),&X).is_err());}
 #[test]fn function_hit_records_receiver_key_and_raw_bits_at_the_original_boundary(){let mut rt=Runtime::new();let f=rt.make_closure(noop,rt.global_env,0,"f");let x=rt.string("x");rt.define_data(f,x,Value::Number(-0.0),true,true,true).unwrap();rt.get_literal_cached(f,&X).unwrap();rt.diagnostics.enabled=true;let before=rt.diagnostics.reachability_roots().len();let Value::Number(n)=rt.get_literal_cached(f,&X).unwrap()else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());let roots=rt.diagnostics.reachability_roots();assert_eq!(roots.len(),before+3);assert!(roots.contains(&f)&&roots.contains(&x));assert!(roots.iter().any(|v|matches!(v,Value::Number(n)if n.to_bits()==(-0.0f64).to_bits())));}
 #[test]fn function_accessor_result_and_post_callback_descriptor_are_distinct(){let mut rt=Runtime::new();let f=rt.make_closure(noop,rt.global_env,0,"f");let x=rt.string("x");rt.define_data(f,x,Value::Number(1.0),true,true,true).unwrap();assert_eq!(rt.get_literal_cached(f,&X).unwrap(),Value::Number(1.0));let getter=rt.native_function("get x",0,replace).unwrap();rt.define_accessor(f,x,Some(getter),None,true,true).unwrap();assert_eq!(rt.get_literal_cached(f,&X).unwrap(),Value::Number(77.0));let Value::Number(n)=rt.get_literal_cached(f,&X).unwrap()else{panic!()};assert_eq!(n.to_bits(),(-0.0f64).to_bits());assert!(rt.delete(f,x,false).unwrap());let proto=rt.object();rt.define_data(proto,x,Value::Number(5.0),true,true,true).unwrap();rt.set_prototype(f,proto).unwrap();assert_eq!(rt.get_literal_cached_with_prototype_hint(f,&X).unwrap(),Value::Number(5.0));assert!(rt.literal_property_slots[X.index().unwrap()].owner().is_none());}
 fn rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}let keep=rt.string("x");rt.declare(env,"keepKey",keep)?;let mut previous=None;let mut reused=0;for round in 0..23{let f=rt.make_closure(noop,parent,round,"fresh");let id=rt.object_id(f)?;if previous==Some(id){reused+=1;}let x=rt.string("x");let bits=if round==0{0x8000000000000000}else{0x7ff0000000000042+round as u64};rt.define_data(f,x,Value::Number(f64::from_bits(bits)),true,true,true)?;for _ in 0..2{let Value::Number(n)=rt.get_literal_cached(f,&X)?else{panic!()};assert_eq!(n.to_bits(),bits);}assert_eq!(rt.get_literal_cached(f,&LENGTH)?,Value::Number(round as f64));rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;assert!(rt.native_battle_gc.free_objects.contains(&id.0),"cache must not root function objects");previous=Some(id);}assert!(reused>0);Ok(Value::Number(rt.native_battle_gc_stats().collections as f64))}
 #[test]fn function_and_object_id_reuse_preserve_bits_across_twenty_three_collections(){let mut rt=Runtime::new();rt.diagnostics.enabled=false;let f=rt.make_closure(rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(f,Value::Undefined,&[]).unwrap(),Value::Number(23.0));}
}
