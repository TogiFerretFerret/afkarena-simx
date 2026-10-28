//! Exact Cocos class dispatch for zero through five arguments. The original
//! class wrapper remains the active JS frame; every prefix operation, ctor
//! getter, callback and exception still executes in source order.
use crate::{Runtime,Value,EnvId,JsResult};
impl Runtime{
 pub fn try_native_class_dispatch(&mut self,this:Value,args:&[Value],parent:EnvId,strict:bool)->JsResult<Option<Value>>{
  // Larger calls retain the entire original body, before its prefix effects.
  if args.len()>5{return Ok(None)}
  let manager=self.lookup(parent,"classManager")?;
  let key=self.string("getNewInstanceId");let method=self.get_property(manager,key)?;
  let instance_id=self.call_value(method,manager,&[])?;
  let key=self.string("__instanceId");self.set_property(this,key,instance_id,strict)?;
  let key=self.string("ctor");let test=self.get_property(this,key)?;
  if self.truthy(test){let target=self.get_property(this,key)?;self.call_value(target,this,args)?;}
  // Source ignores the ctor return value, even an object, before falling off.
  Ok(Some(Value::Undefined))
 }
}
