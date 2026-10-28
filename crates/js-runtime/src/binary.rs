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
const MAX_BUFFER_BYTES:usize=64*1024*1024;
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
 fn binary_prototype(&self,name:&'static str)->JsResult<ObjectId>{self.binary_prototypes.get(name).copied().ok_or_else(||JsError::Unsupported(format!("missing {name} intrinsic prototype")))}
 fn binary_object(&mut self,name:&'static str)->JsResult<ObjectId>{let target=self.current_new_target();let key=self.string("prototype");let value=self.get_property(target,key)?;if matches!(value,Value::Object(_)|Value::Function(_)){self.object_id(value)}else{self.binary_prototype(name)}}
 fn allocate_buffer(&mut self,prototype:ObjectId,length:usize)->JsResult<Value>{if length>MAX_BUFFER_BYTES{return Err(JsError::Unsupported("ArrayBuffer allocation exceeds supported resource bound".into()))}let object=self.alloc_object(Some(prototype));let buffer=BufferId(self.buffers.len());self.buffers.push(ArrayBufferData{bytes:vec![0;length],detached:false,object});self.objects[object.0].kind=ObjectKind::ArrayBuffer{buffer};Ok(Value::Object(object))}
 fn array_buffer_id(&self,value:Value)->JsResult<BufferId>{let object=self.object_id(value)?;if let ObjectKind::ArrayBuffer{buffer}=self.objects[object.0].kind{Ok(buffer)}else{Err(JsError::TypeError("receiver is not an ArrayBuffer".into()))}}
 fn data_view(&self,value:Value)->JsResult<(BufferId,usize,usize)>{let object=self.object_id(value)?;if let ObjectKind::DataView{buffer,byte_offset,byte_length}=self.objects[object.0].kind{Ok((buffer,byte_offset,byte_length))}else{Err(JsError::TypeError("receiver is not a DataView".into()))}}
 fn binary_constructor(&mut self,name:&'static str,length:usize,code:NativeFn,parent:ObjectId)->JsResult<(Value,ObjectId)>{
  let prototype=self.alloc_object(Some(parent));self.binary_prototypes.insert(name,prototype);let constructor=self.native_function(name,length,code)?;self.set_function_constructible(constructor,true)?;self.set_native_construct_allocates_object(constructor,true)?;self.set_constructor_default_prototype(constructor,Value::Object(prototype))?;let key=self.string("prototype");self.define_data(constructor,key,Value::Object(prototype),false,false,false)?;let key=self.string("constructor");self.define_data(Value::Object(prototype),key,constructor,true,false,true)?;let key=self.string(name);self.define_data(Value::Object(self.global_object),key,constructor,true,false,true)?;Ok((constructor,prototype))
 }
 pub fn install_binary_builtins(&mut self)->JsResult<()>{
  let (constructor,prototype)=self.binary_constructor("ArrayBuffer",1,array_buffer_constructor,self.object_prototype)?;
  let getter=self.native_function("get byteLength",0,array_buffer_length)?;let key=self.string("byteLength");self.define_accessor(Value::Object(prototype),key,Some(getter),None,false,true)?;self.builtin(constructor,"isView",1,array_buffer_is_view)?;
  let (_,prototype)=self.binary_constructor("DataView",1,data_view_constructor,self.object_prototype)?;
  for(name,code)in[("buffer",data_view_buffer as NativeFn),("byteOffset",data_view_offset as NativeFn),("byteLength",data_view_length as NativeFn)]{let getter=self.native_function(&format!("get {name}"),0,code)?;let key=self.string(name);self.define_accessor(Value::Object(prototype),key,Some(getter),None,false,true)?;}
  for(name,length,code)in DATA_VIEW_METHODS{self.builtin(Value::Object(prototype),name,length,code)?;}
  Ok(())
 }
}
fn array_buffer_constructor(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 if !rt.is_construct_call(){return Err(JsError::TypeError("ArrayBuffer constructor requires new".into()))}let length=to_index(rt,arg(args,0))?;let options=arg(args,1);if !matches!(options,Value::Undefined){let key=rt.string("maxByteLength");let maximum=rt.get_property(options,key)?;if !matches!(maximum,Value::Undefined){return Err(JsError::Unsupported("resizable ArrayBuffer is not implemented".into()))}}
 let prototype=rt.binary_object("ArrayBuffer")?;rt.allocate_buffer(prototype,length)
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
 #[test]fn data_view_hash_preserves_f64_payloads_and_both_endian_orders(){
  let mut rt=Runtime::new();let buffer=create(&mut rt,"ArrayBuffer",&[Value::Number(16.0)]);let view=create(&mut rt,"DataView",&[buffer,Value::Number(4.0),Value::Number(8.0)]);
  for bits in[0,1,1u64<<63,0x3ff0000000000000,0x7ff0000000000000,0xfff0000000000000,0x7ff0000000000001,0x7ff8000000001234,0xfff8000000005678]{for little in[false,true]{method(&mut rt,view,"setFloat64",&[Value::Number(0.0),Value::Number(f64::from_bits(bits)),Value::Bool(little)]);let first=method(&mut rt,view,"getUint32",&[Value::Number(0.0),Value::Bool(little)]);let second=method(&mut rt,view,"getUint32",&[Value::Number(4.0),Value::Bool(little)]);let(Value::Number(a),Value::Number(b))=(first,second)else{panic!("uint32 outputs")};let actual=if little{(b as u64)<<32|a as u64}else{(a as u64)<<32|b as u64};assert_eq!(actual,bits);let value=method(&mut rt,view,"getFloat64",&[Value::Number(0.0),Value::Bool(little)]);let Value::Number(n)=value else{panic!("float output")};assert_eq!(n.to_bits(),bits);}}
  let key=rt.string("buffer");assert_eq!(rt.get_property(view,key).unwrap(),buffer);
 }
 #[test]fn integer_views_share_bytes_and_bounds_respect_view_window(){
  let mut rt=Runtime::new();let buffer=create(&mut rt,"ArrayBuffer",&[Value::Number(16.0)]);let first=create(&mut rt,"DataView",&[buffer]);let second=create(&mut rt,"DataView",&[buffer,Value::Number(4.0),Value::Number(4.0)]);method(&mut rt,second,"setUint32",&[Value::Number(0.0),Value::Number(0x12345678 as f64),Value::Bool(false)]);assert_eq!(method(&mut rt,first,"getUint32",&[Value::Number(4.0),Value::Bool(false)]),Value::Number(0x12345678 as f64));let key=rt.string("getFloat64");let get=rt.get_property(second,key).unwrap();assert!(matches!(rt.call_value(get,second,&[Value::Number(0.0)]),Err(JsError::RangeError(_))));
 }
}
