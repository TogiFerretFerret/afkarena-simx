//! Ordinary object/property execution. IDs remain stable across allocations.
use std::collections::{HashMap,HashSet};
use crate::value::{Value,StringId,ObjectId,FunctionId,JsError,JsResult};
use crate::heap::*;
use crate::env::{EnvId,Environment,EnvKind};
use crate::closures::FunctionRecord;

#[derive(Clone,Debug)]
pub enum Completion {Normal,Return(Value),Break(Option<&'static str>),Continue(Option<&'static str>)}
pub struct Runtime {
 pub(crate) native_battle_gc:crate::battle_gc::NativeBattleGc,
 pub(crate) expose_scan_guard:Option<crate::expose_scan::ExposeScanGuard>,
 pub(crate) copy_obj_guard:Option<crate::copy_obj::CopyObjGuard>,
 pub(crate) function_objects:HashMap<ObjectId,FunctionId,crate::id_hash::IdBuildHasher>,
 pub(crate) utf8_loader_guard:Option<crate::utf8_guard::Utf8LoaderGuard>,
 pub(crate) strings:Vec<Box<[u16]>>, pub(crate) string_index:HashMap<Vec<u16>,StringId>,
 pub(crate) string_utf8_index:HashMap<String,StringId>,
 pub(crate) static_literal_strings:HashMap<(u8,usize,usize),StringId>,
 pub(crate) diagnostics:crate::diagnostics::Diagnostics,
 pub literal_property_slots_enabled:bool,pub literal_length_fast_path_enabled:bool,pub(crate) literal_property_slots:Vec<crate::property_slots::CachedSlot>,
 pub(crate) throw_type_error:Option<Value>,
 pub(crate) active_argument_frames:Vec<crate::lazy_arguments::ActiveArgumentsFrame>,
 pub objects:Vec<Object>,pub(crate) functions:Vec<FunctionRecord>,pub(crate) environments:Vec<Environment>,
 pub call_stack:Vec<FunctionId>,pub global_env:EnvId,pub global_object:ObjectId,
 pub construct_stack:Vec<(FunctionId,usize)>,
 pub construct_new_targets:Vec<Value>,
 pub(crate) join_stack:Vec<ObjectId>,
 pub(crate) error_prototypes:HashMap<&'static str,ObjectId>,
 pub(crate) error_stack_overrides:HashMap<ObjectId,Value>,
 pub console_output:Vec<(&'static str,Vec<Value>)>,
 pub(crate) buffers:Vec<crate::binary::ArrayBufferData>,pub(crate) binary_prototypes:HashMap<&'static str,ObjectId>,
 pub(crate) binary_constructors:HashMap<&'static str,Value>,
 pub(crate) collection_records:Vec<crate::collections::CollectionRecord>,pub(crate) collection_iterators:Vec<crate::collections::CollectionIterator>,pub(crate) collection_prototypes:HashMap<&'static str,ObjectId>,
 pub(crate) regex_records:Vec<crate::regex::RegexRecord>,pub(crate) regex_cache:HashMap<(StringId,u16),std::sync::Arc<regress::Regex>>,
 pub regexp_prototype:ObjectId,pub(crate) regexp_constructor:Value,
 pub object_prototype:ObjectId,pub function_prototype:ObjectId,pub array_prototype:ObjectId,
 pub string_prototype:ObjectId,pub number_prototype:ObjectId,pub boolean_prototype:ObjectId,
 pub function_prototype_value:Value,
}
impl Default for Runtime {fn default()->Self{Self::new()}}
impl Runtime {
 pub fn new()->Self{
  let mut objects=vec![Object::new(None)];
  for _ in 0..7{objects.push(Object::new(Some(ObjectId(0))))}
  let mut rt=Self{native_battle_gc:crate::battle_gc::NativeBattleGc::default(),copy_obj_guard:None,expose_scan_guard:None,function_objects:HashMap::default(),utf8_loader_guard:None,strings:vec![],string_index:HashMap::new(),string_utf8_index:HashMap::new(),static_literal_strings:HashMap::new(),diagnostics:crate::diagnostics::Diagnostics::from_env(),literal_property_slots_enabled:true,literal_length_fast_path_enabled:true,literal_property_slots:Vec::new(),throw_type_error:None,active_argument_frames:Vec::new(),objects,functions:vec![],environments:vec![Environment::new(None,EnvKind::Global)],call_stack:vec![],construct_stack:vec![],construct_new_targets:vec![],join_stack:vec![],error_prototypes:HashMap::new(),error_stack_overrides:HashMap::new(),console_output:vec![],buffers:vec![],binary_prototypes:HashMap::new(),binary_constructors:HashMap::new(),collection_records:vec![],collection_iterators:vec![],collection_prototypes:HashMap::new(),regex_records:vec![],regex_cache:HashMap::new(),regexp_prototype:ObjectId(7),regexp_constructor:Value::Undefined,global_env:EnvId(0),global_object:ObjectId(1),object_prototype:ObjectId(0),function_prototype:ObjectId(2),array_prototype:ObjectId(3),string_prototype:ObjectId(4),number_prototype:ObjectId(5),boolean_prototype:ObjectId(6),function_prototype_value:Value::Undefined};
  rt.objects[3].kind=ObjectKind::Array{length:0,length_writable:true};
  let empty=rt.intern("");rt.objects[4].kind=ObjectKind::BoxedString(empty);rt.objects[5].kind=ObjectKind::BoxedNumber(0.0);rt.objects[6].kind=ObjectKind::BoxedBoolean(false);
  rt.install_function_builtins().expect("fresh Function intrinsics");
  rt.function_prototype_value=rt.value_for_object(rt.function_prototype);
  rt.install_basic_builtins().expect("fresh Object and Array intrinsics");
  rt.install_array_from_builtin().expect("fresh Array.from intrinsic");
  rt.install_math_builtins().expect("fresh Math intrinsics");
  rt.install_json_builtins().expect("fresh JSON intrinsics");
  rt.install_regexp_builtins().expect("fresh RegExp intrinsics");
  rt.install_date_builtins().expect("fresh Date intrinsics");
  rt.install_host_builtins().expect("fresh host intrinsics");
  rt.install_error_builtins().expect("fresh Error intrinsics");
  rt.install_binary_builtins().expect("fresh binary intrinsics");
  rt.install_collection_builtins().expect("fresh collection intrinsics");
  rt.install_reflection_builtins().expect("fresh reflection intrinsics");
  rt.install_numeric_bootstrap().expect("fresh Number intrinsics");
  rt.install_string_builtins().expect("fresh String intrinsics");
  rt.capture_utf8_loader_guard();
  rt.capture_copy_obj_guard();rt.capture_expose_scan_guard();
  rt
 }
 pub fn intern_utf16(&mut self,units:&[u16])->StringId{if let Some(id)=self.string_index.get(units){return *id}let id=StringId(self.strings.len());self.strings.push(units.into());self.string_index.insert(units.to_vec(),id);id}
 pub fn intern(&mut self,text:&str)->StringId{if let Some(id)=self.string_utf8_index.get(text){return *id}let id=self.intern_utf16(&text.encode_utf16().collect::<Vec<_>>());self.string_utf8_index.insert(text.to_owned(),id);id}
 pub fn string_units(&self,id:StringId)->&[u16]{&self.strings[id.0]}
 pub fn string_text(&self,id:StringId)->String{String::from_utf16_lossy(self.string_units(id))}
 pub fn string(&mut self,text:&str)->Value{Value::String(self.intern(text))}
 pub fn string_utf16(&mut self,units:&[u16])->Value{Value::String(self.intern_utf16(units))}
 pub fn alloc_object(&mut self,prototype:Option<ObjectId>)->ObjectId{if let Some(slot)=self.native_battle_gc.free_objects.pop(){self.objects[slot].reset_for_reuse(prototype);ObjectId(slot)}else{let id=ObjectId(self.objects.len());self.objects.push(Object::new(prototype));id}}
 pub fn object(&mut self)->Value{Value::Object(self.alloc_object(Some(self.object_prototype)))}
 pub fn array(&mut self,items:&[Option<Value>])->Value{let id=self.alloc_object(Some(self.array_prototype));self.objects[id.0].kind=ObjectKind::Array{length:items.len() as u32,length_writable:true};for (index,item)in items.iter().enumerate(){if let Some(value)=item{let key=PropertyKey(self.intern(&index.to_string()));self.objects[id.0].insert(key,Descriptor::data(*value,true,true,true));}}Value::Object(id)}
 pub fn object_id(&self,value:Value)->JsResult<ObjectId>{match value{Value::Object(id)if id.0<self.objects.len()=>Ok(id),Value::Function(id)=>self.functions.get(id.0).map(|f|f.object).ok_or_else(||JsError::TypeError("invalid function identity".into())),_=>Err(JsError::TypeError("value is not an object".into()))}}
 pub fn same_object(&self,a:Value,b:Value)->bool{matches!((self.object_id(a),self.object_id(b)),(Ok(a),Ok(b))if a==b)}
 pub fn require_object_coercible(&self,value:Value)->JsResult<()>{if matches!(value,Value::Null|Value::Undefined){Err(JsError::TypeError("cannot access null or undefined".into()))}else{Ok(())}}
 pub fn to_property_key(&mut self,value:Value)->JsResult<PropertyKey>{Ok(PropertyKey(self.to_string_value(value)?))}
 fn key<K:Into<KeyInput>>(&mut self,key:K)->JsResult<PropertyKey>{match key.into(){KeyInput::Prepared(k)=>Ok(k),KeyInput::Value(v)=>self.to_property_key(v)}}
 fn index(&self,key:PropertyKey)->Option<u32>{let units=self.string_units(key.0);if units.is_empty()||units.len()>10||(units.len()>1&&units[0]==48){return None}let mut n=0u64;for unit in units{if !(48..=57).contains(unit){return None}n=n*10+u64::from(*unit-48);}if n<u32::MAX as u64{Some(n as u32)}else{None}}
 fn is_length(&self,key:PropertyKey)->bool{self.string_units(key.0)==[108,101,110,103,116,104]}
 pub(crate) fn own_descriptor(&mut self,id:ObjectId,key:PropertyKey)->JsResult<Option<Descriptor>>{
  if let Some(value)=self.typed_own_descriptor(id,key)?{return Ok(value)}
  // Only an ordinary sloppy function's original legacy data property has
  // V8's active-arguments reflection behavior. A manually added property on
  // an arrow, bound function or method remains an ordinary property.
  if self.objects.get(id.0).is_some_and(|object|object.is_function)&&self.string_units(key.0)==[97,114,103,117,109,101,110,116,115]{
   if let Some(callee)=self.function_objects.get(&id).copied(){
    let function=&self.functions[callee.0];
    if function.constructible&&matches!(function.kind,crate::closures::FunctionKind::Native{strict:false,arrow_this:None,..}){
     if let Some(Descriptor{kind:PropertyKind::Data{value:Value::Null,writable:false},enumerable:false,configurable:false})=self.objects[id.0].own(key){
      let value=self.active_function_arguments(callee)?;return Ok(Some(Descriptor::data(value,false,false,false)))
     }
    }
   }
  }
  let object=self.objects.get(id.0).ok_or_else(||JsError::TypeError("invalid object identity".into()))?;
  if let Some(binding)=object.arguments_map.get(&key).copied(){let mut desc=object.own(key);if let Some(ref mut d)=desc{if let PropertyKind::Data{ref mut value,..}=d.kind{*value=self.read_binding(binding)?;}}return Ok(desc)}
  match object.kind{
   ObjectKind::Array{length,length_writable}if self.is_length(key)=>return Ok(Some(Descriptor::data(Value::Number(length as f64),length_writable,false,false))),
   ObjectKind::BoxedString(value)=>{if self.is_length(key){return Ok(Some(Descriptor::data(Value::Number(self.string_units(value).len()as f64),false,false,false)))}if let Some(index)=self.index(key){if let Some(unit)=self.string_units(value).get(index as usize).copied(){let value=self.string_utf16(&[unit]);return Ok(Some(Descriptor::data(value,false,true,false)))}}},_=>{}
  }
  Ok(self.objects[id.0].own(key))
 }
 fn read_start(&self,value:Value)->JsResult<ObjectId>{match value{Value::String(_)=>Ok(self.string_prototype),Value::Number(_)=>Ok(self.number_prototype),Value::Bool(_)=>Ok(self.boolean_prototype),_=>self.object_id(value)}}
 pub fn get<K:Into<KeyInput>>(&mut self,receiver:Value,key:K)->JsResult<Value>{let key=key.into();let result=self.get_inner(receiver,key);self.record_get(receiver,key,&result);result}
 fn get_inner<K:Into<KeyInput>>(&mut self,receiver:Value,key:K)->JsResult<Value>{
  self.require_object_coercible(receiver)?;let key=key.into();
  if let KeyInput::Value(Value::Number(index))=key{if let Some(value)=self.binary_get_number(receiver,index){return Ok(value)}}
  let key=self.key(key)?;
  if let Value::String(id)=receiver{if self.is_length(key){return Ok(Value::Number(self.string_units(id).len()as f64))}if let Some(index)=self.index(key){if let Some(unit)=self.string_units(id).get(index as usize).copied(){return Ok(self.string_utf16(&[unit]))}}}
  let mut current=Some(self.read_start(receiver)?);while let Some(id)=current{if let Some(value)=self.typed_get(id,key)?{return Ok(value)}if let Some(d)=self.own_descriptor(id,key)?{return match d.kind{PropertyKind::Data{value,..}=>Ok(value),PropertyKind::Accessor{get:Some(get),..}=>self.call_value(get,receiver,&[]),PropertyKind::Accessor{get:None,..}=>Ok(Value::Undefined)}}current=self.objects[id.0].prototype;}Ok(Value::Undefined)
 }
 pub fn get_property(&mut self,receiver:Value,key:Value)->JsResult<Value>{self.get(receiver,key)}
 pub fn has_property<K:Into<KeyInput>>(&mut self,receiver:Value,key:K)->JsResult<bool>{let id=self.object_id(receiver)?;let key=self.key(key)?;let mut current=Some(id);while let Some(id)=current{if let Some(value)=self.typed_has(id,key)?{return Ok(value)}if self.own_descriptor(id,key)?.is_some(){return Ok(true)}current=self.objects[id.0].prototype;}Ok(false)}
 pub fn has_own_property<K:Into<KeyInput>>(&mut self,receiver:Value,key:K)->JsResult<bool>{self.require_object_coercible(receiver)?;let object=self.to_object(receiver)?;let id=self.object_id(object)?;let key=self.key(key)?;Ok(self.own_descriptor(id,key)?.is_some())}
 fn reject(&self,strict:bool,message:&str,value:Value)->JsResult<Value>{if strict{Err(JsError::TypeError(message.into()))}else{Ok(value)}}
 pub fn set<K:Into<KeyInput>>(&mut self,receiver:Value,key:K,value:Value,strict:bool)->JsResult<Value>{
  self.require_object_coercible(receiver)?;let key=self.key(key)?;if let Ok(id)=self.object_id(receiver){if let Some(value)=self.typed_set(id,key,value)?{return Ok(value)}}let mut current=Some(self.read_start(receiver)?);
  if let Value::String(id)=receiver{if self.is_length(key)||self.index(key).is_some_and(|i|(i as usize)<self.string_units(id).len()){return self.reject(strict,"string property is not writable",value)}}
  while let Some(id)=current{if let Some(desc)=self.own_descriptor(id,key)?{if matches!(self.objects[id.0].kind,ObjectKind::Arguments)&&self.string_units(key.0)==[99,97,108,108,101,101]{if let PropertyKind::Accessor{get:Some(get),set:Some(set)}=desc.kind{if Some(get)==self.throw_type_error&&get==set{return self.reject(strict,"Cannot assign to read only property 'callee' of object '#<Object>'",value)}}}match desc.kind{PropertyKind::Accessor{set:Some(set),..}=>{self.call_value(set,receiver,&[value])?;return Ok(value)},PropertyKind::Accessor{set:None,..}=>return self.reject(strict,"property has no setter",value),PropertyKind::Data{writable:false,..}=>return self.reject(strict,"property is not writable",value),PropertyKind::Data{..}=>break}}current=self.objects[id.0].prototype;}
  let id=match self.object_id(receiver){Ok(id)=>id,Err(_)=>return self.reject(strict,"cannot create property on primitive",value)};
  let own=self.own_descriptor(id,key)?;let (enumerable,configurable)=own.map(|d|(d.enumerable,d.configurable)).unwrap_or((true,true));
  if own.is_none()&&!self.objects[id.0].extensible{return self.reject(strict,"object is not extensible",value)}
  if let ObjectKind::Array{length,length_writable}=self.objects[id.0].kind{if self.is_length(key){self.array_set_length(id,value,length_writable,strict)?;return Ok(value)}if !length_writable&&self.index(key).is_some_and(|i|i>=length){return self.reject(strict,"array length is not writable",value)}}
  self.define_data(receiver,key,value,true,enumerable,configurable)?;Ok(value)
 }
 pub fn set_property(&mut self,receiver:Value,key:Value,value:Value,strict:bool)->JsResult<Value>{self.set(receiver,key,value,strict)}
 pub fn delete<K:Into<KeyInput>>(&mut self,receiver:Value,key:K,strict:bool)->JsResult<bool>{self.require_object_coercible(receiver)?;let key=self.key(key)?;let receiver=self.to_object(receiver)?;let id=self.object_id(receiver)?;if let Some(deleted)=self.typed_delete(id,key)?{if !deleted&&strict{return Err(JsError::TypeError("cannot delete typed array element".into()))}return Ok(deleted)}if let Some(d)=self.own_descriptor(id,key)?{if !d.configurable{if strict{return Err(JsError::TypeError("cannot delete non-configurable property".into()))}return Ok(false)}self.objects[id.0].remove(key);}Ok(true)}
 fn compatible(&self,old:Descriptor,new:Descriptor)->bool{
  if old.configurable{return true}if new.configurable||old.enumerable!=new.enumerable{return false}
  match(old.kind,new.kind){(PropertyKind::Data{value:a,writable:false},PropertyKind::Data{value:b,writable})=>!writable&&same_value(a,b),(PropertyKind::Data{..},PropertyKind::Data{..})=>true,(PropertyKind::Accessor{get:a,set:b},PropertyKind::Accessor{get:c,set:d})=>optional_same(a,c)&&optional_same(b,d),_=>false}
 }
 fn define<K:Into<KeyInput>>(&mut self,receiver:Value,key:K,descriptor:Descriptor)->JsResult<Value>{
  let id=self.object_id(receiver)?;let key=self.key(key)?;if let Some(value)=self.typed_define(id,key,descriptor)?{return Ok(value)}
  if matches!(self.objects[id.0].kind,ObjectKind::Array{..})&&self.is_length(key){if let PropertyKind::Data{value,writable}=descriptor.kind{return self.array_set_length_checked(id,value,writable,true,!descriptor.enumerable&&!descriptor.configurable)}}
  let old=self.own_descriptor(id,key)?;
  if let Some(old)=old{if !self.compatible(old,descriptor){return Err(JsError::TypeError("incompatible property descriptor".into()))}}else if !self.objects[id.0].extensible{return Err(JsError::TypeError("object is not extensible".into()))}
  if let ObjectKind::BoxedString(string)=self.objects[id.0].kind{if self.is_length(key)||self.index(key).is_some_and(|i|(i as usize)<self.string_units(string).len()){return Ok(receiver)}}
  if let ObjectKind::Array{length,length_writable}=self.objects[id.0].kind{
   if self.is_length(key){return Err(JsError::TypeError("array length cannot be an accessor".into()))}
   if self.index(key).is_some_and(|i|i>=length)&&!length_writable{return Err(JsError::TypeError("array length is not writable".into()))}
  }
  if let Some(binding)=self.objects[id.0].arguments_map.get(&key).copied(){match descriptor.kind{PropertyKind::Data{value,writable}=>{self.write_binding(binding,value,false)?;if !writable{self.objects[id.0].arguments_map.remove(&key);}},PropertyKind::Accessor{..}=>{self.objects[id.0].arguments_map.remove(&key);}}}
  self.objects[id.0].insert(key,descriptor);
  if let Some(index)=self.index(key){if let ObjectKind::Array{ref mut length,..}=self.objects[id.0].kind{*length=(*length).max(index+1);}}
  Ok(receiver)
 }
 pub fn define_data<K:Into<KeyInput>>(&mut self,receiver:Value,key:K,value:Value,writable:bool,enumerable:bool,configurable:bool)->JsResult<Value>{self.define(receiver,key,Descriptor::data(value,writable,enumerable,configurable))}
 pub fn define_data_property(&mut self,receiver:Value,key:Value,value:Value,writable:bool,enumerable:bool,configurable:bool)->JsResult<Value>{self.define_data(receiver,key,value,writable,enumerable,configurable)}
 pub fn define_accessor<K:Into<KeyInput>>(&mut self,receiver:Value,key:K,get:Option<Value>,set:Option<Value>,enumerable:bool,configurable:bool)->JsResult<Value>{for f in [get,set].into_iter().flatten(){if !matches!(f,Value::Function(_)){return Err(JsError::TypeError("accessor must be callable".into()))}}self.define(receiver,key,Descriptor{kind:PropertyKind::Accessor{get,set},enumerable,configurable})}
 pub fn literal_accessor<K:Into<KeyInput>>(&mut self,receiver:Value,key:K,get:Option<Value>,set:Option<Value>,enumerable:bool,configurable:bool)->JsResult<Value>{let id=self.object_id(receiver)?;let key=self.key(key)?;let(old_get,old_set)=match self.own_descriptor(id,key)?.map(|d|d.kind){Some(PropertyKind::Accessor{get,set})=>(get,set),_=>(None,None)};self.define_accessor(receiver,key,get.or(old_get),set.or(old_set),enumerable,configurable)}
 pub fn set_function_name(&mut self,function:Value,key:Value,prefix:&str)->JsResult<Value>{let Value::Function(id)=function else{return Err(JsError::TypeError("function name requires function".into()))};let key=self.to_string_value(key)?;let mut units=prefix.encode_utf16().collect::<Vec<_>>();if !prefix.is_empty(){units.push(32)}units.extend_from_slice(self.string_units(key));let name=self.string_utf16(&units);self.functions[id.0].name=String::from_utf16_lossy(&units);let key=self.string("name");self.define_data(function,key,name,false,false,true)?;Ok(function)}
 fn array_set_length(&mut self,id:ObjectId,value:Value,writable:bool,strict:bool)->JsResult<Value>{self.array_set_length_checked(id,value,writable,strict,true)}
 fn array_set_length_checked(&mut self,id:ObjectId,value:Value,writable:bool,strict:bool,attributes_valid:bool)->JsResult<Value>{
  let new=self.to_uint32(value)?;let number=self.to_number(value)?;if number!=new as f64{return Err(JsError::RangeError("invalid array length".into()))}
  if !attributes_valid{return Err(JsError::TypeError("invalid array length descriptor".into()))}
  let ObjectKind::Array{length:old,length_writable:old_writable}=self.objects[id.0].kind else{unreachable!()};
  if !old_writable&&(new!=old||writable){return self.reject(strict,"array length is not writable",Value::Object(id))}
  if new<old{let mut indexed=self.objects[id.0].properties.iter().flatten().filter_map(|(k,d)|self.index(*k).filter(|i|*i>=new).map(|i|(i,*k,*d))).collect::<Vec<_>>();indexed.sort_by_key(|row|std::cmp::Reverse(row.0));for(index,key,descriptor)in indexed{if !descriptor.configurable{self.objects[id.0].kind=ObjectKind::Array{length:index+1,length_writable:writable};return self.reject(strict,"cannot truncate non-configurable array element",Value::Object(id))}self.objects[id.0].remove(key);}}
  self.objects[id.0].kind=ObjectKind::Array{length:new,length_writable:writable};Ok(Value::Object(id))
 }
 pub fn set_prototype(&mut self,object:Value,prototype:Value)->JsResult<Value>{let id=self.object_id(object)?;let prototype=if matches!(prototype,Value::Null){None}else{Some(self.object_id(prototype)?)};if self.objects[id.0].prototype==prototype{return Ok(object)}if !self.objects[id.0].extensible{return Err(JsError::TypeError("object is not extensible".into()))}let mut parent=prototype;while let Some(p)=parent{if p==id{return Err(JsError::TypeError("cyclic prototype".into()))}parent=self.objects[p.0].prototype;}self.objects[id.0].prototype=prototype;Ok(object)}
 pub fn own_keys(&mut self,object:Value,enumerable_only:bool)->JsResult<Vec<Value>>{let id=self.object_id(object)?;if let Some(keys)=self.typed_own_keys(id,enumerable_only)?{return Ok(keys)}let mut keys=Vec::new();match self.objects[id.0].kind{ObjectKind::Array{length,length_writable}=>{let key=PropertyKey(self.intern("length"));keys.push((key,Descriptor::data(Value::Number(length as f64),length_writable,false,false)));},ObjectKind::BoxedString(string)=>{let units=self.string_units(string).to_vec();for(i,u)in units.iter().enumerate(){let k=PropertyKey(self.intern(&i.to_string()));let v=self.string_utf16(&[*u]);keys.push((k,Descriptor::data(v,false,true,false)));}let k=PropertyKey(self.intern("length"));keys.push((k,Descriptor::data(Value::Number(units.len()as f64),false,false,false)));},_=>{}}keys.extend(self.objects[id.0].properties.iter().flatten().map(|(k,d)|(*k,*d)));keys.sort_by_key(|(k,_)|self.index(*k).map(|n|(0,n)).unwrap_or((1,0)));Ok(keys.into_iter().filter(|(_,d)|!enumerable_only||d.enumerable).map(|(k,_)|Value::String(k.0)).collect())}
 pub fn for_in_iter(&mut self,value:Value)->JsResult<ForInIterator>{let object=if matches!(value,Value::Null|Value::Undefined){None}else{let boxed=self.to_object(value)?;Some(self.object_id(boxed)?)};Ok(ForInIterator{object,keys:vec![],cursor:0,visited:HashSet::new(),prepared:false})}
 pub fn for_in_next(&mut self,iter:&mut ForInIterator)->JsResult<Option<Value>>{loop{let Some(id)=iter.object else{return Ok(None)};if !iter.prepared{iter.keys=self.own_keys(Value::Object(id),false)?.into_iter().map(|v|if let Value::String(id)=v{PropertyKey(id)}else{unreachable!()}).collect();iter.cursor=0;iter.prepared=true;}while let Some(key)=iter.keys.get(iter.cursor).copied(){iter.cursor+=1;if iter.visited.contains(&key){continue}if let Some(d)=self.own_descriptor(id,key)?{iter.visited.insert(key);if d.enumerable{return Ok(Some(Value::String(key.0)))}}}iter.object=self.objects[id.0].prototype;iter.prepared=false;}}
 pub fn to_object(&mut self,value:Value)->JsResult<Value>{match value{Value::Object(_)|Value::Function(_)=>Ok(value),Value::Null|Value::Undefined=>Err(JsError::TypeError("cannot box null or undefined".into())),Value::String(v)=>{let id=self.alloc_object(Some(self.string_prototype));self.objects[id.0].kind=ObjectKind::BoxedString(v);Ok(Value::Object(id))},Value::Number(v)=>{let id=self.alloc_object(Some(self.number_prototype));self.objects[id.0].kind=ObjectKind::BoxedNumber(v);Ok(Value::Object(id))},Value::Bool(v)=>{let id=self.alloc_object(Some(self.boolean_prototype));self.objects[id.0].kind=ObjectKind::BoxedBoolean(v);Ok(Value::Object(id))}}}
 pub fn call(&mut self,callee:Value,this:Value,args:&[Value])->JsResult<Value>{self.call_value(callee,this,args)}
 pub fn error_value(&mut self,error:JsError)->JsResult<Value>{self.materialize_error(error)}
}
fn same_value(a:Value,b:Value)->bool{match(a,b){(Value::Number(a),Value::Number(b))=>(a.is_nan()&&b.is_nan())||a.to_bits()==b.to_bits(),_=>a==b}}
fn optional_same(a:Option<Value>,b:Option<Value>)->bool{match(a,b){(Some(a),Some(b))=>same_value(a,b),(None,None)=>true,_=>false}}
