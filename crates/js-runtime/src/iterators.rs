//! Intrinsic Array/Arguments/String iterator execution. The runtime currently
//! rejects Symbol/custom-iterator features elsewhere; it does not substitute a
//! string key for Symbol.iterator. These helpers preserve live element reads,
//! prototype-selected intrinsic behavior and UTF-16 code-point iteration.
use crate::{Runtime,Value,JsError,JsResult,Completion,ObjectKind,StringId};

#[derive(Debug)]
enum IteratorKind { Array{object:Value,index:u64}, String{string:StringId,index:usize}, Object{iterator:Value,next_method:Value} }
#[derive(Debug)]
pub struct IteratorRecord {kind:IteratorKind,done:bool}
impl Runtime {
 pub fn iterator(&mut self,value:Value)->JsResult<IteratorRecord>{
  if let Value::String(string)=value{return Ok(IteratorRecord{kind:IteratorKind::String{string,index:0},done:false})}
  if matches!(value,Value::Undefined|Value::Null|Value::Bool(_)|Value::Number(_)){return Err(JsError::TypeError("value is not iterable".into()))}
  let id=self.object_id(value)?;
  if matches!(self.objects[id.0].kind,ObjectKind::Arguments){return Ok(IteratorRecord{kind:IteratorKind::Array{object:value,index:0},done:false})}
  let mut cursor=Some(id);let mut seen=std::collections::HashSet::new();
  while let Some(object)=cursor{
   if !seen.insert(object){return Err(JsError::Unsupported("cyclic iterator prototype chain".into()))}
   if object==self.array_prototype{return Ok(IteratorRecord{kind:IteratorKind::Array{object:value,index:0},done:false})}
   if object==self.string_prototype{let string=self.to_string_value(value)?;return Ok(IteratorRecord{kind:IteratorKind::String{string,index:0},done:false})}
   if let Some(iterator)=self.collection_iterator_from_prototype(value,object)?{let key=self.string("next");let next_method=self.get_property(iterator,key)?;if !next_method.is_callable(){return Err(JsError::TypeError("iterator next method is not callable".into()))}return Ok(IteratorRecord{kind:IteratorKind::Object{iterator,next_method},done:false})}
   cursor=self.objects[object.0].prototype;
  }
  Err(JsError::TypeError("value is not iterable".into()))
 }
 pub fn iterator_next(&mut self,iterator:&mut IteratorRecord)->JsResult<Option<Value>>{
  if iterator.done{return Ok(None)}
  let result=(||match &mut iterator.kind{
   IteratorKind::Array{object,index}=>{
    let length_key=self.string("length");let length_value=self.get_property(*object,length_key)?;let n=self.to_number(length_value)?;
    let length=if n.is_nan()||n<=0.0{0}else if n>=9_007_199_254_740_991.0{9_007_199_254_740_991}else{n.floor()as u64};
    if *index>=length{return Ok(None)}
    let key=self.string(&index.to_string());*index+=1;self.get_property(*object,key).map(Some)
   },
   IteratorKind::String{string,index}=>{
    let units=self.string_units(*string);let Some(first)=units.get(*index).copied()else{return Ok(None)};
    let pair=if (0xd800..=0xdbff).contains(&first){units.get(*index+1).copied().filter(|unit|(0xdc00..=0xdfff).contains(unit))}else{None};
    let value=match pair{Some(second)=>{*index+=2;self.string_utf16(&[first,second])},None=>{*index+=1;self.string_utf16(&[first])}};
    Ok(Some(value))
   },
   IteratorKind::Object{iterator,next_method}=>{
    let result=self.call_value(*next_method,*iterator,&[])?;self.object_id(result).map_err(|_|JsError::TypeError("iterator result is not an object".into()))?;
    let key=self.string("done");let done=self.get_property(result,key)?;if self.truthy(done){Ok(None)}else{let key=self.string("value");self.get_property(result,key).map(Some)}
   },
  })();
  if !matches!(result,Ok(Some(_))){iterator.done=true;}
  result
 }
 /// Intrinsic iterator prototypes have no return method in the supported domain.
 /// Custom Symbol.iterator/return hooks are not silently omitted: custom Symbols
 /// are an explicitly unsupported runtime feature until their property-key and
 /// callable protocol representation is implemented.
 pub fn iterator_close(&mut self,iterator:&mut IteratorRecord,pending:JsResult<Completion>)->JsResult<Completion>{
  // Unsupported is not a source throw and cannot be swallowed by IteratorClose.
  if matches!(&pending,Err(JsError::Unsupported(_))){return pending}
  iterator.done=true;let IteratorKind::Object{iterator:object,..}=iterator.kind else{return pending};
  let close=(||->JsResult<Option<Value>>{let key=self.string("return");let method=self.get_property(object,key)?;
   if matches!(method,Value::Null|Value::Undefined){return Ok(None)}if !method.is_callable(){return Err(JsError::TypeError("iterator return method is not callable".into()))}
   self.call_value(method,object,&[]).map(Some)
  })();
  if let Err(error @ JsError::Unsupported(_))=close{return Err(error)}
  // GetMethod/Call side effects happen even for a pending throw, but that throw
  // takes precedence over their source errors and over a primitive return value.
  if pending.is_err(){return pending}
  match close{Err(error)=>Err(error),Ok(None)=>pending,Ok(Some(value))if value.is_object()=>pending,Ok(Some(_))=>Err(JsError::TypeError("iterator return result is not an object".into()))}
 }
 pub fn argument_spread(&mut self,value:Value)->JsResult<Vec<Value>>{
  let mut iterator=self.iterator(value)?;let mut values=Vec::new();while let Some(value)=self.iterator_next(&mut iterator)?{values.push(value);}Ok(values)
 }
}
