//! Read-only, non-observing host-boundary heap diagnostics. This is not GC.
//! Callers must supply every Value retained by the host. Generated/native Rust
//! temporaries are not registered roots, so inspection rejects active frames.
use crate::{Runtime,Value,Descriptor,PropertyKind,ObjectKind,BindingRef,JsError,JsResult};
use crate::closures::FunctionKind;
use crate::collections::CollectionKind;
#[derive(Clone,Copy,Debug,Eq,PartialEq)]pub enum WeakEdgePolicy{ConservativeStrong,Ephemeron}
#[derive(Clone,Copy,Debug,Eq,PartialEq)]pub struct ArenaCount{pub total:usize,pub reachable:usize,pub arena_retained_unreachable:usize}
impl ArenaCount{fn of(bits:&[bool])->Self{let reachable=bits.iter().filter(|x|**x).count();Self{total:bits.len(),reachable,arena_retained_unreachable:bits.len()-reachable}}}
#[derive(Clone,Debug)]pub struct ReachabilityReport{
 pub objects:ArenaCount,pub functions:ArenaCount,pub environments:ArenaCount,pub strings:ArenaCount,
 pub buffers:ArenaCount,pub collections:ArenaCount,pub collection_iterators:ArenaCount,pub regex_records:ArenaCount,
 pub buffer_bytes_total:usize,pub buffer_bytes_reachable:usize,pub string_utf16_bytes_total:usize,pub string_utf16_bytes_reachable:usize,
 pub weak_edge_policy:WeakEdgePolicy,pub intern_cache_entries:usize,pub regex_cache_entries:usize,
}
struct Trace<'a>{rt:&'a Runtime,objects:Vec<bool>,functions:Vec<bool>,envs:Vec<bool>,strings:Vec<bool>,buffers:Vec<bool>,collections:Vec<bool>,iterators:Vec<bool>,regex:Vec<bool>,object_functions:Vec<Option<usize>>,collection_owners:Vec<Option<usize>>,pending:Vec<Node>,invalid_edges:usize,ephemerons:Vec<(Value,Value)>}
#[derive(Clone,Copy)]enum Node{Object(usize),Function(usize),Env(usize),Buffer(usize),Collection(usize),Iterator(usize),Regex(usize)}
impl<'a> Trace<'a>{
 fn new(rt:&'a Runtime)->Self{let mut map=vec![None;rt.objects.len()];for(i,f)in rt.functions.iter().enumerate(){if let Some(slot)=map.get_mut(f.object.0){*slot=Some(i)}}let mut collection_owners=vec![None;rt.collection_records.len()];for(i,object)in rt.objects.iter().enumerate(){if let ObjectKind::Collection(record)=object.kind{if let Some(owner)=collection_owners.get_mut(record){*owner=Some(i)}}}Self{rt,objects:vec![false;rt.objects.len()],functions:vec![false;rt.functions.len()],envs:vec![false;rt.environments.len()],strings:vec![false;rt.strings.len()],buffers:vec![false;rt.buffers.len()],collections:vec![false;rt.collection_records.len()],iterators:vec![false;rt.collection_iterators.len()],regex:vec![false;rt.regex_records.len()],object_functions:map,collection_owners,pending:vec![],invalid_edges:0,ephemerons:vec![]}}
 fn mark(&mut self,node:Node){let bits=match node{Node::Object(_)=>&mut self.objects,Node::Function(_)=>&mut self.functions,Node::Env(_)=>&mut self.envs,Node::Buffer(_)=>&mut self.buffers,Node::Collection(_)=>&mut self.collections,Node::Iterator(_)=>&mut self.iterators,Node::Regex(_)=>&mut self.regex};let i=match node{Node::Object(i)|Node::Function(i)|Node::Env(i)|Node::Buffer(i)|Node::Collection(i)|Node::Iterator(i)|Node::Regex(i)=>i};if let Some(bit)=bits.get_mut(i){if !*bit{*bit=true;self.pending.push(node)}}else{self.invalid_edges+=1}}
 fn value(&mut self,v:Value){match v{Value::Object(id)=>self.mark(Node::Object(id.0)),Value::Function(id)=>self.mark(Node::Function(id.0)),Value::String(id)=>{if let Some(bit)=self.strings.get_mut(id.0){*bit=true}else{self.invalid_edges+=1}},_=>{}}}
 fn descriptor(&mut self,d:Descriptor){match d.kind{PropertyKind::Data{value,..}=>self.value(value),PropertyKind::Accessor{get,set}=>{if let Some(v)=get{self.value(v)}if let Some(v)=set{self.value(v)}}}}
 fn binding(&mut self,b:BindingRef){match b{BindingRef::Cell{env,..}=>self.mark(Node::Env(env.0)),BindingRef::Global{object,name}=>{self.mark(Node::Object(object.0));self.value(Value::String(name))},BindingRef::Unresolvable{name}=>self.value(Value::String(name))}}
 fn key_live(&self,key:Value)->bool{match key{Value::Object(id)=>self.objects.get(id.0).copied().unwrap_or(false),Value::Function(id)=>self.functions.get(id.0).copied().unwrap_or(false),_=>false}}
 fn drain(&mut self,policy:WeakEdgePolicy){loop{while let Some(node)=self.pending.pop(){match node{
  Node::Object(i)=>{let object=&self.rt.objects[i];if let Some(f)=self.object_functions[i]{self.mark(Node::Function(f))}if let Some(p)=object.prototype{self.mark(Node::Object(p.0))}for(key,d)in object.properties.iter().flatten(){self.value(Value::String(key.0));self.descriptor(*d)}for(key,d)in object.primary_numeric_properties(){self.value(Value::String(key.0));self.descriptor(d)}for(key,binding)in &object.arguments_map{self.value(Value::String(key.0));self.binding(*binding)}match object.kind{ObjectKind::BoxedString(id)=>self.value(Value::String(id)),ObjectKind::ArrayBuffer{buffer}|ObjectKind::DataView{buffer,..}|ObjectKind::TypedArray{buffer,..}=>self.mark(Node::Buffer(buffer.0)),ObjectKind::Collection(i)=>self.mark(Node::Collection(i)),ObjectKind::CollectionIterator(i)=>self.mark(Node::Iterator(i)),ObjectKind::RegExp(i)=>self.mark(Node::Regex(i)),_=>{}}},
  Node::Function(i)=>{let f=&self.rt.functions[i];self.mark(Node::Object(f.object.0));if let Some(p)=f.prototype{self.mark(Node::Object(p.0))}self.mark(Node::Object(f.constructor_default_prototype.0));self.value(f.lexical_new_target);match &f.kind{FunctionKind::Native{env,arrow_this,..}=>{self.mark(Node::Env(env.0));if let Some(v)=arrow_this{self.value(*v)}},FunctionKind::Bound{target,bound_this,args}=>{self.mark(Node::Function(target.0));self.value(*bound_this);for v in args{self.value(*v)}}}},
  Node::Env(i)=>{let env=&self.rt.environments[i];if let Some(parent)=env.parent{self.mark(Node::Env(parent.0))}for cell in &env.cells{self.value(Value::String(cell.name));if cell.alive&&cell.initialized&&!cell.object_backed{self.value(cell.value)}}},
  Node::Buffer(i)=>self.mark(Node::Object(self.rt.buffers[i].object.0)),
  Node::Collection(i)=>{if let Some(owner)=self.collection_owners[i]{self.mark(Node::Object(owner))}let c=&self.rt.collection_records[i];for(key,value)in c.reachability_slots(){match(c.kind,policy){(CollectionKind::WeakMap,WeakEdgePolicy::Ephemeron)=>self.ephemerons.push((key,value)),(CollectionKind::WeakSet,WeakEdgePolicy::Ephemeron)=>{},_=>{self.value(key);self.value(value)}}}},
  Node::Iterator(i)=>self.mark(Node::Collection(self.rt.collection_iterators[i].reachability_collection())),
  Node::Regex(i)=>self.value(Value::String(self.rt.regex_records[i].source)),
 }}let mut added=false;for i in 0..self.ephemerons.len(){let(key,value)=self.ephemerons[i];if self.key_live(key){let before=self.pending.len();self.value(value);added|=self.pending.len()>before;}}if !added{break}}}
}
impl Runtime{
 /// Strings/regexes retained only by intern/compile caches are reported as
 /// arena-retained, not language roots. No cache entry or object is removed.
 pub fn host_boundary_reachability(&self,explicit_roots:&[Value],weak_edge_policy:WeakEdgePolicy)->JsResult<ReachabilityReport>{self.host_boundary_reachability_with_env_roots(explicit_roots,&[],weak_edge_policy)}
 pub fn host_boundary_reachability_with_env_roots(&self,explicit_roots:&[Value],explicit_env_roots:&[crate::EnvId],weak_edge_policy:WeakEdgePolicy)->JsResult<ReachabilityReport>{
  let t=self.trace_roots(explicit_roots,explicit_env_roots,weak_edge_policy,false)?;
  Ok(ReachabilityReport{objects:ArenaCount::of(&t.objects),functions:ArenaCount::of(&t.functions),environments:ArenaCount::of(&t.envs),strings:ArenaCount::of(&t.strings),buffers:ArenaCount::of(&t.buffers),collections:ArenaCount::of(&t.collections),collection_iterators:ArenaCount::of(&t.iterators),regex_records:ArenaCount::of(&t.regex),buffer_bytes_total:self.buffers.iter().map(|b|b.bytes.len()).sum(),buffer_bytes_reachable:self.buffers.iter().zip(&t.buffers).filter(|(_,live)|**live).map(|(b,_)|b.bytes.len()).sum(),string_utf16_bytes_total:self.strings.iter().map(|s|s.len()*2).sum(),string_utf16_bytes_reachable:self.strings.iter().zip(&t.strings).filter(|(_,live)|**live).map(|(s,_)|s.len()*2).sum(),weak_edge_policy,intern_cache_entries:self.string_index.len(),regex_cache_entries:self.regex_cache.len()})
 }
 fn trace_roots(&self,explicit_roots:&[Value],explicit_env_roots:&[crate::EnvId],weak_edge_policy:WeakEdgePolicy,allow_active:bool)->JsResult<Trace<'_>>{
  if !allow_active&&(!self.call_stack.is_empty()||!self.construct_stack.is_empty()||!self.construct_new_targets.is_empty()||!self.join_stack.is_empty()){return Err(JsError::Unsupported("reachability inspection requires an empty generated/native execution stack".into()))}
  let mut t=Trace::new(self);t.mark(Node::Env(self.global_env.0));for callee in &self.call_stack{t.mark(Node::Function(callee.0))}
  for id in [self.global_object,self.object_prototype,self.function_prototype,self.array_prototype,self.string_prototype,self.number_prototype,self.boolean_prototype,self.regexp_prototype]{t.mark(Node::Object(id.0))}
  t.value(self.function_prototype_value);t.value(self.regexp_constructor);if let Some(value)=self.throw_type_error{t.value(value)}
  for frame in &self.active_argument_frames{let(callee,values,env)=frame.reachability_roots();t.mark(Node::Function(callee.0));for value in values{t.value(value)}if let Some(env)=env{t.mark(Node::Env(env.0))}}
  if let Some(guard)=&self.expose_scan_guard{for value in guard.reachability_roots(){t.value(value)}}
  if let Some(guard)=&self.stage_range_guard{for value in guard.reachability_roots(){t.value(value)}}
  if let Some(plan)=&self.stage_range_plan{for value in plan.reachability_roots(){t.value(value)}}
  if let Some(guard)=&self.copy_obj_guard{for value in guard.reachability_roots(){t.value(value)}}
  for id in self.error_prototypes.values().chain(self.binary_prototypes.values()).chain(self.collection_prototypes.values()){t.mark(Node::Object(id.0))}
  for value in self.binary_constructors.values(){t.value(*value)}
  // Hidden stack overrides are conservatively rooted with their owners.
  for(owner,value)in &self.error_stack_overrides{t.mark(Node::Object(owner.0));t.value(*value)}
  for(_,values)in &self.console_output{for value in values{t.value(*value)}}
  for value in self.diagnostics.reachability_roots(){t.value(value)}
  if let Some(guard)=&self.utf8_loader_guard{for value in guard.reachability_roots(){t.value(value)}}
  for env in explicit_env_roots{t.mark(Node::Env(env.0))}for value in explicit_roots{t.value(*value)}t.drain(weak_edge_policy);
  if t.invalid_edges!=0{return Err(JsError::Unsupported(format!("reachability graph contains {} invalid handles",t.invalid_edges)))}
  Ok(t)
 }
 pub(crate) fn native_battle_gc_marks(&self,env:crate::EnvId,host_roots:&[Value])->JsResult<GcMarks>{let t=self.trace_roots(host_roots,&[env],WeakEdgePolicy::Ephemeron,true)?;Ok(GcMarks{objects:t.objects,functions:t.functions,envs:t.envs,buffers:t.buffers,collections:t.collections,strings:t.strings})}

}

#[cfg(test)]mod tests{
 use super::*;use crate::{EnvId,FunctionId};
 fn never(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{panic!("reachability invoked a source getter")}
 fn noop(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Undefined)}
 fn report(rt:&Runtime,roots:&[Value])->ReachabilityReport{rt.host_boundary_reachability(roots,WeakEdgePolicy::Ephemeron).unwrap()}
 #[test]fn unreachable_cycles_and_live_accessors_are_traced_without_execution(){let mut rt=Runtime::new();let a=rt.object();let b=rt.object();let key=rt.string("cycle");rt.define_data(a,key,b,true,true,true).unwrap();rt.define_data(b,key,a,true,true,true).unwrap();let baseline=report(&rt,&[]);let live=rt.object();let getter=rt.native_function("get observed",0,never).unwrap();let key=rt.string("observed");rt.define_accessor(live,key,Some(getter),None,true,true).unwrap();let roots=report(&rt,&[live]);let unrooted=report(&rt,&[]);assert_eq!(roots.objects.reachable-unrooted.objects.reachable,2);assert_eq!(roots.functions.reachable-unrooted.functions.reachable,1);assert!(roots.objects.arena_retained_unreachable>=2);assert_eq!(baseline.objects.total+2,roots.objects.total);assert_eq!(rt.objects.len(),roots.objects.total);}
 #[test]fn closure_cells_and_bound_arguments_survive_only_with_explicit_host_roots(){let mut rt=Runtime::new();let env=rt.child_block_env(rt.global_env);let captured=rt.object();rt.declare_lexical(env,"captured",true).unwrap();rt.initialize(env,"captured",captured).unwrap();let f=rt.function(noop,env,true);let target=rt.native_function("target",0,noop).unwrap();let this=rt.object();let arg=rt.object();let global=rt.global_env;let key=rt.string("bind");let bind=rt.get(target,key).unwrap();let bound=rt.call(bind,target,&[this,arg]).unwrap();let base=report(&rt,&[]);let rooted=report(&rt,&[f,bound]);assert!(rooted.environments.reachable>base.environments.reachable);assert!(rooted.functions.reachable>=base.functions.reachable+3);assert!(rooted.objects.reachable>=base.objects.reachable+5);assert_eq!(rt.global_env,global);}
 fn collection(rt:&mut Runtime,name:&str)->Value{let global=Value::Object(rt.global_object);let key=rt.string(name);let ctor=rt.get(global,key).unwrap();rt.construct(ctor,&[]).unwrap()}
 fn insert(rt:&mut Runtime,map:Value,key:Value,value:Value){let name=rt.string("set");let set=rt.get(map,name).unwrap();rt.call(set,map,&[key,value]).unwrap();}
 #[test]fn weak_map_ephemeron_fixpoint_does_not_turn_unrooted_cycles_into_roots(){let mut rt=Runtime::new();let first=collection(&mut rt,"WeakMap");let second=collection(&mut rt,"WeakMap");let key=rt.object();let intermediate=rt.object();let value=rt.object();insert(&mut rt,first,key,intermediate);insert(&mut rt,second,intermediate,value);let roots=[first,second];let dead=report(&rt,&roots);let live=report(&rt,&[first,second,key]);assert_eq!(live.objects.reachable-dead.objects.reachable,3);let conservative=rt.host_boundary_reachability(&roots,WeakEdgePolicy::ConservativeStrong).unwrap();assert_eq!(conservative.objects.reachable,live.objects.reachable);let name=rt.string("backedge");rt.define_data(value,name,key,true,true,true).unwrap();assert_eq!(report(&rt,&roots).objects.reachable,dead.objects.reachable);}
 #[test]fn views_retain_shared_backing_buffer_and_iterators_retain_collections(){let mut rt=Runtime::new();let global=Value::Object(rt.global_object);let key=rt.string("Uint8Array");let ctor=rt.get(global,key).unwrap();let bytes=rt.uint8_array_from_bytes(ctor,vec![1,2,3]).unwrap();let map=collection(&mut rt,"Map");let key=rt.object();let value=rt.object();insert(&mut rt,map,key,value);let iterator=rt.collection_iterator(map,CollectionKind::Map,crate::collections::CollectionIteration::Entries).unwrap();let dead=report(&rt,&[]);let live=report(&rt,&[bytes,iterator]);assert_eq!(live.buffer_bytes_reachable-dead.buffer_bytes_reachable,3);assert_eq!(live.collections.reachable-dead.collections.reachable,1);assert_eq!(live.collection_iterators.reachable-dead.collection_iterators.reachable,1);assert_eq!(live.objects.reachable,dead.objects.reachable+6); /* Iterators retain the owning Map and its collection storage. */}
 #[test]fn cache_only_strings_are_distinguished_and_active_execution_is_rejected(){let mut rt=Runtime::new();let value=rt.string("unique unreachable host temporary");let dead=report(&rt,&[]);let live=report(&rt,&[value]);assert_eq!(live.strings.reachable,dead.strings.reachable+1);assert!(dead.intern_cache_entries>=dead.strings.reachable);rt.call_stack.push(FunctionId(0));assert!(matches!(rt.host_boundary_reachability(&[],WeakEdgePolicy::Ephemeron),Err(JsError::Unsupported(_))));}
 #[test]fn invalid_host_roots_are_rejected_and_explicit_environments_are_supported(){let mut rt=Runtime::new();assert!(matches!(rt.host_boundary_reachability(&[Value::Object(crate::ObjectId(usize::MAX))],WeakEdgePolicy::Ephemeron),Err(JsError::Unsupported(_))));let env=rt.child_block_env(rt.global_env);let value=rt.object();rt.declare_lexical(env,"host_kept",true).unwrap();rt.initialize(env,"host_kept",value).unwrap();let base=report(&rt,&[]);let rooted=rt.host_boundary_reachability_with_env_roots(&[],&[env],WeakEdgePolicy::Ephemeron).unwrap();assert_eq!(rooted.environments.reachable,base.environments.reachable+1);assert_eq!(rooted.objects.reachable,base.objects.reachable+1);}

}

pub(crate) struct GcMarks{pub objects:Vec<bool>,pub functions:Vec<bool>,pub envs:Vec<bool>,pub buffers:Vec<bool>,pub collections:Vec<bool>,pub strings:Vec<bool>}
