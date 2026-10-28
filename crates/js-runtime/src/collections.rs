//! Native ordered collections. Tombstoned insertion slots remain stable while
//! iterators and forEach callbacks delete, clear, overwrite and reinsert entries.
//! Weak operations use live stable object handles in this no-GC runtime; this
//! module does not claim weak-reference collection/finalization semantics.
use std::collections::HashMap;
use crate::{Runtime,Value,ObjectId,ObjectKind,JsError,JsResult,EnvId};
use crate::closures::NativeFn;

#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum CollectionKind {Map,Set,WeakMap,WeakSet}
impl CollectionKind {
 pub fn tag(self)->&'static str {match self{Self::Map=>"Map",Self::Set=>"Set",Self::WeakMap=>"WeakMap",Self::WeakSet=>"WeakSet"}}
 fn weak(self)->bool{matches!(self,Self::WeakMap|Self::WeakSet)}
 fn map(self)->bool{matches!(self,Self::Map|Self::WeakMap)}
}
#[derive(Clone,Copy,Debug,Eq,PartialEq,Hash)]
enum Key {Undefined,Null,Bool(bool),Number(u64),String(crate::StringId),Object(ObjectId)}
pub struct CollectionRecord {pub kind:CollectionKind,slots:Vec<Option<(Value,Value)>>,index:HashMap<Key,usize>}
impl CollectionRecord {fn new(kind:CollectionKind)->Self{Self{kind,slots:vec![],index:HashMap::new()}}}
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum CollectionIteration {Keys,Values,Entries}
pub struct CollectionIterator {collection:usize,iteration:CollectionIteration,cursor:usize,done:bool}
impl Runtime {
 fn collection_key(&self,value:Value)->JsResult<Key>{Ok(match value{Value::Undefined=>Key::Undefined,Value::Null=>Key::Null,Value::Bool(v)=>Key::Bool(v),Value::Number(v)=>Key::Number(if v.is_nan(){0x7ff8000000000000}else if v==0.0{0}else{v.to_bits()}),Value::String(v)=>Key::String(v),Value::Object(_)|Value::Function(_)=>Key::Object(self.object_id(value)?)})}
 fn collection_id(&self,this:Value,kind:CollectionKind)->JsResult<usize>{let id=self.object_id(this)?;match self.objects[id.0].kind{ObjectKind::Collection(index)if self.collection_records[index].kind==kind=>Ok(index),_=>Err(JsError::TypeError(format!("{} method called on incompatible receiver",kind.tag())))}}
 fn collection_store(&mut self,id:usize,key:Value,value:Value)->JsResult<Value>{
  if self.collection_records[id].kind.weak()&&!key.is_object(){return Err(JsError::TypeError("invalid weak collection key".into()))}
  let hash=self.collection_key(key)?;let key=if matches!(key,Value::Number(n)if n==0.0){Value::Number(0.0)}else{key};
  let record=&mut self.collection_records[id];let is_map=record.kind.map();
  let value=if is_map{value}else{key};
  match record.index.entry(hash){
   std::collections::hash_map::Entry::Occupied(entry)=>{if is_map{if let Some(slot)=record.slots[*entry.get()].as_mut(){slot.1=value;}}},
   std::collections::hash_map::Entry::Vacant(entry)=>{let index=record.slots.len();record.slots.push(Some((key,value)));entry.insert(index);},
  }
  Ok(key)
 }
 fn collection_find(&self,id:usize,key:Value)->JsResult<Option<(Value,Value)>>{if self.collection_records[id].kind.weak()&&!key.is_object(){return Ok(None)}let hash=self.collection_key(key)?;Ok(self.collection_records[id].index.get(&hash).and_then(|index|self.collection_records[id].slots[*index]))}
 fn collection_remove(&mut self,id:usize,key:Value)->JsResult<bool>{if self.collection_records[id].kind.weak()&&!key.is_object(){return Ok(false)}let hash=self.collection_key(key)?;if let Some(index)=self.collection_records[id].index.remove(&hash){self.collection_records[id].slots[index]=None;Ok(true)}else{Ok(false)}}
 fn collection_proto(&self,name:&str)->JsResult<ObjectId>{self.collection_prototypes.get(name).copied().ok_or_else(||JsError::Unsupported(format!("missing collection intrinsic {name}")))}
 pub fn install_collection_builtins(&mut self)->JsResult<()>{
  if self.collection_prototypes.contains_key("Map"){return Err(JsError::Unsupported("collection intrinsics already installed".into()))}
  for name in ["Map","Set","WeakMap","WeakSet"]{let prototype=self.alloc_object(Some(self.object_prototype));self.collection_prototypes.insert(name,prototype);}
  for (name,kind,constructor)in[("Map",CollectionKind::Map,map_constructor as NativeFn),("Set",CollectionKind::Set,set_constructor as NativeFn),("WeakMap",CollectionKind::WeakMap,weak_map_constructor as NativeFn),("WeakSet",CollectionKind::WeakSet,weak_set_constructor as NativeFn)]{
   let prototype=Value::Object(self.collection_proto(name)?);let constructor=self.builtin(Value::Object(self.global_object),name,0,constructor)?;self.set_function_constructible(constructor,true)?;self.set_constructor_default_prototype(constructor,prototype)?;
   let key=self.string("prototype");self.define_data(constructor,key,prototype,false,false,false)?;let key=self.string("constructor");self.define_data(prototype,key,constructor,true,false,true)?;
   match kind{
    CollectionKind::Map=>{
     for(name,arity,code)in[("get",1,map_get as NativeFn),("set",2,map_set as NativeFn),("has",1,map_has as NativeFn),("delete",1,map_delete as NativeFn),("clear",0,map_clear as NativeFn),("entries",0,map_entries as NativeFn),("forEach",1,map_for_each as NativeFn),("keys",0,map_keys as NativeFn)]{self.builtin(prototype,name,arity,code)?;}
     let getter=self.native_function("get size",0,map_size)?;let key=self.string("size");self.define_accessor(prototype,key,Some(getter),None,false,true)?;self.builtin(prototype,"values",0,map_values)?;
    },
    CollectionKind::Set=>{
     for(name,arity,code)in[("has",1,set_has as NativeFn),("add",1,set_add as NativeFn),("delete",1,set_delete as NativeFn),("difference",1,unsupported_set_operation as NativeFn),("clear",0,set_clear as NativeFn),("entries",0,set_entries as NativeFn),("forEach",1,set_for_each as NativeFn),("intersection",1,unsupported_set_operation as NativeFn),("isSubsetOf",1,unsupported_set_operation as NativeFn),("isSupersetOf",1,unsupported_set_operation as NativeFn),("isDisjointFrom",1,unsupported_set_operation as NativeFn)]{self.builtin(prototype,name,arity,code)?;}
     let getter=self.native_function("get size",0,set_size)?;let key=self.string("size");self.define_accessor(prototype,key,Some(getter),None,false,true)?;
     self.builtin(prototype,"symmetricDifference",1,unsupported_set_operation)?;self.builtin(prototype,"union",1,unsupported_set_operation)?;let values=self.builtin(prototype,"values",0,set_values)?;let key=self.string("keys");self.define_data(prototype,key,values,true,false,true)?;
    },
    CollectionKind::WeakMap=>for(name,arity,code)in[("delete",1,weak_map_delete as NativeFn),("get",1,weak_map_get as NativeFn),("set",2,weak_map_set as NativeFn),("has",1,weak_map_has as NativeFn)]{self.builtin(prototype,name,arity,code)?;},
    CollectionKind::WeakSet=>for(name,arity,code)in[("delete",1,weak_set_delete as NativeFn),("has",1,weak_set_has as NativeFn),("add",1,weak_set_add as NativeFn)]{self.builtin(prototype,name,arity,code)?;},
   }
  }
  let iterator_base=self.alloc_object(Some(self.object_prototype));self.collection_prototypes.insert("@Iterator",iterator_base);
  for(name,next)in[("@MapIterator",map_iterator_next as NativeFn),("@SetIterator",set_iterator_next as NativeFn)]{let prototype=self.alloc_object(Some(iterator_base));self.collection_prototypes.insert(name,prototype);self.builtin(Value::Object(prototype),"next",0,next)?;}
  Ok(())
 }
 pub fn collection_iterator(&mut self,this:Value,kind:CollectionKind,iteration:CollectionIteration)->JsResult<Value>{
  let collection=self.collection_id(this,kind)?;let index=self.collection_iterators.len();self.collection_iterators.push(CollectionIterator{collection,iteration,cursor:0,done:false});
  let prototype=self.collection_proto(if kind==CollectionKind::Map{"@MapIterator"}else{"@SetIterator"})?;let object=self.alloc_object(Some(prototype));self.objects[object.0].kind=ObjectKind::CollectionIterator(index);Ok(Value::Object(object))
 }
 pub fn collection_default_iterator(&mut self,this:Value)->JsResult<Value>{let id=self.object_id(this)?;match self.objects[id.0].kind{ObjectKind::Collection(index)=>match self.collection_records[index].kind{CollectionKind::Map=>self.collection_iterator(this,CollectionKind::Map,CollectionIteration::Entries),CollectionKind::Set=>self.collection_iterator(this,CollectionKind::Set,CollectionIteration::Values),_=>Err(JsError::TypeError("weak collections are not iterable".into()))},_=>Err(JsError::TypeError("collection default iterator has incompatible receiver".into()))}}
 /// Called at the point that prototype lookup reaches the intrinsic iterator
 /// method. An exposed iterator returns itself; Map/Set default methods brand
 /// check even when a foreign object has inherited their prototypes.
 pub fn collection_iterator_from_prototype(&mut self,this:Value,prototype:ObjectId)->JsResult<Option<Value>>{
  if self.collection_prototypes.get("Map")==Some(&prototype){return self.collection_iterator(this,CollectionKind::Map,CollectionIteration::Entries).map(Some)}
  if self.collection_prototypes.get("Set")==Some(&prototype){return self.collection_iterator(this,CollectionKind::Set,CollectionIteration::Values).map(Some)}
  if self.collection_is_iterator_prototype(prototype){return Ok(Some(this))}Ok(None)
 }
 pub fn collection_is_iterator_prototype(&self,prototype:ObjectId)->bool{self.collection_prototypes.get("@Iterator")==Some(&prototype)}
 pub fn collection_iterator_next(&mut self,this:Value)->JsResult<Option<Value>>{
  let object=self.object_id(this)?;let ObjectKind::CollectionIterator(id)=self.objects[object.0].kind else{return Err(JsError::TypeError("incompatible collection iterator receiver".into()))};
  if self.collection_iterators[id].done{return Ok(None)}
  let collection=self.collection_iterators[id].collection;
  loop{let index=self.collection_iterators[id].cursor;let Some(entry)=self.collection_records[collection].slots.get(index).copied()else{self.collection_iterators[id].done=true;return Ok(None)};self.collection_iterators[id].cursor+=1;
   if let Some((key,value))=entry{return Ok(Some(match self.collection_iterators[id].iteration{CollectionIteration::Keys=>key,CollectionIteration::Values=>value,CollectionIteration::Entries=>self.array(&[Some(key),Some(value)])}))}
  }
 }
 pub fn collection_to_string_tag(&self,value:Value)->Option<&'static str>{
  let mut cursor=self.object_id(value).ok();let mut remaining=self.objects.len();
  // Prototype inspection invokes no source hooks. Bound the traversal by the
  // heap size to reject cycles without allocating on every Object#toString.
  let tags=[("Map","Map"),("Set","Set"),("WeakMap","WeakMap"),("WeakSet","WeakSet"),("@MapIterator","Map Iterator"),("@SetIterator","Set Iterator")].map(|(name,tag)|(self.collection_prototypes.get(name).copied(),tag));
  while let Some(id)=cursor{if remaining==0{return None}remaining-=1;for(prototype,tag)in tags{if prototype==Some(id){return Some(tag)}}cursor=self.objects[id.0].prototype;}None
 }
}
fn argument(args:&[Value],index:usize)->Value{args.get(index).copied().unwrap_or(Value::Undefined)}
fn constructor(rt:&mut Runtime,this:Value,args:&[Value],kind:CollectionKind)->JsResult<Value>{
 if !rt.is_construct_call(){return Err(JsError::TypeError(format!("{} constructor requires new",kind.tag())))}
 let object=rt.object_id(this)?;let id=rt.collection_records.len();rt.collection_records.push(CollectionRecord::new(kind));rt.objects[object.0].kind=ObjectKind::Collection(id);
 let input=argument(args,0);if matches!(input,Value::Null|Value::Undefined){return Ok(this)}
 let key=rt.string(if kind.map(){"set"}else{"add"});let adder=rt.get(this,key)?;if !adder.is_callable(){return Err(JsError::TypeError("collection adder is not callable".into()))}
 let mut iterator=rt.iterator(input)?;
 while let Some(entry)=rt.iterator_next(&mut iterator)?{
  let step=(||->JsResult<()>{if kind.map(){if !entry.is_object(){return Err(JsError::TypeError("map iterable entry is not an object".into()))}let zero=rt.string("0");let key=rt.get(entry,zero)?;let one=rt.string("1");let value=rt.get(entry,one)?;rt.call_value(adder,this,&[key,value])?;}else{rt.call_value(adder,this,&[entry])?;}Ok(())})();
  if let Err(error)=step{rt.iterator_close(&mut iterator,Err(error))?;unreachable!("IteratorClose cannot turn an abrupt throw into a normal completion");}
 }
 Ok(this)
}
fn get(rt:&mut Runtime,this:Value,args:&[Value],kind:CollectionKind)->JsResult<Value>{let id=rt.collection_id(this,kind)?;Ok(rt.collection_find(id,argument(args,0))?.map(|entry|entry.1).unwrap_or(Value::Undefined))}
fn store(rt:&mut Runtime,this:Value,args:&[Value],kind:CollectionKind)->JsResult<Value>{let id=rt.collection_id(this,kind)?;let key=argument(args,0);rt.collection_store(id,key,if kind.map(){argument(args,1)}else{key})?;Ok(this)}
fn has(rt:&mut Runtime,this:Value,args:&[Value],kind:CollectionKind)->JsResult<Value>{let id=rt.collection_id(this,kind)?;Ok(Value::Bool(rt.collection_find(id,argument(args,0))?.is_some()))}
fn delete(rt:&mut Runtime,this:Value,args:&[Value],kind:CollectionKind)->JsResult<Value>{let id=rt.collection_id(this,kind)?;Ok(Value::Bool(rt.collection_remove(id,argument(args,0))?))}
fn clear(rt:&mut Runtime,this:Value,kind:CollectionKind)->JsResult<Value>{let id=rt.collection_id(this,kind)?;for entry in &mut rt.collection_records[id].slots{*entry=None}rt.collection_records[id].index.clear();Ok(Value::Undefined)}
fn size(rt:&mut Runtime,this:Value,kind:CollectionKind)->JsResult<Value>{let id=rt.collection_id(this,kind)?;Ok(Value::Number(rt.collection_records[id].index.len()as f64))}
fn for_each(rt:&mut Runtime,this:Value,args:&[Value],kind:CollectionKind)->JsResult<Value>{let id=rt.collection_id(this,kind)?;let callback=argument(args,0);if !callback.is_callable(){return Err(JsError::TypeError("collection forEach callback is not callable".into()))}let receiver=argument(args,1);let mut index=0;while index<rt.collection_records[id].slots.len(){let entry=rt.collection_records[id].slots[index];index+=1;if let Some((key,value))=entry{rt.call_value(callback,receiver,&[value,key,this])?;}}Ok(Value::Undefined)}
macro_rules! methods{($prefix:ident,$kind:expr,$name:ident,$operation:ident)=>{fn $name(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{$operation(rt,this,args,$kind)}};}
macro_rules! ctor{($name:ident,$kind:expr)=>{fn $name(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{constructor(rt,this,args,$kind)}};}
ctor!(map_constructor,CollectionKind::Map);ctor!(set_constructor,CollectionKind::Set);ctor!(weak_map_constructor,CollectionKind::WeakMap);ctor!(weak_set_constructor,CollectionKind::WeakSet);
methods!(map,CollectionKind::Map,map_get,get);methods!(map,CollectionKind::Map,map_set,store);methods!(map,CollectionKind::Map,map_has,has);methods!(map,CollectionKind::Map,map_delete,delete);methods!(map,CollectionKind::Map,map_for_each,for_each);
methods!(set,CollectionKind::Set,set_add,store);methods!(set,CollectionKind::Set,set_has,has);methods!(set,CollectionKind::Set,set_delete,delete);methods!(set,CollectionKind::Set,set_for_each,for_each);
methods!(weakmap,CollectionKind::WeakMap,weak_map_get,get);methods!(weakmap,CollectionKind::WeakMap,weak_map_set,store);methods!(weakmap,CollectionKind::WeakMap,weak_map_has,has);methods!(weakmap,CollectionKind::WeakMap,weak_map_delete,delete);
methods!(weakset,CollectionKind::WeakSet,weak_set_add,store);methods!(weakset,CollectionKind::WeakSet,weak_set_has,has);methods!(weakset,CollectionKind::WeakSet,weak_set_delete,delete);
fn map_clear(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{clear(rt,this,CollectionKind::Map)}fn set_clear(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{clear(rt,this,CollectionKind::Set)}
fn map_size(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{size(rt,this,CollectionKind::Map)}fn set_size(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{size(rt,this,CollectionKind::Set)}
macro_rules! iter{($name:ident,$kind:expr,$iteration:expr)=>{fn $name(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{rt.collection_iterator(this,$kind,$iteration)}};}
iter!(map_keys,CollectionKind::Map,CollectionIteration::Keys);iter!(map_values,CollectionKind::Map,CollectionIteration::Values);iter!(map_entries,CollectionKind::Map,CollectionIteration::Entries);iter!(set_values,CollectionKind::Set,CollectionIteration::Values);iter!(set_entries,CollectionKind::Set,CollectionIteration::Entries);
fn iterator_next(rt:&mut Runtime,this:Value,kind:CollectionKind)->JsResult<Value>{let object=rt.object_id(this)?;let ObjectKind::CollectionIterator(id)=rt.objects[object.0].kind else{return Err(JsError::TypeError("incompatible iterator receiver".into()))};if rt.collection_records[rt.collection_iterators[id].collection].kind!=kind{return Err(JsError::TypeError("incompatible iterator brand".into()))}let value=rt.collection_iterator_next(this)?;let result=rt.object();let key=rt.string("value");rt.define_data(result,key,value.unwrap_or(Value::Undefined),true,true,true)?;let key=rt.string("done");rt.define_data(result,key,Value::Bool(value.is_none()),true,true,true)?;Ok(result)}
fn map_iterator_next(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{iterator_next(rt,this,CollectionKind::Map)}fn set_iterator_next(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{iterator_next(rt,this,CollectionKind::Set)}
fn unsupported_set_operation(_:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Err(JsError::Unsupported("new Set algebra operations are not implemented".into()))}


impl CollectionRecord {pub(crate) fn reachability_slots(&self)->impl Iterator<Item=(Value,Value)>+'_ {self.slots.iter().flatten().copied()}}
impl CollectionIterator {pub(crate) fn reachability_collection(&self)->usize{self.collection}}

impl CollectionRecord{
 pub(crate) fn prune_for_native_gc(&mut self,record_live:bool,objects:&[bool],functions:&[bool]){
  if !record_live{self.slots.clear();self.slots.shrink_to_fit();self.index.clear();self.index.shrink_to_fit();return}
  if !matches!(self.kind,CollectionKind::WeakMap|CollectionKind::WeakSet){return}
  let live=|key:Value|match key{Value::Object(id)=>objects.get(id.0).copied().unwrap_or(false),Value::Function(id)=>functions.get(id.0).copied().unwrap_or(false),_=>false};
  for slot in &mut self.slots{if slot.is_some_and(|(key,_)|!live(key)){*slot=None}}
  self.index.retain(|_,index|self.slots.get(*index).is_some_and(Option::is_some));
 }
}
