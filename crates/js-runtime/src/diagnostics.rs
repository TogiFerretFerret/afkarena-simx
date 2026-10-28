//! Optional host diagnostics. These records contain raw values only: recording
//! never converts a source key/value, calls JavaScript, or invokes a getter.
use std::collections::VecDeque;
use crate::{Runtime,Value,JsError,JsResult,KeyInput};
use crate::closures::FunctionSource;

#[derive(Clone,Copy,Debug)]
pub(crate) enum GetOutcome{Value(Value),Throw(Value),Error(&'static str)}
#[derive(Clone,Copy,Debug)]
pub(crate) struct GetRecord{receiver:Value,key:KeyInput,outcome:GetOutcome}
pub struct Diagnostics{pub(crate) enabled:bool,recent:VecDeque<GetRecord>}
impl Diagnostics{
 pub fn from_env()->Self{let enabled=std::env::var_os("RUST_PORT_TRACE").is_some_and(|value|value!="0"&&value!="");Self{enabled,recent:if enabled{VecDeque::with_capacity(8)}else{VecDeque::new()}}}
}
impl Runtime{
 pub fn record_get(&mut self,receiver:Value,key:KeyInput,result:&JsResult<Value>){
  if !self.diagnostics.enabled{return}
  let outcome=match result{Ok(value)=>GetOutcome::Value(*value),Err(JsError::Throw(value))=>GetOutcome::Throw(*value),Err(error)=>GetOutcome::Error(match error{JsError::TypeError(_)=>"TypeError",JsError::ReferenceError(_)=>"ReferenceError",JsError::RangeError(_)=>"RangeError",JsError::SyntaxError(_)=>"SyntaxError",JsError::Unsupported(_)=>"Unsupported",_=>"Error"})};
  if self.diagnostics.recent.len()==8{self.diagnostics.recent.pop_front();}self.diagnostics.recent.push_back(GetRecord{receiver,key,outcome});
 }
 fn diagnostic_value(&self,value:Value)->String{match value{
  Value::Number(number)=>format!("Number(0x{:016x}, {number:?})",number.to_bits()),
  Value::String(id)=>{let units=self.strings.get(id.0).map(|s|s.as_ref()).unwrap_or(&[]);let text=String::from_utf16_lossy(&units[..units.len().min(120)]);format!("String#{}({text:?}, units={})",id.0,units.len())},
  Value::Object(id)=>{let kind=self.objects.get(id.0).map(|object|format!("{:?}",object.kind)).unwrap_or_else(||"invalid".into());let function=self.functions.iter().position(|f|f.object==id).map(|index|format!(", function_record=#{index}:{}",self.functions[index].name)).unwrap_or_default();format!("Object#{}({kind}{function})",id.0)},
  Value::Function(id)=>format!("Function#{}({:?})",id.0,self.functions.get(id.0).map(|f|f.name.as_str())),
  other=>format!("{other:?}"),
 }}
 fn diagnostic_key(&self,key:KeyInput)->String{match key{KeyInput::Value(value)=>self.diagnostic_value(value),KeyInput::Prepared(key)=>format!("Prepared({})",self.diagnostic_value(Value::String(key.0)))}}
 /// Called while the source caller's native frame is still on call_stack.
 pub fn report_noncallable(&self,callee:Value){
  if !self.diagnostics.enabled{return}
  eprintln!("rust_port_noncallable:{}",self.diagnostic_value(callee));
  for(index,record)in self.diagnostics.recent.iter().enumerate(){let result=match record.outcome{GetOutcome::Value(value)=>self.diagnostic_value(value),GetOutcome::Throw(value)=>format!("Throw({})",self.diagnostic_value(value)),GetOutcome::Error(kind)=>format!("Error({kind})")};eprintln!("rust_port_recent_get:{index} receiver={} key={} result={result}",self.diagnostic_value(record.receiver),self.diagnostic_key(record.key));}
  for(depth,id)in self.call_stack.iter().rev().take(12).enumerate(){let Some(function)=self.functions.get(id.0)else{continue};let(range,units)=match function.source.as_ref(){
   Some(FunctionSource::Owned(units))=>(format!("owned:{}",units.len()),units.iter().copied().take(180).collect::<Vec<_>>()),
   Some(FunctionSource::StaticUtf16Le{bytes,start,end})=>{let begin=start.saturating_mul(2);let stop=end.min(&(start.saturating_add(180))).saturating_mul(2);let units=bytes.get(begin..stop).unwrap_or(&[]).chunks_exact(2).map(|pair|u16::from_le_bytes([pair[0],pair[1]])).collect();(format!("utf16:{start}..{end}"),units)},
   None=>("native".into(),vec![]),
  };eprintln!("rust_port_source_frame:{depth} function=#{} name={:?} source_range={range} source_prefix={:?}",id.0,function.name,String::from_utf16_lossy(&units));}
 }
}

impl Diagnostics{pub(crate) fn reachability_roots(&self)->Vec<Value>{let mut out=Vec::new();for record in &self.recent{out.push(record.receiver);out.push(match record.key{KeyInput::Value(v)=>v,KeyInput::Prepared(k)=>Value::String(k.0)});if let GetOutcome::Value(v)|GetOutcome::Throw(v)=record.outcome{out.push(v)}}out}}
