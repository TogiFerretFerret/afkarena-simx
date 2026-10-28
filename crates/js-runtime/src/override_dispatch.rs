//! Exact source ed.override wrapper dispatch. No additional JS call frame is
//! introduced; captured bindings and the target execute through normal lookup
//! and call machinery, including getters, reassignment and source exceptions.
use crate::{Runtime,Value,EnvId,JsResult};
impl Runtime{
 pub fn try_native_override_dispatch(&mut self,this:Value,args:&[Value],parent:EnvId)->JsResult<Option<Value>>{
  if args.len()>5{return Ok(None)}
  // Source evaluates the callee reference before the arguments: t(e,this,...).
  let target=self.lookup(parent,"t")?;
  let original=self.lookup(parent,"e")?;
  let mut forwarded=[Value::Undefined;7];forwarded[0]=original;forwarded[1]=this;
  forwarded[2..args.len()+2].copy_from_slice(args);
  self.call_value(target,Value::Undefined,&forwarded[..args.len()+2]).map(Some)
 }
}
