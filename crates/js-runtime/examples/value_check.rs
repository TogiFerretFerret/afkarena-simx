//! Raw value/operator differential driver; each input line is independent.
use js_runtime::{Runtime, Value, JsError};
use js_runtime::value::{BinaryOp,UnaryOp};
use std::io::{self,BufRead,Write};
fn decode(rt:&mut Runtime,text:&str)->Value {
    match text.as_bytes()[0] {
        b'u'=>Value::Undefined,b'n'=>Value::Null,b'b'=>Value::Bool(text=="b1"),
        b'd'=>Value::Number(f64::from_bits(u64::from_str_radix(&text[1..],16).unwrap())),
        b's'=>{let units=(1..text.len()).step_by(4).map(|i|u16::from_str_radix(&text[i..i+4],16).unwrap()).collect::<Vec<_>>();Value::String(rt.intern_utf16(&units))},
        _=>panic!("invalid fixture value"),
    }
}
fn encode(rt:&Runtime,value:Value)->String {
    match value {
        Value::Undefined=>"u".into(),Value::Null=>"n".into(),Value::Bool(v)=>format!("b{}",u8::from(v)),
        Value::Number(v)=>format!("d{:016x}",v.to_bits()),
        Value::String(id)=>format!("s{}",rt.string_units(id).iter().map(|u|format!("{u:04x}")).collect::<String>()),
        Value::Object(_)|Value::Function(_)=>panic!("primitive fixture returned object"),
    }
}
fn binary(name:&str)->BinaryOp {match name {
    "Add"=>BinaryOp::Add,"Sub"=>BinaryOp::Sub,"Mul"=>BinaryOp::Mul,"Div"=>BinaryOp::Div,"Rem"=>BinaryOp::Rem,"Pow"=>BinaryOp::Pow,
    "Shl"=>BinaryOp::Shl,"Shr"=>BinaryOp::Shr,"UShr"=>BinaryOp::UShr,"BitOr"=>BinaryOp::BitOr,"BitXor"=>BinaryOp::BitXor,"BitAnd"=>BinaryOp::BitAnd,
    "Eq"=>BinaryOp::Eq,"Ne"=>BinaryOp::Ne,"StrictEq"=>BinaryOp::StrictEq,"StrictNe"=>BinaryOp::StrictNe,"Lt"=>BinaryOp::Lt,"Le"=>BinaryOp::Le,"Gt"=>BinaryOp::Gt,"Ge"=>BinaryOp::Ge,
    _=>panic!("invalid fixture binary operation"),
}}
fn unary(name:&str)->UnaryOp {match name {"Plus"=>UnaryOp::Plus,"Minus"=>UnaryOp::Minus,"Not"=>UnaryOp::Not,"BitNot"=>UnaryOp::BitNot,"TypeOf"=>UnaryOp::TypeOf,"Void"=>UnaryOp::Void,_=>panic!("invalid fixture unary operation")}}
fn main()->io::Result<()> {
    let input=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());let mut rt=Runtime::new();
    for line in input.lock().lines() {
        let line=line?;let mut words=line.split_whitespace();let operation=words.next().unwrap();let name=words.next().unwrap();let a=decode(&mut rt,words.next().unwrap());
        let result=match operation {
            "binary"=>{let b=decode(&mut rt,words.next().unwrap());rt.binary(binary(name),a,b)},
            "unary"=>rt.unary(unary(name),a),
            "convert"=>match name {"number"=>rt.to_number(a).map(Value::Number),"string"=>rt.to_string(a).map(Value::String),"truthy"=>Ok(Value::Bool(rt.truthy(a))),_=>panic!("invalid fixture conversion")},
            _=>panic!("invalid fixture operation"),
        };
        assert!(words.next().is_none());
        let result=match result {Ok(value)=>encode(&rt,value),Err(JsError::Unsupported(reason))=>format!("unsupported:{reason}"),Err(error)=>format!("error:{error:?}")};
        writeln!(out,"{result}")?;
    }
    out.flush()
}
