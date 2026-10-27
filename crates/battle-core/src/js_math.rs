//! Bit-level Math.min/Math.max behavior of the pinned Node v24.19.0 reference.
//! JavaScript does not specify NaN payload bits; this target deliberately matches
//! the observed V8 canonical negative quiet NaN, rather than Rust's f64::NAN.
pub const REFERENCE_NAN:f64=f64::from_bits(0xfff8_0000_0000_0000);
// The pinned interpreter's add/multiply builtins select the RIGHT NaN payload,
// whereas subtract/divide select the LEFT. Ordinary LLVM fadd/fmul may commute
// operands even without fast-math, since Rust does not promise NaN payload bits.
// Keep the actual SSE operand order instead of canonicalizing input NaNs. All
// finite, infinity, signed-zero, subnormal and signaling-NaN operations stay in
// hardware, with the reference process's default FP environment.
#[cfg(not(all(target_arch="x86_64",target_os="linux")))]
compile_error!("Pinned JS arithmetic currently supports the Linux x86_64 reference profile only");
/// Check once at an execution boundary; sticky exception status bits are ignored.
/// The reference masks exceptions, uses nearest-even rounding and retains denormals.
#[cfg(all(target_arch="x86_64",target_os="linux"))]
pub fn reference_fp_environment()->bool{let mut control=0_u32;unsafe{
 std::arch::asm!("stmxcsr [{control}]",control=in(reg)&mut control,options(nostack,preserves_flags));
}control&0xffc0==0x1f80}
#[cfg(all(target_arch="x86_64",target_os="linux"))]
#[inline]pub fn add(a:f64,mut b:f64)->f64{unsafe{
 std::arch::asm!("addsd {b}, {a}",b=inout(xmm_reg)b,a=in(xmm_reg)a,options(pure,nomem,nostack));
}b}
#[cfg(all(target_arch="x86_64",target_os="linux"))]
#[inline]pub fn mul(a:f64,mut b:f64)->f64{unsafe{
 std::arch::asm!("mulsd {b}, {a}",b=inout(xmm_reg)b,a=in(xmm_reg)a,options(pure,nomem,nostack));
}b}
#[cfg(all(target_arch="x86_64",target_os="linux"))]
#[inline]pub fn sub(mut a:f64,b:f64)->f64{unsafe{
 std::arch::asm!("subsd {a}, {b}",a=inout(xmm_reg)a,b=in(xmm_reg)b,options(pure,nomem,nostack));
}a}
#[cfg(all(target_arch="x86_64",target_os="linux"))]
#[inline]pub fn div(mut a:f64,b:f64)->f64{unsafe{
 std::arch::asm!("divsd {a}, {b}",a=inout(xmm_reg)a,b=in(xmm_reg)b,options(pure,nomem,nostack));
}a}
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
 #[test]fn host_uses_reference_floating_environment(){assert!(reference_fp_environment());}
 #[test]fn arithmetic_retains_selected_nan_payload_and_quiets_signaling_nan(){let left=f64::from_bits(0x7ff0_1234_5678_9abc);let right=f64::from_bits(0xfff0_abcd_ef01_2345);assert_eq!(add(left,right).to_bits(),0xfff8_abcd_ef01_2345);assert_eq!(mul(left,right).to_bits(),0xfff8_abcd_ef01_2345);assert_eq!(sub(left,right).to_bits(),0x7ff8_1234_5678_9abc);assert_eq!(div(left,right).to_bits(),0x7ff8_1234_5678_9abc);}
 #[test]fn hardware_generated_invalid_nan_and_signed_zero_match_reference(){assert_eq!(mul(0.0,f64::INFINITY).to_bits(),REFERENCE_NAN.to_bits());assert_eq!(sub(f64::INFINITY,f64::INFINITY).to_bits(),REFERENCE_NAN.to_bits());assert_eq!(div(0.0,0.0).to_bits(),REFERENCE_NAN.to_bits());assert_eq!(add(-0.0,0.0).to_bits(),0.0_f64.to_bits());assert_eq!(mul(-0.0,1.0).to_bits(),(-0.0_f64).to_bits());}
 #[test]fn canonicalizes_nan_sign_and_payload(){for bits in[0x7ff8_0000_0000_0001,0xfff8_0000_0000_0002,0x7ff0_0000_0000_0001]{let x=f64::from_bits(bits);for v in[max(x,0.0),max(0.0,x),min(x,0.0),min(0.0,x)]{assert_eq!(v.to_bits(),REFERENCE_NAN.to_bits());}}}
 #[test]fn retains_signed_zero_rules(){assert_eq!(max(-0.0,0.0).to_bits(),0.0_f64.to_bits());assert_eq!(max(-0.0,-0.0).to_bits(),(-0.0_f64).to_bits());assert_eq!(min(-0.0,0.0).to_bits(),(-0.0_f64).to_bits());assert_eq!(min(0.0,0.0).to_bits(),0.0_f64.to_bits());}
}
