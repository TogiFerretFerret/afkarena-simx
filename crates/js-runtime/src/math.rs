//! Pure Rust Math builtins with source-ordered coercion and pinned f64 behavior.
#[path="fdlibm.rs"]
mod fdlibm;
use crate::{Runtime,Value,JsResult,JsError,ObjectKind};
use crate::env::EnvId;
use crate::closures::NativeFn;
use battle_core::js_math;
impl Runtime {
    pub fn install_math_builtins(&mut self)->JsResult<()> {
        let object=self.object();
        let id=self.object_id(object)?;self.objects[id.0].kind=ObjectKind::Math;
        for (name,arity,code) in [
            ("abs",1,math_abs as NativeFn),("atan",1,math_atan as NativeFn),("atan2",2,math_atan2 as NativeFn),("floor",1,math_floor as NativeFn),
            ("ceil",1,math_ceil as NativeFn),("round",1,math_round as NativeFn),
            ("trunc",1,math_trunc as NativeFn),("sqrt",1,math_sqrt as NativeFn),
            ("min",2,math_min as NativeFn),("max",2,math_max as NativeFn),
            ("pow",2,math_pow as NativeFn),("imul",2,math_imul as NativeFn),
            ("clz32",1,math_clz32 as NativeFn),("sign",1,math_sign as NativeFn),
        ] {
            let value=self.native_function(name,arity,code)?;let key=self.string(name);
            self.define_data(object,key,value,true,false,true)?;
        }
        for name in ["acos","acosh","asin","asinh","atanh","cbrt","cos","cosh","exp","expm1","fround","hypot","log","log10","log1p","log2","random","sin","sinh","tan","tanh"] {
            let arity=if name=="random"{0}else if matches!(name,"atan2"|"hypot"){2}else{1};
            let value=self.native_function(name,arity,unsupported_math)?;let key=self.string(name);
            self.define_data(object,key,value,true,false,true)?;
        }
        for (name,number) in [
            ("E",std::f64::consts::E),("LN2",std::f64::consts::LN_2),("LN10",std::f64::consts::LN_10),
            ("LOG2E",std::f64::consts::LOG2_E),("LOG10E",std::f64::consts::LOG10_E),
            ("PI",std::f64::consts::PI),("SQRT1_2",std::f64::consts::FRAC_1_SQRT_2),("SQRT2",std::f64::consts::SQRT_2),
        ] {let key=self.string(name);self.define_data(object,key,Value::Number(number),false,false,false)?;}
        let key=self.string("Math");self.define_data(Value::Object(self.global_object),key,object,true,false,true)?;
        Ok(())
    }
}
fn first(rt:&mut Runtime,args:&[Value])->JsResult<f64>{rt.to_number(args.first().copied().unwrap_or(Value::Undefined))}
fn math_abs(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Number(f64::from_bits(first(rt,args)?.to_bits()&!(1_u64<<63))))}
fn math_floor(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let n=first(rt,args)?;Ok(Value::Number(if n.is_nan(){n}else{n.floor()}))}
fn math_ceil(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let n=first(rt,args)?;Ok(Value::Number(if n.is_nan(){n}else{n.ceil()}))}
fn math_trunc(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let n=first(rt,args)?;Ok(Value::Number(if n.is_nan(){n}else{n.trunc()}))}
fn math_round(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{
    let n=first(rt,args)?;
    let result=if n.is_nan(){f64::from_bits(n.to_bits()|(1_u64<<51))}
        else if !n.is_finite()||n==0.0{n}
        else if n>=-0.5&&n<0.0{-0.0}
        else{let floor=n.floor();if js_math::sub(n,floor)<0.5{floor}else{js_math::add(floor,1.0)}};
    Ok(Value::Number(result))
}
fn math_sqrt(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Number(first(rt,args)?.sqrt()))}
fn math_min(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let mut value=f64::INFINITY;for argument in args{let number=rt.to_number(*argument)?;value=js_math::min(value,number);}Ok(Value::Number(value))}
fn math_max(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let mut value=f64::NEG_INFINITY;for argument in args{let number=rt.to_number(*argument)?;value=js_math::max(value,number);}Ok(Value::Number(value))}
fn math_pow(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let a=first(rt,args)?;let b=rt.to_number(args.get(1).copied().unwrap_or(Value::Undefined))?;Ok(Value::Number(crate::value::number_pow(a,b)?))}
fn math_imul(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let a=rt.to_uint32(args.first().copied().unwrap_or(Value::Undefined))?;let b=rt.to_uint32(args.get(1).copied().unwrap_or(Value::Undefined))?;Ok(Value::Number((a.wrapping_mul(b)as i32)as f64))}
fn math_clz32(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let n=rt.to_uint32(args.first().copied().unwrap_or(Value::Undefined))?;Ok(Value::Number(n.leading_zeros()as f64))}
fn math_sign(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let n=first(rt,args)?;Ok(Value::Number(if n.is_nan()||n==0.0{n}else if n>0.0{1.0}else{-1.0}))}
fn unsupported_math(rt:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{let name=rt.call_stack.last().and_then(|id|rt.functions.get(id.0)).map(|f|f.name.as_str()).unwrap_or("unknown");Err(JsError::Unsupported(format!("Math.{name} requires a pinned pure Rust implementation")))}

fn math_atan(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Number(fdlibm::atan(first(rt,args)?)))}
fn math_atan2(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let y=first(rt,args)?;let x=rt.to_number(args.get(1).copied().unwrap_or(Value::Undefined))?;Ok(Value::Number(fdlibm::atan2(y,x)))}
