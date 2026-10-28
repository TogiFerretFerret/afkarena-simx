//! Diagnostic harness only. All game functions execute from generated crates.
#[path="program_host.rs"]mod program_host;
use js_runtime::{Runtime,Value,EnvId,JsResult,JsError};

const STOP:&str="one-battle diagnostic stop; remaining host clock intentionally unconsumed";
fn json(rt:&mut Runtime,value:Value)->JsResult<String>{
 let object=rt.lookup(rt.global_env,"JSON")?;let key=rt.string("stringify");let stringify=rt.get(object,key)?;
 let text=rt.call_value(stringify,object,&[value])?;
 let Value::String(id)=text else{return Err(JsError::Unsupported("diagnostic report serialization returned a non-string".into()))};
 Ok(String::from_utf16_lossy(rt.string_units(id)))
}
fn print(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 let mut parts=Vec::new();for &value in args{let id=rt.to_string(value)?;parts.push(String::from_utf16_lossy(rt.string_units(id)));}
 println!("{}",parts.join(" "));Ok(Value::Undefined)
}
fn one_battle(rt:&mut Runtime,this:Value,args:&[Value],env:EnvId)->JsResult<Value>{
 if args.len()!=6{return Err(JsError::Unsupported("diagnostic expected six __nativeRun arguments".into()))}
 let original=rt.lookup(env,"originalRun")?;let mut args=args.to_vec();args[2]=Value::Number(1.0);args[3]=Value::Number(0.0);
 eprintln!("one_battle_start:objects:{}",rt.objects.len());
 let start=std::time::Instant::now();let report=rt.call_value(original,this,&args)?;
 eprintln!("one_battle_complete:elapsed_ms:{}:objects:{}",start.elapsed().as_secs_f64()*1000.0,rt.objects.len());
 println!("ONE_BATTLE_REPORT:{}",json(rt,report)?);
 // These diagnostics occur after the timer/object markers. Do not finish or
 // shorten the original tape: its unused suffix remains an explicit limitation.
 let clock=rt.lookup(rt.global_env,"__nativeClock")?;let key=rt.string("stats");let stats=rt.get(clock,key)?;
 let clock_stats=rt.call_value(stats,clock,&[])?;let entropy=rt.lookup(rt.global_env,"__nativeEntropyIndex")?;
 let inputs=rt.object();let key=rt.string("random");rt.define_data(inputs,key,entropy,true,true,true)?;
 let key=rt.string("clock");rt.define_data(inputs,key,clock_stats,true,true,true)?;
 println!("ONE_BATTLE_HOST_INPUTS:{}",json(rt,inputs)?);
 Err(JsError::Unsupported(STOP.into()))
}
fn run()->JsResult<()>{
 let mut rt=Runtime::new();let env=rt.global_env;let global=Value::Object(rt.global_object);
 program_host::install(&mut rt)?;let printer=rt.make_closure_with_flags(print,env,0,"print",true,None);rt.declare(env,"print",printer)?;
 eprintln!("unit_start:0");battle_unit_0::run(&mut rt,env,global)?;eprintln!("unit_finished:0");
 eprintln!("unit_start:1");battle_unit_1::run(&mut rt,env,global)?;eprintln!("unit_finished:1");
 eprintln!("unit_start:2");battle_unit_2::run(&mut rt,env,global)?;eprintln!("unit_finished:2");
 eprintln!("unit_start:3");battle_unit_3::run(&mut rt,env,global)?;eprintln!("unit_finished:3");
 eprintln!("unit_start:4");battle_unit_4::run(&mut rt,env,global)?;eprintln!("unit_finished:4");
 eprintln!("unit_start:5");battle_unit_5::run(&mut rt,env,global)?;eprintln!("unit_finished:5");
 let original=rt.lookup(env,"__nativeRun")?;let capture=rt.child_env(env);rt.declare(capture,"originalRun",original)?;
 let wrapper=rt.make_closure_with_flags(one_battle,capture,6,"one_battle_diagnostic",true,None);rt.assign(env,"__nativeRun",wrapper,true)?;
 eprintln!("unit_start:6");battle_unit_6::run(&mut rt,env,global)?;Ok(())
}
fn main(){if let Err(error)=run(){eprintln!("one_battle_error:{error:?}");std::process::exit(1);}}
