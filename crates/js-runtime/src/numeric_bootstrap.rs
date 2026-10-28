//! Number constructor fields used by the source battle. A missing MAX_VALUE
//! silently changes comparisons, so constants are installed with their exact
//! binary64 values and immutable native descriptors before source execution.
use crate::{Runtime,Value,EnvId,JsResult};
use crate::closures::NativeFn;
fn arg(args:&[Value])->Value{args.first().copied().unwrap_or(Value::Undefined)}
impl Runtime{
 pub fn install_numeric_bootstrap(&mut self)->JsResult<()>{
  let global=Value::Object(self.global_object);let key=self.string("Number");let number=self.get(global,key)?;
  for(name,code)in[("isFinite",is_finite as NativeFn),("isInteger",is_integer as NativeFn),("isNaN",is_nan as NativeFn),("isSafeInteger",is_safe_integer as NativeFn)]{self.builtin(number,name,1,code)?;}
  // Number.parse* are aliases, not fresh wrappers: source identity is observable.
  for name in["parseFloat","parseInt"]{let key=self.string(name);let function=self.get(global,key)?;self.define_data(number,key,function,true,false,true)?;}
  for(name,value)in[
   ("MAX_VALUE",f64::MAX),("MIN_VALUE",f64::from_bits(1)),("NaN",f64::from_bits(0x7ff8000000000000)),
   ("NEGATIVE_INFINITY",f64::NEG_INFINITY),("POSITIVE_INFINITY",f64::INFINITY),
   ("MAX_SAFE_INTEGER",9_007_199_254_740_991.0),("MIN_SAFE_INTEGER",-9_007_199_254_740_991.0),("EPSILON",f64::EPSILON),
  ]{let key=self.string(name);self.define_data(number,key,Value::Number(value),false,false,false)?;}
  Ok(())
 }
}
fn is_finite(_: &mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Bool(matches!(arg(args),Value::Number(n)if n.is_finite())))}
fn is_nan(_: &mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Bool(matches!(arg(args),Value::Number(n)if n.is_nan())))}
fn is_integer(_: &mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Bool(matches!(arg(args),Value::Number(n)if n.is_finite()&&n.trunc()==n)))}
fn is_safe_integer(_: &mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Bool(matches!(arg(args),Value::Number(n)if n.is_finite()&&n.trunc()==n&&n.abs()<=9_007_199_254_740_991.0)))}
