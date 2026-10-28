//! Intrinsic Array/Arguments/String iterator execution. The runtime currently
//! rejects Symbol/custom-iterator features elsewhere; it does not substitute a
//! string key for Symbol.iterator. These helpers preserve live element reads,
//! prototype-selected intrinsic behavior and UTF-16 code-point iteration.
use crate::{Runtime,Value,JsError,JsResult,Completion,ObjectKind,StringId};

#[derive(Debug)]
enum IteratorKind { Array{object:Value,index:u64}, String{string:StringId,index:usize} }
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
  })();
  if !matches!(result,Ok(Some(_))){iterator.done=true;}
  result
 }
 /// Intrinsic iterator prototypes have no return method in the supported domain.
 /// Custom Symbol.iterator/return hooks are not silently omitted: custom Symbols
 /// are an explicitly unsupported runtime feature until their property-key and
 /// callable protocol representation is implemented.
 pub fn iterator_close(&mut self,iterator:&mut IteratorRecord,pending:JsResult<Completion>)->JsResult<Completion>{iterator.done=true;pending}
 pub fn argument_spread(&mut self,value:Value)->JsResult<Vec<Value>>{
  let mut iterator=self.iterator(value)?;let mut values=Vec::new();while let Some(value)=self.iterator_next(&mut iterator)?{values.push(value);}Ok(values)
 }
}
