use battle_core::{unit as u,skill as s,entity::Vec2Arena,unit_skill_runtime as r};
use std::io::{self,BufRead,Write};
use std::collections::VecDeque;
use std::sync::Arc;
pub(crate) fn bits(v:f64)->String{format!("{:016x}",v.to_bits())}
fn q(v:f64)->String{format!("\"{}\"",bits(v))}
fn optional(v:s::Number)->String{match v{s::Number::Undefined=>"\"u\"".into(),s::Number::Null=>"\"n\"".into(),s::Number::Value(x)=>q(x)}}
fn reference<T:Copy>(v:s::Reference<T>,id:impl FnOnce(T)->usize)->String{match v{s::Reference::Undefined=>"\"u\"".into(),s::Reference::Null=>"\"n\"".into(),s::Reference::Value(x)=>id(x).to_string()}}
fn vec_json(v:&[f64;2])->String{format!("[{},{}]",q(v[0]),q(v[1]))}
pub(crate) fn snapshot(w:&u::World,t:&s::World,last_tick:f64)->String{
 let a=&w.units[0];let b=&t.skills[0];let su=&t.units[0];
 let current=a.current_skill.map(|x|x.to_string()).unwrap_or_else(||"\"n\"".into());
 format!("{{\"unit\":[{},{},{},{},{},{},{},{},{},{},[{}]],\"skill\":[{},{},{},{},{},{},{},{},{},{},{},{}],\"lastTick\":{},\"freeze\":{},\"queues\":[{}],\"active\":{}}}",
 q(a.hp),q(a.mp),q(a.global_cd),current,q(a.speeder),q(a.dt_action),q(a.action_elapsed),vec_json(w.vectors.get(a.position)),vec_json(w.vectors.get(a.previous_position)),vec_json(w.vectors.get(a.velocity)),a.skills.iter().map(|i|i.to_string()).collect::<Vec<_>>().join(","),
 q(b.cd_remaining),q(b.current_phase_elapsed),b.casting,su.manually_casting,b.info.0,reference(b.next_event,|x|x.0),q(b.next_event_idx),reference(b.next_sound,|x|x.0),q(b.next_sound_idx),b.play_sound,optional(b.unfreeze_time),optional(b.launch_effect_delay),q(last_tick),q(w.freeze_level),t.callback_queues.iter().map(|q|q.len().to_string()).collect::<Vec<_>>().join(","),t.active_queue)
}
pub(crate) struct Host{pub action:usize,pub used:bool,pub events:Vec<String>,pub last_tick:f64,pub frame:usize}
impl Host{
 fn event(&mut self,c:&mut r::Context<'_>,kind:impl AsRef<str>){let state=c.inspect(|u,s|snapshot(u,s,self.last_tick)).expect("valid fixture arena");self.events.push(format!("{{\"kind\":{:?},\"state\":{}}}",kind.as_ref(),state));}
 pub(crate) fn event_runtime(&mut self,runtime:&mut r::Runtime,kind:impl AsRef<str>){runtime.inspect(|u,s|self.event_world(u,s,kind)).expect("valid fixture arena");}
 pub(crate) fn event_world(&mut self,u:&u::World,s:&s::World,kind:impl AsRef<str>){self.events.push(format!("{{\"kind\":{:?},\"state\":{}}}",kind.as_ref(),snapshot(u,s,self.last_tick)));}
 fn once(&mut self,action:usize)->bool{if self.action==action&&!self.used{self.used=true;true}else{false}}
}
impl r::Hooks for Host{
 fn unit(&mut self,c:&mut r::Context<'_>,call:r::UnitCall<'_>)->r::Result<r::Reply>{
  use r::{UnitCall as C,Reply as R};
  match call{
   C::IsTurnBased{..}=>{self.event(c,"turnbased");Ok(R::Bool(false))},
   C::StageRect=>{self.event(c,"rect");Ok(R::Rect(u::Rect{min_x:-400.0,max_x:400.0}))},
   C::SkillIsBasic{skill}=>{let caster=c.skill(s::SkillId(skill))?.caster.0;Ok(R::Bool(c.unit(caster)?.basic_skill==Some(skill)))},
   C::UpdateSkill{action_dt,cd_dt,raw_dt,..}=>{self.event(c,format!("update:{}:{}:{}",bits(action_dt),bits(cd_dt),bits(raw_dt)));Ok(R::UseRustSkill)},
   C::IsPet{..}=>{self.event(c,"pet");Ok(R::Bool(false))},
   C::UpdateAi{dt,..}=>{self.event(c,format!("ai:{}",bits(dt)));Ok(R::Done)},
   C::RecheckManual{..}=>{self.event(c,"manual");if self.once(13){c.unit_mut(0)?.mp=47.0;self.event(c,"mutate:manual-throw");return Err("fixture-sentinel".into())}Ok(R::Done)},
   C::TransferMpTarget{..}=>{self.event(c,"mp-target");Ok(R::UseRustResource)},
   C::SetMp{value,source,..}=>{if source!=0{return Err("unexpected mp source".into())}self.event(c,format!("mp:{}",bits(value)));Ok(R::UseRustResource)},
   C::TransferHpTarget{..}=>{self.event(c,"hp-target");Ok(R::UseRustResource)},
   C::SetHp{value,..}=>{self.event(c,format!("hp:{}",bits(value)));Ok(R::UseRustResource)},
   C::AddRestore{value,..}=>{self.event(c,format!("restore:{}",bits(value)));Ok(R::Done)},
   C::ActionFinished{..}=>{self.event(c,"action-finished");if self.once(12){c.unit_mut(0)?.mp=43.0;self.event(c,"mutate:action-throw");return Err("fixture-sentinel".into())}Ok(R::Done)},
   other=>Err(format!("unexpected unit mechanic: {other:?}")),
  }
 }
 fn skill(&mut self,c:&mut r::Context<'_>,call:r::SkillCall<'_>)->r::Result<r::Reply>{
  use r::{SkillCall as C,Reply as R};
  match call{
   C::CheckRegion{..}=>{self.event(c,"region");if self.once(14){c.unit_mut(0)?.current_skill=None;self.event(c,"mutate:region-throw");return Err("fixture-sentinel".into())}Ok(R::Done)},
   C::Unfreeze=>{self.event(c,"unfreeze");if self.once(4){c.unit_mut(0)?.mp=-0.0;*c.freeze_level_mut()=0.0;self.event(c,"mutate:unfreeze-shared");}Ok(R::Done)},
   C::AttackFrame{skill}=>{
    self.event(c,"attack");
    if self.once(1){let u=c.unit_mut(0)?;u.mp=37.0;u.global_cd=-0.0;u.current_skill=None;self.event(c,"mutate:attack-shared");}
    if self.once(2){c.skill_mut(skill)?.casting=false;self.event(c,"mutate:casting");}
    if self.once(3){c.unit_mut(0)?.global_cd=9.0;self.event(c,"mutate:global-cd");}
    if self.once(7){c.skill_mut(skill)?.info=s::InfoId(1);self.event(c,"mutate:info");}
    if self.once(8){c.unit_mut(0)?.mp=39.0;self.event(c,"mutate:attack-throw");return Err("fixture-sentinel".into())}
    if self.once(10){c.unit_mut(0)?.skills.clear();self.event(c,"mutate:skill-list");}
    Ok(R::Done)
   },
   C::UnitScale{..}=>{self.event(c,"scale");Ok(R::Number(1.0))},
   C::LaunchSound{effect}=>{if effect!="spark"{return Err("unexpected effect lookup".into())}self.event(c,"lookup");Ok(R::Text(Some("launch".into())))},
   C::PlayEffect{sound}=>{
    self.event(c,format!("sound:{sound}"));
    if self.once(5){let u=c.unit_mut(0)?;u.mp+=5.0;u.global_cd=-7.0;u.current_skill=None;self.event(c,"mutate:sound-shared");}
    if self.once(6){c.skill_mut(s::SkillId(0))?.next_sound_idx=1.0;self.event(c,"mutate:sound-index");}
    if self.once(9){c.unit_mut(0)?.global_cd=23.0;self.event(c,"mutate:sound-throw");return Err("fixture-sentinel".into())}
    if self.once(11){let queues=c.queues_mut();queues.push(VecDeque::from([s::Callback::LaunchSound{skill:s::SkillId(0),sound:Some("nested".into())}]));let index=queues.len()-1;c.set_active_queue(index)?;self.event(c,"mutate:queue-replacement");}
    Ok(R::Done)
   },
   other=>Err(format!("unexpected skill mechanic: {other:?}")),
  }
 }
 fn resource(&mut self,c:&mut r::Context<'_>,call:r::ResourceCall)->r::Result<r::Reply>{
  use r::{ResourceCall as C,Reply as R};
  match call{
   C::MaxMp{..}=>Ok(R::Number(1000.0)),
   C::NoAddMp{..}|C::TransferHealEnabled{..}|C::TransferMpEnabled{..}=>Ok(R::Bool(false)),
   C::LogMp{..}=>{self.event(c,"btlog-mp");if self.once(16){let skill=c.skill_mut(s::SkillId(0))?;skill.info=s::InfoId(1);skill.casting=false;self.event(c,"mutate:resource-skill");}Ok(R::Done)},
   C::MaxHp{..}=>Ok(R::Number(200.0)),
   C::Ticks=>Ok(R::Number(self.frame as f64)),
   C::SetLastHpChangeTick{tick,..}=>{self.last_tick=tick;Ok(R::Done)},
   C::LogHp{..}=>{self.event(c,"btlog-hp");if self.once(17){c.skill_mut(s::SkillId(0))?.next_sound_idx=1.0;self.event(c,"mutate:resource-throw");return Err("fixture-sentinel".into())}Ok(R::Done)},
   C::TransferHealTarget{..}|C::TransferMpTarget{..}=>Err("disabled target read".into()),
  }
 }
}
pub(crate) fn make(n:&[f64],action:usize)->r::Runtime{
 let mut vectors=Vec2Arena::default();let zero=vectors.insert([0.0,0.0]);let position=vectors.insert([0.0,0.0]);let previous=vectors.insert([1.0,2.0]);let walk=vectors.insert([0.125,-0.25]);let knock=vectors.insert([0.0,0.0]);let velocity=vectors.insert([0.0,0.0]);
 let unit=u::Unit{state:u::State::Idle,is_summoned:false,is_boss:false,camp:1.0,hp:100.0,mp:n[6],attribs:u::Attributes{mspd:n[1],atkhast:n[2],ms_fix:0.0,hast:n[3],mpr:n[4],hpr:n[5],heal:15.0,dot_ratio:0.25,all_mp_ratio:0.1,pr_mp_ratio:25.0},effects:0,position,previous_position:previous,walk_v:walk,knockup_v:knock,velocity,knockup_accel:None,force_destination:None,destination:None,direction:1.0,height:0.0,z_speed:None,gravity_coef:1.0,delay_terminate_timer:None,current_skill:Some(0),basic_skill:Some(0),skills:vec![0],buffs:vec![],speeder:99.0,dt_action:99.0,action_name:if action==12{Some(Arc::from("atk"))}else{None},action_elapsed:if action==12{1.5}else{0.0},action_duration:1.0,action_loop:false,fall_frozen_delay:None,fall_frozen_time:0.0,knockup_time:0.0,knock_state:false,knock_not_fall:false,walk_ignore_rect:false,global_cd:n[7],frozen_model:false,thump_resistance_level:0.0,thump_resistance_reduce:None,enter_delay_timer:None};
 let units=u::World{units:vec![unit],vectors,effects:vec![u::Effects::default()],skills:vec![u::SkillView{set_speeder:Some(25.5),..u::SkillView::default()}],buffs:vec![],zero,gravity:-10.0,freeze_level:1.0,local_bot:false};
 let mut timelines=s::World::default();timelines.infos=vec![s::Info{launch_effect:if action==15{Some("spark".into())}else{None},launch_z_order:s::Number::Value(0.0),launch_fix_x:s::Number::Value(-0.0),launch_fix_y:s::Number::Value(3.0),..s::Info::default()},s::Info::default()];
 timelines.units.push(s::Unit{manually_casting:true,..s::Unit::default()});timelines.events=vec![s::TimelineEvent{time:0.0,attack:true},s::TimelineEvent{time:0.1,attack:true}];timelines.sounds=vec![s::Sound{delay:0.0,name:"first".into()},s::Sound{delay:0.1,name:"second".into()},s::Sound{delay:0.2,name:"third".into()}];timelines.phases.push(s::Phase{events:vec![Some(s::EventId(0)),Some(s::EventId(1))],sounds:vec![Some(s::SoundId(0)),Some(s::SoundId(1)),Some(s::SoundId(2))],action_name:"atk".into()});
 let mut skill=s::Skill::new(s::InfoId(0),s::UnitId(0));skill.cd_remaining=2.0;skill.unfreeze_time=s::Number::Value(n[8]);skill.launch_effect_delay=if action==15{s::Number::Value(0.0)}else{s::Number::Undefined};skill.casting=true;skill.current_phase=s::Reference::Value(s::PhaseId(0));skill.next_event=s::Reference::Value(s::EventId(0));skill.next_sound=s::Reference::Value(s::SoundId(0));timelines.skills.push(skill);
 r::Runtime::new(units,timelines,vec![s::Number::Value(25.5),s::Number::Value(0.0)]).unwrap()
}
fn main()->io::Result<()>{let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in stdin.lock().lines(){let line=line?;let mut input=line.split_whitespace();let action=input.next().unwrap().parse::<usize>().unwrap();let n=(0..9).map(|_|f64::from_bits(u64::from_str_radix(input.next().unwrap(),16).unwrap())).collect::<Vec<_>>();assert!(input.next().is_none());let mut runtime=make(&n,action);let mut host=Host{action,used:false,events:vec![],last_tick:-1.0,frame:0};let mut errors=vec![];
 for frame in 0..2{
  host.frame=frame;host.event_runtime(&mut runtime,format!("frame:{frame}:enter"));if let Err(error)=runtime.update_unit(0,n[0],&mut host){assert_eq!(error,"fixture-sentinel");errors.push(format!("unit:{frame}"));host.event_runtime(&mut runtime,"error:unit");}host.event_runtime(&mut runtime,format!("frame:{frame}:after-unit"));
  if let Err(error)=runtime.drain_callbacks(&mut host){assert_eq!(error,"fixture-sentinel");errors.push(format!("drain:{frame}"));host.event_runtime(&mut runtime,"error:drain");}host.event_runtime(&mut runtime,format!("frame:{frame}:after-drain"));
 }
 writeln!(out,"{{\"frames\":[{}],\"errors\":{:?},\"used\":{}}}",host.events.join(","),errors,host.used)?;
 }out.flush()}
