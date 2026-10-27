//! Bit-level Math.min/Math.max behavior of the pinned Node v24.19.0 reference.
//! JavaScript does not specify NaN payload bits; this target deliberately matches
//! the observed V8 canonical negative quiet NaN, rather than Rust's f64::NAN.
pub const REFERENCE_NAN:f64=f64::from_bits(0xfff8_0000_0000_0000);
#[inline]pub fn max(a:f64,b:f64)->f64{
 if a.is_nan()||b.is_nan(){REFERENCE_NAN}
 else if a==0.0&&b==0.0{if a.is_sign_negative()&&b.is_sign_negative(){-0.0}else{0.0}}
 else if a>b{a}else{b}
}
#[inline]pub fn min(a:f64,b:f64)->f64{
 if a.is_nan()||b.is_nan(){REFERENCE_NAN}
 else if a==0.0&&b==0.0{if a.is_sign_negative()||b.is_sign_negative(){-0.0}else{0.0}}
 else if a<b{a}else{b}
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn canonicalizes_nan_sign_and_payload(){for bits in[0x7ff8_0000_0000_0001,0xfff8_0000_0000_0002,0x7ff0_0000_0000_0001]{let x=f64::from_bits(bits);for v in[max(x,0.0),max(0.0,x),min(x,0.0),min(0.0,x)]{assert_eq!(v.to_bits(),REFERENCE_NAN.to_bits());}}}
 #[test]fn retains_signed_zero_rules(){assert_eq!(max(-0.0,0.0).to_bits(),0.0_f64.to_bits());assert_eq!(max(-0.0,-0.0).to_bits(),(-0.0_f64).to_bits());assert_eq!(min(-0.0,0.0).to_bits(),(-0.0_f64).to_bits());assert_eq!(min(0.0,0.0).to_bits(),0.0_f64.to_bits());}
}
