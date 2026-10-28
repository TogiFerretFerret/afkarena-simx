//! Lexical cells are owned by stable environments. A closure stores an EnvId,
//! never a snapshot of captured values. Global var bindings use the actual global
//! object's properties, while global let/const stay declarative and can shadow it.
use std::collections::BTreeMap;
use crate::{Runtime, Value, JsError, JsResult};
use crate::value::{StringId,ObjectId};

#[derive(Clone,Copy,Debug,Eq,PartialEq,Hash)]
pub struct EnvId(pub usize);
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum EnvKind { Global, Function, Block }
#[derive(Clone,Debug)]
pub struct Binding {
 pub(crate) value:Value,pub(crate) mutable:bool,pub(crate) initialized:bool,
 pub(crate) deletable:bool,pub(crate) object_backed:bool,pub(crate) strict_immutable:bool,
}
#[derive(Clone,Debug)]
pub struct Environment {
 pub(crate) parent:Option<EnvId>,pub(crate) bindings:BTreeMap<String,Binding>,pub(crate) kind:EnvKind,
}
impl Environment {pub fn new(parent:Option<EnvId>,kind:EnvKind)->Self{Self{parent,bindings:BTreeMap::new(),kind}}}
/// Captures the reference before RHS execution. A later declaration must not
/// retarget an already-resolved unresolvable reference or lexical cell.
#[derive(Clone,Copy,Debug,Eq,PartialEq,Hash)]
pub enum BindingRef {
 Cell{env:EnvId,name:StringId}, Global{object:ObjectId,name:StringId}, Unresolvable{name:StringId},
}
impl Runtime {
 pub fn child_env(&mut self,parent:EnvId)->EnvId {let id=EnvId(self.environments.len());self.environments.push(Environment::new(Some(parent),EnvKind::Function));id}
 pub fn child_block_env(&mut self,parent:EnvId)->EnvId {let id=EnvId(self.environments.len());self.environments.push(Environment::new(Some(parent),EnvKind::Block));id}
 pub fn new_env(&mut self,parent:Option<EnvId>)->EnvId {match parent{Some(p)=>self.child_env(p),None=>{let id=EnvId(self.environments.len());self.environments.push(Environment::new(None,EnvKind::Function));id}}}
 fn variable_env(&self,mut env:EnvId)->JsResult<EnvId>{loop{let e=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;if e.kind!=EnvKind::Block{return Ok(env)}env=e.parent.ok_or_else(||JsError::Unsupported("block environment has no parent".into()))?;}}
 /// Creates a var/parameter cell only if absent. Initializers and duplicate
 /// parameters perform their assignment separately; hoisting cannot reset them.
 pub fn declare(&mut self,env:EnvId,name:&str,value:Value)->JsResult<()> {
  let env=self.variable_env(env)?;
  if self.environments[env.0].bindings.contains_key(name){return Ok(())}
  let global=self.environments[env.0].kind==EnvKind::Global;
  if global {
   let key=Value::String(self.intern(name));let object=Value::Object(self.global_object);
   if !self.has_own_property(object,key)? {self.define_data_property(object,key,value,true,true,false)?;}
  }
  self.environments[env.0].bindings.insert(name.into(),Binding{value,mutable:true,initialized:true,deletable:false,object_backed:global,strict_immutable:false});
  Ok(())
 }
 pub fn declare_var(&mut self,env:EnvId,name:&str)->JsResult<()> {self.declare(env,name,Value::Undefined)}
 pub fn declare_lexical(&mut self,env:EnvId,name:&str,mutable:bool)->JsResult<()> {
  let e=self.environments.get_mut(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;
  if e.bindings.contains_key(name){return Err(JsError::Unsupported(format!("duplicate lexical declaration {name}; compiler must reject it")))}
  e.bindings.insert(name.into(),Binding{value:Value::Undefined,mutable,initialized:false,deletable:false,object_backed:false,strict_immutable:true});Ok(())
 }
 pub fn initialize(&mut self,env:EnvId,name:&str,value:Value)->JsResult<Value> {
  let b=self.environments.get_mut(env.0).and_then(|e|e.bindings.get_mut(name)).ok_or_else(||JsError::ReferenceError(format!("{name} is not defined")))?;
  if b.initialized{return Err(JsError::TypeError(format!("binding {name} is already initialized")))}
  b.value=value;b.initialized=true;Ok(value)
 }
 pub fn resolve_binding(&mut self,mut env:EnvId,name:&str)->JsResult<BindingRef> {
  let id=self.intern(name);
  loop{
   let e=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;
   if let Some(binding)=e.bindings.get(name){return Ok(if binding.object_backed{BindingRef::Global{object:self.global_object,name:id}}else{BindingRef::Cell{env,name:id}})}
   if let Some(parent)=e.parent{env=parent;continue}
   if e.kind==EnvKind::Global&&self.has_property(Value::Object(self.global_object),Value::String(id))? {return Ok(BindingRef::Global{object:self.global_object,name:id})}
   return Ok(BindingRef::Unresolvable{name:id})
  }
 }
 pub fn read_binding(&mut self,reference:BindingRef)->JsResult<Value>{match reference{
  BindingRef::Cell{env,name}=>{let name=self.string_text(name);let b=self.environments.get(env.0).and_then(|e|e.bindings.get(&name)).ok_or_else(||JsError::ReferenceError(format!("{name} is not defined")))?;if !b.initialized{return Err(JsError::ReferenceError(format!("Cannot access '{name}' before initialization")))}Ok(b.value)},
  BindingRef::Global{object,name}=>self.get_property(Value::Object(object),Value::String(name)),
  BindingRef::Unresolvable{name}=>Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(name)))),
 }}
 pub fn write_binding(&mut self,reference:BindingRef,value:Value,strict:bool)->JsResult<Value>{match reference{
  BindingRef::Cell{env,name}=>{let name=self.string_text(name);let b=self.environments.get_mut(env.0).and_then(|e|e.bindings.get_mut(&name)).ok_or_else(||JsError::ReferenceError(format!("{name} is not defined")))?;if !b.initialized{return Err(JsError::ReferenceError(format!("Cannot access '{name}' before initialization")))}if !b.mutable{if strict||b.strict_immutable{return Err(JsError::TypeError("Assignment to constant variable".into()))}return Ok(value)}b.value=value;Ok(value)},
  BindingRef::Global{object,name}=>self.set_property(Value::Object(object),Value::String(name),value,strict),
  BindingRef::Unresolvable{name}=>{if strict{return Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(name))))}self.set_property(Value::Object(self.global_object),Value::String(name),value,false)},
 }}
 pub fn lookup(&mut self,env:EnvId,name:&str)->JsResult<Value>{let reference=self.resolve_binding(env,name)?;self.read_binding(reference)}
 pub fn assign(&mut self,env:EnvId,name:&str,value:Value,strict:bool)->JsResult<Value>{let reference=self.resolve_binding(env,name)?;self.write_binding(reference,value,strict)}
 pub fn typeof_name(&mut self,env:EnvId,name:&str)->JsResult<Value>{let reference=self.resolve_binding(env,name)?;if matches!(reference,BindingRef::Unresolvable{..}){return Ok(self.string("undefined"))}let value=self.read_binding(reference)?;Ok(self.string(match value{Value::Undefined=>"undefined",Value::Null|Value::Object(_)=>"object",Value::Bool(_)=>"boolean",Value::Number(_)=>"number",Value::String(_)=>"string",Value::Function(_)=>"function"}))}
 pub fn delete_binding(&mut self,reference:BindingRef,strict:bool)->JsResult<bool>{match reference{
  BindingRef::Unresolvable{..}=>Ok(true),
  BindingRef::Global{object,name}=>self.delete(Value::Object(object),Value::String(name),strict),
  BindingRef::Cell{env,name}=>{let name=self.string_text(name);let deletable=self.environments.get(env.0).and_then(|e|e.bindings.get(&name)).map(|b|b.deletable).unwrap_or(true);if deletable{self.environments[env.0].bindings.remove(&name);Ok(true)}else if strict{Err(JsError::TypeError(format!("Cannot delete binding {name}")))}else{Ok(false)}},
 }}
 /// Per-iteration lexical environments copy binding VALUES into fresh cells.
 /// Existing closures keep the previous cells; the new environment has the same
 /// parent rather than being a child of the previous iteration.
 pub fn clone_loop_env(&mut self,env:EnvId,names:&[&str])->JsResult<EnvId>{
  let old=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid loop environment".into()))?;
  let mut new=Environment::new(old.parent,old.kind);
  for name in names {let binding=old.bindings.get(*name).ok_or_else(||JsError::ReferenceError(format!("loop binding {name} is missing")))?;if binding.object_backed{return Err(JsError::Unsupported("global object binding cannot be a loop lexical cell".into()))}new.bindings.insert((*name).into(),binding.clone());}
  let id=EnvId(self.environments.len());self.environments.push(new);Ok(id)
 }
 pub(crate) fn declare_function_name(&mut self,env:EnvId,name:&str,value:Value)->JsResult<()> {
  let e=self.environments.get_mut(env.0).ok_or_else(||JsError::Unsupported("invalid function-name environment".into()))?;
  e.bindings.insert(name.into(),Binding{value,mutable:false,initialized:true,deletable:false,object_backed:false,strict_immutable:false});Ok(())
 }
}
