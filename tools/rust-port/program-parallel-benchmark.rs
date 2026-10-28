//! Four-process driver uses one independent Runtime per OS process. Only the
//! host wall-clock argument is wrapped; original battle counts and code stay.
#[path="program_host.rs"] mod program_host;
use js_runtime::{Runtime,Value,EnvId,JsResult,JsError};
fn print(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let mut parts=vec![];for &arg in args{let id=rt.to_string(arg)?;parts.push(String::from_utf16_lossy(rt.string_units(id)));}println!("{}",parts.join(" "));Ok(Value::Undefined)}
fn wall_now(rt:&mut Runtime,this:Value,args:&[Value],env:EnvId)->JsResult<Value>{
 let original=rt.lookup(env,"parallelOriginalWallNow")?;
 let Value::Number(ordinal)=rt.lookup(env,"parallelWallCalls")?else{return Err(JsError::Unsupported("invalid wall ordinal".into()))};
 if ordinal!=0.0&&ordinal!=1.0{return Err(JsError::Unsupported("more than two measured wall calls".into()))}
 rt.assign(env,"parallelWallCalls",Value::Number(ordinal+1.0),true)?;
 let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|JsError::Unsupported(format!("wall epoch: {e}")))?.as_nanos();
 let result=rt.call_value(original,this,args)?;
 eprintln!("PARALLEL_WALL_NOW:{}:{}",ordinal as u32,stamp);
 Ok(result)
}
fn execute()->JsResult<()>{
 let mut rt=Runtime::new();let env=rt.global_env;let global=Value::Object(rt.global_object);
 rt.enable_native_battle_gc();program_host::install(&mut rt)?;
 let printer=rt.make_closure_with_flags(print,env,0,"print",true,None);rt.declare(env,"print",printer)?;
 battle_unit_0::run(&mut rt,env,global)?;battle_unit_1::run(&mut rt,env,global)?;battle_unit_2::run(&mut rt,env,global)?;battle_unit_3::run(&mut rt,env,global)?;battle_unit_4::run(&mut rt,env,global)?;battle_unit_5::run(&mut rt,env,global)?;
 let original=rt.lookup(env,"__nativeWallNow")?;let capture=rt.child_env(env);
 rt.declare(capture,"parallelOriginalWallNow",original)?;rt.declare(capture,"parallelWallCalls",Value::Number(0.0))?;
 let wrapper=rt.make_closure_with_flags(wall_now,capture,0,"__nativeWallNow",true,None);rt.assign(env,"__nativeWallNow",wrapper,true)?;
 battle_unit_6::run(&mut rt,env,global)?;
 if rt.lookup(capture,"parallelWallCalls")?!=Value::Number(2.0){return Err(JsError::Unsupported("expected exactly two wall calls".into()))}
 eprintln!("PARALLEL_GC_COLLECTIONS:{}",rt.native_battle_gc_stats().collections);
 Ok(())
}
fn main(){if let Err(error)=execute(){eprintln!("parallel_execution_error:{error:?}");std::process::exit(1);}}
