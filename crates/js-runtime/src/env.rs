//! Stable lexical cells. Captures retain EnvId identities and references retain
//! slot indices; reads and writes never decode names or search a map again.
use std::collections::HashMap;
use crate::id_hash::IdBuildHasher;
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
 pub(crate) parent:Option<EnvId>,pub(crate) bindings:HashMap<StringId,usize,IdBuildHasher>,
 pub(crate) cells:Vec<Binding>,pub(crate) kind:EnvKind,
}
impl Environment {
 pub fn new(parent:Option<EnvId>,kind:EnvKind)->Self{Self{parent,bindings:HashMap::default(),cells:vec![],kind}}
 pub(crate) fn reset_for_reuse(&mut self,parent:Option<EnvId>,kind:EnvKind){self.parent=parent;self.kind=kind;self.bindings.clear();self.cells.clear();}
 pub(crate) fn reuse_record(&mut self,mut record:Self){self.reset_for_reuse(record.parent,record.kind);self.bindings.extend(record.bindings.drain());self.cells.append(&mut record.cells);}
 fn insert(&mut self,_name:&str,binding:Binding){let index=self.cells.len();let name=binding.name;self.cells.push(binding);self.bindings.insert(name,index);}
}
#[derive(Clone,Copy,Debug,Eq,PartialEq,Hash)]
pub enum BindingRef {
 Cell{env:EnvId,index:usize},Global{object:ObjectId,name:StringId},Unresolvable{name:StringId},
}
impl Runtime {
 pub fn child_env(&mut self,parent:EnvId)->EnvId{self.allocate_environment_record(Environment::new(Some(parent),EnvKind::Function))}
 pub fn child_block_env(&mut self,parent:EnvId)->EnvId{self.allocate_environment_record(Environment::new(Some(parent),EnvKind::Block))}
 pub fn new_env(&mut self,parent:Option<EnvId>)->EnvId{match parent{Some(parent)=>self.child_env(parent),None=>{self.allocate_environment_record(Environment::new(None,EnvKind::Function))}}}
 fn variable_env(&self,mut env:EnvId)->JsResult<EnvId>{loop{let e=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;if e.kind!=EnvKind::Block{return Ok(env)}env=e.parent.ok_or_else(||JsError::Unsupported("block environment has no parent".into()))?;}}
 /// Hoisting creates a cell only if absent; parameter values are not reset.
 pub fn declare(&mut self,env:EnvId,name:&str,value:Value)->JsResult<()>{
  let env=self.variable_env(env)?;let name_id=self.intern(name);if self.environments[env.0].bindings.contains_key(&name_id){return Ok(())}
  let global=self.environments[env.0].kind==EnvKind::Global;
  if global{let object=Value::Object(self.global_object);let key=Value::String(name_id);if !self.has_own_property(object,key)?{self.define_data_property(object,key,value,true,true,false)?;}}
  self.environments[env.0].insert(name,Binding{name:name_id,value,mutable:true,initialized:true,deletable:false,object_backed:global,strict_immutable:false,alive:true});Ok(())
 }
 pub fn declare_var(&mut self,env:EnvId,name:&str)->JsResult<()>{self.declare(env,name,Value::Undefined)}
 pub fn declare_lexical(&mut self,env:EnvId,name:&str,mutable:bool)->JsResult<()>{
  let name_id=self.intern(name);let e=self.environments.get_mut(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;
  if e.bindings.contains_key(&name_id){return Err(JsError::Unsupported(format!("duplicate lexical declaration {name}; compiler must reject it")))}
  e.insert(name,Binding{name:name_id,value:Value::Undefined,mutable,initialized:false,deletable:false,object_backed:false,strict_immutable:true,alive:true});Ok(())
 }
 pub fn initialize(&mut self,env:EnvId,name:&str,value:Value)->JsResult<Value>{
  let name_id=self.intern(name);let e=self.environments.get_mut(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;let index=*e.bindings.get(&name_id).ok_or_else(||JsError::ReferenceError(format!("{name} is not defined")))?;let b=&mut e.cells[index];
  if b.initialized{return Err(JsError::TypeError(format!("binding {name} is already initialized")))}b.value=value;b.initialized=true;Ok(value)
 }
 /// Cache only addresses whose environment lookup cannot change during a call.
 /// This raw walk never calls getters or observes a TDZ value.
 pub fn stable_binding_reference(&self,mut env:EnvId,name:StringId)->JsResult<Option<BindingRef>>{
  loop {let e=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;
   if let Some(&index)=e.bindings.get(&name){let b=&e.cells[index];
    if !b.object_backed{return Ok(if b.alive&&!b.deletable{Some(BindingRef::Cell{env,index})}else{None})}
    return Ok(self.objects[self.global_object.0].own(crate::heap::PropertyKey(name)).filter(|d|!d.configurable).map(|_|BindingRef::Global{object:self.global_object,name}));
   }
   if let Some(parent)=e.parent{env=parent;continue}
   return Ok(if e.kind==EnvKind::Global{self.objects[self.global_object.0].own(crate::heap::PropertyKey(name)).filter(|d|!d.configurable).map(|_|BindingRef::Global{object:self.global_object,name})}else{None})
  }
 }
 pub fn resolve_binding(&mut self,env:EnvId,name:&str)->JsResult<BindingRef>{let name_id=self.intern(name);self.resolve_binding_id(env,name_id)}
 pub fn resolve_binding_id(&mut self,mut env:EnvId,name_id:StringId)->JsResult<BindingRef>{
  loop{
   let e=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;
   let binding=e.bindings.get(&name_id).map(|index|(*index,e.cells[*index].object_backed,e.cells[*index].name));let parent=e.parent;let kind=e.kind;
   if let Some((index,false,_))=binding{return Ok(BindingRef::Cell{env,index})}
   if let Some((_,true,name_id))=binding{if self.has_property(Value::Object(self.global_object),Value::String(name_id))?{return Ok(BindingRef::Global{object:self.global_object,name:name_id})}}
   if let Some(parent)=parent{env=parent;continue}
   if kind==EnvKind::Global&&self.has_property(Value::Object(self.global_object),Value::String(name_id))?{return Ok(BindingRef::Global{object:self.global_object,name:name_id})}return Ok(BindingRef::Unresolvable{name:name_id})
  }
 }
 /// ID entry points preserve all live environment/global descriptor resolution.
 pub fn lookup_id(&mut self,env:EnvId,name:StringId)->JsResult<Value>{let reference=self.resolve_binding_id(env,name)?;self.read_binding(reference)}
 pub fn assign_id(&mut self,env:EnvId,name:StringId,value:Value,strict:bool)->JsResult<Value>{let reference=self.resolve_binding_id(env,name)?;self.write_binding(reference,value,strict)}
 pub fn typeof_name_id(&mut self,env:EnvId,name:StringId)->JsResult<Value>{let reference=self.resolve_binding_id(env,name)?;if matches!(reference,BindingRef::Unresolvable{..}){return Ok(self.string("undefined"))}let value=self.read_binding(reference)?;Ok(self.string(match value{Value::Undefined=>"undefined",Value::Null|Value::Object(_)=>"object",Value::Bool(_)=>"boolean",Value::Number(_)=>"number",Value::String(_)=>"string",Value::Function(_)=>"function"}))}
 pub fn declare_id(&mut self,env:EnvId,name_id:StringId,value:Value)->JsResult<()>{
  let env=self.variable_env(env)?;if self.environments[env.0].bindings.contains_key(&name_id){return Ok(())}let global=self.environments[env.0].kind==EnvKind::Global;
  if global{let object=Value::Object(self.global_object);let key=Value::String(name_id);if !self.has_own_property(object,key)?{self.define_data_property(object,key,value,true,true,false)?;}}
  self.environments[env.0].insert("",Binding{name:name_id,value,mutable:true,initialized:true,deletable:false,object_backed:global,strict_immutable:false,alive:true});Ok(())
 }
 pub fn declare_lexical_id(&mut self,env:EnvId,name_id:StringId,mutable:bool)->JsResult<()>{
  let Some(record)=self.environments.get(env.0)else{return Err(JsError::Unsupported("invalid environment handle".into()))};if record.bindings.contains_key(&name_id){return Err(JsError::Unsupported(format!("duplicate lexical declaration {}; compiler must reject it",self.string_text(name_id))))}
  self.environments[env.0].insert("",Binding{name:name_id,value:Value::Undefined,mutable,initialized:false,deletable:false,object_backed:false,strict_immutable:true,alive:true});Ok(())
 }
 pub fn initialize_id(&mut self,env:EnvId,name_id:StringId,value:Value)->JsResult<Value>{
  let record=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid environment handle".into()))?;let Some(index)=record.bindings.get(&name_id).copied()else{return Err(JsError::ReferenceError(format!("{} is not defined",self.string_text(name_id))))};if record.cells[index].initialized{return Err(JsError::TypeError(format!("binding {} is already initialized",self.string_text(name_id))))}let binding=&mut self.environments[env.0].cells[index];binding.value=value;binding.initialized=true;Ok(value)
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
  BindingRef::Cell{env,index}=>{let b=self.environments.get(env.0).and_then(|e|e.cells.get(index)).ok_or_else(||JsError::Unsupported("invalid lexical cell handle".into()))?;if !b.deletable{if strict{return Err(JsError::TypeError(format!("Cannot delete binding {}",self.string_text(b.name))))}return Ok(false)}let name=b.name;let e=&mut self.environments[env.0];e.cells[index].alive=false;e.bindings.remove(&name);Ok(true)},
 }}
 pub fn clone_loop_env(&mut self,env:EnvId,names:&[&str])->JsResult<EnvId>{
  let name_ids=names.iter().map(|name|self.intern(name)).collect::<Vec<_>>();let old=self.environments.get(env.0).ok_or_else(||JsError::Unsupported("invalid loop environment".into()))?;let mut new=Environment::new(old.parent,old.kind);
  for (name,name_id) in names.iter().zip(name_ids){let index=*old.bindings.get(&name_id).ok_or_else(||JsError::ReferenceError(format!("loop binding {name} is missing")))?;let binding=&old.cells[index];if binding.object_backed{return Err(JsError::Unsupported("global object binding cannot be a loop lexical cell".into()))}new.insert(name,binding.clone());}
  Ok(self.allocate_environment_record(new))
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
