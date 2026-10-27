#[path="../crates/battle-core/src/ai.rs"]
mod ai;
use ai::*;
use std::io::{self,BufRead,Write};
struct Hooks{ranges:Vec<bool>,calls:Vec<String>}
impl TargetHooks for Hooks{
 fn is_alive(&mut self,w:&mut AiWorld,id:usize)->bool{self.calls.push(format!("alive:{}",id));w.units[id].alive}
 fn basic_shape(&mut self,w:&mut AiWorld)->BasicShape{self.calls.push("shape".into());w.shape}
 fn alive_units(&mut self,w:&mut AiWorld,_:f64)->usize{self.calls.push("units".into());w.alive_list}
 fn target_in_basic_range(&mut self,_:&mut AiWorld,id:usize)->bool{self.calls.push(format!("range:{}",id));self.ranges[id]}
}
fn int(i:&mut std::str::SplitWhitespace<'_>)->usize{i.next().unwrap().parse().unwrap()}
fn number(i:&mut std::str::SplitWhitespace<'_>)->f64{f64::from_bits(u64::from_str_radix(i.next().unwrap(),16).unwrap())}
fn main()->io::Result<()>{let input=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in input.lock().lines(){let line=line?;let mut i=line.split_whitespace();let count=int(&mut i);let owner=int(&mut i);let rectangle=int(&mut i)!=0;let arg1=number(&mut i);let math_huge=number(&mut i);let mut w=AiWorld{units:vec![],vectors:vec![],lists:vec![vec![]],owner,alive_list:0,shape:if rectangle{BasicShape::Rectangle{arg1}}else{BasicShape::Other},math_huge};let mut ranges=vec![];
 for index in 0..count{let x=number(&mut i);let y=number(&mut i);w.vectors.push([x,y]);let camp=number(&mut i);let foe_camp=number(&mut i);let is_unit=int(&mut i)!=0;let alive=int(&mut i)!=0;let untargetable=int(&mut i)!=0;let low_priority=int(&mut i)!=0;let taunted=int(&mut i)!=0;let pursue=int(&mut i)!=0;let target=int(&mut i);let range=int(&mut i)!=0;w.units.push(TargetUnit{position:index,camp,foe_camp,is_unit,alive,untargetable,low_priority,taunted,pursue,force_target:if target==count{None}else{Some(target)}});ranges.push(range);}
 let length=int(&mut i);for _ in 0..length{w.lists[0].push(int(&mut i));}assert!(i.next().is_none());let mut h=Hooks{ranges,calls:vec![]};let r=search_target(&mut w,&mut h);let target=r.target.map(|x|x.to_string()).unwrap_or_else(||"null".into());let calls=h.calls.iter().map(|s|format!("\"{}\"",s)).collect::<Vec<_>>().join(",");writeln!(out,"{{\"target\":{},\"distance\":\"{:016x}\",\"calls\":[{}]}}",target,r.distance_squared.to_bits(),calls)?;
 }out.flush()}
