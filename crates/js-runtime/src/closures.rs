//! Executable Rust closures retain shared lexical environments by identity.
use crate::{Runtime,Value,JsError,JsResult};
use crate::value::{FunctionId,ObjectId,StringId};
use crate::env::EnvId;
use crate::heap::PropertyKey;
pub type NativeFn=fn(&mut Runtime,Value,&[Value],EnvId)->JsResult<Value>;
#[derive(Clone)]
pub enum FunctionKind {
 Native{code:NativeFn,env:EnvId,strict:bool,arrow_this:Option<Value>},
 Bound{target:FunctionId,bound_this:Value,args:Vec<Value>},
}
#[derive(Clone)]
pub enum FunctionSource {
 Owned(Vec<u16>),
 StaticUtf16Le{bytes:&'static [u8],start:usize,end:usize},
}
impl FunctionSource {
 fn units(&self)->Vec<u16>{match self{Self::Owned(units)=>units.clone(),Self::StaticUtf16Le{bytes,start,end}=>bytes[start*2..end*2].chunks_exact(2).map(|p|u16::from_le_bytes([p[0],p[1]])).collect()}}
}
#[derive(Clone)]
pub struct FunctionRecord {
 pub kind:FunctionKind,pub object:ObjectId,pub prototype:Option<ObjectId>,
 pub name:StringId,pub arity:usize,pub source:Option<FunctionSource>,pub lexical_new_target:Value,pub constructor_default_prototype:ObjectId,pub native_construct_allocates_object:bool,pub constructible:bool,
}
impl Runtime {
 pub fn function(&mut self,code:NativeFn,env:EnvId,strict:bool)->Value{self.make_closure_with_flags(code,env,0,"",strict,None)}
 pub fn make_closure(&mut self,code:NativeFn,env:EnvId,arity:usize,name:&str)->Value{self.make_closure_with_flags(code,env,arity,name,false,None)}
 pub fn make_closure_with_flags(&mut self,code:NativeFn,env:EnvId,arity:usize,name:&str,strict:bool,arrow_this:Option<Value>)->Value{
  let lexical_new_target=if arrow_this.is_some(){self.current_new_target()}else{Value::Undefined};
  let name_id=self.intern(name);let object=self.alloc_object(Some(self.function_prototype));let id=self.allocate_function_record(FunctionRecord{kind:FunctionKind::Native{code,env,strict,arrow_this},object,prototype:None,name:name_id,arity,source:None,lexical_new_target,constructor_default_prototype:self.object_prototype,native_construct_allocates_object:false,constructible:arrow_this.is_none()});
  let value=Value::Function(id);let length_key=self.string("length");self.define_data(value,length_key,Value::Number(arity as f64),false,false,true).expect("fresh function length");let name_key=self.string("name");let name_value=Value::String(name_id);self.define_data(value,name_key,name_value,false,false,true).expect("fresh function name");
  if !strict&&arrow_this.is_none(){for name in ["arguments","caller"]{let key=self.string(name);self.define_data(value,key,Value::Null,false,false,false).expect("fresh legacy function field");}}
  if arrow_this.is_none(){let prototype=self.alloc_object(Some(self.object_prototype));let prototype_key=self.string("prototype");self.define_data(value,prototype_key,Value::Object(prototype),true,false,false).expect("fresh function prototype");let constructor_key=self.string("constructor");self.define_data(Value::Object(prototype),constructor_key,value,true,false,true).expect("fresh constructor");self.functions[id.0].prototype=Some(prototype);}
  value
 }
 pub fn make_named_closure(&mut self,code:NativeFn,env:EnvId,arity:usize,name:&str,strict:bool)->Value{
  let inner=self.child_block_env(env);let value=self.make_closure_with_flags(code,inner,arity,name,strict,None);self.declare_function_name(inner,name,value).expect("fresh function-name environment");value
 }
 pub fn native_function(&mut self,name:&str,arity:usize,code:NativeFn)->JsResult<Value>{
  let name_id=self.intern(name);let object=self.alloc_object(Some(self.function_prototype));let id=self.allocate_function_record(FunctionRecord{kind:FunctionKind::Native{code,env:self.global_env,strict:true,arrow_this:None},object,prototype:None,name:name_id,arity,source:None,lexical_new_target:Value::Undefined,constructor_default_prototype:self.object_prototype,native_construct_allocates_object:false,constructible:false});
  let value=Value::Function(id);let length_key=self.string("length");self.define_data(value,length_key,Value::Number(arity as f64),false,false,true)?;let name_key=self.string("name");let name_value=Value::String(name_id);self.define_data(value,name_key,name_value,false,false,true)?;Ok(value)
 }
 pub fn set_function_constructable(&mut self,value:Value,constructible:bool)->JsResult<()>{
  let Value::Function(id)=value else{return Err(JsError::TypeError("not a function".into()))};let record=self.functions.get_mut(id.0).ok_or_else(||JsError::TypeError("invalid function".into()))?;record.constructible=constructible;
  if !constructible{let object=record.object;record.prototype=None;for name in ["prototype","arguments","caller"]{let key=PropertyKey(self.intern(name));self.objects[object.0].remove(key);}}Ok(())
 }
 pub fn set_function_constructible(&mut self,value:Value,constructible:bool)->JsResult<()>{self.set_function_constructable(value,constructible)}
 pub fn set_function_source(&mut self,value:Value,source:&[u16])->JsResult<()>{let Value::Function(id)=value else{return Err(JsError::TypeError("not a function".into()))};self.functions.get_mut(id.0).ok_or_else(||JsError::TypeError("invalid function".into()))?.source=Some(FunctionSource::Owned(source.to_vec()));Ok(())}

 pub fn set_function_source_range(&mut self,value:Value,bytes:&'static [u8],start:usize,end:usize)->JsResult<()>{
  if bytes.len()%2!=0||start>end||end>bytes.len()/2{return Err(JsError::Unsupported("invalid static UTF-16 source range".into()))}
  let Value::Function(id)=value else{return Err(JsError::TypeError("not a function".into()))};self.functions.get_mut(id.0).ok_or_else(||JsError::TypeError("invalid function".into()))?.source=Some(FunctionSource::StaticUtf16Le{bytes,start,end});Ok(())
 }
 pub fn current_new_target(&self)->Value{
  let Some(id)=self.call_stack.last().copied()else{return Value::Undefined};
  if let Some(record)=self.functions.get(id.0){if matches!(record.kind,FunctionKind::Native{arrow_this:Some(_),..}){return record.lexical_new_target}}
  if self.is_construct_call(){self.construct_new_targets.last().copied().unwrap_or(Value::Function(id))}else{Value::Undefined}
 }
 pub fn new_target(&self)->Value{self.current_new_target()}
 pub fn call_value(&mut self,callee:Value,this:Value,args:&[Value])->JsResult<Value>{
  let Value::Function(id)=callee else{self.report_noncallable(callee);return Err(JsError::TypeError("value is not callable".into()))};let kind=self.functions.get(id.0).map(|f|f.kind.clone()).ok_or_else(||JsError::TypeError("invalid function".into()))?;
  match kind{
   FunctionKind::Bound{target,bound_this,args:mut bound}=>{bound.extend_from_slice(args);self.call_value(Value::Function(target),bound_this,&bound)},
   FunctionKind::Native{code,env,strict,arrow_this}=>{let receiver=if let Some(this)=arrow_this{this}else if strict{this}else{match this{Value::Null|Value::Undefined=>Value::Object(self.global_object),Value::Object(_)|Value::Function(_)=>this,_=>self.to_object(this)?}};let track_arguments=!strict&&arrow_this.is_none();if track_arguments{self.active_argument_frames.push(crate::lazy_arguments::ActiveArgumentsFrame::new(id,args));}self.call_stack.push(id);let result=code(self,receiver,args,env);self.call_stack.pop();if track_arguments{self.active_argument_frames.pop();}result},
  }
 }
 pub fn construct(&mut self,callee:Value,args:&[Value])->JsResult<Value>{self.construct_with_new_target(callee,args,callee)}
 pub fn set_native_construct_allocates_object(&mut self,callee:Value,enabled:bool)->JsResult<()>{let Value::Function(id)=callee else{return Err(JsError::TypeError("not a constructor".into()))};self.functions.get_mut(id.0).ok_or_else(||JsError::TypeError("invalid constructor".into()))?.native_construct_allocates_object=enabled;Ok(())}
 pub fn set_constructor_default_prototype(&mut self,callee:Value,prototype:Value)->JsResult<()>{let object=self.object_id(prototype)?;let Value::Function(id)=callee else{return Err(JsError::TypeError("not a constructor".into()))};self.functions.get_mut(id.0).ok_or_else(||JsError::TypeError("invalid constructor".into()))?.constructor_default_prototype=object;Ok(())}
 pub fn construct_with_new_target(&mut self,callee:Value,args:&[Value],new_target:Value)->JsResult<Value>{
  let Value::Function(id)=callee else{return Err(JsError::TypeError("value is not a constructor".into()))};let (kind,constructible,default_prototype,native_allocates)=self.functions.get(id.0).map(|f|(f.kind.clone(),f.constructible,f.constructor_default_prototype,f.native_construct_allocates_object)).ok_or_else(||JsError::TypeError("invalid constructor".into()))?;
  if !constructible{return Err(JsError::TypeError("function is not a constructor".into()))}
  let Value::Function(new_id)=new_target else{return Err(JsError::TypeError("newTarget is not a constructor".into()))};if !self.functions.get(new_id.0).map(|f|f.constructible).unwrap_or(false){return Err(JsError::TypeError("newTarget is not a constructor".into()))}
  if let FunctionKind::Bound{target,args:mut bound,..}=kind{bound.extend_from_slice(args);let next_target=if new_target==callee{Value::Function(target)}else{new_target};return self.construct_with_new_target(Value::Function(target),&bound,next_target)}
  if native_allocates{
   self.construct_stack.push((id,self.call_stack.len()));self.construct_new_targets.push(new_target);let result=self.call_value(callee,Value::Undefined,args);self.construct_new_targets.pop();self.construct_stack.pop();let value=result?;if !matches!(value,Value::Object(_)|Value::Function(_)){return Err(JsError::Unsupported("native constructor returned a primitive".into()))}return Ok(value)
  }
  let key=self.string("prototype");let candidate=self.get_property(new_target,key)?;let prototype=match candidate{Value::Object(_)|Value::Function(_)=>self.object_id(candidate)?,_=>default_prototype};let object=Value::Object(self.alloc_object(Some(prototype)));self.construct_stack.push((id,self.call_stack.len()));self.construct_new_targets.push(new_target);let result=self.call_value(callee,object,args);self.construct_new_targets.pop();self.construct_stack.pop();let result=result?;Ok(if matches!(result,Value::Object(_)|Value::Function(_)){result}else{object})
 }

 pub fn bind_function(&mut self,target:Value,bound_this:Value,args:&[Value])->JsResult<Value>{
  let Value::Function(target_id)=target else{return Err(JsError::TypeError("bind target is not callable".into()))};let (target_object,target_constructible)=self.functions.get(target_id.0).map(|f|(f.object,f.constructible)).ok_or_else(||JsError::TypeError("invalid bind target".into()))?;
  let prototype=self.objects[target_object.0].prototype;let empty_name=self.intern("");let object=self.alloc_object(prototype);let id=self.allocate_function_record(FunctionRecord{kind:FunctionKind::Bound{target:target_id,bound_this,args:args.to_vec()},object,prototype:None,name:empty_name,arity:0,source:None,lexical_new_target:Value::Undefined,constructor_default_prototype:self.object_prototype,native_construct_allocates_object:false,constructible:target_constructible});let value=Value::Function(id);
  let length_key=self.string("length");let mut length=0.0;if self.has_own_property(target,length_key)?{if let Value::Number(n)=self.get_property(target,length_key)?{let integer=if n.is_nan(){0.0}else{n.trunc()};length=(integer-args.len()as f64).max(0.0);}}
  self.define_data(value,length_key,Value::Number(length),false,false,true)?;
  let name_key=self.string("name");let target_name=self.get_property(target,name_key)?;let mut name="bound ".encode_utf16().collect::<Vec<_>>();if let Value::String(s)=target_name{name.extend_from_slice(self.string_units(s));}let name_value=self.string_utf16(&name);self.functions[id.0].name=if let Value::String(id)=name_value{id}else{unreachable!()};self.define_data(value,name_key,name_value,false,false,true)?;Ok(value)
 }
 pub fn is_construct_call(&self)->bool{let Some(id)=self.call_stack.last().copied()else{return false};self.construct_stack.last().copied()==Some((id,self.call_stack.len()-1))}
 pub fn value_for_object(&self,object:ObjectId)->Value{if self.objects.get(object.0).is_some_and(|object|!object.is_function){return Value::Object(object)}self.function_objects.get(&object).copied().map(Value::Function).unwrap_or(Value::Object(object))}
 pub fn instance_of(&mut self,left:Value,right:Value)->JsResult<bool>{
  let Value::Function(id)=right else{return Err(JsError::TypeError("right-hand side of instanceof is not callable".into()))};let kind=self.functions.get(id.0).map(|f|f.kind.clone()).ok_or_else(||JsError::TypeError("invalid instanceof function".into()))?;if let FunctionKind::Bound{target,..}=kind{return self.instance_of(left,Value::Function(target))}
  if !matches!(left,Value::Object(_)|Value::Function(_)){return Ok(false)}let key=self.string("prototype");let prototype_value=self.get_property(right,key)?;let prototype=self.object_id(prototype_value).map_err(|_|JsError::TypeError("function has non-object prototype in instanceof".into()))?;let mut current=self.objects[self.object_id(left)?.0].prototype;while let Some(object)=current{if object==prototype{return Ok(true)}current=self.objects[object.0].prototype;}Ok(false)
 }
 pub fn arguments_object(&mut self,env:EnvId,parameters:&[&str],args:&[Value],strict:bool)->JsResult<Value>{
  let object=self.object();let id=self.object_id(object)?;self.objects[id.0].kind=crate::ObjectKind::Arguments;for (index,value)in args.iter().enumerate(){let key=self.string(&index.to_string());self.define_data(object,key,*value,true,true,true)?;}let length_key=self.string("length");self.define_data(object,length_key,Value::Number(args.len()as f64),true,false,true)?;
  let callee_key=self.string("callee");if strict{let poison=self.throw_type_error.ok_or_else(||JsError::Unsupported("missing intrinsic ThrowTypeError".into()))?;self.define_accessor(object,callee_key,Some(poison),Some(poison),false,false)?;}else{let callee=self.call_stack.last().copied().map(Value::Function).unwrap_or(Value::Undefined);self.define_data(object,callee_key,callee,true,false,true)?;let mut seen=std::collections::HashSet::new();for index in(0..parameters.len()).rev(){let name=parameters[index];if seen.insert(name)&&index<args.len(){let binding=self.resolve_binding(env,name)?;let key=PropertyKey(self.intern(&index.to_string()));self.objects[id.0].arguments_map.insert(key,binding);}}}Ok(object)
 }
 pub fn install_function_builtins(&mut self)->JsResult<()>{
  if self.function_objects.contains_key(&self.function_prototype){return Ok(())}
  let empty_name=self.intern("");let id=self.allocate_function_record(FunctionRecord{kind:FunctionKind::Native{code:empty_function,env:self.global_env,strict:true,arrow_this:None},object:self.function_prototype,prototype:None,name:empty_name,arity:0,source:None,lexical_new_target:Value::Undefined,constructor_default_prototype:self.object_prototype,native_construct_allocates_object:false,constructible:false});let prototype=Value::Function(id);let length=self.string("length");self.define_data(prototype,length,Value::Number(0.0),false,false,true)?;let name=self.string("name");let empty=self.string("");self.define_data(prototype,name,empty,false,false,true)?;
  let poison=self.native_function("",0,throw_type_error)?;self.throw_type_error=Some(poison);for(name,value)in[("length",Value::Number(0.0)),("name",empty)]{let key=self.string(name);self.define_data(poison,key,value,false,false,false)?;}let poison_object=self.object_id(poison)?;self.objects[poison_object.0].extensible=false;for name in ["arguments","caller"]{let key=self.string(name);self.define_accessor(prototype,key,Some(poison),Some(poison),false,true)?;}
  for(name,arity,code)in[("call",1,function_call as NativeFn),("apply",2,function_apply as NativeFn),("bind",1,function_bind as NativeFn),("toString",0,function_to_string as NativeFn)]{let method=self.native_function(name,arity,code)?;let key=self.string(name);self.define_data(prototype,key,method,true,false,true)?;}
  let constructor=self.native_function("Function",1,dynamic_function)?;self.set_function_constructable(constructor,true)?;let key=self.string("prototype");self.define_data(constructor,key,prototype,false,false,false)?;let constructor_key=self.string("constructor");self.define_data(prototype,constructor_key,constructor,true,false,true)?;let global_key=self.string("Function");self.define_data(Value::Object(self.global_object),global_key,constructor,true,false,true)?;Ok(())
 }
}
fn empty_function(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Undefined)}
fn throw_type_error(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Err(JsError::TypeError("'caller', 'callee', and 'arguments' properties may not be accessed on strict mode functions or the arguments objects for calls to them".into()))}
fn dynamic_function(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Err(JsError::Unsupported("dynamic Function constructor requires source compilation".into()))}
fn function_call(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{rt.call_value(this,args.first().copied().unwrap_or(Value::Undefined),args.get(1..).unwrap_or(&[]))}
fn function_bind(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{rt.bind_function(this,args.first().copied().unwrap_or(Value::Undefined),args.get(1..).unwrap_or(&[]))}
fn function_apply(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{if !matches!(this,Value::Function(_)){return Err(JsError::TypeError("apply target is not callable".into()))}let receiver=args.first().copied().unwrap_or(Value::Undefined);let array=args.get(1).copied().unwrap_or(Value::Undefined);if matches!(array,Value::Null|Value::Undefined){return rt.call_value(this,receiver,&[])}rt.object_id(array)?;let key=rt.string("length");let raw=rt.get_property(array,key)?;let n=rt.to_number(raw)?;let length=if n.is_nan()||n<=0.0{0}else if !n.is_finite()||n>1_000_000.0{return Err(JsError::Unsupported("apply argument list exceeds supported resource bound".into()))}else{n.floor()as usize};// Keep every original indexed Get in order, including getters and throws.
// Small argument lists borrow stack storage until the unchanged native call returns.
if length<=8{let mut values=[Value::Undefined;8];for(i,value)in values[..length].iter_mut().enumerate(){let key=rt.string(&i.to_string());*value=rt.get_property(array,key)?;}return rt.call_value(this,receiver,&values[..length])}
let mut values=Vec::with_capacity(length);for i in 0..length{let key=rt.string(&i.to_string());values.push(rt.get_property(array,key)?);}rt.call_value(this,receiver,&values)}
fn function_to_string(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let Value::Function(id)=this else{return Err(JsError::TypeError("Function.prototype.toString requires callable receiver".into()))};let record=rt.functions.get(id.0).ok_or_else(||JsError::TypeError("invalid function identity".into()))?;if let Some(source)=record.source.as_ref(){let units=source.units();return Ok(rt.string_utf16(&units))}let text=if matches!(record.kind,FunctionKind::Bound{..}){"function () { [native code] }".into()}else{format!("function {}() {{ [native code] }}",rt.string_text(record.name))};Ok(rt.string(&text))}

#[cfg(test)]
mod tests {
 use super::*;
 fn increment(rt:&mut Runtime,_:Value,_:&[Value],env:EnvId)->JsResult<Value>{let old=rt.lookup(env,"counter")?;let next=Value::Number(rt.to_number(old)?+1.0);rt.assign(env,"counter",next,false)}
 fn identity_this(_: &mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(this)}
 fn throws_after_write(rt:&mut Runtime,_:Value,args:&[Value],env:EnvId)->JsResult<Value>{rt.assign(env,"counter",Value::Number(41.0),false)?;Err(JsError::Throw(args[0]))}
 fn constructor(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{let key=rt.string("x");rt.set_property(this,key,args[0],true)?;Ok(Value::Number(999.0))}
 fn read_new_target(rt:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(rt.current_new_target())}
 fn make_new_target_arrow(rt:&mut Runtime,this:Value,_:&[Value],env:EnvId)->JsResult<Value>{Ok(rt.make_closure_with_flags(read_new_target,env,0,"",false,Some(this)))}
 #[test]fn new_target_tracks_constructor_frames_and_escapes_in_arrows(){
  let mut rt=Runtime::new();let env=rt.global_env;let f=rt.make_closure(read_new_target,env,0,"F");assert_eq!(rt.call_value(f,Value::Undefined,&[]).unwrap(),Value::Undefined);assert_eq!(rt.construct(f,&[]).unwrap(),f);let bound=rt.bind_function(f,Value::Null,&[]).unwrap();assert_eq!(rt.construct(bound,&[]).unwrap(),f);let factory=rt.make_closure(make_new_target_arrow,env,0,"Factory");let arrow=rt.construct(factory,&[]).unwrap();assert_eq!(rt.call_value(arrow,Value::Null,&[]).unwrap(),factory);assert_eq!(rt.current_new_target(),Value::Undefined);
 }
 #[test]fn static_little_endian_source_range_retains_utf16_units(){
  static POOL:&[u8]=&[112,0,102,0,0,216,125,0,115,0];let mut rt=Runtime::new();let f=rt.make_closure(identity_this,rt.global_env,0,"f");rt.set_function_source_range(f,POOL,1,4).unwrap();let key=rt.string("toString");let method=rt.get_property(f,key).unwrap();let value=rt.call_value(method,f,&[]).unwrap();let Value::String(id)=value else{panic!("source string")};assert_eq!(rt.string_units(id),[102,0xd800,125]);assert!(matches!(rt.set_function_source_range(f,POOL,4,6),Err(JsError::Unsupported(_))));
 }
 #[test]fn shared_capture_mutation_and_throw_prefix_survive_calls(){
  let mut rt=Runtime::new();let env=rt.child_env(rt.global_env);rt.declare(env,"counter",Value::Number(0.0)).unwrap();let first=rt.make_closure(increment,env,0,"first");let second=rt.make_closure(increment,env,0,"second");assert_eq!(rt.call_value(first,Value::Undefined,&[]).unwrap(),Value::Number(1.0));assert_eq!(rt.call_value(second,Value::Undefined,&[]).unwrap(),Value::Number(2.0));let throwing=rt.make_closure(throws_after_write,env,1,"throwing");let sentinel=rt.object();assert!(matches!(rt.call_value(throwing,Value::Null,&[sentinel]),Err(JsError::Throw(value))if value==sentinel));assert_eq!(rt.lookup(env,"counter").unwrap(),Value::Number(41.0));assert!(rt.call_stack.is_empty());
 }
 #[test]fn strict_sloppy_arrow_and_bound_receivers_remain_distinct(){
  let mut rt=Runtime::new();let global=rt.global_env;let strict=rt.make_closure_with_flags(identity_this,global,0,"strict",true,None);let sloppy=rt.make_closure(identity_this,global,0,"sloppy");let lexical=rt.object();let arrow=rt.make_closure_with_flags(identity_this,global,0,"arrow",false,Some(lexical));assert_eq!(rt.call_value(strict,Value::Undefined,&[]).unwrap(),Value::Undefined);assert_eq!(rt.call_value(sloppy,Value::Null,&[]).unwrap(),Value::Object(rt.global_object));let bound=rt.bind_function(arrow,Value::Null,&[]).unwrap();assert_eq!(rt.call_value(bound,Value::Undefined,&[]).unwrap(),lexical);assert!(matches!(rt.construct(arrow,&[]),Err(JsError::TypeError(_))));
 }
 #[test]fn bound_constructor_ignores_bound_this_and_uses_target_prototype(){
  let mut rt=Runtime::new();let target=rt.make_closure(constructor,rt.global_env,1,"Ctor");let receiver=rt.object();let bound=rt.bind_function(target,receiver,&[Value::Number(17.0)]).unwrap();let instance=rt.construct(bound,&[]).unwrap();let x=rt.string("x");assert_eq!(rt.get_property(instance,x).unwrap(),Value::Number(17.0));assert_eq!(rt.get_property(receiver,x).unwrap(),Value::Undefined);assert!(rt.instance_of(instance,target).unwrap());assert!(rt.instance_of(instance,bound).unwrap());assert!(rt.construct_stack.is_empty());
 }
 #[test]fn mapped_arguments_follow_live_cells_and_detach_on_descriptor_change(){
  let mut rt=Runtime::new();let env=rt.child_env(rt.global_env);rt.declare(env,"a",Value::Number(2.0)).unwrap();let arguments=rt.arguments_object(env,&["a","a"],&[Value::Number(1.0),Value::Number(2.0)],false).unwrap();let zero=rt.string("0");let one=rt.string("1");rt.set_property(arguments,zero,Value::Number(10.0),false).unwrap();assert_eq!(rt.lookup(env,"a").unwrap(),Value::Number(2.0));rt.assign(env,"a",Value::Number(4.0),false).unwrap();assert_eq!(rt.get_property(arguments,one).unwrap(),Value::Number(4.0));rt.define_data(arguments,one,Value::Number(4.0),false,true,true).unwrap();rt.assign(env,"a",Value::Number(8.0),false).unwrap();assert_eq!(rt.get_property(arguments,one).unwrap(),Value::Number(4.0));
 }
 #[test]fn source_metadata_and_function_prototype_are_actual_callable_objects(){
  let mut rt=Runtime::new();let function=rt.make_closure(identity_this,rt.global_env,0,"f");let source=[102,117,110,99,116,105,111,110,32,102,40,41,123,47,42,0xd800,42,47,125];rt.set_function_source(function,&source).unwrap();let key=rt.string("toString");let to_string=rt.get_property(function,key).unwrap();let result=rt.call_value(to_string,function,&[]).unwrap();let Value::String(id)=result else{panic!("function source is a string")};assert_eq!(rt.string_units(id),source);let prototype=rt.value_for_object(rt.function_prototype);assert!(matches!(prototype,Value::Function(_)));assert_eq!(rt.call_value(prototype,Value::Undefined,&[]).unwrap(),Value::Undefined);
 }
}

#[cfg(test)]mod function_identity_index_tests{
 use super::*;
 fn noop(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Undefined)}
 #[test]fn all_creation_paths_keep_the_same_callable_object_identity(){let mut rt=Runtime::new();let env=rt.global_env;let native=rt.native_function("native",0,noop).unwrap();let ordinary=rt.make_closure(noop,env,0,"ordinary");let strict=rt.make_closure_with_flags(noop,env,0,"strict",true,None);let arrow=rt.make_closure_with_flags(noop,env,0,"arrow",false,Some(Value::Null));let named=rt.make_named_closure(noop,env,0,"named",true);let bound=rt.bind_function(ordinary,Value::Null,&[]).unwrap();let intrinsic=rt.value_for_object(rt.function_prototype);for value in[native,ordinary,strict,arrow,named,bound,intrinsic]{let object=rt.object_id(value).unwrap();assert_eq!(rt.value_for_object(object),value);let child=Value::Object(rt.alloc_object(Some(object)));let global=Value::Object(rt.global_object);let key=rt.string("Object");let ctor=rt.get(global,key).unwrap();let key=rt.string("getPrototypeOf");let get=rt.get(ctor,key).unwrap();assert_eq!(rt.call(get,ctor,&[child]).unwrap(),value);rt.set_prototype(value,Value::Null).unwrap();assert_eq!(rt.value_for_object(object),value);}assert_eq!(rt.function_objects.len(),rt.functions.len());for(i,function)in rt.functions.iter().enumerate(){assert_eq!(rt.value_for_object(function.object),Value::Function(FunctionId(i)));}}
 #[test]fn ordinary_objects_remain_noncallable_even_when_inheriting_from_functions(){let mut rt=Runtime::new();let f=rt.native_function("callable",0,noop).unwrap();let prototype=rt.object_id(f).unwrap();for _ in 0..1024{rt.native_function("later",0,noop).unwrap();}let object=Value::Object(rt.alloc_object(Some(prototype)));let id=rt.object_id(object).unwrap();assert_eq!(rt.value_for_object(id),object);assert!(matches!(rt.call(object,Value::Null,&[]),Err(JsError::TypeError(_))));let source="function callable() { return 7; }".encode_utf16().collect::<Vec<_>>();rt.set_function_source(f,&source).unwrap();rt.set_prototype(f,Value::Object(rt.function_prototype)).unwrap();let key=rt.string("toString");let to_string=rt.get(f,key).unwrap();let result=rt.call(to_string,f,&[]).unwrap();let Value::String(text)=result else{panic!()};assert_eq!(rt.string_units(text),source);assert_eq!(rt.value_for_object(prototype),f);}
 #[test]fn captured_internal_name_ignores_later_own_name_descriptor_changes(){let mut rt=Runtime::new();let f=rt.native_function("original",0,noop).unwrap();let Value::Function(id)=f else{unreachable!()};let name=rt.functions[id.0].name;let key=rt.string("name");let renamed=rt.string("replacement");rt.define_data(f,key,renamed,false,false,true).unwrap();assert_eq!(rt.string_text(name),"original");let method=rt.string("toString");let method=rt.get(f,method).unwrap();let rendered=rt.call(method,f,&[]).unwrap();let Value::String(rendered)=rendered else{unreachable!()};assert_eq!(rt.string_text(rendered),"function original() { [native code] }");let bound=rt.bind_function(f,Value::Null,&[]).unwrap();let bound_name=rt.get(bound,key).unwrap();let Value::String(bound_name)=bound_name else{unreachable!()};assert_eq!(rt.string_text(bound_name),"bound replacement");assert_eq!(rt.functions[id.0].name,name);}

}
