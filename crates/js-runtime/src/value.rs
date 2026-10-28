//! JavaScript value and operator semantics for generated Rust execution.
//! Strings are UTF-16, Numbers remain binary64, and conversions perform source
//! callbacks in specification order. Unsupported operations are hard errors.
use crate::runtime::Runtime;
use battle_core::js_math as arithmetic;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct StringId(pub usize);
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ObjectId(pub usize);
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FunctionId(pub usize);
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(StringId),
    Object(ObjectId),
    Function(FunctionId),
}
impl Value {
    pub fn is_primitive(self) -> bool { !matches!(self, Self::Object(_) | Self::Function(_)) }
    pub fn is_object(self) -> bool { !self.is_primitive() }
    pub fn is_callable(self) -> bool { matches!(self, Self::Function(_)) }
}
#[derive(Clone, Debug, PartialEq)]
pub enum JsError {
    Throw(Value),
    TypeError(String),
    ReferenceError(String),
    RangeError(String),
    SyntaxError(String),
    Unsupported(String),
}
pub type JsResult<T = Value> = Result<T, JsError>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hint { Default, Number, String }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOp { Plus, Minus, Not, BitNot, TypeOf, Void }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinaryOp {
    Add, Sub, Mul, Div, Rem, Pow,
    Shl, Shr, UShr, BitOr, BitXor, BitAnd,
    Eq, Ne, StrictEq, StrictNe, Lt, Le, Gt, Ge, In, InstanceOf,
}
/// V8's Number(undefined) and invalid StringNumericLiteral canonical NaN.
pub const CONVERSION_NAN: f64 = f64::from_bits(0x7ff8_0000_0000_0000);

impl Runtime {
    pub fn truthy(&self, value: Value) -> bool {
        match value {
            Value::Undefined | Value::Null => false,
            Value::Bool(value) => value,
            Value::Number(value) => value != 0.0 && !value.is_nan(),
            Value::String(id) => !self.string_units(id).is_empty(),
            Value::Object(_) | Value::Function(_) => true,
        }
    }
    pub fn to_primitive(&mut self, value: Value, hint: Hint) -> JsResult<Value> {
        if value.is_primitive() { return Ok(value); }
        // Symbol.toPrimitive is not silently ignored: Symbol creation/property
        // keys are outside this runtime's currently supported value domain.
        let date_default=hint==Hint::Default && self.object_id(value).is_ok_and(|id|matches!(self.objects[id.0].kind,crate::heap::ObjectKind::Date(_)));
        let names = if hint == Hint::String || date_default { ["toString", "valueOf"] } else { ["valueOf", "toString"] };
        for name in names {
            let key = self.string(name);
            let method = self.get_property(value, key)?;
            if method.is_callable() {
                let result = self.call_value(method, value, &[])?;
                if result.is_primitive() { return Ok(result); }
            }
        }
        Err(JsError::TypeError("Cannot convert object to primitive value".into()))
    }
    pub fn to_number(&mut self, value: Value) -> JsResult<f64> {
        match value {
            Value::Undefined => Ok(CONVERSION_NAN),
            Value::Null => Ok(0.0),
            Value::Bool(value) => Ok(if value { 1.0 } else { 0.0 }),
            Value::Number(value) => Ok(value),
            Value::String(id) => Ok(string_to_number(self.string_units(id))),
            Value::Object(_) | Value::Function(_) => {
                let primitive = self.to_primitive(value, Hint::Number)?;
                self.to_number(primitive)
            }
        }
    }
    pub fn to_string(&mut self, value: Value) -> JsResult<StringId> {
        let text = match value {
            Value::Undefined => "undefined",
            Value::Null => "null",
            Value::Bool(true) => "true",
            Value::Bool(false) => "false",
            Value::Number(number) => {
                let mut buffer = ryu_js::Buffer::new();
                let text = buffer.format(number);
                return Ok(self.intern_utf16(&text.encode_utf16().collect::<Vec<_>>()));
            }
            Value::String(id) => return Ok(id),
            Value::Object(_) | Value::Function(_) => {
                let primitive = self.to_primitive(value, Hint::String)?;
                return self.to_string(primitive);
            }
        };
        Ok(self.intern_utf16(&text.encode_utf16().collect::<Vec<_>>()))
    }
    pub fn to_string_value(&mut self, value: Value) -> JsResult<StringId> { self.to_string(value) }
    pub fn to_uint32(&mut self, value: Value) -> JsResult<u32> { Ok(number_to_uint32(self.to_number(value)?)) }
    pub fn to_int32(&mut self, value: Value) -> JsResult<i32> { Ok(self.to_uint32(value)? as i32) }
    pub fn strict_eq(&self, left: Value, right: Value) -> bool {
        match (left, right) {
            (Value::Undefined, Value::Undefined) | (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Number(a), Value::Number(b)) => a == b,
            (Value::String(a), Value::String(b)) => self.string_units(a) == self.string_units(b),
            (Value::Object(a), Value::Object(b)) => a == b,
            (Value::Function(a), Value::Function(b)) => a == b,
            (a @ (Value::Function(_) | Value::Object(_)), b @ (Value::Function(_) | Value::Object(_))) => self.same_object(a,b),
            _ => false,
        }
    }
    pub fn same_value(&self, left: Value, right: Value) -> bool {
        match (left, right) {
            (Value::Number(a), Value::Number(b)) => (a.is_nan() && b.is_nan()) || a.to_bits() == b.to_bits(),
            _ => self.strict_eq(left, right),
        }
    }
    pub fn same_value_zero(&self, left: Value, right: Value) -> bool {
        match (left, right) {
            (Value::Number(a), Value::Number(b)) => (a.is_nan() && b.is_nan()) || a == b,
            _ => self.strict_eq(left, right),
        }
    }
    pub fn abstract_eq(&mut self, left: Value, right: Value) -> JsResult<bool> {
        use Value::*;
        match (left, right) {
            (Undefined, Null) | (Null, Undefined) => Ok(true),
            (Number(a), String(b)) => Ok(a == string_to_number(self.string_units(b))),
            (String(a), Number(b)) => Ok(string_to_number(self.string_units(a)) == b),
            (Bool(a), b) => self.abstract_eq(Number(if a { 1.0 } else { 0.0 }), b),
            (a, Bool(b)) => self.abstract_eq(a, Number(if b { 1.0 } else { 0.0 })),
            (a @ (Object(_) | Function(_)), b @ (Number(_) | String(_))) => {
                let a = self.to_primitive(a, Hint::Default)?; self.abstract_eq(a, b)
            }
            (a @ (Number(_) | String(_)), b @ (Object(_) | Function(_))) => {
                let b = self.to_primitive(b, Hint::Default)?; self.abstract_eq(a, b)
            }
            _ => Ok(self.strict_eq(left, right)),
        }
    }
    pub fn unary(&mut self, op: UnaryOp, value: Value) -> JsResult<Value> {
        Ok(match op {
            UnaryOp::Plus => Value::Number(self.to_number(value)?),
            UnaryOp::Minus => Value::Number(f64::from_bits(self.to_number(value)?.to_bits() ^ (1_u64 << 63))),
            UnaryOp::Not => Value::Bool(!self.truthy(value)),
            UnaryOp::BitNot => Value::Number((!self.to_int32(value)?) as f64),
            UnaryOp::Void => Value::Undefined,
            UnaryOp::TypeOf => self.string(match value {
                Value::Undefined => "undefined", Value::Null | Value::Object(_) => "object",
                Value::Bool(_) => "boolean", Value::Number(_) => "number",
                Value::String(_) => "string", Value::Function(_) => "function",
            }),
        })
    }
    pub fn binary(&mut self, op: BinaryOp, left: Value, right: Value) -> JsResult<Value> {
        use BinaryOp::*;
        match op {
            StrictEq => return Ok(Value::Bool(self.strict_eq(left, right))),
            StrictNe => return Ok(Value::Bool(!self.strict_eq(left, right))),
            Eq => return Ok(Value::Bool(self.abstract_eq(left, right)?)),
            Ne => return Ok(Value::Bool(!self.abstract_eq(left, right)?)),
            In => return Ok(Value::Bool(self.has_property(right, left)?)),
            InstanceOf => return Ok(Value::Bool(self.instance_of(left, right)?)),
            Lt | Le | Gt | Ge => {
                // Even > and <= convert the ORIGINAL left object first.
                let a = self.to_primitive(left, Hint::Number)?;
                let b = self.to_primitive(right, Hint::Number)?;
                let comparison = if matches!(op, Gt | Le) { self.less_than_primitives(b, a)? } else { self.less_than_primitives(a, b)? };
                return Ok(Value::Bool(match op { Lt | Gt => comparison == Some(true), _ => comparison == Some(false) }));
            }
            Add => {
                let a = self.to_primitive(left, Hint::Default)?;
                let b = self.to_primitive(right, Hint::Default)?;
                if matches!(a, Value::String(_)) || matches!(b, Value::String(_)) {
                    let a = self.to_string(a)?; let b = self.to_string(b)?;
                    let mut units = self.string_units(a).to_vec(); units.extend_from_slice(self.string_units(b));
                    return Ok(Value::String(self.intern_utf16(&units)));
                }
                let a = self.to_number(a)?; let b = self.to_number(b)?;
                return Ok(Value::Number(arithmetic::add(a, b)));
            }
            _ => {}
        }
        // Conversion order is observable even for commutative/bitwise operators.
        let a = self.to_number(left)?;
        let b = self.to_number(right)?;
        let number = match op {
            Sub => arithmetic::sub(a, b), Mul => arithmetic::mul(a, b), Div => arithmetic::div(a, b),
            Rem => number_rem(a, b)?,
            Pow => number_pow(a, b)?,
            Shl => ((number_to_uint32(a) as i32).wrapping_shl(number_to_uint32(b) & 31)) as f64,
            Shr => ((number_to_uint32(a) as i32).wrapping_shr(number_to_uint32(b) & 31)) as f64,
            UShr => number_to_uint32(a).wrapping_shr(number_to_uint32(b) & 31) as f64,
            BitOr => ((number_to_uint32(a) as i32) | (number_to_uint32(b) as i32)) as f64,
            BitXor => ((number_to_uint32(a) as i32) ^ (number_to_uint32(b) as i32)) as f64,
            BitAnd => ((number_to_uint32(a) as i32) & (number_to_uint32(b) as i32)) as f64,
            _ => return Err(JsError::Unsupported(format!("unexpected binary operation {op:?}"))),
        };
        Ok(Value::Number(number))
    }
    fn less_than_primitives(&mut self, left: Value, right: Value) -> JsResult<Option<bool>> {
        if let (Value::String(a), Value::String(b)) = (left, right) { return Ok(Some(self.string_units(a) < self.string_units(b))); }
        let a = self.to_number(left)?; let b = self.to_number(right)?;
        Ok(if a.is_nan() || b.is_nan() { None } else { Some(a < b) })
    }
}

pub fn number_to_uint32(number: f64) -> u32 {
    if !number.is_finite() || number == 0.0 { return 0; }
    let mut value = number.trunc() % 4_294_967_296.0;
    if value < 0.0 { value += 4_294_967_296.0; }
    value as u32
}
fn whitespace(unit: u16) -> bool {
    matches!(unit, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
pub fn string_to_number(mut units: &[u16]) -> f64 {
    while units.first().is_some_and(|u| whitespace(*u)) { units = &units[1..]; }
    while units.last().is_some_and(|u| whitespace(*u)) { units = &units[..units.len()-1]; }
    if units.is_empty() { return 0.0; }
    if units.iter().any(|u| *u > 0x7f) { return CONVERSION_NAN; }
    let bytes = units.iter().map(|u| *u as u8).collect::<Vec<_>>();
    let text = std::str::from_utf8(&bytes).expect("ASCII numeric literal");
    match text { "Infinity" | "+Infinity" => return f64::INFINITY, "-Infinity" => return f64::NEG_INFINITY, _ => {} }
    if bytes.len() >= 2 && bytes[0] == b'0' {
        let radix_bits = match bytes[1] { b'x' | b'X' => Some(4), b'o' | b'O' => Some(3), b'b' | b'B' => Some(1), _ => None };
        if let Some(bits) = radix_bits { return radix_integer(&bytes[2..], bits); }
    }
    let mut i = usize::from(matches!(bytes[0], b'+' | b'-'));
    let mut digits = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; digits += 1; }
    if i < bytes.len() && bytes[i] == b'.' { i += 1; while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; digits += 1; } }
    if digits == 0 { return CONVERSION_NAN; }
    if i < bytes.len() && matches!(bytes[i], b'e' | b'E') {
        i += 1; if i < bytes.len() && matches!(bytes[i], b'+' | b'-') { i += 1; }
        let start = i; while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
        if start == i { return CONVERSION_NAN; }
    }
    if i != bytes.len() { return CONVERSION_NAN; }
    text.parse::<f64>().unwrap_or(CONVERSION_NAN)
}
fn radix_integer(digits: &[u8], radix_bits: u32) -> f64 {
    if digits.is_empty() { return CONVERSION_NAN; }
    let mut bits = Vec::with_capacity(digits.len().saturating_mul(radix_bits as usize));
    let mut significant = false;
    for byte in digits {
        let digit = match byte { b'0'..=b'9' => byte-b'0', b'a'..=b'f' => byte-b'a'+10, b'A'..=b'F' => byte-b'A'+10, _ => return CONVERSION_NAN };
        if digit as u32 >= 1_u32 << radix_bits { return CONVERSION_NAN; }
        for shift in (0..radix_bits).rev() { let bit = digit >> shift & 1; if bit != 0 { significant = true; } if significant { bits.push(bit); } }
    }
    if bits.is_empty() { return 0.0; }
    if bits.len() <= 53 { return bits.iter().fold(0_u64, |n, b| n*2+*b as u64) as f64; }
    let mut significand = bits[..53].iter().fold(0_u64, |n, b| n*2+*b as u64);
    if bits[53] != 0 && (bits[54..].iter().any(|b| *b != 0) || significand & 1 != 0) { significand += 1; }
    let mut exponent = bits.len()-1;
    if significand == 1_u64 << 53 { significand >>= 1; exponent += 1; }
    if exponent > 1023 { return f64::INFINITY; }
    f64::from_bits(((exponent as u64 + 1023) << 52) | (significand & ((1_u64 << 52)-1)))
}
/// Pinned V8 Float64Mod uses x87 FPREM, including its NaN operand choice.
/// The tagged-Smi zero-divisor path instead returns V8's positive root NaN.
/// A plain f64 does not retain array/boxing provenance, so reject that ambiguous
/// domain instead of claiming a guessed NaN payload is execution-equivalent.
pub fn number_rem(dividend:f64,divisor:f64)->JsResult<f64>{
    if divisor.to_bits()==0 && dividend.is_finite() && dividend.fract()==0.0
        && dividend>=i32::MIN as f64 && dividend<=i32::MAX as f64
        && dividend.to_bits()!=(-0.0_f64).to_bits(){
        return Err(JsError::Unsupported("integer remainder with positive-zero divisor requires pinned V8 tagged-number provenance".into()));
    }
    let mut result=0.0_f64;
    // FPREM may need repeated iterations for a large exponent difference. The
    // x87 stack is restored before returning; no JS engine or host fmod is used.
    unsafe {std::arch::asm!(
        "fld qword ptr [{divisor}]",
        "fld qword ptr [{dividend}]",
        "2:",
        "fprem",
        "fnstsw ax",
        "test ax, 0x400",
        "jnz 2b",
        "fstp qword ptr [{result}]",
        "fstp st(0)",
        divisor=in(reg)&divisor,dividend=in(reg)&dividend,result=in(reg)&mut result,
        out("ax") _,options(nostack),
    );}
    Ok(result)
}
/// Pinned Node24.19 V8 src/numbers/ieee754.cc (use_std_math_pow=true).
/// Source and BSD license are retained under tools/native-compiler-vendor/v8-math.
/// Keep the wrapper's special cases: a reciprocal is NOT an equivalent pow(-1).
pub(crate) fn number_pow(mut base:f64,exponent:f64)->JsResult<f64>{
    if exponent.is_nan(){return Ok(CONVERSION_NAN)}
    if exponent.is_infinite()&&(base==1.0||base== -1.0){return Ok(CONVERSION_NAN)}
    if base.is_nan(){base=CONVERSION_NAN;}
    if exponent==2.0{return Ok(arithmetic::mul(base,base))}
    if exponent==0.5 {
        return Ok(if base.is_infinite(){f64::INFINITY}else{arithmetic::add(base,0.0).sqrt()});
    }
    Ok(std_pow(base,exponent))
}
// Never allow a compile-time constant call site to turn this into a different
// reciprocal/polynomial: the pinned reference deliberately calls platform pow.
#[inline(never)]
fn std_pow(base:f64,exponent:f64)->f64{base.powf(exponent)}
