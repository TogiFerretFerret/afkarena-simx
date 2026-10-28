use js_runtime::{Runtime,Value,EnvId,JsResult,PropertyKind};
fn setter(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 let env=rt.global_env;let Value::Number(count)=rt.lookup(env,"calls")?else{panic!()};
 rt.assign(env,"calls",Value::Number(count+1.0),true)?;
 rt.assign(env,"last",args.first().copied().unwrap_or(Value::Undefined),true)?;
 Ok(Value::Undefined)
}
fn mutate_key(rt:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{
 let target=rt.lookup(rt.global_env,"target")?;
 let callback=rt.lookup(rt.global_env,"setter")?;let key=rt.string("x");
 rt.delete(target,key,true)?;rt.define_accessor(target,key,None,Some(callback),true,true)?;
 Ok(key)
}
fn setup(enabled:bool)->Runtime{let mut rt=Runtime::new();rt.ordinary_set_fast_path_enabled=enabled;let env=rt.global_env;rt.declare(env,"calls",Value::Number(0.0)).unwrap();rt.declare(env,"last",Value::Undefined).unwrap();rt}
#[test]fn own_data_keeps_flags_extensibility_and_every_raw_number_bit(){for enabled in[false,true]{
 let mut rt=setup(enabled);let object=rt.object();let key=rt.string("x");
 rt.define_data(object,key,Value::Number(1.0),true,false,false).unwrap();
 let id=rt.object_id(object).unwrap();rt.objects[id.0].extensible=false;
 for bits in[0,0x8000000000000000,0x7ff0000000000042,0xfff0000000000042,0x7ff8000000000042,u64::MAX]{
  let value=Value::Number(f64::from_bits(bits));rt.set(object,key,value,true).unwrap();
  let Value::Number(actual)=rt.get(object,key).unwrap()else{panic!()};assert_eq!(actual.to_bits(),bits);
  let property=rt.to_property_key(key).unwrap();let d=rt.objects[id.0].own(property).unwrap();
  assert!(!d.enumerable&&!d.configurable);assert!(matches!(d.kind,PropertyKind::Data{writable:true,..}));
 }
}}
#[test]fn own_data_shadows_setters_but_absent_and_readonly_properties_keep_original_rules(){for enabled in[false,true]{
 let mut rt=setup(enabled);let callback=rt.make_closure(setter,rt.global_env,1,"set x");
 let prototype=rt.object();let key=rt.string("x");rt.define_accessor(prototype,key,None,Some(callback),true,true).unwrap();
 let object=rt.object();rt.set_prototype(object,prototype).unwrap();rt.define_data(object,key,Value::Number(1.0),true,true,true).unwrap();
 rt.set(object,key,Value::Number(2.0),true).unwrap();assert_eq!(rt.lookup(rt.global_env,"calls").unwrap(),Value::Number(0.0));
 rt.delete(object,key,true).unwrap();rt.set(object,key,Value::Number(3.0),true).unwrap();assert_eq!(rt.lookup(rt.global_env,"calls").unwrap(),Value::Number(1.0));
 rt.define_data(object,key,Value::Number(4.0),false,true,true).unwrap();assert!(rt.set(object,key,Value::Number(5.0),true).is_err());
 rt.set(object,key,Value::Number(6.0),false).unwrap();assert_eq!(rt.get(object,key).unwrap(),Value::Number(4.0));
}}
#[test]fn key_coercion_can_replace_own_data_with_a_setter_before_the_write(){for enabled in[false,true]{
 let mut rt=setup(enabled);let env=rt.global_env;let target=rt.object();let key=rt.string("x");rt.define_data(target,key,Value::Number(1.0),true,true,true).unwrap();
 let callback=rt.make_closure(setter,env,1,"set x");rt.declare(env,"target",target).unwrap();rt.declare(env,"setter",callback).unwrap();
 let key_object=rt.object();let method=rt.make_closure(mutate_key,env,0,"toString");let name=rt.string("toString");rt.define_data(key_object,name,method,true,true,true).unwrap();
 rt.set(target,key_object,Value::Number(7.0),true).unwrap();assert_eq!(rt.lookup(env,"calls").unwrap(),Value::Number(1.0));assert_eq!(rt.lookup(env,"last").unwrap(),Value::Number(7.0));
}}
#[test]fn arrays_and_mapped_arguments_keep_virtual_and_binding_writes(){for enabled in[false,true]{
 let mut rt=setup(enabled);let array=rt.array(&[Some(Value::Number(1.0)),Some(Value::Number(2.0))]);let length=rt.string("length");rt.set(array,length,Value::Number(1.0),true).unwrap();let one=rt.string("1");assert_eq!(rt.get(array,one).unwrap(),Value::Undefined);
 let env=rt.child_env(rt.global_env);rt.declare(env,"a",Value::Number(1.0)).unwrap();let args=rt.arguments_object(env,&["a"],&[Value::Number(1.0)],false).unwrap();let zero=rt.string("0");rt.set(args,zero,Value::Number(9.0),true).unwrap();assert_eq!(rt.lookup(env,"a").unwrap(),Value::Number(9.0));
}}
