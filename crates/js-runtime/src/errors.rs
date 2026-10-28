//! Native Error intrinsics. Typed runtime throws materialize with intrinsic
//! prototypes, not whichever constructor a source program has assigned globally.
//! V8 stack rendering is an explicit unsupported operation; it is never invented.
use crate::{Runtime,Value,ObjectId,ObjectKind,JsError,JsResult,EnvId};
use crate::closures::NativeFn;

const KINDS:[&str;7]=["Error","EvalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"];
impl Runtime {
 pub fn install_error_builtins(&mut self)->JsResult<()> {
  if self.error_prototypes.contains_key("Error"){return Err(JsError::Unsupported("Error intrinsics already installed".into()))}
  let base=self.alloc_object(Some(self.object_prototype));self.error_prototypes.insert("Error",base);
  let stack_get=self.native_function("",0,error_stack_get)?;let stack_set=self.native_function("",1,error_stack_set)?;
  let getter=self.object_id(stack_get)?;let setter=self.object_id(stack_set)?;
  self.error_prototypes.insert("@stack_getter",getter);self.error_prototypes.insert("@stack_setter",setter);
  let mut error_constructor_value=Value::Undefined;
  for name in KINDS {
   let prototype=if name=="Error"{base}else{let id=self.alloc_object(Some(base));self.error_prototypes.insert(name,id);id};
   let constructor=self.builtin(Value::Object(self.global_object),name,1,error_constructor as NativeFn)?;
   self.set_function_constructible(constructor,true)?;self.set_constructor_default_prototype(constructor,Value::Object(prototype))?;
   if name=="Error"{error_constructor_value=constructor}else{self.set_prototype(constructor,error_constructor_value)?;}
   let key=self.string("prototype");self.define_data(constructor,key,Value::Object(prototype),false,false,false)?;
   let key=self.string("constructor");self.define_data(Value::Object(prototype),key,constructor,true,false,true)?;
   let key=self.string("name");let value=self.string(name);self.define_data(Value::Object(prototype),key,value,true,false,true)?;
   let key=self.string("message");let value=self.string("");self.define_data(Value::Object(prototype),key,value,true,false,true)?;
   if name=="Error"{self.builtin(Value::Object(prototype),"toString",0,error_to_string)?;}
  }
  self.builtin(error_constructor_value,"captureStackTrace",2,error_capture_stack)?;
  self.builtin(error_constructor_value,"isError",1,error_is_error)?;
  let key=self.string("stackTraceLimit");self.define_data(error_constructor_value,key,Value::Number(10.0),true,true,true)?;
  Ok(())
 }
 fn error_prototype(&self,name:&str)->JsResult<ObjectId>{self.error_prototypes.get(name).copied().ok_or_else(||JsError::Unsupported(format!("Error intrinsic {name} is not installed")))}
 fn initialize_error_object(&mut self,object:Value)->JsResult<Value>{
  let id=self.object_id(object)?;self.objects[id.0].kind=ObjectKind::Error;
  let getter=self.value_for_object(self.error_prototype("@stack_getter")?);let setter=self.value_for_object(self.error_prototype("@stack_setter")?);
  let stack=self.string("stack");self.define_accessor(object,stack,Some(getter),Some(setter),false,true)?;Ok(object)
 }
 /// `Throw` retains exact identity, while Unsupported stays an internal hard
 /// failure so source catch/finally cannot disguise an unimplemented operation.
 pub fn materialize_error(&mut self,error:JsError)->JsResult<Value>{
  let(name,message)=match error{
   JsError::Throw(value)=>return Ok(value),JsError::Unsupported(message)=>return Err(JsError::Unsupported(message)),
   JsError::TypeError(message)=>("TypeError",message),JsError::ReferenceError(message)=>("ReferenceError",message),
   JsError::RangeError(message)=>("RangeError",message),JsError::SyntaxError(message)=>("SyntaxError",message),
  };
  let prototype=self.error_prototype(name)?;let object=Value::Object(self.alloc_object(Some(prototype)));self.initialize_error_object(object)?;
  let key=self.string("message");let value=self.string(&message);self.define_data(object,key,value,true,false,true)?;Ok(object)
 }
}
fn error_constructor(rt:&mut Runtime,_this:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 let id=rt.call_stack.last().copied().ok_or_else(||JsError::Unsupported("Error constructor has no active native call".into()))?;
 let name=rt.string_text(rt.functions[id.0].name);let intrinsic=rt.error_prototype(&name)?;
 // Ordinary [[Construct]] already reads the current newTarget.prototype before
 // message coercion and supplies that fresh object. Calling Error as a function
 // instead creates a fresh intrinsic Error instance and ignores the receiver.
 let object=if rt.is_construct_call(){_this}else{Value::Object(rt.alloc_object(Some(intrinsic)))};
 rt.initialize_error_object(object)?;
 let message=args.first().copied().unwrap_or(Value::Undefined);
 if !matches!(message,Value::Undefined){let units=rt.to_string_value(message)?;let key=rt.string("message");rt.define_data(object,key,Value::String(units),true,false,true)?;}
 if let Some(options)=args.get(1).copied().filter(|value|value.is_object()){
  let key=rt.string("cause");if rt.has_property(options,key)?{let cause=rt.get(options,key)?;rt.define_data(object,key,cause,true,false,true)?;}
 }
 Ok(object)
}
fn error_to_string(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{
 if !this.is_object(){return Err(JsError::TypeError("Error.prototype.toString called on a non-object".into()))}
 let name_key=rt.string("name");let name=rt.get(this,name_key)?;let name=if matches!(name,Value::Undefined){rt.intern("Error")}else{rt.to_string_value(name)?};
 let message_key=rt.string("message");let message=rt.get(this,message_key)?;let message=if matches!(message,Value::Undefined){rt.intern("")}else{rt.to_string_value(message)?};
 if rt.string_units(name).is_empty(){return Ok(Value::String(message))}if rt.string_units(message).is_empty(){return Ok(Value::String(name))}
 let mut units=rt.string_units(name).to_vec();units.extend_from_slice(&[58,32]);units.extend_from_slice(rt.string_units(message));Ok(rt.string_utf16(&units))
}
fn error_stack_get(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{
 let Ok(id)=rt.object_id(this)else{return Ok(Value::Undefined)};
 if !matches!(rt.objects[id.0].kind,ObjectKind::Error){return Ok(Value::Undefined)}
 if let Some(value)=rt.error_stack_overrides.get(&id).copied(){return Ok(value)}
 Err(JsError::Unsupported("V8 Error.stack rendering and prepareStackTrace CallSite objects are not implemented".into()))
}
fn error_stack_set(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 if let Ok(id)=rt.object_id(this){if matches!(rt.objects[id.0].kind,ObjectKind::Error){rt.error_stack_overrides.insert(id,args.first().copied().unwrap_or(Value::Undefined));}}
 Ok(Value::Undefined)
}
fn error_capture_stack(_:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Err(JsError::Unsupported("Error.captureStackTrace requires native source-mapped V8 CallSite semantics".into()))}
fn error_is_error(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let value=args.first().copied().unwrap_or(Value::Undefined);Ok(Value::Bool(rt.object_id(value).ok().is_some_and(|id|matches!(rt.objects[id.0].kind,ObjectKind::Error))))}
