//! Stable lexical cells. Captures retain EnvId identities and references retain
//! slot indices; reads and writes never decode names or search a map again.
use std::collections::BTreeMap;
use crate::{Runtime,Value,JsError,JsResult};
use crate::value::{StringId,ObjectId};
#[derive(Clone,Copy,Debug,Eq,PartialEq,Hash)]
pub struct EnvId(pub usize);
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum EnvKind {Global,Function,Block}
#[derive(Clone,Debug)]
pub struct Binding {
 pub(crate) name:StringId,pub(crate) value:Value,pub(crate) mutable:bool,
 pub(crate) initialized:bool,pub(crate) deletable:bool,pub(crate) object_backed:bool,
 pub(crate) strict_immutable:bool,pub(crate) alive:bool,
}
#[derive(Clone,Debug)]
pub struct Environment {
 pub(crate) parent:Option<EnvId>,pub(crate) bindings:BTreeMap<String,usize>,
 pub(crate) cells:Vec<Binding>,pub(crate) kind:EnvKind,
}
impl Environment {
 pub fn new(parent:Option<EnvId>,kind:EnvKind)->Self{Self{parent,bindings:BTreeMap::new(),cells:vec![],kind}}
 fn insert(&mut self,name:&str,binding:Binding){let index=self.cells.len();self.cells.push(binding);self.bindings.insert(name.into(),index);}
}
#[derive(Clone,Copy,Debug,Eq,PartialEq,Hash)]
pub enum BindingRef {
 Cell{env:EnvId,index:usize},Global{object:ObjectId,name:StringId},Unresolvable{name:StringId},
}
impl Runtime {
 pub fn child_env(&mut self,parent:EnvId)->EnvId{let id=EnvId(self.environments.len());self.environments.push(Environment::new(Some(parent),EnvKind::Function));id}
 pub fn child_block_env(&mut self,parent:EnvId)->EnvId{let id=EnvId(self.environments.len());self.environments.push(Environment::new(Some(parent),EnvKind::Block));id}
 pub fn new_env(&mut self,parent:Option<EnvId>)->EnvId{match parent{Some(parent)=>self.child_env(parent),None=>{let id=EnvId(self.environments.len());self.environments.push(Environment::new(None,EnvKind::Function));id}}}
 fn variable_env(&self,mut env:EnvId)->JsResult<EnvId>{loop{let e=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;if e.kind!=EnvKind::Block{return Ok(env)}env=e.parent.ok_or_else(||JsError::Unsupported("block environment has no parent".into()))?;}}
 /// Hoisting creates a cell only if absent; parameter values are not reset.
 pub fn declare(&mut self,env:EnvId,name:&str,value:Value)->JsResult<()>{
  let env=self.variable_env(env)?;if self.environments[env.0].bindings.contains_key(name){return Ok(())}
  let global=self.environments[env.0].kind==EnvKind::Global;let name_id=self.intern(name);
  if global{let object=Value::Object(self.global_object);let key=Value::String(name_id);if !self.has_own_property(object,key)?{self.define_data_property(object,key,value,true,true,false)?;}}
  self.environments[env.0].insert(name,Binding{name:name_id,value,mutable:true,initialized:true,deletable:false,object_backed:global,strict_immutable:false,alive:true});Ok(())
 }
 pub fn declare_var(&mut self,env:EnvId,name:&str)->JsResult<()>{self.declare(env,name,Value::Undefined)}
 pub fn declare_lexical(&mut self,env:EnvId,name:&str,mutable:bool)->JsResult<()>{
  let name_id=self.intern(name);let e=self.environments.get_mut(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;
  if e.bindings.contains_key(name){return Err(JsError::Unsupported(format!("duplicate lexical declaration {name}; compiler must reject it")))}
  e.insert(name,Binding{name:name_id,value:Value::Undefined,mutable,initialized:false,deletable:false,object_backed:false,strict_immutable:true,alive:true});Ok(())
 }
 pub fn initialize(&mut self,env:EnvId,name:&str,value:Value)->JsResult<Value>{
  let e=self.environments.get_mut(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;let index=*e.bindings.get(name).ok_or_else(||JsError::ReferenceError(format!("{name} is not defined")))?;let b=&mut e.cells[index];
  if b.initialized{return Err(JsError::TypeError(format!("binding {name} is already initialized")))}b.value=value;b.initialized=true;Ok(value)
 }
 pub fn resolve_binding(&mut self,mut env:EnvId,name:&str)->JsResult<BindingRef>{
  loop{
   let e=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;
   let binding=e.bindings.get(name).map(|index|(*index,e.cells[*index].object_backed,e.cells[*index].name));let parent=e.parent;let kind=e.kind;
   if let Some((index,false,_))=binding{return Ok(BindingRef::Cell{env,index})}
   if let Some((_,true,name_id))=binding{if self.has_property(Value::Object(self.global_object),Value::String(name_id))?{return Ok(BindingRef::Global{object:self.global_object,name:name_id})}}
   if let Some(parent)=parent{env=parent;continue}
   let id=self.intern(name);if kind==EnvKind::Global&&self.has_property(Value::Object(self.global_object),Value::String(id))?{return Ok(BindingRef::Global{object:self.global_object,name:id})}return Ok(BindingRef::Unresolvable{name:id})
  }
 }
 pub fn read_binding(&mut self,reference:BindingRef)->JsResult<Value>{match reference{
  BindingRef::Cell{env,index}=>{
   let b=self.environments.get(env.0).and_then(|e|e.cells.get(index)).ok_or_else(||JsError::Unsupported("invalid lexical cell handle".into()))?;
   if !b.alive{return Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(b.name))))}
   if !b.initialized{return Err(JsError::ReferenceError(format!("Cannot access '{}' before initialization",self.string_text(b.name))))}Ok(b.value)
  },
  BindingRef::Global{object,name}=>self.get_property(Value::Object(object),Value::String(name)),
  BindingRef::Unresolvable{name}=>Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(name)))),
 }}
 pub fn write_binding(&mut self,reference:BindingRef,value:Value,strict:bool)->JsResult<Value>{match reference{
  BindingRef::Cell{env,index}=>{
   let b=self.environments.get_mut(env.0).and_then(|e|e.cells.get_mut(index)).ok_or_else(||JsError::Unsupported("invalid lexical cell handle".into()))?;
   if !b.alive{let name=b.name;return Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(name))))}
   if !b.initialized{let name=b.name;return Err(JsError::ReferenceError(format!("Cannot access '{}' before initialization",self.string_text(name))))}
   if !b.mutable{if strict||b.strict_immutable{return Err(JsError::TypeError("Assignment to constant variable".into()))}return Ok(value)}b.value=value;Ok(value)
  },
  BindingRef::Global{object,name}=>{if strict&&!self.has_property(Value::Object(object),Value::String(name))?{return Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(name))))}self.set_property(Value::Object(object),Value::String(name),value,strict)},
  BindingRef::Unresolvable{name}=>{if strict{return Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(name))))}self.set_property(Value::Object(self.global_object),Value::String(name),value,false)},
 }}
 pub fn lookup(&mut self,env:EnvId,name:&str)->JsResult<Value>{let reference=self.resolve_binding(env,name)?;self.read_binding(reference)}
 pub fn assign(&mut self,env:EnvId,name:&str,value:Value,strict:bool)->JsResult<Value>{let reference=self.resolve_binding(env,name)?;self.write_binding(reference,value,strict)}
 pub fn typeof_name(&mut self,env:EnvId,name:&str)->JsResult<Value>{let reference=self.resolve_binding(env,name)?;if matches!(reference,BindingRef::Unresolvable{..}){return Ok(self.string("undefined"))}let value=self.read_binding(reference)?;Ok(self.string(match value{Value::Undefined=>"undefined",Value::Null|Value::Object(_)=>"object",Value::Bool(_)=>"boolean",Value::Number(_)=>"number",Value::String(_)=>"string",Value::Function(_)=>"function"}))}
 pub fn delete_binding(&mut self,reference:BindingRef,strict:bool)->JsResult<bool>{match reference{
  BindingRef::Unresolvable{..}=>Ok(true),BindingRef::Global{object,name}=>self.delete(Value::Object(object),Value::String(name),strict),
  BindingRef::Cell{env,index}=>{let b=self.environments.get(env.0).and_then(|e|e.cells.get(index)).ok_or_else(||JsError::Unsupported("invalid lexical cell handle".into()))?;if !b.deletable{if strict{return Err(JsError::TypeError(format!("Cannot delete binding {}",self.string_text(b.name))))}return Ok(false)}let name=b.name;let text=self.string_text(name);let e=&mut self.environments[env.0];e.cells[index].alive=false;e.bindings.remove(&text);Ok(true)},
 }}
 pub fn clone_loop_env(&mut self,env:EnvId,names:&[&str])->JsResult<EnvId>{
  let old=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid loop environment".into()))?;let mut new=Environment::new(old.parent,old.kind);
  for name in names{let index=*old.bindings.get(*name).ok_or_else(||JsError::ReferenceError(format!("loop binding {name} is missing")))?;let binding=&old.cells[index];if binding.object_backed{return Err(JsError::Unsupported("global object binding cannot be a loop lexical cell".into()))}new.insert(name,binding.clone());}
  let id=EnvId(self.environments.len());self.environments.push(new);Ok(id)
 }
 pub(crate) fn declare_function_name(&mut self,env:EnvId,name:&str,value:Value)->JsResult<()>{
  let name_id=self.intern(name);let e=self.environments.get_mut(env.0).ok_or_else(||JsError::Unsupported("invalid function-name environment".into()))?;
  e.insert(name,Binding{name:name_id,value,mutable:false,initialized:true,deletable:false,object_backed:false,strict_immutable:false,alive:true});Ok(())
 }
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]fn var_hoisting_does_not_reset_parameters_and_tdz_hides_parent(){
  let mut rt=Runtime::new();let env=rt.child_env(rt.global_env);rt.declare(env,"x",Value::Number(7.0)).unwrap();rt.declare_var(env,"x").unwrap();assert_eq!(rt.lookup(env,"x").unwrap(),Value::Number(7.0));let block=rt.child_block_env(env);rt.declare_lexical(block,"x",true).unwrap();assert!(matches!(rt.lookup(block,"x"),Err(JsError::ReferenceError(_))));rt.initialize(block,"x",Value::Number(9.0)).unwrap();assert_eq!(rt.lookup(block,"x").unwrap(),Value::Number(9.0));assert_eq!(rt.lookup(env,"x").unwrap(),Value::Number(7.0));
 }
 #[test]fn references_resolve_before_rhs_and_loop_cells_are_fresh(){
  let mut rt=Runtime::new();let block=rt.child_block_env(rt.global_env);let reference=rt.resolve_binding(block,"late").unwrap();rt.declare_lexical(block,"late",true).unwrap();rt.initialize(block,"late",Value::Number(3.0)).unwrap();assert!(matches!(rt.write_binding(reference,Value::Number(5.0),true),Err(JsError::ReferenceError(_))));rt.write_binding(reference,Value::Number(5.0),false).unwrap();assert_eq!(rt.lookup(block,"late").unwrap(),Value::Number(3.0));let global=rt.global_env;assert_eq!(rt.lookup(global,"late").unwrap(),Value::Number(5.0));let iteration=rt.clone_loop_env(block,&["late"]).unwrap();rt.assign(iteration,"late",Value::Number(11.0),false).unwrap();assert_eq!(rt.lookup(block,"late").unwrap(),Value::Number(3.0));assert_eq!(rt.lookup(iteration,"late").unwrap(),Value::Number(11.0));
 }
 #[test]fn global_var_properties_remain_live_and_inherited_names_get_own_bindings(){
  let mut rt=Runtime::new();let key=rt.string("inherited");rt.define_data(Value::Object(rt.object_prototype),key,Value::Number(3.0),true,true,true).unwrap();let global=rt.global_env;rt.declare(global,"inherited",Value::Undefined).unwrap();assert_eq!(rt.lookup(global,"inherited").unwrap(),Value::Undefined);rt.declare(global,"live",Value::Number(1.0)).unwrap();let live=rt.string("live");rt.set_property(Value::Object(rt.global_object),live,Value::Number(2.0),false).unwrap();assert_eq!(rt.lookup(global,"live").unwrap(),Value::Number(2.0));
 }
}
