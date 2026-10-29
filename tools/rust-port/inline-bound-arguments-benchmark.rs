use js_runtime::{Runtime,Value,EnvId,JsResult};
#[cfg(allocation_probe)]
include!("measured-allocator.rs");
fn last(_: &mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(args.last().copied().unwrap_or(Value::Undefined))}
fn main(){
 for &(pre,extra) in &[(0,1),(1,1),(4,4),(8,0),(8,1)]{
  let mut rt=Runtime::new();let f=rt.native_function("last",0,last).unwrap();
  let args=(0..pre).map(|i|Value::Number(f64::from_bits(0x8000000000000000+i as u64))).collect::<Vec<_>>();
  let values=(0..extra).map(|i|Value::Number(f64::from_bits(0x7ff8000000000042+i as u64))).collect::<Vec<_>>();
  let bound=rt.bind_function(f,Value::Null,&args).unwrap();
  let expected=values.last().or(args.last()).copied().unwrap_or(Value::Undefined);
  for _ in 0..100{std::hint::black_box(rt.call_value(bound,Value::Undefined,&values).unwrap());}
  #[cfg(allocation_probe)] allocation_boundary(0);
  let start=std::time::Instant::now();let mut actual=Value::Undefined;
  for _ in 0..200_000{actual=std::hint::black_box(rt.call_value(std::hint::black_box(bound),Value::Undefined,std::hint::black_box(&values)).unwrap());}
  let nanos=start.elapsed().as_nanos();
  #[cfg(allocation_probe)] allocation_boundary(1);
  let (Value::Number(expected),Value::Number(actual))=(expected,actual)else{panic!("numeric result")};assert_eq!(expected.to_bits(),actual.to_bits());
  println!("{pre}\t{extra}\t{nanos}\t{:016x}",actual.to_bits());
 }
}
