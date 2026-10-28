//! Diagnostic wrapper only; calls the existing generated copy function unchanged.
use js_runtime::{Runtime,Value,EnvId,JsResult,JsError,ObjectKind,PropertyKind,PropertyKey,Descriptor,ObjectId};
use std::{cell::RefCell,collections::BTreeMap,time::Instant};

#[derive(Clone)]struct Context{constructor:PropertyKey,properties:Vec<(ObjectId,PropertyKey,Descriptor)>,to_string:Value}
#[derive(Clone,Copy,PartialEq,Eq,PartialOrd,Ord)]struct Shape{category:&'static str,properties:usize,enumerable:usize,configurable:usize,writable:usize,accessors:usize,numbers:usize,finite:usize,flags:u16,guard_changes:u16}
#[derive(Default)]struct Row{calls:u64,inclusive_ns:u128,exclusive_ns:u128}
#[derive(Default)]struct Stats{context:Option<Context>,active:bool,rows:BTreeMap<(Shape,i128,bool),Row>,stack:Vec<u128>,calls:u64,top_calls:u64,top_ns:u128,max_depth:usize}
thread_local!{static STATS:RefCell<Stats>=RefCell::new(Stats::default());}
fn same(a:Descriptor,b:Descriptor)->bool{a.enumerable==b.enumerable&&a.configurable==b.configurable&&match(a.kind,b.kind){(PropertyKind::Data{value:a,writable:aw},PropertyKind::Data{value:b,writable:bw})=>a==b&&aw==bw,(PropertyKind::Accessor{get:a,set:b},PropertyKind::Accessor{get:c,set:d})=>a==c&&b==d,_=>false}}
fn data(rt:&Runtime,object:ObjectId,key:PropertyKey)->JsResult<Value>{match rt.objects[object.0].own(key).map(|d|d.kind){Some(PropertyKind::Data{value,..})=>Ok(value),_=>Err(JsError::Unsupported("copy diagnostic expected an intrinsic data property".into()))}}
pub fn capture(rt:&mut Runtime)->JsResult<()>{
 let constructor=PropertyKey(rt.intern("constructor"));let mut properties=Vec::new();
 let mut save=|rt:&mut Runtime,object:ObjectId,name:&str|->JsResult<Value>{let key=PropertyKey(rt.intern(name));let desc=rt.objects[object.0].own(key).ok_or_else(||JsError::Unsupported("missing diagnostic intrinsic".into()))?;let value=data(rt,object,key)?;eprintln!("COPY_OBJ_GUARD_EXPECTED:{}:{}:{desc:?}",properties.len(),name);properties.push((object,key,desc));Ok(value)};
 let object=save(rt,rt.global_object,"Object")?;let array=save(rt,rt.global_object,"Array")?;
 let object_id=rt.object_id(object)?;let array_id=rt.object_id(array)?;
 save(rt,object_id,"keys")?;save(rt,object_id,"prototype")?;save(rt,array_id,"prototype")?;save(rt,rt.object_prototype,"constructor")?;save(rt,rt.array_prototype,"constructor")?;
 let key=PropertyKey(rt.intern("toString"));let to_string=data(rt,rt.function_prototype,key)?;
 STATS.with(|state|state.borrow_mut().context=Some(Context{constructor,properties,to_string}));Ok(())
}
pub fn install(rt:&mut Runtime,env:EnvId)->JsResult<()>{
 let ed=rt.lookup(env,"ed")?;let key=rt.string("copyObj");let original=rt.get(ed,key)?;
 let to_string=STATS.with(|state|state.borrow().context.as_ref().unwrap().to_string);
 let source=rt.call_value(to_string,original,&[])?;let Value::String(source_id)=source else{return Err(JsError::Unsupported("copy source is not a string".into()))};
 eprintln!("COPY_OBJ_SOURCE:{}",String::from_utf16_lossy(rt.string_units(source_id)));
 let captured=rt.child_env(env);rt.declare(captured,"copyDiagnosticOriginal",original)?;
 let wrapper=rt.make_closure_with_flags(copy,captured,1,"copyObj",true,None);rt.set(ed,key,wrapper,true)?;Ok(())
}
pub fn reset(){STATS.with(|state|{let mut state=state.borrow_mut();state.rows.clear();state.stack.clear();state.calls=0;state.top_calls=0;state.top_ns=0;state.max_depth=0;state.active=true;});}
fn shape(rt:&Runtime,input:Value)->Shape{
 STATS.with(|state|{let state=state.borrow();let context=state.context.as_ref().unwrap();
  let mut guard_changes=0;for(index,&(object,key,expected))in context.properties.iter().enumerate(){if !rt.objects[object.0].own(key).is_some_and(|actual|same(actual,expected)){guard_changes|=1<<index;}}
  if rt.objects[rt.object_prototype.0].prototype.is_some(){guard_changes|=1<<7;}if rt.objects[rt.array_prototype.0].prototype!=Some(rt.object_prototype){guard_changes|=1<<8;}
  let mut result=Shape{category:if matches!(input,Value::Function(_)){"function"}else{"primitive"},properties:0,enumerable:0,configurable:0,writable:0,accessors:0,numbers:0,finite:0,flags:0,guard_changes};
  let Value::Object(id)=input else{return result};let object=&rt.objects[id.0];
  if object.extensible{result.flags|=1;}if object.prototype==Some(rt.object_prototype){result.flags|=2;}if object.prototype==Some(rt.array_prototype){result.flags|=4;}if !object.arguments_map.is_empty(){result.flags|=8;}if object.own(context.constructor).is_some(){result.flags|=16;}if matches!(object.kind,ObjectKind::Array{length_writable:true,..}){result.flags|=32;}
  for(_,desc)in object.iter_properties(){result.properties+=1;if desc.enumerable{result.enumerable+=1;}if desc.configurable{result.configurable+=1;}match desc.kind{PropertyKind::Accessor{..}=>result.accessors+=1,PropertyKind::Data{value,writable}=>{if writable{result.writable+=1;}if let Value::Number(number)=value{result.numbers+=1;if number.is_finite(){result.finite+=1;}}}}}
  result.category=if matches!(object.kind,ObjectKind::Array{length:0,..}){"emptyArray"}else if matches!(object.kind,ObjectKind::Ordinary)&&result.properties==47&&result.finite==47{"flatFinite47"}else if matches!(object.kind,ObjectKind::Ordinary)&&result.properties==result.finite{"flatFiniteOther"}else{"other"};result
 })
}
fn copy(rt:&mut Runtime,this:Value,args:&[Value],env:EnvId)->JsResult<Value>{
 let original=rt.lookup(env,"copyDiagnosticOriginal")?;
 if !STATS.with(|state|state.borrow().active){return rt.call_value(original,this,args)}
 let shape=shape(rt,args.first().copied().unwrap_or(Value::Undefined));
 STATS.with(|state|{let mut state=state.borrow_mut();state.stack.push(0);state.max_depth=state.max_depth.max(state.stack.len());});
 let before=rt.objects.len();let start=Instant::now();let result=rt.call_value(original,this,args);let inclusive=start.elapsed().as_nanos();let delta=rt.objects.len()as i128-before as i128;let threw=result.is_err();
 STATS.with(|state|{let mut state=state.borrow_mut();let nested=state.stack.pop().unwrap();if let Some(parent)=state.stack.last_mut(){*parent+=inclusive;}else{state.top_calls+=1;state.top_ns+=inclusive;}state.calls+=1;let row=state.rows.entry((shape,delta,threw)).or_default();row.calls+=1;row.inclusive_ns+=inclusive;row.exclusive_ns+=inclusive.saturating_sub(nested);});result
}
pub fn finish(){STATS.with(|state|{let mut state=state.borrow_mut();state.active=false;
 eprintln!("COPY_OBJ_SUMMARY:{{\"calls\":{},\"topLevelCalls\":{},\"topLevelInclusiveNs\":\"{}\",\"rows\":{},\"maxDepth\":{}}}",state.calls,state.top_calls,state.top_ns,state.rows.len(),state.max_depth);
 for((shape,delta,threw),row)in &state.rows{eprintln!("COPY_OBJ_ROW:{{\"category\":\"{}\",\"propertyCount\":{},\"enumerable\":{},\"configurable\":{},\"writable\":{},\"accessors\":{},\"numbers\":{},\"finite\":{},\"flags\":{},\"intrinsicChangeMask\":{},\"objectDelta\":{},\"threw\":{},\"calls\":{},\"inclusiveNs\":\"{}\",\"exclusiveNs\":\"{}\"}}",shape.category,shape.properties,shape.enumerable,shape.configurable,shape.writable,shape.accessors,shape.numbers,shape.finite,shape.flags,shape.guard_changes,delta,threw,row.calls,row.inclusive_ns,row.exclusive_ns);}
 });}
