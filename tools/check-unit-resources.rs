#[path="../crates/battle-core/src/entity.rs"] mod entity;
#[path="../crates/battle-core/src/js_math.rs"] mod js_math;
#[path="../crates/battle-core/src/unit.rs"] mod unit;
#[path="../crates/battle-core/src/unit_speeder.rs"] mod unit_speeder;
#[path="../crates/battle-core/src/skill.rs"] mod skill;
#[path="../crates/battle-core/src/unit_resources.rs"] mod unit_resources;
use unit::{World,Unit,State,Attributes,Effects};
use skill::Reference;
use unit_resources::Hooks;
use std::io::{self,BufRead,Write};
fn bits(v:f64)->String{format!("{:016x}",v.to_bits())}
fn reference(v:Reference<usize>)->String{match v{Reference::Null=>"null".into(),Reference::Undefined=>"undefined".into(),Reference::Value(i)=>format!("value:{i}")}}
fn unit(v:entity::Vec2Id,hp:f64,mp:f64)->Unit{Unit{state:State::Idle,is_summoned:false,is_boss:false,camp:1.0,hp,mp,attribs:Attributes::default(),effects:0,position:v,previous_position:v,walk_v:v,knockup_v:v,velocity:v,knockup_accel:None,force_destination:None,destination:None,direction:1.0,height:0.0,z_speed:None,gravity_coef:1.0,delay_terminate_timer:None,current_skill:None,basic_skill:None,skills:vec![],buffs:vec![],speeder:1.0,dt_action:0.0,action_name:None,action_elapsed:0.0,action_duration:0.0,action_loop:false,fall_frozen_delay:None,fall_frozen_time:0.0,knockup_time:0.0,knock_state:false,knock_not_fall:false,walk_ignore_rect:false,global_cd:0.0,frozen_model:false,thump_resistance_level:0.0,thump_resistance_reduce:None,enter_delay_timer:None}}
struct Fixture{flags:usize,fail:usize,maximum:f64,second:f64,last:f64,ticks:f64,reads:usize,targets:[Reference<usize>;2],target_reads:usize,events:Vec<String>}
impl Fixture{
 fn event(&mut self,w:&World,name:String)->unit::Result{self.events.push(format!("{name}|{}:{}:{}",bits(w.units[0].hp),bits(w.units[0].mp),bits(self.last)));if self.events.len()==self.fail{Err("sentinel".into())}else{Ok(())}}
 fn maximum(&mut self,w:&mut World,kind:&str)->unit::Result<f64>{self.reads+=1;self.event(w,format!("{kind}:{}",self.reads))?;if self.flags&2!=0{w.units[0].mp=5.0;}if self.flags&4!=0{w.units[0].hp=-9.0;}Ok(if self.flags&8!=0&&self.reads>1{self.second}else{self.maximum})}
 fn log(&mut self,w:&mut World,kind:&str)->unit::Result{self.event(w,kind.into())?;if self.flags&16!=0{w.units[0].hp=66.0;w.units[0].mp=77.0;}Ok(())}
 fn target(&mut self,w:&mut World,kind:&str)->unit::Result<Reference<usize>>{self.target_reads+=1;self.event(w,format!("{kind}:{}",self.target_reads))?;Ok(self.targets[(self.target_reads-1).min(1)])}
}
impl Hooks for Fixture{
 fn max_mp(&mut self,w:&mut World,_:usize)->unit::Result<f64>{self.maximum(w,"max-mp")}
 fn no_add_mp(&mut self,w:&mut World,_:usize)->unit::Result<bool>{self.event(w,"no-add".into())?;if self.flags&256!=0{w.units[0].mp=42.0;}Ok(self.flags&1!=0)}
 fn log_mp(&mut self,w:&mut World,_:usize)->unit::Result{self.log(w,"log-mp")}
 fn max_hp(&mut self,w:&mut World,_:usize)->unit::Result<f64>{self.maximum(w,"max-hp")}
 fn ticks(&mut self,w:&mut World)->unit::Result<f64>{self.event(w,"ticks".into())?;if self.flags&128!=0{w.units[0].hp=13.0;}Ok(self.ticks)}
 fn set_last_hp_change_tick(&mut self,w:&mut World,_:usize,v:f64)->unit::Result{self.event(w,format!("last:{}",bits(v)))?;self.last=v;if self.flags&512!=0{w.units[0].hp=14.0;}Ok(())}
 fn log_hp(&mut self,w:&mut World,_:usize)->unit::Result{self.log(w,"log-hp")}
 fn transfer_heal_enabled(&mut self,w:&mut World,_:usize)->unit::Result<bool>{self.event(w,"enable-heal".into())?;Ok(self.flags&32!=0)}
 fn transfer_heal_target(&mut self,w:&mut World,_:usize)->unit::Result<Reference<usize>>{self.target(w,"target-heal")}
 fn transfer_mp_enabled(&mut self,w:&mut World,_:usize)->unit::Result<bool>{self.event(w,"enable-mp".into())?;Ok(self.flags&32!=0)}
 fn transfer_mp_target(&mut self,w:&mut World,_:usize)->unit::Result<Reference<usize>>{self.target(w,"target-mp")}
}
fn main()->io::Result<()>{let mut out=io::BufWriter::new(io::stdout().lock());for line in io::stdin().lock().lines(){let line=line?;let mut words=line.split_whitespace();let op=words.next().unwrap().parse::<usize>().unwrap();let flags=words.next().unwrap().parse::<usize>().unwrap();let fail=words.next().unwrap().parse::<usize>().unwrap();let ta=words.next().unwrap().parse::<usize>().unwrap();let tb=words.next().unwrap().parse::<usize>().unwrap();let n=(0..7).map(|_|f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap())).collect::<Vec<_>>();assert!(words.next().is_none());let r=|i|match i{0=>Reference::Null,1=>Reference::Value(1),2=>Reference::Undefined,_=>Reference::Value(0)};let mut vectors=entity::Vec2Arena::default();let v=vectors.insert([0.0,0.0]);let mut world=World{units:vec![unit(v,n[1],n[2]),unit(v,50.0,60.0)],vectors,effects:vec![Effects::default()],skills:vec![],buffs:vec![],zero:v,gravity:-10.0,freeze_level:0.0,local_bot:false};let mut h=Fixture{flags,fail,maximum:n[3],second:n[6],last:n[4],ticks:n[5],reads:0,targets:[r(ta),r(tb)],target_reads:0,events:vec![]};let result=match op{0=>unit_resources::set_mp(&mut world,0,n[0],&mut h).map(|_|"undefined".into()),1=>unit_resources::set_hp(&mut world,0,n[0],&mut h).map(|_|"undefined".into()),2=>unit_resources::transfer_heal_target(&mut world,0,&mut h).map(reference),_=>unit_resources::transfer_mp_target(&mut world,0,&mut h).map(reference)};let (value,error)=match result{Ok(v)=>(format!("{:?}",v),"null".into()),Err(e)=>("null".into(),format!("{:?}",e))};writeln!(out,"{{\"events\":[{}],\"state\":[\"{}\",\"{}\",\"{}\"],\"value\":{},\"error\":{}}}",h.events.iter().map(|e|format!("{:?}",e)).collect::<Vec<_>>().join(","),bits(world.units[0].hp),bits(world.units[0].mp),bits(h.last),value,error)?;}out.flush()}
