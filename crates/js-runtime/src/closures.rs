//! Executable Rust closures retain shared lexical environments by identity.
use crate::{Runtime,Value,JsError,JsResult};
use crate::value::{FunctionId,ObjectId};
use crate::env::EnvId;
use crate::heap::PropertyKey;
pub type NativeFn=fn(&mut Runtime,Value,&[Value],EnvId)->JsResult<Value>;
#[derive(Clone)]
pub enum FunctionKind {
 Native{code:NativeFn,env:EnvId,strict:bool,arrow_this:Option<Value>},
 Bound{target:FunctionId,bound_this:Value,args:Vec<Value>},
}
#[derive(Clone)]
pub struct FunctionRecord {
 pub kind:FunctionKind,pub object:ObjectId,pub prototype:Option<ObjectId>,
 pub name:String,pub arity:usize,pub source:Option<Vec<u16>>,pub constructible:bool,
}
impl Runtime {
 pub fn function(&mut self,code:NativeFn,env:EnvId,strict:bool)->Value{self.make_closure_with_flags(code,env,0,"",strict,None)}
 pub fn make_closure(&mut self,code:NativeFn,env:EnvId,arity:usize,name:&str)->Value{self.make_closure_with_flags(code,env,arity,name,false,None)}
 pub fn make_closure_with_flags(&mut self,code:NativeFn,env:EnvId,arity:usize,name:&str,strict:bool,arrow_this:Option<Value>)->Value{
  let object=self.alloc_object(Some(self.function_prototype));let id=FunctionId(self.functions.len());
  self.functions.push(FunctionRecord{kind:FunctionKind::Native{code,env,strict,arrow_this},object,prototype:None,name:name.into(),arity,source:None,constructible:arrow_this.is_none()});
  let value=Value::Function(id);let name_key=self.string("name");let name_value=self.string(name);self.define_data(value,name_key,name_value,false,false,true).expect("fresh function name");let length_key=self.string("length");self.define_data(value,length_key,Value::Number(arity as f64),false,false,true).expect("fresh function length");
  if arrow_this.is_none(){let prototype=self.alloc_object(Some(self.object_prototype));let prototype_key=self.string("prototype");self.define_data(value,prototype_key,Value::Object(prototype),true,false,false).expect("fresh function prototype");let constructor_key=self.string("constructor");self.define_data(Value::Object(prototype),constructor_key,value,true,false,true).expect("fresh constructor");self.functions[id.0].prototype=Some(prototype);}
  value
 }
 pub fn make_named_closure(&mut self,code:NativeFn,env:EnvId,arity:usize,name:&str,strict:bool)->Value{
  let inner=self.child_block_env(env);let value=self.make_closure_with_flags(code,inner,arity,name,strict,None);self.declare_function_name(inner,name,value).expect("fresh function-name environment");value
 }
 pub fn native_function(&mut self,name:&str,arity:usize,code:NativeFn)->JsResult<Value>{let value=self.make_closure_with_flags(code,self.global_env,arity,name,true,Some(Value::Undefined));Ok(value)}
 pub fn set_function_constructable(&mut self,value:Value,constructible:bool)->JsResult<()>{let Value::Function(id)=value else{return Err(JsError::TypeError("not a function".into()))};self.functions.get_mut(id.0).ok_or_else(||JsError::TypeError("invalid function".into()))?.constructible=constructible;Ok(())}
 pub fn set_function_constructible(&mut self,value:Value,constructible:bool)->JsResult<()>{self.set_function_constructable(value,constructible)}
 pub fn set_function_source(&mut self,value:Value,source:&[u16])->JsResult<()>{let Value::Function(id)=value else{return Err(JsError::TypeError("not a function".into()))};self.functions.get_mut(id.0).ok_or_else(||JsError::TypeError("invalid function".into()))?.source=Some(source.to_vec());Ok(())}

 pub fn call_value(&mut self,callee:Value,this:Value,args:&[Value])->JsResult<Value>{
  let Value::Function(id)=callee else{return Err(JsError::TypeError("value is not callable".into()))};let record=self.functions.get(id.0).cloned().ok_or_else(||JsError::TypeError("invalid function".into()))?;
  match record.kind{
   FunctionKind::Bound{target,bound_this,args:mut bound}=>{bound.extend_from_slice(args);self.call_value(Value::Function(target),bound_this,&bound)},
   FunctionKind::Native{code,env,strict,arrow_this}=>{let receiver=if let Some(this)=arrow_this{this}else if strict{this}else{match this{Value::Null|Value::Undefined=>Value::Object(self.global_object),Value::Object(_)|Value::Function(_)=>this,_=>self.to_object(this)?}};self.call_stack.push(id);let result=code(self,receiver,args,env);self.call_stack.pop();result},
  }
 }
 pub fn construct(&mut self,callee:Value,args:&[Value])->JsResult<Value>{
  let Value::Function(id)=callee else{return Err(JsError::TypeError("value is not a constructor".into()))};let record=self.functions.get(id.0).cloned().ok_or_else(||JsError::TypeError("invalid constructor".into()))?;
  if !record.constructible{return Err(JsError::TypeError("function is not a constructor".into()))}
  if let FunctionKind::Bound{target,args:mut bound,..}=record.kind{bound.extend_from_slice(args);return self.construct(Value::Function(target),&bound)}
  let key=self.string("prototype");let candidate=self.get_property(callee,key)?;let prototype=match candidate{Value::Object(_)|Value::Function(_)=>self.object_id(candidate)?,_=>self.object_prototype};let object=Value::Object(self.alloc_object(Some(prototype)));let result=self.call_value(callee,object,args)?;Ok(if matches!(result,Value::Object(_)|Value::Function(_)){result}else{object})
 }
 pub fn bind_function(&mut self,target:Value,bound_this:Value,args:&[Value])->JsResult<Value>{
  let Value::Function(target_id)=target else{return Err(JsError::TypeError("bind target is not callable".into()))};let target_record=self.functions.get(target_id.0).cloned().ok_or_else(||JsError::TypeError("invalid bind target".into()))?;
  let prototype=self.objects[target_record.object.0].prototype;let object=self.alloc_object(prototype);let id=FunctionId(self.functions.len());self.functions.push(FunctionRecord{kind:FunctionKind::Bound{target:target_id,bound_this,args:args.to_vec()},object,prototype:None,name:String::new(),arity:0,source:None,constructible:target_record.constructible});let value=Value::Function(id);
  let length_key=self.string("length");let mut length=0.0;if self.has_own_property(target,length_key)?{if let Value::Number(n)=self.get_property(target,length_key)?{let integer=if n.is_nan(){0.0}else{n.trunc()};length=(integer-args.len()as f64).max(0.0);}}
  self.define_data(value,length_key,Value::Number(length),false,false,true)?;
  let name_key=self.string("name");let target_name=self.get_property(target,name_key)?;let mut name="bound ".encode_utf16().collect::<Vec<_>>();if let Value::String(s)=target_name{name.extend_from_slice(self.string_units(s));}let name_value=self.string_utf16(&name);self.functions[id.0].name=String::from_utf16_lossy(&name);self.define_data(value,name_key,name_value,false,false,true)?;Ok(value)
 }
 pub fn value_for_object(&self,object:ObjectId)->Value{self.functions.iter().position(|f|f.object==object).map(|id|Value::Function(FunctionId(id))).unwrap_or(Value::Object(object))}
 pub fn instance_of(&mut self,left:Value,right:Value)->JsResult<bool>{
  let Value::Function(id)=right else{return Err(JsError::TypeError("right-hand side of instanceof is not callable".into()))};let record=self.functions.get(id.0).cloned().ok_or_else(||JsError::TypeError("invalid instanceof function".into()))?;if let FunctionKind::Bound{target,..}=record.kind{return self.instance_of(left,Value::Function(target))}
  if !matches!(left,Value::Object(_)|Value::Function(_)){return Ok(false)}let key=self.string("prototype");let prototype_value=self.get_property(right,key)?;let prototype=self.object_id(prototype_value).map_err(|_|JsError::TypeError("function has non-object prototype in instanceof".into()))?;let mut current=self.objects[self.object_id(left)?.0].prototype;while let Some(object)=current{if object==prototype{return Ok(true)}current=self.objects[object.0].prototype;}Ok(false)
 }
 pub fn arguments_object(&mut self,env:EnvId,parameters:&[&str],args:&[Value],strict:bool)->JsResult<Value>{
  let object=self.object();let id=self.object_id(object)?;for (index,value)in args.iter().enumerate(){let key=self.string(&index.to_string());self.define_data(object,key,*value,true,true,true)?;}let length_key=self.string("length");self.define_data(object,length_key,Value::Number(args.len()as f64),true,false,true)?;
  let callee_key=self.string("callee");if strict{let poison=self.native_function("",0,throw_type_error)?;self.define_accessor(object,callee_key,Some(poison),Some(poison),false,false)?;}else{let callee=self.call_stack.last().copied().map(Value::Function).unwrap_or(Value::Undefined);self.define_data(object,callee_key,callee,true,false,true)?;let mut seen=std::collections::HashSet::new();for index in(0..parameters.len().min(args.len())).rev(){let name=parameters[index];if seen.insert(name){let binding=self.resolve_binding(env,name)?;let key=PropertyKey(self.intern(&index.to_string()));self.objects[id.0].arguments_map.insert(key,binding);}}}Ok(object)
 }
 pub fn install_function_builtins(&mut self)->JsResult<()>{
  let id=FunctionId(self.functions.len());self.functions.push(FunctionRecord{kind:FunctionKind::Native{code:empty_function,env:self.global_env,strict:true,arrow_this:None},object:self.function_prototype,prototype:None,name:String::new(),arity:0,source:None,constructible:false});let prototype=Value::Function(id);let name=self.string("name");let empty=self.string("");self.define_data(prototype,name,empty,false,false,true)?;let length=self.string("length");self.define_data(prototype,length,Value::Number(0.0),false,false,true)?;
  for(name,arity,code)in[("call",1,function_call as NativeFn),("apply",2,function_apply as NativeFn),("bind",1,function_bind as NativeFn),("toString",0,function_to_string as NativeFn)]{let method=self.native_function(name,arity,code)?;let key=self.string(name);self.define_data(prototype,key,method,true,false,true)?;}
  let constructor=self.native_function("Function",1,dynamic_function)?;let key=self.string("prototype");self.define_data(constructor,key,prototype,false,false,false)?;let constructor_key=self.string("constructor");self.define_data(prototype,constructor_key,constructor,true,false,true)?;let global_key=self.string("Function");self.define_data(Value::Object(self.global_object),global_key,constructor,true,false,true)?;Ok(())
 }
}
fn empty_function(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Undefined)}
fn throw_type_error(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Err(JsError::TypeError("restricted function property".into()))}
fn dynamic_function(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Err(JsError::Unsupported("dynamic Function constructor requires source compilation".into()))}
fn function_call(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{rt.call_value(this,args.first().copied().unwrap_or(Value::Undefined),args.get(1..).unwrap_or(&[]))}
fn function_bind(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{rt.bind_function(this,args.first().copied().unwrap_or(Value::Undefined),args.get(1..).unwrap_or(&[]))}
fn function_apply(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{if !matches!(this,Value::Function(_)){return Err(JsError::TypeError("apply target is not callable".into()))}let receiver=args.first().copied().unwrap_or(Value::Undefined);let array=args.get(1).copied().unwrap_or(Value::Undefined);if matches!(array,Value::Null|Value::Undefined){return rt.call_value(this,receiver,&[])}rt.object_id(array)?;let key=rt.string("length");let raw=rt.get_property(array,key)?;let n=rt.to_number(raw)?;let length=if n.is_nan()||n<=0.0{0}else if !n.is_finite()||n>1_000_000.0{return Err(JsError::Unsupported("apply argument list exceeds supported resource bound".into()))}else{n.floor()as usize};let mut values=Vec::with_capacity(length);for i in 0..length{let key=rt.string(&i.to_string());values.push(rt.get_property(array,key)?);}rt.call_value(this,receiver,&values)}
fn function_to_string(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let Value::Function(id)=this else{return Err(JsError::TypeError("Function.prototype.toString requires callable receiver".into()))};let record=rt.functions.get(id.0).cloned().ok_or_else(||JsError::TypeError("invalid function identity".into()))?;if let Some(source)=record.source{return Ok(rt.string_utf16(&source))}let text=if matches!(record.kind,FunctionKind::Bound{..}){"function () { [native code] }".into()}else{format!("function {}() {{ [native code] }}",record.name)};Ok(rt.string(&text))}
