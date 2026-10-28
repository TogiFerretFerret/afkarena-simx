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

// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
const TWO_OVER_PI:[i32;66]=[
 0xA2F983,0x6E4E44,0x1529FC,0x2757D1,0xF534DD,0xC0DB62,0x95993C,0x439041,
 0xFE5163,0xABDEBB,0xC561B7,0x246E3A,0x424DD2,0xE00649,0x2EEA09,0xD1921C,
 0xFE1DEB,0x1CB129,0xA73EE8,0x8235F5,0x2EBB44,0x84E99C,0x7026B4,0x5F7E41,
 0x3991D6,0x398353,0x39F49C,0x845F8B,0xBDF928,0x3B1FF8,0x97FFDE,0x05980F,
 0xEF2F11,0x8B5A0A,0x6D1F6D,0x367ECF,0x27CB09,0xB74F46,0x3F669E,0x5FEA2D,
 0x7527BA,0xC7EBE5,0xF17B3D,0x0739F7,0x8A5292,0xEA6BFB,0x5FB11F,0x8D5D08,
 0x560330,0x46FC7B,0x6BABF0,0xCFBC20,0x9AF436,0x1DA9E3,0x91615E,0xE61B08,
 0x659985,0x5F14A0,0x68408D,0xFFD880,0x4D7327,0x310606,0x1556CA,0x73A8C9,
 0x60E27B,0xC08C6B,
];
const NPIO2_HW:[i32;32]=[
 0x3FF921FB,0x400921FB,0x4012D97C,0x401921FB,0x401F6A7A,0x4022D97C,
 0x4025FDBB,0x402921FB,0x402C463A,0x402F6A7A,0x4031475C,0x4032D97C,
 0x40346B9C,0x4035FDBB,0x40378FDB,0x403921FB,0x403AB41B,0x403C463A,
 0x403DD85A,0x403F6A7A,0x40407E4C,0x4041475C,0x4042106C,0x4042D97C,
 0x4043A28C,0x40446B9C,0x404534AC,0x4045FDBB,0x4046C6CB,0x40478FDB,
 0x404858EB,0x404921FB,
];
const PIO2:[f64;8]=[
 1.57079625129699707031e+00,7.54978941586159635335e-08,5.39030252995776476554e-15,
 3.28200341580791294123e-22,1.27065575308067607349e-29,1.22933308981111328932e-36,
 2.73370053816464559624e-44,2.16741683877804819444e-51,
];
#[inline]fn low_zero(x:f64)->f64{f64::from_bits(x.to_bits()&0xffff_ffff_0000_0000)}
fn scale(mut x:f64,mut n:i32)->f64{
 while n>1023{x=mul(x,f64::from_bits(2046_u64<<52));n-=1023;}
 while n< -1022{x=mul(x,f64::from_bits(1_u64<<52));n+=1022;}
 mul(x,f64::from_bits(((n+1023)as u64)<<52))
}
/// The only source callers request prec=2. Keep that specialization explicit;
/// precision-0/1/3 paths are not used to approximate the double implementation.
fn kernel_rem_pio2(x:&[f64],e0:i32)->(i32,[f64;2]){
 let jk=4usize;let jp=jk;let jx=x.len()-1;let jv=((e0-3)/24).max(0)as usize;
 let mut q0=e0-24*(jv as i32+1);
 let(mut f,mut fq,mut q)=([0.0;20],[0.0;20],[0.0;20]);let mut iq=[0_i32;20];
 let mut j=jv as i32-jx as i32;
 for item in f.iter_mut().take(jx+jk+1){*item=if j<0{0.0}else{TWO_OVER_PI[j as usize]as f64};j+=1;}
 for i in 0..=jk{let mut fw=0.0;for j in 0..=jx{fw=add(fw,mul(x[j],f[jx+i-j]));}q[i]=fw;}
 let mut jz=jk;let(mut n,mut ih,mut z);
 loop {
  let mut i=0;let mut j=jz;z=q[jz];
  while j>0 {let fw=mul(5.9604644775390625e-8,z)as i32 as f64;iq[i]=sub(z,mul(16_777_216.0,fw))as i32;z=add(q[j-1],fw);i+=1;j-=1;}
  z=scale(z,q0);z=sub(z,mul(8.0,mul(z,0.125).floor()));n=z as i32;z=sub(z,n as f64);ih=0;
  if q0>0{let i=iq[jz-1]>>(24-q0);n+=i;iq[jz-1]-=i<<(24-q0);ih=iq[jz-1]>>(23-q0);}
  else if q0==0{ih=iq[jz-1]>>23;}else if z>=0.5{ih=2;}
  if ih>0 {
   n+=1;let mut carry=0;
   for digit in iq.iter_mut().take(jz){let j=*digit;if carry==0{if j!=0{carry=1;*digit=0x1000000-j;}}else{*digit=0xffffff-j;}}
   if q0==1{iq[jz-1]&=0x7fffff;}else if q0==2{iq[jz-1]&=0x3fffff;}
   if ih==2{z=sub(1.0,z);if carry!=0{z=sub(z,scale(1.0,q0));}}
  }
  if z==0.0 {
   let mut j=0;for i in (jk..jz).rev(){j|=iq[i];}
   if j==0 {
    let mut k=1;while jk>=k&&iq[jk-k]==0{k+=1;}
    for i in jz+1..=jz+k{f[jx+i]=TWO_OVER_PI[jv+i]as f64;let mut fw=0.0;for j in 0..=jx{fw=add(fw,mul(x[j],f[jx+i-j]));}q[i]=fw;}
    jz+=k;continue;
   }
  }
  break;
 }
 if z==0.0 {jz-=1;q0-=24;while iq[jz]==0{jz-=1;q0-=24;}}
 else{z=scale(z,-q0);if z>=16_777_216.0{let fw=mul(5.9604644775390625e-8,z)as i32 as f64;iq[jz]=sub(z,mul(16_777_216.0,fw))as i32;jz+=1;q0+=24;iq[jz]=fw as i32;}else{iq[jz]=z as i32;}}
 let mut fw=scale(1.0,q0);for i in (0..=jz).rev(){q[i]=mul(fw,iq[i]as f64);fw=mul(fw,5.9604644775390625e-8);}
 for i in (0..=jz).rev(){let mut fw=0.0;for k in 0..=jp.min(jz-i){fw=add(fw,mul(PIO2[k],q[i+k]));}fq[jz-i]=fw;}
 let mut fw=0.0;for i in (0..=jz).rev(){fw=add(fw,fq[i]);}let y0=if ih==0{fw}else{neg(fw)};
 fw=sub(fq[0],fw);for item in fq.iter().take(jz+1).skip(1){fw=add(fw,*item);}let y1=if ih==0{fw}else{neg(fw)};
 (n&7,[y0,y1])
}
fn rem_pio2(x:f64)->(i32,[f64;2]){
 const INVPIO2:f64=6.36619772367581382433e-1;
 const P1:f64=1.57079632673412561417;const P1T:f64=6.07710050650619224932e-11;
 const P2:f64=6.07710050630396597660e-11;const P2T:f64=2.02226624879595063154e-21;
 const P3:f64=2.02226624871116645580e-21;const P3T:f64=8.47842766036889956997e-32;
 let hx=(x.to_bits()>>32)as i32;let ix=hx&0x7fffffff;
 if ix<=0x3fe921fb{return(0,[x,0.0])}
 if ix<0x4002d97c {
  if hx>0{let mut z=sub(x,P1);let(y0,y1)=if ix!=0x3ff921fb{let y0=sub(z,P1T);(y0,sub(sub(z,y0),P1T))}else{z=sub(z,P2);let y0=sub(z,P2T);(y0,sub(sub(z,y0),P2T))};return(1,[y0,y1])}
  let mut z=add(x,P1);let(y0,y1)=if ix!=0x3ff921fb{let y0=add(z,P1T);(y0,add(sub(z,y0),P1T))}else{z=add(z,P2);let y0=add(z,P2T);(y0,add(sub(z,y0),P2T))};return(-1,[y0,y1]);
 }
 if ix<=0x413921fb {
  let mut t=abs(x);let n=add(mul(t,INVPIO2),0.5)as i32;let fn_=n as f64;let mut r=sub(t,mul(fn_,P1));let mut w=mul(fn_,P1T);let mut y0=sub(r,w);
  if !(n<32&&ix!=NPIO2_HW[n as usize-1]) {
   let j=ix>>20;let mut i=j-(((y0.to_bits()>>32)as i32>>20)&0x7ff);
   if i>16{t=r;w=mul(fn_,P2);r=sub(t,w);w=sub(mul(fn_,P2T),sub(sub(t,r),w));y0=sub(r,w);i=j-(((y0.to_bits()>>32)as i32>>20)&0x7ff);
    if i>49{t=r;w=mul(fn_,P3);r=sub(t,w);w=sub(mul(fn_,P3T),sub(sub(t,r),w));y0=sub(r,w);}}
  }
  let y1=sub(sub(r,y0),w);return if hx<0{(-n,[neg(y0),neg(y1)])}else{(n,[y0,y1])};
 }
 if ix>=0x7ff00000{let nan=sub(x,x);return(0,[nan,nan])}
 let e0=(ix>>20)-1046;let high=(ix as u32).wrapping_sub((e0 as u32).wrapping_shl(20));let mut z=f64::from_bits(((high as u64)<<32)|(x.to_bits()&0xffffffff));
 let mut tx=[0.0;3];for item in tx.iter_mut().take(2){*item=z as i32 as f64;z=mul(sub(z,*item),16_777_216.0);}tx[2]=z;let mut nx=3;while tx[nx-1]==0.0{nx-=1;}
 let(n,[y0,y1])=kernel_rem_pio2(&tx[..nx],e0);if hx<0{(-n,[neg(y0),neg(y1)])}else{(n,[y0,y1])}
}
fn kernel_sin(x:f64,y:f64,iy:i32)->f64{
 const S:[f64;6]=[-1.66666666666666324348e-1,8.33333333332248946124e-3,-1.98412698298579493134e-4,2.75573137070700676789e-6,-2.50507602534068634195e-8,1.58969099521155010221e-10];
 if ((x.to_bits()>>32)as u32&0x7fffffff)<0x3e400000&&x as i32==0{return x}
 let z=mul(x,x);let v=mul(z,x);let r=add(S[1],mul(z,add(S[2],mul(z,add(S[3],mul(z,add(S[4],mul(z,S[5]))))))));
 if iy==0{add(x,mul(v,add(S[0],mul(z,r))))}else{sub(x,sub(sub(mul(z,sub(mul(0.5,y),mul(v,r))),y),mul(v,S[0])))}
}
fn kernel_cos(x:f64,y:f64)->f64{
 const C:[f64;6]=[4.16666666666666019037e-2,-1.38888888888741095749e-3,2.48015872894767294178e-5,-2.75573143513906633035e-7,2.08757232129817482790e-9,-1.13596475577881948265e-11];
 let ix=(x.to_bits()>>32)as u32&0x7fffffff;if ix<0x3e400000&&x as i32==0{return 1.0}
 let z=mul(x,x);let r=mul(z,add(C[0],mul(z,add(C[1],mul(z,add(C[2],mul(z,add(C[3],mul(z,add(C[4],mul(z,C[5])))))))))));
 if ix<0x3fd33333{sub(1.0,sub(mul(0.5,z),sub(mul(z,r),mul(x,y))))}
 else{let qx=if ix>0x3fe90000{0.28125}else{f64::from_bits(((ix-0x00200000)as u64)<<32)};let iz=sub(mul(0.5,z),qx);let a=sub(1.0,qx);sub(a,sub(iz,sub(mul(z,r),mul(x,y))))}
}
fn kernel_tan(mut x:f64,mut y:f64,iy:i32)->f64{
 const T:[f64;13]=[3.33333333333334091986e-1,1.33333333333201242699e-1,5.39682539762260521377e-2,2.18694882948595424599e-2,8.86323982359930005737e-3,3.59207910759131235356e-3,1.45620945432529025516e-3,5.88041240820264096874e-4,2.46463134818469906812e-4,7.81794442939557092300e-5,7.14072491382608190305e-5,-1.85586374855275456654e-5,2.59073051863633712884e-5];
 let hx=(x.to_bits()>>32)as i32;let ix=hx&0x7fffffff;
 if ix<0x3e300000&&x as i32==0 {
  if ((ix as u32|x.to_bits()as u32)|((iy+1)as u32))==0{return div(1.0,abs(x))}
  if iy==1{return x}
  let w=add(x,y);let z=low_zero(w);let v=sub(y,sub(z,x));let a=div(-1.0,w);let t=low_zero(a);let s=add(1.0,mul(t,z));return add(t,mul(a,add(s,mul(t,v))));
 }
 if ix>=0x3fe59428{if hx<0{x=neg(x);y=neg(y);}let z=sub(f64::from_bits(0x3fe921fb54442d18),x);let w=sub(f64::from_bits(0x3c81a62633145c07),y);x=add(z,w);y=0.0;}
 let z=mul(x,x);let w=mul(z,z);
 let r=add(T[1],mul(w,add(T[3],mul(w,add(T[5],mul(w,add(T[7],mul(w,add(T[9],mul(w,T[11]))))))))));
 let v=mul(z,add(T[2],mul(w,add(T[4],mul(w,add(T[6],mul(w,add(T[8],mul(w,add(T[10],mul(w,T[12])))))))))));
 let s=mul(z,x);let mut r=add(y,mul(z,add(mul(s,add(r,v)),y)));r=add(r,mul(T[0],s));let w=add(x,r);
 if ix>=0x3fe59428{let v=iy as f64;return mul((1-((hx>>30)&2))as f64,sub(v,mul(2.0,sub(x,sub(div(mul(w,w),add(w,v)),r)))))}
 if iy==1{w}else{let z=low_zero(w);let v=sub(r,sub(z,x));let a=div(-1.0,w);let t=low_zero(a);let s=add(1.0,mul(t,z));add(t,mul(a,add(s,mul(t,v))))}
}
pub fn sin(x:f64)->f64{let ix=(x.to_bits()>>32)as u32&0x7fffffff;if ix<=0x3fe921fb{return kernel_sin(x,0.0,0)}if ix>=0x7ff00000{return sub(x,x)}let(n,[a,b])=rem_pio2(x);match n&3{0=>kernel_sin(a,b,1),1=>kernel_cos(a,b),2=>neg(kernel_sin(a,b,1)),_=>neg(kernel_cos(a,b))}}
pub fn cos(x:f64)->f64{let ix=(x.to_bits()>>32)as u32&0x7fffffff;if ix<=0x3fe921fb{return kernel_cos(x,0.0)}if ix>=0x7ff00000{return sub(x,x)}let(n,[a,b])=rem_pio2(x);match n&3{0=>kernel_cos(a,b),1=>neg(kernel_sin(a,b,1)),2=>neg(kernel_cos(a,b)),_=>kernel_sin(a,b,1)}}
pub fn tan(x:f64)->f64{let ix=(x.to_bits()>>32)as u32&0x7fffffff;if ix<=0x3fe921fb{return kernel_tan(x,0.0,1)}if ix>=0x7ff00000{return sub(x,x)}let(n,[a,b])=rem_pio2(x);kernel_tan(a,b,1-((n&1)<<1))}
