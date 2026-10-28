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
fn gc_noop(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Undefined)}
fn slot_gc_rounds(rt:&mut Runtime,_:Value,_:&[Value],parent:EnvId)->JsResult<Value>{
    let env=rt.child_env(parent);
    for(name,value)in[("battles",23.0),("warmup",0.0),("battleIndex",0.0)]{rt.declare(env,name,Value::Number(value))?;}
    let initial=rt.objects.len();let mut reclaimed_ids=std::collections::HashSet::new();let mut reused=0;
    for round in 0..23 {
        let object=rt.object();let id=rt.object_id(object)?;
        if reclaimed_ids.contains(&id){reused+=1;}
        let x=rt.intern("x");let y=rt.intern("y");
        if round%2==1{rt.define_data(object,y,Value::Number(88.0),true,true,true)?;}
        let bits=if round==0{0x8000000000000000}else{0x7ff0000000000042+round as u64};
        rt.define_data(object,x,Value::Number(f64::from_bits(bits)),true,true,true)?;
        let Value::Number(value)=rt.get_literal_cached(object,&X)?else{panic!("cached value must remain numeric")};assert_eq!(value.to_bits(),bits);
        // Root neither the object nor its cyclic function/prototype records.
        let dead=rt.make_closure(gc_noop,env,0,"dead");reclaimed_ids.insert(rt.object_id(dead)?);reclaimed_ids.insert(id);
        let function=rt.make_closure(legacy,env,1,"reused");
        assert_eq!(rt.call(function,Value::Undefined,&[Value::Number(round as f64)])?,Value::Bool(true));
        rt.assign(env,"battleIndex",Value::Number(round as f64),false)?;
        rt.collect_native_battle_backedge(env,parent)?;
    }
    assert!(reused>0,"object IDs must actually recycle across collection rounds");
    assert!(rt.objects.len()<initial+32,"cached locations must not retain whole receiver objects");
    Ok(Value::Number(rt.native_battle_gc_stats().collections as f64))
}
#[test]
fn twenty_three_collections_recycle_slots_without_caching_values_or_function_aliases(){
    let mut rt=Runtime::new();let function=rt.make_closure(slot_gc_rounds,rt.global_env,0,"__nativeRun");
    rt.set_function_source(function,&include_str!("../src/native_battle_run.js").encode_utf16().collect::<Vec<_>>()).unwrap();
    rt.enable_native_battle_gc();assert_eq!(rt.call(function,Value::Undefined,&[]).unwrap(),Value::Number(23.0));
}
