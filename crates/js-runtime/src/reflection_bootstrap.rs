//! Ordinary-object reflection needed by the source clock/ClassMgr bootstrap.
//! Descriptor conversion is eager and separate from definition, so a later
//! descriptor getter can fail before any target property is defined.
use crate::{Runtime,Value,EnvId,JsError,JsResult,PropertyKind};
use crate::closures::NativeFn;
fn arg(args:&[Value],index:usize)->Value{args.get(index).copied().unwrap_or(Value::Undefined)}
fn is_object(value:Value)->bool{matches!(value,Value::Object(_)|Value::Function(_))}

impl Runtime{
 pub fn install_reflection_builtins(&mut self)->JsResult<()>{
  let key=self.string("Object");let object=self.get(Value::Object(self.global_object),key)?;
  for(name,arity,code)in[("assign",2,object_assign as NativeFn),("freeze",1,object_freeze as NativeFn),("seal",1,object_seal as NativeFn),("isFrozen",1,object_is_frozen as NativeFn),("isSealed",1,object_is_sealed as NativeFn),("is",2,object_is as NativeFn),("hasOwn",2,object_has_own as NativeFn),("defineProperties",2,object_define_properties as NativeFn),("create",2,object_create as NativeFn),("getOwnPropertyDescriptors",1,object_descriptors as NativeFn)]{self.builtin(object,name,arity,code)?;}
  Ok(())
 }
}

/// Materialize ToPropertyDescriptor into a private null-prototype data record.
/// Field presence and getters are observed once, in specification order. A
/// null prototype prevents later Object.prototype mutation from adding fields.
fn descriptor_snapshot(rt:&mut Runtime,attributes:Value)->JsResult<Value>{
 rt.object_id(attributes)?;let mut fields=Vec::new();let mut data=false;let mut accessor=false;
 for name in["enumerable","configurable","value","writable","get","set"]{
  let key=rt.string(name);if !rt.has_property(attributes,key)?{continue}let mut value=rt.get(attributes,key)?;
  match name{
   "enumerable"|"configurable"|"writable"=>{value=Value::Bool(rt.truthy(value));if name=="writable"{data=true}},
   "value"=>data=true,
   "get"|"set"=>{accessor=true;if !matches!(value,Value::Undefined|Value::Function(_)){return Err(JsError::TypeError("descriptor accessor is not callable".into()))}},
   _=>unreachable!(),
  }
  fields.push((key,value));
 }
 if data&&accessor{return Err(JsError::TypeError("descriptor combines accessor and data fields".into()))}
 let result=Value::Object(rt.alloc_object(None));for(key,value)in fields{rt.define_data(result,key,value,true,true,true)?;}Ok(result)
}
fn define_properties(rt:&mut Runtime,target:Value,properties:Value)->JsResult<Value>{
 rt.object_id(target)?;let properties=rt.to_object(properties)?;let id=rt.object_id(properties)?;let keys=rt.own_keys(properties,false)?;let mut descriptors=Vec::new();
 for key in keys{let property=rt.to_property_key(key)?;if !rt.own_descriptor(id,property)?.is_some_and(|d|d.enumerable){continue}let raw=rt.get(properties,property)?;let descriptor=descriptor_snapshot(rt,raw)?;descriptors.push((property,descriptor));}
 for(property,descriptor)in descriptors{rt.define_property_value(target,Value::String(property.0),descriptor)?;}Ok(target)
}
fn object_define_properties(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{define_properties(rt,arg(args,0),arg(args,1))}
fn object_create(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 let prototype=arg(args,0);let parent=if matches!(prototype,Value::Null){None}else{Some(rt.object_id(prototype)?)};let object=Value::Object(rt.alloc_object(parent));let properties=arg(args,1);if !matches!(properties,Value::Undefined){define_properties(rt,object,properties)?;}Ok(object)
}
fn object_assign(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 let target=rt.to_object(arg(args,0))?;
 for source in args.iter().copied().skip(1){if matches!(source,Value::Undefined|Value::Null){continue}let source=rt.to_object(source)?;let id=rt.object_id(source)?;let keys=rt.own_keys(source,false)?;
  for key in keys{let property=rt.to_property_key(key)?;if rt.own_descriptor(id,property)?.is_some_and(|d|d.enumerable){let value=rt.get(source,property)?;rt.set(target,property,value,true)?;}}
 }Ok(target)
}
fn integrity(rt:&mut Runtime,value:Value,freeze:bool)->JsResult<Value>{
 if !is_object(value){return Ok(value)}let id=rt.object_id(value)?;rt.objects[id.0].extensible=false;let keys=rt.own_keys(value,false)?;
 for key in keys{let property=rt.to_property_key(key)?;let Some(descriptor)=rt.own_descriptor(id,property)?else{continue};
  match descriptor.kind{
   PropertyKind::Data{value:entry,writable}=>{if descriptor.configurable||(freeze&&writable){rt.define_data(value,property,entry,if freeze{false}else{writable},descriptor.enumerable,false)?;}},
   PropertyKind::Accessor{get,set}=>{if descriptor.configurable{rt.define_accessor(value,property,get,set,descriptor.enumerable,false)?;}},
  }
 }Ok(value)
}
fn check_integrity(rt:&mut Runtime,value:Value,freeze:bool)->JsResult<Value>{
 if !is_object(value){return Ok(Value::Bool(true))}let id=rt.object_id(value)?;if rt.objects[id.0].extensible{return Ok(Value::Bool(false))}
 for key in rt.own_keys(value,false)?{let property=rt.to_property_key(key)?;if let Some(descriptor)=rt.own_descriptor(id,property)?{if descriptor.configurable||freeze&&matches!(descriptor.kind,PropertyKind::Data{writable:true,..}){return Ok(Value::Bool(false))}}}Ok(Value::Bool(true))
}
fn object_freeze(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{integrity(rt,arg(args,0),true)}
fn object_seal(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{integrity(rt,arg(args,0),false)}
fn object_is_frozen(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{check_integrity(rt,arg(args,0),true)}
fn object_is_sealed(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{check_integrity(rt,arg(args,0),false)}
fn object_is(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Bool(rt.same_value(arg(args,0),arg(args,1))))}
fn object_has_own(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let object=rt.to_object(arg(args,0))?;let property=rt.to_property_key(arg(args,1))?;Ok(Value::Bool(rt.has_own_property(object,property)?))}
fn object_descriptors(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let object=rt.to_object(arg(args,0))?;let id=rt.object_id(object)?;let keys=rt.own_keys(object,false)?;let result=rt.object();for key in keys{let property=rt.to_property_key(key)?;if rt.own_descriptor(id,property)?.is_none(){continue}let descriptor=rt.get_own_descriptor_value(object,Value::String(property.0))?;rt.define_data(result,property,descriptor,true,true,true)?;}Ok(result)}
