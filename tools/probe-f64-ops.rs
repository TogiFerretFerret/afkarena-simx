use std::io::{self,BufRead,Write};
use std::arch::asm;
#[path="../crates/battle-core/src/js_math.rs"]mod js_math;
fn operation(kind:usize,mut a:f64,b:f64)->f64{
 unsafe{match kind{
  0=>a+b,1=>a-b,2=>a*b,3=>a/b,
  4=>{asm!("addsd {a}, {b}",a=inout(xmm_reg)a,b=in(xmm_reg)b,options(pure,nomem,nostack));a},
  5=>{asm!("subsd {a}, {b}",a=inout(xmm_reg)a,b=in(xmm_reg)b,options(pure,nomem,nostack));a},
  6=>{asm!("mulsd {a}, {b}",a=inout(xmm_reg)a,b=in(xmm_reg)b,options(pure,nomem,nostack));a},
  7=>{asm!("divsd {a}, {b}",a=inout(xmm_reg)a,b=in(xmm_reg)b,options(pure,nomem,nostack));a},
  8=>{let mut right=b;asm!("addsd {right}, {a}",right=inout(xmm_reg)right,a=in(xmm_reg)a,options(pure,nomem,nostack));right},
  9=>{let mut right=b;asm!("mulsd {right}, {a}",right=inout(xmm_reg)right,a=in(xmm_reg)a,options(pure,nomem,nostack));right},
  10=>js_math::add(a,b),11=>js_math::sub(a,b),12=>js_math::mul(a,b),13=>js_math::div(a,b),14=>js_math::min(a,b),15=>js_math::max(a,b),_=>panic!()
 }}
}
fn main()->io::Result<()>{assert!(js_math::reference_fp_environment(),"Unsupported MXCSR control environment");let mut out=io::BufWriter::new(io::stdout().lock());for line in io::stdin().lock().lines(){let line=line?;let mut words=line.split_whitespace();let a=f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap());let b=f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap());let values=(0..16).map(|kind|format!("\"{:016x}\"",operation(kind,a,b).to_bits())).collect::<Vec<_>>();writeln!(out,"[{}]",values.join(","))?;}out.flush()}
