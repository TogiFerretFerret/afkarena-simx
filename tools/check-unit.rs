#[path="../crates/battle-core/src/entity.rs"]mod entity;
#[path="../crates/battle-core/src/js_math.rs"]mod js_math;
#[path="../crates/battle-core/src/unit.rs"]mod unit;
#[path="../crates/battle-core/src/unit_speeder.rs"]mod unit_speeder;
use entity::{Vec2Arena,Vec2Id};
use unit::{Attributes,Effects,SkillView,BuffView,State,Unit,World,Hooks,Rect,Result};
use std::io::{self,BufRead,Write};
use std::sync::Arc;
fn q(x:f64)->String{format!("\"{:016x}\"",x.to_bits())}
fn nums(xs:&[f64])->String{format!("[{}]",xs.iter().map(|x|q(*x)).collect::<Vec<_>>().join(","))}
fn opt(x:Option<f64>)->String{x.map(q).unwrap_or_else(||"null".into())}
fn idx(x:Option<usize>)->String{x.map(|x|x.to_string()).unwrap_or_else(||"null".into())}
fn ids(xs:&[usize])->String{format!("[{}]",xs.iter().map(|x|x.to_string()).collect::<Vec<_>>().join(","))}
fn state(x:State)->usize{match x{State::Idle=>0,State::Walk=>1,State::Attack=>2,State::Fall=>3,State::Dead=>4,State::Dying=>5,State::Other(_)=>6}}
fn fx(x:Effects)->usize{usize::from(x.frozen)|(usize::from(x.motionless)<<1)|(usize::from(x.immobilize)<<2)|(usize::from(x.fix)<<3)|(usize::from(x.disable_ai)<<4)|(usize::from(x.stop_buff)<<5)|(usize::from(x.no_hpr)<<6)|(usize::from(x.unheal)<<7)}
fn effect(x:usize)->Effects{Effects{frozen:x&1!=0,motionless:x&2!=0,immobilize:x&4!=0,fix:x&8!=0,disable_ai:x&16!=0,stop_buff:x&32!=0,no_hpr:x&64!=0,unheal:x&128!=0}}
fn snapshot(w:&World)->String{
 let units=w.units.iter().map(|u|{
  let flags=usize::from(u.is_summoned)|(usize::from(u.is_boss)<<1)|(usize::from(u.action_loop)<<2)|(usize::from(u.knock_state)<<3)|(usize::from(u.knock_not_fall)<<4)|(usize::from(u.walk_ignore_rect)<<5)|(usize::from(u.frozen_model)<<6);
  let numbers=[u.camp,u.hp,u.mp,u.direction,u.height,u.gravity_coef,u.speeder,u.dt_action,u.action_elapsed,u.action_duration,u.fall_frozen_time,u.knockup_time,u.global_cd,u.thump_resistance_level];
  let optional=[u.z_speed,u.delay_terminate_timer,u.fall_frozen_delay,u.thump_resistance_reduce,u.enter_delay_timer].map(opt).join(",");
  let vectors=[Some(u.position),Some(u.previous_position),Some(u.walk_v),Some(u.knockup_v),Some(u.velocity),u.knockup_accel,u.force_destination,u.destination].map(|x|idx(x.map(|x|x.index()))).join(",");
  let a=u.attribs;let attrs=[a.mspd,a.atkhast,a.ms_fix,a.hast,a.mpr,a.hpr,a.heal,a.dot_ratio,a.all_mp_ratio,a.pr_mp_ratio];
  format!("{{\"s\":{},\"f\":{},\"fx\":{},\"n\":{},\"o\":[{}],\"v\":[{}],\"a\":{},\"current\":{},\"basic\":{},\"action\":{},\"skills\":{},\"buffs\":{}}}",state(u.state),flags,u.effects,nums(&numbers),optional,vectors,nums(&attrs),idx(u.current_skill),idx(u.basic_skill),u.action_name.as_ref().map(|x|format!("{:?}",x.as_ref())).unwrap_or_else(||"null".into()),ids(&u.skills),ids(&u.buffs))
 }).collect::<Vec<_>>().join(",");
 let vectors=w.vectors.values().iter().map(|v|nums(v)).collect::<Vec<_>>().join(",");
 let effects=ids(&w.effects.iter().map(|x|fx(*x)).collect::<Vec<_>>());
 let skills=w.skills.iter().map(|s|format!("[{}, {}, {}, {}, {}]",opt(s.set_speeder),s.lock_action_speeder,s.lock_ms_fix,s.lock_direction,idx(s.target))).collect::<Vec<_>>().join(",");
 let buffs=w.buffs.iter().map(|b|format!("[{}, {}, {}, {}]",b.clear_on_caster_death,idx(b.caster),opt(b.timer),opt(b.unheal_counter))).collect::<Vec<_>>().join(",");
 format!("{{\"units\":[{}],\"vectors\":[{}],\"effects\":{},\"skills\":[{}],\"buffs\":[{}],\"gravity\":{},\"freeze\":{},\"local\":{}}}",units,vectors,effects,skills,buffs,q(w.gravity),q(w.freeze_level),w.local_bot)
}
struct Fixture{actions:usize,flags:usize,trace:bool,events:Vec<String>,terminated:usize}
impl Fixture{fn event(&mut self,w:&World,kind:String){self.events.push(if self.trace{format!("{{\"kind\":{:?},\"state\":{}}}",kind,snapshot(w))}else{format!("{{\"kind\":{:?}}}",kind)});}}
impl Hooks for Fixture{
 fn terminate(&mut self,w:&mut World,id:usize)->Result{self.event(w,format!("terminate:{id}"));self.terminated+=1;Ok(())}
 fn debug_checks(&mut self,w:&mut World,id:usize)->Result{let p=w.vectors.get(w.units[id].position);if p[0].is_nan()||p[1].is_nan(){self.event(w,"console:position_error".into());}if p[0].abs()>23333.0||p[1].abs()>23333.0{self.event(w,"console:position_error_v2".into());}Ok(())}
 fn action_finished(&mut self,w:&mut World,id:usize)->Result{self.event(w,format!("action_finished:{id}"));if self.actions&1!=0{w.units[id].state=State::Dead;}if self.actions&16384!=0{w.units[id].action_name=Some(Arc::from("next"));}Ok(())}
 fn add_buff(&mut self,w:&mut World,id:usize,tid:u32,caster:usize)->Result<Option<usize>>{self.event(w,format!("add_buff:{id}:{tid}:{caster}"));Ok(Some(0))}
 fn is_turn_based(&mut self,w:&mut World,id:usize)->Result<bool>{self.event(w,format!("is_turn_based:{id}"));Ok(self.flags&256!=0)}
 fn fall(&mut self,w:&mut World,id:usize)->Result{self.event(w,format!("fall:{id}"));w.units[id].state=State::Fall;if self.actions&2!=0{w.units[id].velocity=w.vectors.insert([9.0,-3.0]);}Ok(())}
 fn stage_rect(&mut self,w:&mut World)->Result<Rect>{self.event(w,"stage_rect".into());if self.actions&4!=0{w.units[0].velocity=w.vectors.insert([123.0,-45.0]);}if self.actions&8192!=0{w.units[0].position=w.vectors.insert([450.0,0.0]);}Ok(Rect{min_x:-400.0,max_x:400.0})}
 fn skill_is_basic(&mut self,_:&mut World,skill:usize)->Result<bool>{Ok(skill==0)}
 fn update_skill(&mut self,w:&mut World,skill:usize,a:f64,c:f64,r:f64)->Result{self.event(w,format!("update_skill:{skill}:{:016x}:{:016x}:{:016x}",a.to_bits(),c.to_bits(),r.to_bits()));if skill==0{if self.actions&16!=0&&!w.units[0].skills.is_empty(){w.units[0].skills.remove(0);}if self.actions&32!=0&&!w.units[0].skills.contains(&2){w.units[0].skills.push(2);}if self.actions&32768!=0{w.units[0].action_name=Some(Arc::from("after"));}}Ok(())}
 fn phase_finished(&mut self,w:&mut World,skill:usize)->Result{self.event(w,format!("phase_finished:{skill}"));if self.actions&65536!=0{w.units[0].current_skill=None;}Ok(())}
 fn cast_when_controlled(&mut self,w:&mut World,id:usize)->Result{self.event(w,format!("cast_when_controlled:{id}"));Ok(())}
 fn update_ai(&mut self,w:&mut World,id:usize,dt:f64)->Result{self.event(w,format!("update_ai:{id}:{:016x}",dt.to_bits()));if self.actions&8!=0{w.units[id].effects=1;}Ok(())}
 fn is_pet(&mut self,w:&mut World,id:usize)->Result<bool>{self.event(w,format!("is_pet:{id}"));if self.actions&1024!=0{w.units[id].effects=1;}Ok(self.flags&512!=0)}
 fn recheck_manual(&mut self,w:&mut World,id:usize)->Result{self.event(w,format!("recheck_manual:{id}"));if self.actions&256!=0{w.units[id].state=State::Dead;}Ok(())}
 fn buff_has_effect(&mut self,w:&mut World,buff:usize,effect:&str)->Result<bool>{self.event(w,format!("buff_has_effect:{buff}:{effect}"));if effect=="unheal"&&self.actions&2048!=0{w.buffs[buff].unheal_counter=Some(2.0);}Ok(buff%2==0)}
 fn update_buff(&mut self,w:&mut World,buff:usize,dt:f64)->Result{self.event(w,format!("update_buff:{buff}:{:016x}",dt.to_bits()));if buff==0&&self.actions&64!=0&&!w.units[0].buffs.is_empty(){w.units[0].buffs.remove(0);}Ok(())}
 fn transfer_mp_target(&mut self,w:&mut World,id:usize)->Result<usize>{self.event(w,format!("transfer_mp:{id}"));Ok(1)}
 fn set_mp(&mut self,w:&mut World,id:usize,value:f64,source:usize)->Result{self.event(w,format!("set_mp:{id}:{:016x}:{source}",value.to_bits()));w.units[id].mp=value;if self.actions&512!=0{w.units[id].state=State::Dead;}Ok(())}
 fn buff_hpr_damage(&mut self,w:&mut World,buff:usize,dt:f64)->Result{self.event(w,format!("buff_hpr:{buff}:{:016x}",dt.to_bits()));if buff==0&&self.actions&128!=0&&!w.units[0].buffs.is_empty(){w.units[0].buffs.remove(0);}Ok(())}
 fn transfer_hp_target(&mut self,w:&mut World,id:usize)->Result<usize>{self.event(w,format!("transfer_hp:{id}"));Ok(2)}
 fn set_hp(&mut self,w:&mut World,id:usize,value:f64)->Result{self.event(w,format!("set_hp:{id}:{:016x}",value.to_bits()));w.units[id].hp=value;Ok(())}
 fn add_restore(&mut self,w:&mut World,id:usize,value:f64)->Result{self.event(w,format!("add_restore:{id}:{:016x}",value.to_bits()));Ok(())}
 fn fix_position(&mut self,w:&mut World,position:Vec2Id)->Result<Vec2Id>{self.event(w,format!("fix_position:{}",position.index()));Ok(w.vectors.insert([-1.0,2.0]))}
}
fn make_unit(n:&[f64],v:&[Vec2Id],fx:usize)->Unit{
 Unit{state:State::Idle,is_summoned:false,is_boss:false,camp:n[2],hp:n[0],mp:n[1],attribs:Attributes{mspd:n[22],atkhast:n[23],ms_fix:n[24],hast:n[25],mpr:n[26],hpr:n[27],heal:n[28],dot_ratio:n[29],all_mp_ratio:n[30],pr_mp_ratio:n[31]},effects:fx,position:v[1],previous_position:v[2],walk_v:v[3],knockup_v:v[4],velocity:v[5],knockup_accel:Some(v[6]),force_destination:Some(v[7]),destination:Some(v[8]),direction:n[3],height:n[4],z_speed:None,gravity_coef:n[6],delay_terminate_timer:None,current_skill:None,basic_skill:Some(0),skills:vec![],buffs:vec![],speeder:n[8],dt_action:n[9],action_name:None,action_elapsed:n[10],action_duration:n[11],action_loop:false,fall_frozen_delay:None,fall_frozen_time:n[13],knockup_time:n[14],knock_state:false,knock_not_fall:false,walk_ignore_rect:false,global_cd:n[15],frozen_model:false,thump_resistance_level:n[16],thump_resistance_reduce:None,enter_delay_timer:None}
}
fn main()->io::Result<()>{let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in stdin.lock().lines(){let line=line?;let mut words=line.split_whitespace();let mut integer=||words.next().unwrap().parse::<usize>().unwrap();let trace=integer()!=0;let actions=integer();let flags=integer();let state=integer();let optional=integer();let action=integer();let current=integer();let skill_count=integer();let buff_count=integer();let effects=[integer(),integer(),integer()];let aliases=integer();let skill_flags=integer();drop(integer);
 let n=(0..33).map(|_|f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap())).collect::<Vec<_>>();let mut arena=Vec2Arena::default();let v=(0..10).map(|_|{let x=f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap());let y=f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap());arena.insert([x,y])}).collect::<Vec<_>>();assert!(words.next().is_none());
 let mut units=(0..3).map(|i|make_unit(&n,&v,i)).collect::<Vec<_>>();
 for i in 1..3{units[i].hp=n[0]+10.0*i as f64;units[i].mp=n[1]+20.0*i as f64;units[i].position=if i==1{v[9]}else{v[1]};units[i].state=if flags&(if i==1{1024}else{2048})!=0{State::Dead}else{State::Idle};}
 let u=&mut units[0];u.state=match state{0=>State::Idle,1=>State::Walk,2=>State::Attack,3=>State::Fall,4=>State::Dead,5=>State::Dying,_=>State::Other(6)};u.is_summoned=flags&1!=0;u.is_boss=flags&2!=0;u.action_loop=flags&4!=0;u.knock_state=flags&8!=0;u.knock_not_fall=flags&16!=0;u.walk_ignore_rect=flags&32!=0;u.frozen_model=flags&64!=0;u.action_name=match action{0=>None,1=>Some(Arc::from("atk")),2=>Some(Arc::from("")),_=>Some(Arc::from("other"))};u.current_skill=if current<3{Some(current)}else{None};u.skills=(0..skill_count).collect();u.buffs=(0..buff_count).collect();u.z_speed=(optional&1!=0).then_some(n[5]);u.delay_terminate_timer=(optional&2!=0).then_some(n[7]);u.fall_frozen_delay=(optional&4!=0).then_some(n[12]);u.thump_resistance_reduce=(optional&8!=0).then_some(n[17]);u.enter_delay_timer=(optional&16!=0).then_some(n[18]);
 if aliases&1!=0{u.velocity=v[3];}if aliases&2!=0{u.velocity=v[4];}if aliases&4!=0{u.velocity=v[1];}if aliases&8!=0{u.previous_position=v[1];}if aliases&16!=0{u.knockup_accel=Some(v[4]);}if aliases&32!=0{u.velocity=v[0];}if aliases&64!=0{u.force_destination=Some(v[1]);}if aliases&128!=0{units[1].position=v[1];}
 let skills=(0..3).map(|_|SkillView{set_speeder:(optional&32!=0).then_some(n[32]),lock_action_speeder:skill_flags&1!=0,lock_ms_fix:skill_flags&2!=0,lock_direction:skill_flags&4!=0,target:Some(1)}).collect();let buffs=(0..3).map(|i|BuffView{clear_on_caster_death:i%2==0,caster:Some(1),timer:Some(5.0+i as f64),unheal_counter:if i==0{Some(1.0)}else if i==1{Some(0.0)}else{None}}).collect();
 let mut world=World{units,vectors:arena,effects:effects.map(effect).to_vec(),skills,buffs,zero:v[0],gravity:n[21],freeze_level:n[20],local_bot:flags&128!=0};let mut fixture=Fixture{actions,flags,trace,events:vec![],terminated:0};let result=world.update_unit(0,n[19],&mut fixture);
 writeln!(out,"{{\"events\":[{}],\"final\":{},\"terminated\":{},\"error\":{}}}",fixture.events.join(","),snapshot(&world),fixture.terminated,result.err().map(|e|format!("{:?}",e)).unwrap_or_else(||"null".into()))?;
 }out.flush()}
