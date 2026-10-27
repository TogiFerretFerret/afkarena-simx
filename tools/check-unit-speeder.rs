use std::io::{self,BufRead};
#[path="../crates/battle-core/src/js_math.rs"]mod js_math;
#[path="../crates/battle-core/src/unit_speeder.rs"]mod unit_speeder;
use unit_speeder::{Input,SkillSpeed,calculate,calculate_guarded};
fn main(){for line in io::stdin().lock().lines(){let line=line.unwrap();let t:Vec<_>=line.split_whitespace().collect();let n=|i:usize|f64::from_bits(u64::from_str_radix(t[i],16).unwrap());let f:u32=t[4].parse().unwrap();let input=Input{mspd:n(0),atkhast:n(1),dt:n(2),is_boss:f&1!=0,skill:if f&2!=0{Some(SkillSpeed{set_speeder:if f&64!=0{Some(n(3))}else{None},is_basic:f&4!=0,lock_action_speeder:f&8!=0})}else{None},frozen:f&16!=0,motionless:f&32!=0};let output=calculate(input);println!("{:016x} {:016x} {:016x} {}",output.raw_dt.to_bits(),output.speeder.to_bits(),output.dt_action.to_bits(),u8::from(calculate_guarded(input).is_some()));}}
