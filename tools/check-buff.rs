#[path="../crates/battle-core/src/skill.rs"]mod skill;
#[path="../crates/battle-core/src/js_math.rs"]mod js_math;
#[path="../crates/battle-core/src/buff.rs"]mod buff;
use buff::*;use skill::Number;use std::io::{self,BufRead,Write};
fn bits(x:f64)->String{format!("{:016x}",x.to_bits())}
fn snapshot(w:&World)->String{let b=&w.buffs[0];let timer=match b.timer{Number::Null=>"n".into(),Number::Undefined=>"u".into(),Number::Value(x)=>bits(x)};format!("{}:{}:{}:{}",b.owner,b.caster.map_or("n".into(),|v|v.to_string()),timer,w.units.iter().map(|u|bits(u.hp)).collect::<Vec<_>>().join(":"))}
struct Host{events:Vec<String>,flags:usize,coef:f64}
impl Host{fn event(&mut self,w:&World,s:String){self.events.push(format!("{}|{}",s,snapshot(w)))}fn mutate(&self,w:&mut World){if self.flags&32!=0{w.buffs[0].timer=Number::Value(99.0)}if self.flags&64!=0{w.buffs[0].caster=Some(2)}if self.flags&128!=0{w.buffs[0].owner=2}}}
impl Hooks for Host{
 fn is_turn_based(&mut self,w:&mut World,_:BuffId)->Result<bool>{self.event(w,"turn".into());Ok(self.flags&1!=0)}
 fn update_turn_based(&mut self,w:&mut World,_:BuffId,dt:f64)->Result{self.event(w,format!("tb:{}",bits(dt)));Ok(())}
 fn remove_buff(&mut self,w:&mut World,u:UnitId,_:BuffId)->Result{self.event(w,format!("remove:{u}"));Ok(())}
 fn transfer_target(&mut self,w:&mut World,_:UnitId)->Result<UnitId>{self.event(w,"transfer".into());self.mutate(w);Ok(if self.flags&16!=0{2}else{0})}
 fn add_heal(&mut self,w:&mut World,u:UnitId,v:f64)->Result{self.event(w,format!("heal:{u}:{}",bits(v)));self.mutate(w);Ok(())}
 fn hp_change_all(&mut self,w:&mut World,u:UnitId,v:f64,c:UnitId,k:&str)->Result{self.event(w,format!("hp:{u}:{}:{c}:{k}",bits(v)));Ok(())}
 fn control_conflict(&mut self,w:&mut World,_:BuffId)->Result<bool>{self.event(w,"conflict".into());self.mutate(w);Ok(self.flags&8!=0)}
 fn control_timer_coefficient(&mut self,w:&mut World,o:UnitId,c:UnitId,_:BuffId)->Result<f64>{self.event(w,format!("ctrl:{o}:{c}"));self.mutate(w);Ok(self.coef)}
 fn positive_timer_coefficient(&mut self,w:&mut World,o:UnitId,c:UnitId,_:BuffId)->Result<f64>{self.event(w,format!("pos:{o}:{c}"));self.mutate(w);Ok(self.coef)}
 fn add_damage(&mut self,w:&mut World,u:UnitId,v:f64,c:UnitId,o:UnitId,k:&str)->Result{self.event(w,format!("damage:{u}:{}:{c}:{o}:{k}",bits(v)));self.mutate(w);Ok(())}
 fn add_real_bear_damage(&mut self,w:&mut World,u:UnitId,v:f64,c:UnitId,o:UnitId)->Result{self.event(w,format!("real:{u}:{}:{c}:{o}",bits(v)));Ok(())}
 fn add_bear_damage(&mut self,w:&mut World,u:UnitId,v:f64)->Result{self.event(w,format!("bear:{u}:{}",bits(v)));Ok(())}
}
fn main()->io::Result<()>{let mut out=io::BufWriter::new(io::stdout().lock());for line in io::stdin().lock().lines(){let line=line?;let mut p=line.split_whitespace();let n:Vec<f64>=(0..10).map(|_|f64::from_bits(u64::from_str_radix(p.next().unwrap(),16).unwrap())).collect();let f:Vec<usize>=p.map(|s|s.parse().unwrap()).collect();let unit=Unit{camp:1.0,has_config:true,field_npc:false,is_unit:true,hp:n[3],max_hp:n[4],heal:n[5],dot_ratio:n[6]};let mut w=World{units:vec![unit,Unit{camp:if f[0]&2!=0{1.0}else{-1.0},field_npc:f[0]&4!=0,..unit},Unit{hp:n[7],heal:n[8],..unit}],buffs:vec![Buff{owner:0,caster:Some(1),timer:match f[1]{0=>Number::Null,1=>Number::Undefined,_=>Number::Value(n[0])},inc_hpr:Number::Value(n[1]),affected_by_attr:f[0]&256!=0}]};let mut h=Host{events:vec![],flags:f[0],coef:n[9]};if f[2]==0{w.update(0,n[2],&mut h).unwrap()}else{w.update_hpr_damage(0,n[2],&mut h).unwrap()};writeln!(out,"{{\"events\":[{}],\"state\":\"{}\"}}",h.events.iter().map(|e|format!("\"{e}\"")).collect::<Vec<_>>().join(","),snapshot(&w))?}out.flush()}
