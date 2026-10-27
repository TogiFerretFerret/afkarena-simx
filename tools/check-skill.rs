#[path="../crates/battle-core/src/skill.rs"] mod skill;
use skill::*;
use std::io::{self,BufRead,Write};
use std::collections::VecDeque;
fn bits(v:f64)->String{format!("\"{:016x}\"",v.to_bits())}
fn number(v:Number)->String{match v{Number::Undefined=>"\"u\"".into(),Number::Null=>"\"n\"".into(),Number::Value(x)=>bits(x)}}
fn reference<T:Copy>(v:Reference<T>,id:impl FnOnce(T)->usize)->String{match v{Reference::Undefined=>"\"u\"".into(),Reference::Null=>"\"n\"".into(),Reference::Value(x)=>id(x).to_string()}}
fn snapshot(w:&World)->String{
 let s=&w.skills[0];let u=&w.units[s.caster.0];
 format!("{{\"cd\":{},\"unfreeze\":{},\"delay\":{},\"casting\":{},\"elapsed\":{},\"phase\":{},\"event\":{},\"eventIndex\":{},\"sound\":{},\"soundIndex\":{},\"manual\":{},\"current\":{},\"play\":{},\"info\":{},\"activeQueue\":{},\"mode\":\"{}\",\"eventTimes\":[{}],\"queues\":[{}]}}",bits(s.cd_remaining),number(s.unfreeze_time),number(s.launch_effect_delay),s.casting,bits(s.current_phase_elapsed),reference(s.current_phase,|x|x.0),reference(s.next_event,|x|x.0),bits(s.next_event_idx),reference(s.next_sound,|x|x.0),bits(s.next_sound_idx),u.manually_casting,reference(u.current_skill,|x|x.0),s.play_sound,s.info.0,w.active_queue,w.mode,w.events.iter().map(|e|bits(e.time)).collect::<Vec<_>>().join(","),w.callback_queues.iter().map(|q|q.len().to_string()).collect::<Vec<_>>().join(","))
}
struct Host{frames:Vec<String>,action:usize,used:bool}
impl Host{fn event(&mut self,w:&World,kind:&str){self.frames.push(format!("{{\"kind\":\"{}\",\"state\":{}}}",kind,snapshot(w)));}}
impl Hooks for Host{
 fn update_tb(&mut self,w:&mut World,_:SkillId,_:f64,_:f64,_:f64)->Result{self.event(w,"tb");Ok(())}
 fn check_region(&mut self,w:&mut World,_:SkillId)->Result{self.event(w,"region");Ok(())}
 fn unfreeze(&mut self,w:&mut World)->Result{self.event(w,"unfreeze");Ok(())}
 fn on_attack_frame(&mut self,w:&mut World,id:SkillId)->Result{self.event(w,"attack");if !self.used&&self.action!=4{self.used=true;match self.action{1=>w.skills[id.0].casting=false,2=>w.skills[id.0].current_phase=Reference::Value(PhaseId(1)),3=>w.skills[id.0].next_event_idx+=1.0,5=>w.units[0].current_skill=Reference::Null,6=>w.skills[0].play_sound=false,7=>w.skills[0].launch_effect_delay=Number::Value(0.0),8=>w.skills[0].info=InfoId(1),9=>w.events[0].time=999.0,10=>w.mode="act_raid_monster".into(),_=>{}}}Ok(())}
 fn get_unit_scale(&mut self,w:&mut World,_:UnitId)->Result<f64>{self.event(w,"scale");if self.action==11{w.skills[0].info=InfoId(1);}Ok(1.0)}
 fn lookup_launch_sound(&mut self,w:&mut World,_:&str)->Result<Option<String>>{self.event(w,"lookup");Ok(Some("launch".into()))}
 fn add_effect(&mut self,w:&mut World,_:usize,effect:&str,z:f64,offset:[f64;2])->Result{self.event(w,&format!("effect:{}:{:016x}:{:016x}:{:016x}",effect,z.to_bits(),offset[0].to_bits(),offset[1].to_bits()));Ok(())}
 fn play_effect(&mut self,w:&mut World,sound:&str)->Result{self.event(w,&format!("sound:{sound}"));if self.action==4&&!self.used{self.used=true;w.callback_queues.push(VecDeque::new());w.active_queue=1;w.callback_queues[1].push_back(Callback::LaunchSound{skill:SkillId(0),sound:Some("new".into())});}if self.action==12{w.skills[0].next_sound_idx=1.0;}Ok(())}
 fn interrupt(&mut self,_:&mut World,_:SkillId)->Result{Err(Error::Host("unexpected interrupt".into()))}
 fn set_action(&mut self,_:&mut World,_:SkillId,_:&str)->Result{Err(Error::Host("unexpected set_action".into()))}
 fn finish(&mut self,_:&mut World,_:SkillId)->Result{Err(Error::Host("unexpected finish".into()))}
 fn select_target(&mut self,_:&mut World,_:SkillId,_:Reference<UnitId>)->Result{Err(Error::Host("unexpected select_target".into()))}
 fn fix_enemy_cd(&mut self,_:&mut World,_:SkillId,_:f64)->Result<f64>{Err(Error::Host("unexpected fix_enemy_cd".into()))}
 fn log_skill_start(&mut self,_:&mut World,_:SkillId)->Result{Err(Error::Host("unexpected log_skill_start".into()))}
 fn skill_start_event(&mut self,_:&mut World,_:UnitId,_:SkillId)->Result{Err(Error::Host("unexpected skill_start_event".into()))}
 fn is_pet(&mut self,_:&mut World,_:UnitId)->Result<bool>{Err(Error::Host("unexpected is_pet".into()))}
 fn set_pet_mp(&mut self,_:&mut World,_:UnitId,_:f64)->Result{Err(Error::Host("unexpected set_pet_mp".into()))}
 fn set_pet_cast_skill(&mut self,_:&mut World,_:bool)->Result{Err(Error::Host("unexpected set_pet_cast_skill".into()))}
 fn idle(&mut self,_:&mut World,_:UnitId)->Result{Err(Error::Host("unexpected idle".into()))}
 fn skill_finish_event(&mut self,_:&mut World,_:UnitId,_:SkillId)->Result{Err(Error::Host("unexpected skill_finish_event".into()))}
 fn set_mp(&mut self,_:&mut World,_:UnitId,_:f64,_:UnitId)->Result{Err(Error::Host("unexpected set_mp".into()))}
}
struct Input<'a>(std::str::SplitWhitespace<'a>);impl Input<'_>{fn int(&mut self)->usize{self.0.next().unwrap().parse().unwrap()}fn float(&mut self)->f64{f64::from_bits(u64::from_str_radix(self.0.next().unwrap(),16).unwrap())}fn number(&mut self)->Number{let kind=self.int();let x=self.float();match kind{0=>Number::Undefined,1=>Number::Null,_=>Number::Value(x)}}}
fn main()->io::Result<()>{let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in stdin.lock().lines(){let line=line?;let mut i=Input(line.split_whitespace());let action=i.int();let tb=i.int()!=0;let casting=i.int()!=0;let current=i.int()!=0;let manual=i.int()!=0;let actor=i.int()!=0;let play=i.int()!=0;let launch=i.int()!=0;
 let dt=i.float();let cd_dt=i.float();let raw_dt=i.float();let cd=i.float();let elapsed=i.float();let unfreeze=i.number();let delay=i.number();let event_time=i.float();let sound_delay=i.float();let next_index=i.float();
 let mut w=World::default();if tb{w.mode="act_raid_monster".into()};w.units.push(Unit{current_skill:if current{Reference::Value(SkillId(0))}else{Reference::Null},manually_casting:manual,actor:actor.then_some(0),..Unit::default()});
 w.infos=vec![Info{launch_effect:launch.then_some("spark".into()),launch_z_order:Number::Value(0.0),launch_fix_x:Number::Value(-0.0),launch_fix_y:Number::Value(3.0),..Info::default()},Info{launch_effect:Some("other".into()),launch_z_order:Number::Value(4.0),launch_fix_x:Number::Value(5.0),launch_fix_y:Number::Value(6.0),..Info::default()}];
 w.events=vec![TimelineEvent{time:event_time,attack:true},TimelineEvent{time:0.1,attack:true},TimelineEvent{time:0.0,attack:false}];w.sounds=vec![Sound{delay:sound_delay,name:"first".into()},Sound{delay:0.1,name:"second".into()},Sound{delay:0.2,name:"third".into()}];
 w.phases=vec![Phase{events:vec![Some(EventId(0)),Some(EventId(1))],sounds:vec![Some(SoundId(0)),Some(SoundId(1)),Some(SoundId(2))],action_name:"attack".into()},Phase{events:vec![Some(EventId(2)),None],sounds:vec![],action_name:"other".into()}];
 let mut s=Skill::new(InfoId(0),UnitId(0));s.casting=casting;s.play_sound=play;s.cd_remaining=cd;s.current_phase_elapsed=elapsed;s.unfreeze_time=unfreeze;s.launch_effect_delay=delay;s.current_phase=Reference::Value(PhaseId(0));s.next_event=Reference::Value(EventId(0));s.next_event_idx=next_index;s.next_sound=Reference::Value(SoundId(0));w.skills.push(s);
 let mut h=Host{frames:vec![],action,used:false};h.event(&w,"enter");w.update(SkillId(0),dt,cd_dt,raw_dt,&mut h).unwrap();h.event(&w,"after_update");w.drain_current(&mut h).unwrap();h.event(&w,"after_drain");w.drain_current(&mut h).unwrap();h.event(&w,"after_second_drain");writeln!(out,"{{\"frames\":[{}],\"used\":{}}}",h.frames.join(","),h.used)?;
 }out.flush()}
