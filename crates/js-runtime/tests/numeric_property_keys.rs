use js_runtime::{Runtime,Value,EnvId,JsResult};
#[test]
fn cached_integer_keys_match_uncached_number_conversion_and_collisions(){
 let mut rt=Runtime::new();let mut state=1u32;
 for _ in 0..20000{state=state.wrapping_mul(1664525).wrapping_add(1013904223);let number=(state%u32::MAX)as f64;rt.numeric_property_key_cache_enabled=false;let expected=rt.to_property_key(Value::Number(number)).unwrap();rt.numeric_property_key_cache_enabled=true;for _ in 0..2{assert_eq!(rt.to_property_key(Value::Number(number)).unwrap(),expected);}}
 for number in[-0.0,0.0,256.0,512.0,4294967294.0,4294967295.0,4294967296.0,-1.0,0.5,f64::INFINITY,f64::NEG_INFINITY,f64::NAN,f64::from_bits(0x7ff0000000000042)]{rt.numeric_property_key_cache_enabled=false;let expected=rt.to_property_key(Value::Number(number)).unwrap();rt.numeric_property_key_cache_enabled=true;assert_eq!(rt.to_property_key(Value::Number(number)).unwrap(),expected);}
 for index in[0usize,256,512,usize::MAX]{let key=rt.index_property_key(index);assert_eq!(rt.string_text(key.0),index.to_string());}
 let id=rt.intern_utf16(&[0xd800,0,0xdc00]);assert_eq!(rt.to_property_key(Value::String(id)).unwrap().0,id);
}
fn rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}for round in 0..23{for index in[0usize,1,255,256,512,4294967294]{let key=rt.index_property_key(index);assert_eq!(rt.string_text(key.0),index.to_string());}rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;rt.collect_native_battle_backedge(env,parent)?;}Ok(Value::Number(rt.native_battle_gc_stats().collections as f64))}
#[test]
fn cached_decimal_ids_survive_twenty_three_verified_collections(){let mut rt=Runtime::new();let f=rt.make_closure(rounds,rt.global_env,0,"__nativeRun");rt.set_function_source(f,&include_str!("../src/native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();rt.enable_native_battle_gc();assert_eq!(rt.call(f,Value::Undefined,&[]).unwrap(),Value::Number(23.0));}
