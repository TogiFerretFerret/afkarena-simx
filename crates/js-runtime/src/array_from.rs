//! Array.from for the runtime's supported intrinsic iterable domain.
use crate::{Runtime,Value,EnvId,JsError,JsResult};
impl Runtime {
 pub fn install_array_from_builtin(&mut self)->JsResult<()>{
  let key=self.string("Array");let array=self.get(Value::Object(self.global_object),key)?;
  self.builtin(array,"from",1,array_from)?;Ok(())
 }
}
fn constructor(rt:&Runtime,value:Value)->bool{if let Value::Function(id)=value{rt.functions[id.0].constructible}else{false}}
fn create(rt:&mut Runtime,receiver:Value,length:Option<usize>)->JsResult<Value>{
 if constructor(rt,receiver){match length{Some(n)=>rt.construct(receiver,&[Value::Number(n as f64)]),None=>rt.construct(receiver,&[])}}
 else{Ok(rt.array(&[]))}
}
fn finish(rt:&mut Runtime,array:Value,length:usize)->JsResult<Value>{let key=rt.string("length");rt.set(array,key,Value::Number(length as f64),true)?;Ok(array)}
fn put(rt:&mut Runtime,array:Value,index:usize,value:Value)->JsResult<()>{let key=rt.string(&index.to_string());rt.define_data(array,key,value,true,true,true)?;Ok(())}
fn array_from(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 let items=args.first().copied().unwrap_or(Value::Undefined);let mapper=args.get(1).copied().unwrap_or(Value::Undefined);let mapped=!matches!(mapper,Value::Undefined);
 if mapped&&!mapper.is_callable(){return Err(JsError::TypeError("Array.from mapper is not callable".into()))}
 let map_this=args.get(2).copied().unwrap_or(Value::Undefined);
 if rt.has_intrinsic_iterator(items)?{
  let result=create(rt,this,None)?;let mut iterator=rt.iterator(items)?;let mut index=0;
  while let Some(value)=rt.iterator_next(&mut iterator)?{
   let step=(||{if index>=1_000_000{return Err(JsError::Unsupported("Array.from iterable exceeds current resource bound".into()))}let value=if mapped{rt.call_value(mapper,map_this,&[value,Value::Number(index as f64)])?}else{value};put(rt,result,index,value)})();
   if let Err(error)=step{let completion=rt.iterator_close(&mut iterator,Err(error));return match completion{Err(error)=>Err(error),Ok(_)=>unreachable!()}}
   index+=1;
  }
  finish(rt,result,index)
 }else{
  let object=rt.to_object(items)?;let key=rt.string("length");let raw=rt.get(object,key)?;let number=rt.to_number(raw)?;let length=if number.is_nan()||number<=0.0{0.0}else{number.floor().min(9_007_199_254_740_991.0)};
  if length>1_000_000.0{return Err(JsError::Unsupported("Array.from array-like exceeds current resource bound".into()))}let length=length as usize;
  let result=create(rt,this,Some(length))?;
  for index in 0..length{let key=rt.string(&index.to_string());let value=rt.get(object,key)?;let value=if mapped{rt.call_value(mapper,map_this,&[value,Value::Number(index as f64)])?}else{value};put(rt,result,index,value)?;}
  finish(rt,result,length)
 }
}
