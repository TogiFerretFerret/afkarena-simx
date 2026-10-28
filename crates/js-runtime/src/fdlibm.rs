//! Rust translations of pinned V8 fdlibm algorithms.
//! Reference: tools/native-compiler-vendor/v8-math/src/base/ieee754.cc.
//! Original Sun/V8 BSD notices are preserved in that directory's LICENSE and
//! source file. Constants and scalar arithmetic order are retained verbatim;
//! explicit arithmetic helpers prevent LLVM NaN/FMA/reassociation changes.
use battle_core::js_math::{add,sub,mul,div};
#[inline]fn neg(x:f64)->f64{f64::from_bits(x.to_bits()^(1_u64<<63))}
#[inline]fn abs(x:f64)->f64{f64::from_bits(x.to_bits()&0x7fff_ffff_ffff_ffff)}
const ATAN_HI:[f64;4]=[
 f64::from_bits(0x3fddac670561bb4f),f64::from_bits(0x3fe921fb54442d18),
 f64::from_bits(0x3fef730bd281f69b),f64::from_bits(0x3ff921fb54442d18),
];
const ATAN_LO:[f64;4]=[
 f64::from_bits(0x3c7a2b7f222f65e2),f64::from_bits(0x3c81a62633145c07),
 f64::from_bits(0x3c7007887af0cbbd),f64::from_bits(0x3c91a62633145c07),
];
const AT:[f64;11]=[
 f64::from_bits(0x3fd555555555550d),f64::from_bits(0xbfc999999998ebc4),
 f64::from_bits(0x3fc24924920083ff),f64::from_bits(0xbfbc71c6fe231671),
 f64::from_bits(0x3fb745cdc54c206e),f64::from_bits(0xbfb3b0f2af749a6d),
 f64::from_bits(0x3fb10d66a0d03d51),f64::from_bits(0xbfadde2d52defd9a),
 f64::from_bits(0x3fa97b4b24760deb),f64::from_bits(0xbfa2b4442c6a6c2f),
 f64::from_bits(0x3f90ad3ae322da11),
];
pub fn atan(mut x:f64)->f64{
 let hx=(x.to_bits()>>32)as i32;let ix=hx&0x7fff_ffff;
 if ix>=0x4410_0000 {
  let low=x.to_bits()as u32;
  if ix>0x7ff0_0000||(ix==0x7ff0_0000&&low!=0){return add(x,x)}
  return if hx>0{add(ATAN_HI[3],ATAN_LO[3])}else{sub(neg(ATAN_HI[3]),ATAN_LO[3])};
 }
 let id;
 if ix<0x3fdc_0000 {
  if ix<0x3e40_0000&&add(1.0e300,x)>1.0{return x}
  id=None;
 }else{
  x=abs(x);
  if ix<0x3ff3_0000 {
   if ix<0x3fe6_0000 {id=Some(0);x=div(sub(mul(2.0,x),1.0),add(2.0,x));}
   else{id=Some(1);x=div(sub(x,1.0),add(x,1.0));}
  }else if ix<0x4003_8000 {id=Some(2);x=div(sub(x,1.5),add(1.0,mul(1.5,x)));}
  else{id=Some(3);x=div(-1.0,x);}
 }
 let z=mul(x,x);let w=mul(z,z);
 let s1=mul(z,add(AT[0],mul(w,add(AT[2],mul(w,add(AT[4],mul(w,add(AT[6],mul(w,add(AT[8],mul(w,AT[10])))))))))));
 let s2=mul(w,add(AT[1],mul(w,add(AT[3],mul(w,add(AT[5],mul(w,add(AT[7],mul(w,AT[9])))))))));
 if let Some(id)=id{let z=sub(ATAN_HI[id],sub(sub(mul(x,add(s1,s2)),ATAN_LO[id]),x));if hx<0{neg(z)}else{z}}
 else{sub(x,mul(x,add(s1,s2)))}
}
pub fn atan2(y:f64,x:f64)->f64{
 let tiny=1.0e-300;let pi4=f64::from_bits(0x3fe921fb54442d18);let pi2=f64::from_bits(0x3ff921fb54442d18);
 let pi=f64::from_bits(0x400921fb54442d18);let pi_lo=f64::from_bits(0x3ca1a62633145c07);
 let hx=(x.to_bits()>>32)as i32;let lx=x.to_bits()as u32;let ix=hx&0x7fff_ffff;
 let hy=(y.to_bits()>>32)as i32;let ly=y.to_bits()as u32;let iy=hy&0x7fff_ffff;
 // The pinned C++ atan2 implementation's x+y selects x's NaN when
 // both operands are NaN. JS arithmetic add's helper selects its RIGHT
 // operand, so its argument order must differ here (directed proof retained).
 if x.is_nan()||y.is_nan(){return add(y,x)}
 if x.to_bits()==1.0_f64.to_bits(){return atan(y)}
 let mut m=((hy>>31)&1)|((hx>>30)&2);
 if (iy as u32|ly)==0{return match m{0|1=>y,2=>add(pi,tiny),_=>sub(neg(pi),tiny)}}
 if (ix as u32|lx)==0{return if hy<0{sub(neg(pi2),tiny)}else{add(pi2,tiny)}}
 if ix==0x7ff0_0000 {
  if iy==0x7ff0_0000{return match m{0=>add(pi4,tiny),1=>sub(neg(pi4),tiny),2=>add(mul(3.0,pi4),tiny),_=>sub(mul(-3.0,pi4),tiny)}}
  return match m{0=>0.0,1=>-0.0,2=>add(pi,tiny),_=>sub(neg(pi),tiny)};
 }
 if iy==0x7ff0_0000{return if hy<0{sub(neg(pi2),tiny)}else{add(pi2,tiny)}}
 let k=(iy-ix)>>20;
 let z=if k>60{m&=1;add(pi2,mul(0.5,pi_lo))}else if hx<0&&k< -60{0.0}else{atan(abs(div(y,x)))};
 match m{0=>z,1=>neg(z),2=>sub(pi,sub(z,pi_lo)),_=>sub(sub(z,pi_lo),pi)}
}
