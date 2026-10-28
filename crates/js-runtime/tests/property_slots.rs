use js_runtime::{Runtime,Value,JsResult,EnvId};
use js_runtime::property_slots::LiteralReadSite;
static X:LiteralReadSite=LiteralReadSite::new("x");
static Y:LiteralReadSite=LiteralReadSite::new("y");
static ARGS:LiteralReadSite=LiteralReadSite::new("arguments");

#[test]
fn sites_and_runtime_interners_remain_independent(){
    for reverse in [false,true]{let mut rt=Runtime::new();if reverse{for i in 0..50{rt.intern(&format!("pre{i}"));}}
        let a=rt.object();let b=rt.object();let x=rt.intern("x");let y=rt.intern("y");
        rt.define_data(a,x,Value::Number(1.0),true,true,true).unwrap();rt.define_data(a,y,Value::Number(2.0),true,true,true).unwrap();
        rt.define_data(b,y,Value::Number(3.0),true,true,true).unwrap();rt.define_data(b,x,Value::Number(4.0),true,true,true).unwrap();
        for _ in 0..10{assert_eq!(rt.get_literal_cached(a,&X).unwrap(),Value::Number(1.0));assert_eq!(rt.get_literal_cached(b,&Y).unwrap(),Value::Number(3.0));assert_eq!(rt.get_literal_cached(b,&X).unwrap(),Value::Number(4.0));assert_eq!(rt.get_literal_cached(a,&Y).unwrap(),Value::Number(2.0));}
    }
}

fn legacy(rt:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{
    let callee=*rt.call_stack.last().unwrap();let id=rt.object_id(Value::Function(callee))?;
    let first=rt.get_literal_cached(Value::Object(id),&ARGS)?;
    let second=rt.get_literal_cached(Value::Object(id),&ARGS)?;
    Ok(Value::Bool(first.is_object()&&second.is_object()&&first!=second))
}
#[test]
fn physical_function_alias_never_caches_legacy_null_slot(){
    let mut rt=Runtime::new();let f=rt.make_closure(legacy,rt.global_env,1,"f");
    for _ in 0..3{assert_eq!(rt.call(f,Value::Undefined,&[Value::Number(9.0)]).unwrap(),Value::Bool(true));}
}

#[test]
fn data_slot_value_is_live_and_delete_reinsert_does_not_reuse_tombstone(){
    let mut rt=Runtime::new();let object=rt.object();let x=rt.intern("x");let y=rt.intern("y");
    rt.define_data(object,x,Value::Number(-0.0),true,true,true).unwrap();rt.get_literal_cached(object,&X).unwrap();
    rt.set(object,x,Value::Number(7.0),true).unwrap();assert_eq!(rt.get_literal_cached(object,&X).unwrap(),Value::Number(7.0));
    rt.delete(object,x,true).unwrap();rt.define_data(object,y,Value::Number(8.0),true,true,true).unwrap();
    assert_eq!(rt.get_literal_cached(object,&X).unwrap(),Value::Undefined);
    rt.define_data(object,x,Value::Number(9.0),true,true,true).unwrap();assert_eq!(rt.get_literal_cached(object,&X).unwrap(),Value::Number(9.0));
}
