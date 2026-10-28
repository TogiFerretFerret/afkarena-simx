//! Shared byte storage for ECMAScript binary-data views. Floating-point stores
//! use raw IEEE bits; no NaN normalization is performed.
use crate::{Runtime,Value,ObjectId,JsError,JsResult,EnvId};
#[derive(Clone,Copy,Debug,Eq,PartialEq,Hash)]
pub struct BufferId(pub usize);
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum TypedArrayKind {Int8,Uint8,Uint8Clamped,Int16,Uint16,Int32,Uint32,Float32,Float64}
impl TypedArrayKind {
 pub fn bytes(self)->usize{match self{Self::Int8|Self::Uint8|Self::Uint8Clamped=>1,Self::Int16|Self::Uint16=>2,Self::Int32|Self::Uint32|Self::Float32=>4,Self::Float64=>8}}
 pub fn name(self)->&'static str{match self{Self::Int8=>"Int8Array",Self::Uint8=>"Uint8Array",Self::Uint8Clamped=>"Uint8ClampedArray",Self::Int16=>"Int16Array",Self::Uint16=>"Uint16Array",Self::Int32=>"Int32Array",Self::Uint32=>"Uint32Array",Self::Float32=>"Float32Array",Self::Float64=>"Float64Array"}}
}
pub struct ArrayBufferData {pub bytes:Vec<u8>,pub detached:bool,pub object:ObjectId}
use crate::ObjectKind;
use crate::closures::NativeFn;
const MAX_BUFFER_BYTES:usize=256*1024*1024;
const KINDS:[TypedArrayKind;9]=[TypedArrayKind::Int8,TypedArrayKind::Uint8,TypedArrayKind::Uint8Clamped,TypedArrayKind::Int16,TypedArrayKind::Uint16,TypedArrayKind::Int32,TypedArrayKind::Uint32,TypedArrayKind::Float32,TypedArrayKind::Float64];
fn arg(args:&[Value],index:usize)->Value{args.get(index).copied().unwrap_or(Value::Undefined)}
fn to_index(rt:&mut Runtime,value:Value)->JsResult<usize>{let n=rt.to_number(value)?;if n.is_nan()||n==0.0{return Ok(0)}let integer=n.trunc();if !integer.is_finite()||integer<0.0||integer>9_007_199_254_740_991.0{return Err(JsError::RangeError("index is outside the valid range".into()))}Ok(integer as usize)}
fn read_number(bytes:&[u8],kind:TypedArrayKind,little:bool)->f64{
 let mut raw=[0u8;8];if little{raw[..bytes.len()].copy_from_slice(bytes)}else{for(i,byte)in bytes.iter().rev().enumerate(){raw[i]=*byte}}
 let n=u64::from_le_bytes(raw);match kind{
  TypedArrayKind::Int8=>(n as i8)as f64,TypedArrayKind::Uint8|TypedArrayKind::Uint8Clamped=>(n as u8)as f64,
  TypedArrayKind::Int16=>(n as i16)as f64,TypedArrayKind::Uint16=>(n as u16)as f64,
  TypedArrayKind::Int32=>(n as i32)as f64,TypedArrayKind::Uint32=>(n as u32)as f64,
  TypedArrayKind::Float32=>f32::from_bits(n as u32)as f64,TypedArrayKind::Float64=>f64::from_bits(n),
 }
}
fn number_bits(n:f64,kind:TypedArrayKind)->u64{match kind{
 TypedArrayKind::Int8|TypedArrayKind::Uint8=>(crate::value::number_to_uint32(n)as u8)as u64,
 TypedArrayKind::Int16|TypedArrayKind::Uint16=>(crate::value::number_to_uint32(n)as u16)as u64,
 TypedArrayKind::Int32|TypedArrayKind::Uint32=>crate::value::number_to_uint32(n)as u64,
 TypedArrayKind::Float32=>(n as f32).to_bits()as u64,TypedArrayKind::Float64=>n.to_bits(),
 TypedArrayKind::Uint8Clamped=>{if n.is_nan()||n<=0.0{0}else if n>=255.0{255}else{let floor=n.floor();let fraction=n-floor;let rounded=if fraction>0.5||(fraction==0.5&&(floor as u64)%2!=0){floor+1.0}else{floor};rounded as u64}},
}}
fn store_number(bytes:&mut[u8],number:f64,kind:TypedArrayKind,little:bool){let raw=number_bits(number,kind).to_le_bytes();let size=bytes.len();if little{bytes.copy_from_slice(&raw[..size])}else{for(i,dest)in bytes.iter_mut().enumerate(){*dest=raw[size-1-i]}}}
impl Runtime {
 /// Host file bytes have no JavaScript element getters or conversions. Build
 /// their Uint8Array through the actual intrinsic constructor (including its
 /// current prototype), then transfer raw storage without interning one key
 /// for every byte of a potentially 100 MiB source table.
 pub fn uint8_array_from_bytes(&mut self,constructor:Value,bytes:Vec<u8>)->JsResult<Value>{
  if self.binary_constructors.get("Uint8Array").copied()!=Some(constructor){return Err(JsError::Unsupported("oracle file loader requires the original Uint8Array constructor".into()))}
  let value=self.construct(constructor,&[Value::Number(bytes.len()as f64)])?;
  let object=self.object_id(value)?;
  if let ObjectKind::TypedArray{buffer,byte_offset:0,length,kind:TypedArrayKind::Uint8}=self.objects[object.0].kind{
   if length==bytes.len(){self.buffers[buffer.0].bytes=bytes;return Ok(value)}
  }
  Err(JsError::Unsupported("intrinsic Uint8Array returned an unexpected host byte view".into()))
 }
 fn binary_prototype(&self,name:&'static str)->JsResult<ObjectId>{self.binary_prototypes.get(name).copied().ok_or_else(||JsError::Unsupported(format!("missing {name} intrinsic prototype")))}
 fn binary_object(&mut self,name:&'static str)->JsResult<ObjectId>{let target=self.current_new_target();let key=self.string("prototype");let value=self.get_property(target,key)?;if matches!(value,Value::Object(_)|Value::Function(_)){self.object_id(value)}else{self.binary_prototype(name)}}
 fn allocate_buffer(&mut self,prototype:ObjectId,length:usize)->JsResult<Value>{if length>MAX_BUFFER_BYTES{return Err(JsError::Unsupported("ArrayBuffer allocation exceeds supported resource bound".into()))}let object=self.alloc_object(Some(prototype));let buffer=BufferId(self.buffers.len());self.buffers.push(ArrayBufferData{bytes:vec![0;length],detached:false,object});self.objects[object.0].kind=ObjectKind::ArrayBuffer{buffer};Ok(Value::Object(object))}
 fn array_buffer_id(&self,value:Value)->JsResult<BufferId>{let object=self.object_id(value)?;if let ObjectKind::ArrayBuffer{buffer}=self.objects[object.0].kind{Ok(buffer)}else{Err(JsError::TypeError("receiver is not an ArrayBuffer".into()))}}
 fn data_view(&self,value:Value)->JsResult<(BufferId,usize,usize)>{let object=self.object_id(value)?;if let ObjectKind::DataView{buffer,byte_offset,byte_length}=self.objects[object.0].kind{Ok((buffer,byte_offset,byte_length))}else{Err(JsError::TypeError("receiver is not a DataView".into()))}}
 fn binary_constructor(&mut self,name:&'static str,length:usize,code:NativeFn,parent:ObjectId)->JsResult<(Value,ObjectId)>{
  let prototype=self.alloc_object(Some(parent));self.binary_prototypes.insert(name,prototype);let constructor=self.native_function(name,length,code)?;self.binary_constructors.insert(name,constructor);self.set_function_constructible(constructor,true)?;self.set_native_construct_allocates_object(constructor,true)?;self.set_constructor_default_prototype(constructor,Value::Object(prototype))?;let key=self.string("prototype");self.define_data(constructor,key,Value::Object(prototype),false,false,false)?;let key=self.string("constructor");self.define_data(Value::Object(prototype),key,constructor,true,false,true)?;let key=self.string(name);self.define_data(Value::Object(self.global_object),key,constructor,true,false,true)?;Ok((constructor,prototype))
 }
 pub fn install_binary_builtins(&mut self)->JsResult<()>{
  let (constructor,prototype)=self.binary_constructor("ArrayBuffer",1,array_buffer_constructor,self.object_prototype)?;
  let getter=self.native_function("get byteLength",0,array_buffer_length)?;let key=self.string("byteLength");self.define_accessor(Value::Object(prototype),key,Some(getter),None,false,true)?;self.builtin(constructor,"isView",1,array_buffer_is_view)?;
  let (_,prototype)=self.binary_constructor("DataView",1,data_view_constructor,self.object_prototype)?;
  for(name,code)in[("buffer",data_view_buffer as NativeFn),("byteOffset",data_view_offset as NativeFn),("byteLength",data_view_length as NativeFn)]{let getter=self.native_function(&format!("get {name}"),0,code)?;let key=self.string(name);self.define_accessor(Value::Object(prototype),key,Some(getter),None,false,true)?;}
  for(name,length,code)in DATA_VIEW_METHODS{self.builtin(Value::Object(prototype),name,length,code)?;}
  self.install_typed_array_builtins()?;
  Ok(())
 }
}
fn array_buffer_constructor(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 if !rt.is_construct_call(){return Err(JsError::TypeError("ArrayBuffer constructor requires new".into()))}
 // The pinned V8 constructor rejects negative integers before reading the
 // derived prototype, but defers an oversized positive allocation until after
 // options and GetPrototypeFromConstructor. ToIndex would throw too early.
 let number=rt.to_number(arg(args,0))?;let length=if number.is_nan(){0.0}else{number.trunc()};if length<0.0{return Err(JsError::RangeError("ArrayBuffer length is negative".into()))}
 let options=arg(args,1);if !matches!(options,Value::Undefined){let key=rt.string("maxByteLength");let maximum=rt.get_property(options,key)?;if !matches!(maximum,Value::Undefined){return Err(JsError::Unsupported("resizable ArrayBuffer is not implemented".into()))}}
 let prototype=rt.binary_object("ArrayBuffer")?;if !length.is_finite()||length>9_007_199_254_740_991.0{return Err(JsError::RangeError("ArrayBuffer length is outside the valid range".into()))}rt.allocate_buffer(prototype,length as usize)
}
fn array_buffer_length(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let buffer=rt.array_buffer_id(this)?;let data=&rt.buffers[buffer.0];Ok(Value::Number(if data.detached{0.0}else{data.bytes.len()as f64}))}
fn array_buffer_is_view(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let is_view=rt.object_id(arg(args,0)).ok().is_some_and(|id|matches!(rt.objects[id.0].kind,ObjectKind::DataView{..}|ObjectKind::TypedArray{..}));Ok(Value::Bool(is_view))}
fn data_view_constructor(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 if !rt.is_construct_call(){return Err(JsError::TypeError("DataView constructor requires new".into()))}let buffer=rt.array_buffer_id(arg(args,0))?;let offset=to_index(rt,arg(args,1))?;if rt.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}let length=rt.buffers[buffer.0].bytes.len();if offset>length{return Err(JsError::RangeError("DataView offset exceeds buffer length".into()))}let size=if matches!(arg(args,2),Value::Undefined){length-offset}else{to_index(rt,arg(args,2))?};if offset.checked_add(size).is_none_or(|end|end>length){return Err(JsError::RangeError("DataView length exceeds buffer length".into()))}let prototype=rt.binary_object("DataView")?;if rt.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}let object=rt.alloc_object(Some(prototype));rt.objects[object.0].kind=ObjectKind::DataView{buffer,byte_offset:offset,byte_length:size};Ok(Value::Object(object))
}
fn data_view_buffer(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let(buffer,_,_)=rt.data_view(this)?;Ok(Value::Object(rt.buffers[buffer.0].object))}
fn data_view_offset(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let(buffer,offset,_)=rt.data_view(this)?;if rt.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}Ok(Value::Number(offset as f64))}
fn data_view_length(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let(buffer,_,length)=rt.data_view(this)?;if rt.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}Ok(Value::Number(length as f64))}
fn view_get(rt:&mut Runtime,this:Value,args:&[Value],kind:TypedArrayKind)->JsResult<Value>{let(buffer,view_offset,view_length)=rt.data_view(this)?;let offset=to_index(rt,arg(args,0))?;let little=rt.truthy(arg(args,1));if rt.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}if offset.checked_add(kind.bytes()).is_none_or(|end|end>view_length){return Err(JsError::RangeError("DataView access exceeds view length".into()))}let begin=view_offset+offset;Ok(Value::Number(read_number(&rt.buffers[buffer.0].bytes[begin..begin+kind.bytes()],kind,little)))}
fn view_set(rt:&mut Runtime,this:Value,args:&[Value],kind:TypedArrayKind)->JsResult<Value>{let(buffer,view_offset,view_length)=rt.data_view(this)?;let offset=to_index(rt,arg(args,0))?;let value=rt.to_number(arg(args,1))?;let little=rt.truthy(arg(args,2));if rt.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}if offset.checked_add(kind.bytes()).is_none_or(|end|end>view_length){return Err(JsError::RangeError("DataView access exceeds view length".into()))}let begin=view_offset+offset;store_number(&mut rt.buffers[buffer.0].bytes[begin..begin+kind.bytes()],value,kind,little);Ok(Value::Undefined)}
macro_rules! view_methods{($(($get:ident,$set:ident,$kind:ident)),*)=>{$(fn $get(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{view_get(rt,this,args,TypedArrayKind::$kind)}fn $set(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{view_set(rt,this,args,TypedArrayKind::$kind)})*};}
view_methods!((get_i8,set_i8,Int8),(get_u8,set_u8,Uint8),(get_i16,set_i16,Int16),(get_u16,set_u16,Uint16),(get_i32,set_i32,Int32),(get_u32,set_u32,Uint32),(get_f32,set_f32,Float32),(get_f64,set_f64,Float64));
const DATA_VIEW_METHODS:[(&str,usize,NativeFn);16]=[("getInt8",1,get_i8),("getUint8",1,get_u8),("getInt16",1,get_i16),("getUint16",1,get_u16),("getInt32",1,get_i32),("getUint32",1,get_u32),("getFloat32",1,get_f32),("getFloat64",1,get_f64),("setInt8",2,set_i8),("setUint8",2,set_u8),("setInt16",2,set_i16),("setUint16",2,set_u16),("setInt32",2,set_i32),("setUint32",2,set_u32),("setFloat32",2,set_f32),("setFloat64",2,set_f64)];
#[cfg(test)]mod tests{
 use super::*;
 fn create(rt:&mut Runtime,name:&str,args:&[Value])->Value{let global=rt.global_env;let constructor=rt.lookup(global,name).unwrap();rt.construct(constructor,args).unwrap()}
 fn method(rt:&mut Runtime,object:Value,name:&str,args:&[Value])->Value{let key=rt.string(name);let function=rt.get_property(object,key).unwrap();rt.call_value(function,object,args).unwrap()}
 #[test]fn numeric_typed_reads_preserve_bits_and_do_not_intern_byte_positions(){
  let mut rt=Runtime::new();let buffer=create(&mut rt,"ArrayBuffer",&[Value::Number(16.0)]);let view=create(&mut rt,"DataView",&[buffer]);let typed=create(&mut rt,"Float64Array",&[buffer]);
  for (i,bits) in [0x7ff0000000001234u64,0x8000000000000000].into_iter().enumerate(){method(&mut rt,view,"setFloat64",&[Value::Number((i*8)as f64),Value::Number(f64::from_bits(bits)),Value::Bool(true)]);}
  for index in [0.0,-0.0,1.0,2.0,-1.0,0.5,f64::NAN,f64::INFINITY,f64::NEG_INFINITY,1e21]{let key=rt.to_string_value(Value::Number(index)).unwrap();let expected=rt.get(typed,Value::String(key)).unwrap();let before=rt.strings.len();let actual=rt.get(typed,Value::Number(index)).unwrap();match(actual,expected){(Value::Number(a),Value::Number(b))=>assert_eq!(a.to_bits(),b.to_bits()),(a,b)=>assert_eq!(a,b)}assert_eq!(rt.strings.len(),before);}
  let id=rt.object_id(typed).unwrap();let(buffer,_,_,_)=rt.typed_parts(id).unwrap();rt.buffers[buffer.0].detached=true;assert_eq!(rt.get(typed,Value::Number(0.0)).unwrap(),Value::Undefined);
 }
 #[test]fn data_view_hash_preserves_f64_payloads_and_both_endian_orders(){
  let mut rt=Runtime::new();let buffer=create(&mut rt,"ArrayBuffer",&[Value::Number(16.0)]);let view=create(&mut rt,"DataView",&[buffer,Value::Number(4.0),Value::Number(8.0)]);
  for bits in[0,1,1u64<<63,0x3ff0000000000000,0x7ff0000000000000,0xfff0000000000000,0x7ff0000000000001,0x7ff8000000001234,0xfff8000000005678]{for little in[false,true]{method(&mut rt,view,"setFloat64",&[Value::Number(0.0),Value::Number(f64::from_bits(bits)),Value::Bool(little)]);let first=method(&mut rt,view,"getUint32",&[Value::Number(0.0),Value::Bool(little)]);let second=method(&mut rt,view,"getUint32",&[Value::Number(4.0),Value::Bool(little)]);let(Value::Number(a),Value::Number(b))=(first,second)else{panic!("uint32 outputs")};let actual=if little{(b as u64)<<32|a as u64}else{(a as u64)<<32|b as u64};assert_eq!(actual,bits);let value=method(&mut rt,view,"getFloat64",&[Value::Number(0.0),Value::Bool(little)]);let Value::Number(n)=value else{panic!("float output")};assert_eq!(n.to_bits(),bits);}}
  let key=rt.string("buffer");assert_eq!(rt.get_property(view,key).unwrap(),buffer);
 }
 #[test]fn typed_arrays_share_bytes_and_reject_canonical_invalid_indices(){
  let mut rt=Runtime::new();let buffer=create(&mut rt,"ArrayBuffer",&[Value::Number(16.0)]);let typed=create(&mut rt,"Uint32Array",&[buffer,Value::Number(4.0),Value::Number(2.0)]);let view=create(&mut rt,"DataView",&[buffer]);let zero=rt.string("0");rt.set_property(typed,zero,Value::Number(0x12345678 as f64),true).unwrap();assert_eq!(method(&mut rt,view,"getUint32",&[Value::Number(4.0),Value::Bool(true)]),Value::Number(0x12345678 as f64));let invalid=rt.string("-0");rt.set_property(typed,invalid,Value::Number(99.0),true).unwrap();assert_eq!(rt.get_property(typed,invalid).unwrap(),Value::Undefined);assert_eq!(rt.get_property(typed,zero).unwrap(),Value::Number(0x12345678 as f64));assert!(!rt.delete(typed,zero,false).unwrap());let noncanonical=rt.string("01");rt.set_property(typed,noncanonical,Value::Number(7.0),true).unwrap();assert_eq!(rt.get_property(typed,noncanonical).unwrap(),Value::Number(7.0));
 }
 #[test]fn typed_set_overlap_subarray_alias_and_slice_copy_are_distinct(){
  let mut rt=Runtime::new();let input=rt.array(&[Some(Value::Number(1.0)),Some(Value::Number(2.0)),Some(Value::Number(3.0)),Some(Value::Number(4.0))]);let typed=create(&mut rt,"Uint8Array",&[input]);let sub=method(&mut rt,typed,"subarray",&[Value::Number(0.0),Value::Number(3.0)]);method(&mut rt,typed,"set",&[sub,Value::Number(1.0)]);for(i,n)in[1.0,1.0,2.0,3.0].into_iter().enumerate(){let key=rt.string(&i.to_string());assert_eq!(rt.get_property(typed,key).unwrap(),Value::Number(n));}let copy=method(&mut rt,typed,"slice",&[Value::Number(0.0),Value::Number(2.0)]);let zero=rt.string("0");rt.set_property(typed,zero,Value::Number(7.0),true).unwrap();assert_eq!(rt.get_property(sub,zero).unwrap(),Value::Number(7.0));assert_eq!(rt.get_property(copy,zero).unwrap(),Value::Number(1.0));
 }
 #[test]fn same_element_float_copy_preserves_signaling_nan_and_clamping_uses_even_ties(){
  let mut rt=Runtime::new();let buffer=create(&mut rt,"ArrayBuffer",&[Value::Number(8.0)]);let view=create(&mut rt,"DataView",&[buffer]);method(&mut rt,view,"setFloat64",&[Value::Number(0.0),Value::Number(f64::from_bits(0x7ff0000000001234)),Value::Bool(true)]);let first=create(&mut rt,"Float64Array",&[buffer]);let second=create(&mut rt,"Float64Array",&[first]);let key=rt.string("buffer");let copied_buffer=rt.get_property(second,key).unwrap();let copied_view=create(&mut rt,"DataView",&[copied_buffer]);assert_eq!(method(&mut rt,copied_view,"getUint32",&[Value::Number(0.0),Value::Bool(true)]),Value::Number(0x1234 as f64));assert_eq!(method(&mut rt,copied_view,"getUint32",&[Value::Number(4.0),Value::Bool(true)]),Value::Number(0x7ff00000 as f64));let input=rt.array(&[Some(Value::Number(0.5)),Some(Value::Number(1.5)),Some(Value::Number(2.5)),Some(Value::Number(254.5))]);let clamped=create(&mut rt,"Uint8ClampedArray",&[input]);for(i,n)in[0.0,2.0,2.0,254.0].into_iter().enumerate(){let key=rt.string(&i.to_string());assert_eq!(rt.get_property(clamped,key).unwrap(),Value::Number(n));}
 }
 #[test]fn integer_views_share_bytes_and_bounds_respect_view_window(){
  let mut rt=Runtime::new();let buffer=create(&mut rt,"ArrayBuffer",&[Value::Number(16.0)]);let first=create(&mut rt,"DataView",&[buffer]);let second=create(&mut rt,"DataView",&[buffer,Value::Number(4.0),Value::Number(4.0)]);method(&mut rt,second,"setUint32",&[Value::Number(0.0),Value::Number(0x12345678 as f64),Value::Bool(false)]);assert_eq!(method(&mut rt,first,"getUint32",&[Value::Number(4.0),Value::Bool(false)]),Value::Number(0x12345678 as f64));let key=rt.string("getFloat64");let get=rt.get_property(second,key).unwrap();assert!(matches!(rt.call_value(get,second,&[Value::Number(0.0)]),Err(JsError::RangeError(_))));
 }
}
use crate::{PropertyKey,Descriptor,PropertyKind};
impl Runtime {
 /// Numeric primitive property keys stringify without user code. On a typed
 /// array their canonical numeric index is the same number, except -0 becomes
 /// the string "0". Avoid permanently interning every byte position while
 /// decoding large host-loaded tables; object keys still take normal coercion.
 pub(crate) fn binary_get_number(&self,receiver:Value,index:f64)->Option<Value>{
  let Value::Object(id)=receiver else{return None};
  let(buffer,offset,length,kind)=self.typed_parts(id)?;
  let index=if index==0.0{0.0}else{index};
  let Some(index)=self.typed_index(buffer,length,index)else{return Some(Value::Undefined)};
  let begin=offset+index*kind.bytes();
  Some(Value::Number(read_number(&self.buffers[buffer.0].bytes[begin..begin+kind.bytes()],kind,true)))
 }
 fn typed_parts(&self,id:ObjectId)->Option<(BufferId,usize,usize,TypedArrayKind)>{match self.objects.get(id.0)?.kind{ObjectKind::TypedArray{buffer,byte_offset,length,kind}=>Some((buffer,byte_offset,length,kind)),_=>None}}
 pub fn validate_typed_array(&self,value:Value)->JsResult<()>{let id=self.object_id(value)?;let Some((buffer,_,_,_))=self.typed_parts(id)else{return Err(JsError::TypeError("receiver is not a typed array".into()))};if self.buffers[buffer.0].detached{return Err(JsError::TypeError("typed array buffer is detached".into()))}Ok(())}
 pub fn binary_is_typed_array_prototype(&self,id:ObjectId)->bool{self.binary_prototypes.get("TypedArray").copied()==Some(id)}
 fn canonical_numeric_index(&mut self,key:PropertyKey)->JsResult<Option<f64>>{
  let units=self.string_units(key.0);if units==[45,48]{return Ok(Some(-0.0))}
  if !units.is_empty()&&units.len()<=15&&(units.len()==1||units[0]!=48)&&units.iter().all(|c|(48..=57).contains(c)){let mut n=0u64;for c in units{n=n*10+u64::from(*c-48)}return Ok(Some(n as f64))}
  let n=self.to_number(Value::String(key.0))?;let text=self.to_string_value(Value::Number(n))?;Ok(if self.string_units(text)==self.string_units(key.0){Some(n)}else{None})
 }
 fn typed_index(&self,buffer:BufferId,length:usize,index:f64)->Option<usize>{if self.buffers[buffer.0].detached||!index.is_finite()||index<0.0||index.fract()!=0.0||(index==0.0&&index.is_sign_negative())||index>=length as f64{None}else{Some(index as usize)}}
 pub fn typed_own_descriptor(&mut self,id:ObjectId,key:PropertyKey)->JsResult<Option<Option<Descriptor>>>{
  let Some((buffer,offset,length,kind))=self.typed_parts(id)else{return Ok(None)};let Some(index)=self.canonical_numeric_index(key)?else{return Ok(None)};let Some(index)=self.typed_index(buffer,length,index)else{return Ok(Some(None))};let begin=offset+index*kind.bytes();let value=read_number(&self.buffers[buffer.0].bytes[begin..begin+kind.bytes()],kind,true);Ok(Some(Some(Descriptor::data(Value::Number(value),true,true,true))))
 }
 pub fn typed_get(&mut self,id:ObjectId,key:PropertyKey)->JsResult<Option<Value>>{Ok(self.typed_own_descriptor(id,key)?.map(|d|d.map(|d|match d.kind{PropertyKind::Data{value,..}=>value,_=>unreachable!()}).unwrap_or(Value::Undefined)))}
 pub fn typed_has(&mut self,id:ObjectId,key:PropertyKey)->JsResult<Option<bool>>{let Some((buffer,_,length,_))=self.typed_parts(id)else{return Ok(None)};let Some(index)=self.canonical_numeric_index(key)?else{return Ok(None)};Ok(Some(self.typed_index(buffer,length,index).is_some()))}
 pub fn typed_set(&mut self,id:ObjectId,key:PropertyKey,value:Value)->JsResult<Option<Value>>{
  let Some((buffer,offset,length,kind))=self.typed_parts(id)else{return Ok(None)};let Some(index)=self.canonical_numeric_index(key)?else{return Ok(None)};let number=self.to_number(value)?;if let Some(index)=self.typed_index(buffer,length,index){let begin=offset+index*kind.bytes();store_number(&mut self.buffers[buffer.0].bytes[begin..begin+kind.bytes()],number,kind,true);}Ok(Some(value))
 }
 pub fn typed_define(&mut self,id:ObjectId,key:PropertyKey,descriptor:Descriptor)->JsResult<Option<Value>>{
  let Some((buffer,offset,length,kind))=self.typed_parts(id)else{return Ok(None)};let Some(index)=self.canonical_numeric_index(key)?else{return Ok(None)};
  let Some(index)=self.typed_index(buffer,length,index)else{return Err(JsError::TypeError("invalid typed array index".into()))};let PropertyKind::Data{value,writable}=descriptor.kind else{return Err(JsError::TypeError("typed array elements cannot be accessors".into()))};if !writable||!descriptor.enumerable||!descriptor.configurable{return Err(JsError::TypeError("incompatible typed array element descriptor".into()))}
  let number=self.to_number(value)?;if self.buffers[buffer.0].detached{return Err(JsError::TypeError("typed array buffer became detached".into()))}let begin=offset+index*kind.bytes();store_number(&mut self.buffers[buffer.0].bytes[begin..begin+kind.bytes()],number,kind,true);Ok(Some(self.value_for_object(id)))
 }
 pub fn typed_delete(&mut self,id:ObjectId,key:PropertyKey)->JsResult<Option<bool>>{Ok(self.typed_has(id,key)?.map(|has|!has))}
 pub fn typed_own_keys(&mut self,id:ObjectId,enumerable_only:bool)->JsResult<Option<Vec<Value>>>{
  let Some((buffer,_,length,_))=self.typed_parts(id)else{return Ok(None)};let length=if self.buffers[buffer.0].detached{0}else{length};if length>1_000_000{return Err(JsError::Unsupported("typed array own-key list exceeds supported resource bound".into()))}
  let mut keys=Vec::with_capacity(length+self.objects[id.0].properties.len());for index in 0..length{keys.push(self.string(&index.to_string()));}
  keys.extend(self.objects[id.0].iter_properties().filter(|(_,d)|!enumerable_only||d.enumerable).map(|(key,_)|Value::String(key.0)));Ok(Some(keys))
 }
}
fn to_length(rt:&mut Runtime,value:Value)->JsResult<usize>{let n=rt.to_number(value)?;Ok(if n.is_nan()||n<=0.0{0}else if n>=9_007_199_254_740_991.0{9_007_199_254_740_991}else{n.floor()as usize})}
fn to_integer(rt:&mut Runtime,value:Value)->JsResult<f64>{let n=rt.to_number(value)?;Ok(if n.is_nan(){0.0}else{n.trunc()})}
impl Runtime {
 pub fn typed_array_length(&self,value:Value)->JsResult<Option<usize>>{let Ok(id)=self.object_id(value)else{return Ok(None)};let Some((buffer,_,length,_))=self.typed_parts(id)else{return Ok(None)};if self.buffers[buffer.0].detached{return Err(JsError::TypeError("typed array buffer is detached".into()))}Ok(Some(length))}
 fn typed_array(&self,value:Value)->JsResult<(BufferId,usize,usize,TypedArrayKind)>{let id=self.object_id(value)?;let parts=self.typed_parts(id).ok_or_else(||JsError::TypeError("receiver is not a typed array".into()))?;if self.buffers[parts.0.0].detached{return Err(JsError::TypeError("typed array buffer is detached".into()))}Ok(parts)}
 fn allocate_typed(&mut self,kind:TypedArrayKind,prototype:ObjectId,length:usize)->JsResult<Value>{let bytes=length.checked_mul(kind.bytes()).ok_or_else(||JsError::Unsupported("typed array allocation size overflow".into()))?;let buffer_prototype=self.binary_prototype("ArrayBuffer")?;let buffer_value=self.allocate_buffer(buffer_prototype,bytes)?;let buffer=self.array_buffer_id(buffer_value)?;let id=self.alloc_object(Some(prototype));self.objects[id.0].kind=ObjectKind::TypedArray{buffer,byte_offset:0,length,kind};Ok(Value::Object(id))}
 fn fill_typed(&mut self,target:Value,values:&[Value])->JsResult<()>{let(buffer,offset,_,kind)=self.typed_array(target)?;for(index,value)in values.iter().enumerate(){let number=self.to_number(*value)?;if self.buffers[buffer.0].detached{return Err(JsError::TypeError("typed array buffer became detached".into()))}let begin=offset+index*kind.bytes();store_number(&mut self.buffers[buffer.0].bytes[begin..begin+kind.bytes()],number,kind,true);}Ok(())}
 fn typed_constructor_impl(&mut self,kind:TypedArrayKind,args:&[Value])->JsResult<Value>{
  if !self.is_construct_call(){return Err(JsError::TypeError("typed array constructor requires new".into()))}
  let first=arg(args,0);
  if matches!(first,Value::Object(_)|Value::Function(_)){
   let id=self.object_id(first)?;
   match self.objects[id.0].kind{
    ObjectKind::ArrayBuffer{buffer}=>{
     // Pinned V8 obtains the derived prototype before offset/length coercion.
     let prototype=self.binary_object(kind.name())?;let offset=to_index(self,arg(args,1))?;if offset%kind.bytes()!=0{return Err(JsError::RangeError("typed array byteOffset is not aligned".into()))}if self.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}let byte_length=self.buffers[buffer.0].bytes.len();
     let length=if matches!(arg(args,2),Value::Undefined){if byte_length%kind.bytes()!=0{return Err(JsError::RangeError("ArrayBuffer length is not aligned".into()))}if offset>byte_length{return Err(JsError::RangeError("typed array offset exceeds buffer".into()))}(byte_length-offset)/kind.bytes()}else{let length=to_index(self,arg(args,2))?;if self.buffers[buffer.0].detached{return Err(JsError::TypeError("ArrayBuffer is detached".into()))}let bytes=length.checked_mul(kind.bytes()).ok_or_else(||JsError::RangeError("typed array view is too large".into()))?;if offset.checked_add(bytes).is_none_or(|end|end>byte_length){return Err(JsError::RangeError("typed array view exceeds buffer".into()))}length};
     let object=self.alloc_object(Some(prototype));self.objects[object.0].kind=ObjectKind::TypedArray{buffer,byte_offset:offset,length,kind};return Ok(Value::Object(object))
    },
    ObjectKind::TypedArray{buffer,byte_offset,length,kind:source_kind}=>{
     let prototype=self.binary_object(kind.name())?;if self.buffers[buffer.0].detached{return Err(JsError::TypeError("source typed array is detached".into()))}let target=self.allocate_typed(kind,prototype,length)?;
     if kind==source_kind{let bytes=self.buffers[buffer.0].bytes[byte_offset..byte_offset+length*kind.bytes()].to_vec();let(dest,offset,_,_)=self.typed_array(target)?;self.buffers[dest.0].bytes[offset..offset+bytes.len()].copy_from_slice(&bytes);}else{let values=(0..length).map(|i|{let begin=byte_offset+i*source_kind.bytes();Value::Number(read_number(&self.buffers[buffer.0].bytes[begin..begin+source_kind.bytes()],source_kind,true))}).collect::<Vec<_>>();self.fill_typed(target,&values)?;}return Ok(target)
    },
    _=>{},
   }
   if self.has_intrinsic_iterator(first)?{let values=self.argument_spread(first)?;let prototype=self.binary_object(kind.name())?;let target=self.allocate_typed(kind,prototype,values.len())?;self.fill_typed(target,&values)?;return Ok(target)}
   let length_key=self.string("length");let raw=self.get_property(first,length_key)?;let length=to_length(self,raw)?;let prototype=self.binary_object(kind.name())?;let target=self.allocate_typed(kind,prototype,length)?;
   for index in 0..length{let key=self.string(&index.to_string());let value=self.get_property(first,key)?;let number=self.to_number(value)?;let(buffer,offset,_,_)=self.typed_array(target)?;let begin=offset+index*kind.bytes();store_number(&mut self.buffers[buffer.0].bytes[begin..begin+kind.bytes()],number,kind,true);}return Ok(target)
  }
  let prototype=self.binary_object(kind.name())?;let length=to_index(self,first)?;self.allocate_typed(kind,prototype,length)
 }
 fn install_typed_array_builtins(&mut self)->JsResult<()>{
  let common=self.alloc_object(Some(self.object_prototype));self.binary_prototypes.insert("TypedArray",common);let abstract_constructor=self.native_function("TypedArray",0,abstract_typed_constructor)?;self.set_function_constructible(abstract_constructor,true)?;self.set_native_construct_allocates_object(abstract_constructor,true)?;let key=self.string("prototype");self.define_data(abstract_constructor,key,Value::Object(common),false,false,false)?;let key=self.string("constructor");self.define_data(Value::Object(common),key,abstract_constructor,true,false,true)?;self.binary_constructors.insert("TypedArray",abstract_constructor);
  for(name,code)in[("buffer",typed_buffer as NativeFn),("byteLength",typed_byte_length as NativeFn),("byteOffset",typed_byte_offset as NativeFn),("length",typed_length as NativeFn)]{let get=self.native_function(&format!("get {name}"),0,code)?;let key=self.string(name);self.define_accessor(Value::Object(common),key,Some(get),None,false,true)?;}
  self.builtin(Value::Object(common),"set",1,typed_set_method)?;self.builtin(Value::Object(common),"subarray",2,typed_subarray)?;self.builtin(Value::Object(common),"slice",2,typed_slice)?;
  let array_proto=Value::Object(self.array_prototype);let key=self.string("toString");let to_string=self.get_property(array_proto,key)?;self.define_data(Value::Object(common),key,to_string,true,false,true)?;let key=self.string("join");let join=self.get_property(array_proto,key)?;self.define_data(Value::Object(common),key,join,true,false,true)?;
  for(kind,code)in KINDS.into_iter().zip(TYPED_CONSTRUCTORS){let(constructor,prototype)=self.binary_constructor(kind.name(),3,code,common)?;self.set_prototype(constructor,abstract_constructor)?;let bytes=Value::Number(kind.bytes()as f64);let key=self.string("BYTES_PER_ELEMENT");self.define_data(constructor,key,bytes,false,false,false)?;self.define_data(Value::Object(prototype),key,bytes,false,false,false)?;}
  Ok(())
 }
 fn typed_species_constructor(&mut self,value:Value,kind:TypedArrayKind)->JsResult<Value>{
  let default=self.binary_constructors.get(kind.name()).copied().ok_or_else(||JsError::Unsupported("missing typed array intrinsic constructor".into()))?;let key=self.string("constructor");let constructor=self.get_property(value,key)?;if matches!(constructor,Value::Undefined){return Ok(default)}let id=self.object_id(constructor)?;
  // The source-visible Symbol feature is unsupported. Within this domain the
  // intrinsic TypedArray species getter is inherited through constructor links.
  let base=self.binary_constructors.get("TypedArray").copied().ok_or_else(||JsError::Unsupported("missing TypedArray constructor".into()))?;let base=self.object_id(base)?;let mut next=Some(id);while let Some(object)=next{if object==base{return Ok(constructor)}next=self.objects[object.0].prototype;}Ok(default)
 }
}
fn abstract_typed_constructor(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Err(JsError::TypeError("abstract TypedArray constructor".into()))}
macro_rules! typed_constructors{($(($name:ident,$kind:ident)),*)=>{$(fn $name(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{rt.typed_constructor_impl(TypedArrayKind::$kind,args)})*};}
typed_constructors!((ctor_i8,Int8),(ctor_u8,Uint8),(ctor_uc8,Uint8Clamped),(ctor_i16,Int16),(ctor_u16,Uint16),(ctor_i32,Int32),(ctor_u32,Uint32),(ctor_f32,Float32),(ctor_f64,Float64));
const TYPED_CONSTRUCTORS:[NativeFn;9]=[ctor_i8,ctor_u8,ctor_uc8,ctor_i16,ctor_u16,ctor_i32,ctor_u32,ctor_f32,ctor_f64];
fn typed_buffer(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let id=rt.object_id(this)?;let Some((buffer,_,_,_))=rt.typed_parts(id)else{return Err(JsError::TypeError("receiver is not a typed array".into()))};Ok(Value::Object(rt.buffers[buffer.0].object))}
fn typed_byte_length(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let id=rt.object_id(this)?;let Some((buffer,_,length,kind))=rt.typed_parts(id)else{return Err(JsError::TypeError("receiver is not a typed array".into()))};Ok(Value::Number(if rt.buffers[buffer.0].detached{0.0}else{(length*kind.bytes())as f64}))}
fn typed_byte_offset(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let id=rt.object_id(this)?;let Some((buffer,offset,_,_))=rt.typed_parts(id)else{return Err(JsError::TypeError("receiver is not a typed array".into()))};Ok(Value::Number(if rt.buffers[buffer.0].detached{0.0}else{offset as f64}))}
fn typed_length(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let id=rt.object_id(this)?;let Some((buffer,_,length,_))=rt.typed_parts(id)else{return Err(JsError::TypeError("receiver is not a typed array".into()))};Ok(Value::Number(if rt.buffers[buffer.0].detached{0.0}else{length as f64}))}
fn typed_set_method(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 let(target_buffer,target_offset,target_length,target_kind)=rt.typed_array(this)?;let offset=to_integer(rt,arg(args,1))?;if offset<0.0{return Err(JsError::RangeError("typed array set offset is negative".into()))}let source=arg(args,0);let source_object=rt.to_object(source)?;let id=rt.object_id(source_object)?;
 if let Some((buffer,source_offset,length,kind))=rt.typed_parts(id){if rt.buffers[buffer.0].detached||rt.buffers[target_buffer.0].detached{return Err(JsError::TypeError("typed array buffer is detached".into()))}if offset+length as f64>target_length as f64{return Err(JsError::RangeError("typed array set exceeds target length".into()))}let start=target_offset+offset as usize*target_kind.bytes();if kind==target_kind{let bytes=rt.buffers[buffer.0].bytes[source_offset..source_offset+length*kind.bytes()].to_vec();rt.buffers[target_buffer.0].bytes[start..start+bytes.len()].copy_from_slice(&bytes);}else{let values=(0..length).map(|i|{let begin=source_offset+i*kind.bytes();read_number(&rt.buffers[buffer.0].bytes[begin..begin+kind.bytes()],kind,true)}).collect::<Vec<_>>();for(i,n)in values.into_iter().enumerate(){let begin=start+i*target_kind.bytes();store_number(&mut rt.buffers[target_buffer.0].bytes[begin..begin+target_kind.bytes()],n,target_kind,true);}}return Ok(Value::Undefined)}
 let key=rt.string("length");let raw=rt.get_property(source_object,key)?;let length=to_length(rt,raw)?;if offset+length as f64>target_length as f64{return Err(JsError::RangeError("typed array set exceeds target length".into()))}for i in 0..length{let key=rt.string(&i.to_string());let value=rt.get_property(source_object,key)?;let index=PropertyKey(rt.intern(&(offset as usize+i).to_string()));rt.typed_set(rt.object_id(this)?,index,value)?;}Ok(Value::Undefined)
}
fn relative_index(n:f64,length:usize)->usize{if n<0.0{(length as f64+n).max(0.0)as usize}else{n.min(length as f64)as usize}}
fn typed_subarray(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{let(buffer,offset,length,kind)=rt.typed_array(this)?;let begin_value=to_integer(rt,arg(args,0))?;let begin=relative_index(begin_value,length);let end=if matches!(arg(args,1),Value::Undefined){length}else{let n=to_integer(rt,arg(args,1))?;relative_index(n,length)};let count=end.saturating_sub(begin);let constructor=rt.typed_species_constructor(this,kind)?;let buffer_value=Value::Object(rt.buffers[buffer.0].object);let result=rt.construct(constructor,&[buffer_value,Value::Number((offset+begin*kind.bytes())as f64),Value::Number(count as f64)])?;rt.validate_typed_array(result)?;Ok(result)}
fn typed_slice(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{let(buffer,offset,length,kind)=rt.typed_array(this)?;let begin_value=to_integer(rt,arg(args,0))?;let begin=relative_index(begin_value,length);let end=if matches!(arg(args,1),Value::Undefined){length}else{let n=to_integer(rt,arg(args,1))?;relative_index(n,length)};let count=end.saturating_sub(begin);let constructor=rt.typed_species_constructor(this,kind)?;let result=rt.construct(constructor,&[Value::Number(count as f64)])?;let(dest,dest_offset,dest_length,dest_kind)=rt.typed_array(result)?;if dest_length<count{return Err(JsError::TypeError("typed array species result is too short".into()))}if rt.buffers[buffer.0].detached{return Err(JsError::TypeError("source typed array buffer is detached".into()))}if kind==dest_kind{let bytes=rt.buffers[buffer.0].bytes[offset+begin*kind.bytes()..offset+(begin+count)*kind.bytes()].to_vec();rt.buffers[dest.0].bytes[dest_offset..dest_offset+bytes.len()].copy_from_slice(&bytes);}else{let values=(0..count).map(|i|{let start=offset+(begin+i)*kind.bytes();read_number(&rt.buffers[buffer.0].bytes[start..start+kind.bytes()],kind,true)}).collect::<Vec<_>>();for(i,n)in values.into_iter().enumerate(){let start=dest_offset+i*dest_kind.bytes();store_number(&mut rt.buffers[dest.0].bytes[start..start+dest_kind.bytes()],n,dest_kind,true);}}Ok(result)}
