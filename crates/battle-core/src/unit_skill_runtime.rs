//! Rust Unit -> Skill -> deferred callback integration.
//!
//! Unit owns shared resource/current-skill fields. Skill's existing controller
//! receives private transient mirrors; every external Skill hook first commits
//! controller writes, then imports host mutations, including on error. Hosts
//! cannot obtain a writable mirror of those shared fields. This is a component
//! execution path, not a complete hero/mechanics backend or a battle benchmark.
use crate::{unit, skill};
use crate::entity::{Vec2Arena,Vec2Id};
pub type Result<T=()> = std::result::Result<T,String>;

#[derive(Clone,Copy,Debug)]
pub enum UnitCall<'a> {
 Terminate{unit:usize}, DebugChecks{unit:usize}, ActionFinished{unit:usize},
 AddBuff{unit:usize,tid:u32,caster:usize}, IsTurnBased{unit:usize}, Fall{unit:usize}, StageRect,
 SkillIsBasic{skill:usize}, UpdateSkill{skill:usize,action_dt:f64,cd_dt:f64,raw_dt:f64}, PhaseFinished{skill:usize},
 CastWhenControlled{unit:usize}, UpdateAi{unit:usize,dt:f64}, IsPet{unit:usize}, RecheckManual{unit:usize},
 BuffHasEffect{buff:usize,effect:&'a str}, UpdateBuff{buff:usize,dt:f64}, TransferMpTarget{unit:usize},
 SetMp{unit:usize,value:f64,source:usize}, BuffHprDamage{buff:usize,dt:f64}, TransferHpTarget{unit:usize},
 SetHp{unit:usize,value:f64}, AddRestore{unit:usize,value:f64}, FixPosition{position:Vec2Id},
}
#[derive(Clone,Copy,Debug)]
pub enum SkillCall<'a> {
 UpdateTb{skill:skill::SkillId,action_dt:f64,cd_dt:f64,raw_dt:f64}, CheckRegion{skill:skill::SkillId},
 Unfreeze, AttackFrame{skill:skill::SkillId}, UnitScale{unit:skill::UnitId}, LaunchSound{effect:&'a str},
 AddEffect{actor:usize,effect:&'a str,z:f64,offset:[f64;2]}, PlayEffect{sound:&'a str},
 Interrupt{skill:skill::SkillId}, SetAction{skill:skill::SkillId,action:&'a str}, Finish{skill:skill::SkillId},
 SelectTarget{skill:skill::SkillId,target:skill::Reference<skill::UnitId>}, FixEnemyCd{skill:skill::SkillId,cd:f64},
 LogStart{skill:skill::SkillId}, StartEvent{caster:skill::UnitId,skill:skill::SkillId}, IsPet{unit:skill::UnitId},
 SetPetMp{unit:skill::UnitId,mp:f64}, SetMp{unit:skill::UnitId,mp:f64,source:skill::UnitId},
 SetPetCastSkill{value:bool}, Idle{unit:skill::UnitId}, FinishEvent{caster:skill::UnitId,skill:skill::SkillId},
}
#[derive(Clone,Copy,Debug)]
pub enum ResourceCall {
 MaxMp{unit:usize},NoAddMp{unit:usize},LogMp{unit:usize},MaxHp{unit:usize},Ticks,
 SetLastHpChangeTick{unit:usize,tick:f64},LogHp{unit:usize},TransferHealEnabled{unit:usize},
 TransferHealTarget{unit:usize},TransferMpEnabled{unit:usize},TransferMpTarget{unit:usize},
}
pub enum Reply { Done, Bool(bool), Number(f64), Unit(usize), UnitReference(skill::Reference<usize>), Buff(Option<usize>), Rect(unit::Rect), Vector(Vec2Id), Text(Option<String>), UseRustSkill, UseRustResource }
/// No mechanic has a default implementation. Returning the wrong reply fails at
/// that source call boundary, after preserving mutations already performed.
pub trait Hooks {
 fn unit(&mut self,context:&mut Context<'_>,call:UnitCall<'_>)->Result<Reply>;
 fn skill(&mut self,context:&mut Context<'_>,call:SkillCall<'_>)->Result<Reply>;
 fn resource(&mut self,context:&mut Context<'_>,call:ResourceCall)->Result<Reply>;
}

pub struct Runtime { units:unit::World, timelines:skill::World, info_speeders:Vec<skill::Number> }
/// Skill-only fields. Shared mp/global_cd/current_skill deliberately absent.
#[derive(Clone,Copy,Debug)]
pub struct SkillUnitRead {pub manually_casting:bool,pub pet_skill_casting:bool,pub morph:bool,pub actor:Option<usize>,pub pet_mp:f64}
pub struct SkillUnitOnly<'a> { pub manually_casting:&'a mut bool,pub pet_skill_casting:&'a mut bool,pub morph:&'a mut bool,pub actor:&'a mut Option<usize>,pub pet_mp:&'a mut f64 }
pub struct Context<'a> { units:&'a mut unit::World,timelines:&'a mut skill::World,info_speeders:&'a mut Vec<skill::Number> }
impl Context<'_> {
 /// A coherent diagnostic read of both controllers. Read-only borrows
 /// cannot survive a later mutation through this context. Raw mirror worlds
 /// are never separately exposed to host callbacks.
 pub fn inspect<T>(&mut self,observer:impl FnOnce(&unit::World,&skill::World)->T)->Result<T>{import_units(self.units,self.timelines,self.info_speeders)?;Ok(observer(self.units,self.timelines))}
 pub fn unit_records(&self)->&[unit::Unit]{&self.units.units}
 pub fn freeze_level(&self)->f64{self.units.freeze_level}
 pub fn mode(&self)->&str{&self.timelines.mode}
 pub fn unit(&self,id:usize)->Result<&unit::Unit>{self.units.units.get(id).ok_or_else(||"missing unit".into())}
 pub fn skill(&self,id:skill::SkillId)->Result<&skill::Skill>{self.timelines.skills.get(id.0).ok_or_else(||"missing skill".into())}
 pub fn info(&self,id:skill::InfoId)->Result<&skill::Info>{self.timelines.infos.get(id.0).ok_or_else(||"missing info".into())}
 pub fn info_speeder(&self,id:skill::InfoId)->Result<skill::Number>{self.info_speeders.get(id.0).copied().ok_or_else(||"missing info speed metadata".into())}
 pub fn skill_unit(&self,id:skill::UnitId)->Result<SkillUnitRead>{let u=self.timelines.units.get(id.0).ok_or_else(||"missing skill unit".to_string())?;Ok(SkillUnitRead{manually_casting:u.manually_casting,pet_skill_casting:u.pet_skill_casting,morph:u.morph,actor:u.actor,pet_mp:u.pet_mp})}
 pub fn queues(&self)->&[std::collections::VecDeque<skill::Callback>]{&self.timelines.callback_queues}
 pub fn active_queue(&self)->usize{self.timelines.active_queue}
 pub fn unit_mut(&mut self,id:usize)->Result<&mut unit::Unit>{self.units.units.get_mut(id).ok_or_else(||"missing unit".into())}
 pub fn effects_mut(&mut self)->&mut Vec<unit::Effects>{&mut self.units.effects}
 pub fn vectors_mut(&mut self)->&mut Vec2Arena{&mut self.units.vectors}
 pub fn unit_buff_mut(&mut self,id:usize)->Result<&mut unit::BuffView>{self.units.buffs.get_mut(id).ok_or_else(||"missing unit buff".into())}
 pub fn skill_mut(&mut self,id:skill::SkillId)->Result<&mut skill::Skill>{self.timelines.skills.get_mut(id.0).ok_or_else(||"missing skill".into())}
 pub fn info_mut(&mut self,id:skill::InfoId)->Result<&mut skill::Info>{self.timelines.infos.get_mut(id.0).ok_or_else(||"missing info".into())}
 pub fn set_info_speeder(&mut self,id:skill::InfoId,value:skill::Number)->Result{*self.info_speeders.get_mut(id.0).ok_or_else(||"missing info speed metadata".to_string())?=value;Ok(())}
 pub fn phase_mut(&mut self,id:skill::PhaseId)->Result<&mut skill::Phase>{self.timelines.phases.get_mut(id.0).ok_or_else(||"missing phase".into())}
 pub fn sound_mut(&mut self,id:skill::SoundId)->Result<&mut skill::Sound>{self.timelines.sounds.get_mut(id.0).ok_or_else(||"missing sound".into())}
 pub fn event_mut(&mut self,id:skill::EventId)->Result<&mut skill::TimelineEvent>{self.timelines.events.get_mut(id.0).ok_or_else(||"missing timeline event".into())}
 pub fn skill_unit_mut(&mut self,id:skill::UnitId)->Result<SkillUnitOnly<'_>>{let u=self.timelines.units.get_mut(id.0).ok_or_else(||"missing skill unit".to_string())?;Ok(SkillUnitOnly{manually_casting:&mut u.manually_casting,pet_skill_casting:&mut u.pet_skill_casting,morph:&mut u.morph,actor:&mut u.actor,pet_mp:&mut u.pet_mp})}
 pub fn set_skill_locks(&mut self,id:usize,action:bool,movement:bool,direction:bool)->Result{let s=self.units.skills.get_mut(id).ok_or_else(||"missing skill view".to_string())?;s.lock_action_speeder=action;s.lock_ms_fix=movement;s.lock_direction=direction;Ok(())}
 pub fn freeze_level_mut(&mut self)->&mut f64{&mut self.units.freeze_level}
 pub fn queues_mut(&mut self)->&mut Vec<std::collections::VecDeque<skill::Callback>>{&mut self.timelines.callback_queues}
 pub fn set_active_queue(&mut self,id:usize)->Result{if id>=self.timelines.callback_queues.len(){return Err("missing callback queue".into())}self.timelines.active_queue=id;Ok(())}
 pub fn set_mode(&mut self,mode:String){self.timelines.mode=mode}

}
fn check_layout(units:&unit::World,timelines:&skill::World,info_speeders:&[skill::Number])->Result{
 if units.units.len()!=timelines.units.len()||units.skills.len()!=timelines.skills.len()||units.buffs.len()!=timelines.buffs.len()||info_speeders.len()!=timelines.infos.len(){return Err("unaligned shared identity registries".into())}
 if timelines.active_queue>=timelines.callback_queues.len(){return Err("missing active callback queue".into())}
 for u in &units.units {if u.current_skill.is_some_and(|i|i>=units.skills.len())||u.basic_skill.is_some_and(|i|i>=units.skills.len())||u.skills.iter().any(|i|*i>=units.skills.len())||u.buffs.iter().any(|i|*i>=units.buffs.len())||u.effects>=units.effects.len(){return Err("invalid unit identity reference".into())}}
 for s in &timelines.skills {if s.info.0>=info_speeders.len()||s.caster.0>=units.units.len()||s.target.value().is_some_and(|id|id.0>=units.units.len()){return Err("invalid skill identity reference".into())}}
 Ok(())
}
fn derived_views(units:&mut unit::World,timelines:&skill::World,info_speeders:&[skill::Number])->Result{
 check_layout(units,timelines,info_speeders)?;
 for (view,record) in units.skills.iter_mut().zip(&timelines.skills){view.set_speeder=info_speeders[record.info.0].value();view.target=record.target.value().map(|id|id.0)}
 Ok(())
}
fn import_units(units:&mut unit::World,timelines:&mut skill::World,speeders:&[skill::Number])->Result{
 derived_views(units,timelines,speeders)?;
 for (u,s) in units.units.iter().zip(&mut timelines.units){s.mp=u.mp;s.global_cd=u.global_cd;s.current_skill=u.current_skill.map(|id|skill::Reference::Value(skill::SkillId(id))).unwrap_or(skill::Reference::Null)}
 for (u,s) in units.buffs.iter().zip(&mut timelines.buffs){s.timer=u.timer.map(skill::Number::Value).unwrap_or(skill::Number::Null)}
 Ok(())
}
fn export_units(units:&mut unit::World,timelines:&skill::World,speeders:&[skill::Number])->Result{
 check_layout(units,timelines,speeders)?;
 // Reject unsupported missing-vs-null values before any mirror write.
 if timelines.units.iter().any(|s|matches!(s.current_skill,skill::Reference::Undefined))||timelines.buffs.iter().any(|s|matches!(s.timer,skill::Number::Undefined)){return Err("shared unit view cannot represent undefined current_skill or buff timer".into())}
 for (u,s) in units.units.iter_mut().zip(&timelines.units){u.mp=s.mp;u.global_cd=s.global_cd;u.current_skill=s.current_skill.value().map(|id|id.0)}
 for (u,s) in units.buffs.iter_mut().zip(&timelines.buffs){u.timer=s.timer.value()}
 derived_views(units,timelines,speeders)
}
impl Runtime {
 pub fn new(mut units:unit::World,mut timelines:skill::World,info_speeders:Vec<skill::Number>)->Result<Self>{import_units(&mut units,&mut timelines,&info_speeders)?;Ok(Self{units,timelines,info_speeders})}
 pub fn units(&self)->&unit::World{&self.units}
 pub fn timelines(&self)->&skill::World{&self.timelines}
 pub fn context(&mut self)->Context<'_>{Context{units:&mut self.units,timelines:&mut self.timelines,info_speeders:&mut self.info_speeders}}
 pub fn update_unit<H:Hooks>(&mut self,id:usize,dt:f64,host:&mut H)->Result{
  if id>=self.units.units.len(){return Err("missing unit".into())}
  import_units(&mut self.units,&mut self.timelines,&self.info_speeders)?;
  let result=self.units.update_unit(id,dt,&mut UnitAdapter{timelines:&mut self.timelines,speeders:&mut self.info_speeders,host});
  let sync=import_units(&mut self.units,&mut self.timelines,&self.info_speeders);result.and(sync)
 }
 pub fn update_skill<H:Hooks>(&mut self,id:skill::SkillId,action_dt:f64,cd_dt:f64,raw_dt:f64,host:&mut H)->Result{self.with_skill(host,|w,h|w.update(id,action_dt,cd_dt,raw_dt,h))}
 pub fn start_skill<H:Hooks>(&mut self,id:skill::SkillId,target:skill::Reference<skill::UnitId>,host:&mut H)->Result{self.with_skill(host,|w,h|w.start(id,target,h))}
 pub fn finish_skill<H:Hooks>(&mut self,id:skill::SkillId,host:&mut H)->Result{self.with_skill(host,|w,h|w.finish(id,h))}
 pub fn drain_callbacks<H:Hooks>(&mut self,host:&mut H)->Result{self.with_skill(host,|w,h|w.drain_current(h))}
 fn with_skill<H:Hooks,F>(&mut self,host:&mut H,f:F)->Result where F:FnOnce(&mut skill::World,&mut SkillAdapter<'_,H>)->skill::Result{
  import_units(&mut self.units,&mut self.timelines,&self.info_speeders)?;
  let result=f(&mut self.timelines,&mut SkillAdapter{units:&mut self.units,speeders:&mut self.info_speeders,host}).map_err(skill_error);
  let sync=export_units(&mut self.units,&self.timelines,&self.info_speeders);result.and(sync)
 }
}
fn skill_error(e:skill::Error)->String{match e{skill::Error::Host(s)=>s,other=>format!("{other:?}")}}
fn done(reply:Reply)->Result{if matches!(reply,Reply::Done){Ok(())}else{Err("host reply must be Done".into())}}
fn boolean(reply:Reply)->Result<bool>{if let Reply::Bool(v)=reply{Ok(v)}else{Err("host reply must be Bool".into())}}
fn number(reply:Reply)->Result<f64>{if let Reply::Number(v)=reply{Ok(v)}else{Err("host reply must be Number".into())}}
struct UnitAdapter<'a,H>{timelines:&'a mut skill::World,speeders:&'a mut Vec<skill::Number>,host:&'a mut H}
impl<H:Hooks> UnitAdapter<'_,H>{
 fn call(&mut self,w:&mut unit::World,event:UnitCall<'_>)->Result<Reply>{import_units(w,self.timelines,self.speeders)?;let result=self.host.unit(&mut Context{units:w,timelines:self.timelines,info_speeders:self.speeders},event);let sync=import_units(w,self.timelines,self.speeders);match result{Ok(v)=>sync.map(|_|v),Err(e)=>{let _=sync;Err(e)}}}
 fn resource<F,T>(&mut self,w:&mut unit::World,f:F)->Result<T> where F:FnOnce(&mut unit::World,&mut ResourceAdapter<'_,H>)->Result<T>{
  import_units(w,self.timelines,self.speeders)?;
  let result=f(w,&mut ResourceAdapter{timelines:self.timelines,speeders:self.speeders,host:self.host});
  let sync=import_units(w,self.timelines,self.speeders);match result{Ok(v)=>sync.map(|_|v),Err(e)=>{let _=sync;Err(e)}}
 }
 fn rust_skill<F>(&mut self,w:&mut unit::World,f:F)->Result where F:FnOnce(&mut skill::World,&mut SkillAdapter<'_,H>)->skill::Result{import_units(w,self.timelines,self.speeders)?;let result=f(self.timelines,&mut SkillAdapter{units:w,speeders:self.speeders,host:self.host}).map_err(skill_error);let sync=export_units(w,self.timelines,self.speeders);result.and(sync)}
}
impl<H:Hooks> unit::Hooks for UnitAdapter<'_,H>{
 fn terminate(&mut self,w:&mut unit::World,id:usize)->Result{done(self.call(w,UnitCall::Terminate{unit:id})?)}
 fn debug_checks(&mut self,w:&mut unit::World,id:usize)->Result{done(self.call(w,UnitCall::DebugChecks{unit:id})?)}
 fn action_finished(&mut self,w:&mut unit::World,id:usize)->Result{done(self.call(w,UnitCall::ActionFinished{unit:id})?)}
 fn add_buff(&mut self,w:&mut unit::World,id:usize,tid:u32,caster:usize)->Result<Option<usize>>{if let Reply::Buff(v)=self.call(w,UnitCall::AddBuff{unit:id,tid,caster})?{Ok(v)}else{Err("host reply must be Buff".into())}}
 fn is_turn_based(&mut self,w:&mut unit::World,id:usize)->Result<bool>{boolean(self.call(w,UnitCall::IsTurnBased{unit:id})?)}
 fn fall(&mut self,w:&mut unit::World,id:usize)->Result{done(self.call(w,UnitCall::Fall{unit:id})?)}
 fn stage_rect(&mut self,w:&mut unit::World)->Result<unit::Rect>{if let Reply::Rect(v)=self.call(w,UnitCall::StageRect)?{Ok(v)}else{Err("host reply must be Rect".into())}}
 fn skill_is_basic(&mut self,w:&mut unit::World,skill:usize)->Result<bool>{boolean(self.call(w,UnitCall::SkillIsBasic{skill})?)}
 fn update_skill(&mut self,w:&mut unit::World,skill:usize,action_dt:f64,cd_dt:f64,raw_dt:f64)->Result{match self.call(w,UnitCall::UpdateSkill{skill,action_dt,cd_dt,raw_dt})?{Reply::UseRustSkill=>self.rust_skill(w,|s,h|s.update(skill::SkillId(skill),action_dt,cd_dt,raw_dt,h)),Reply::Done=>Ok(()),_=>Err("update_skill requires UseRustSkill or completed override".into())}}
 fn phase_finished(&mut self,w:&mut unit::World,skill:usize)->Result{match self.call(w,UnitCall::PhaseFinished{skill})?{Reply::UseRustSkill=>self.rust_skill(w,|s,h|s.on_phase_finished(skill::SkillId(skill),h)),Reply::Done=>Ok(()),_=>Err("phase_finished requires UseRustSkill or completed override".into())}}
 fn cast_when_controlled(&mut self,w:&mut unit::World,id:usize)->Result{done(self.call(w,UnitCall::CastWhenControlled{unit:id})?)}
 fn update_ai(&mut self,w:&mut unit::World,id:usize,dt:f64)->Result{done(self.call(w,UnitCall::UpdateAi{unit:id,dt})?)}
 fn is_pet(&mut self,w:&mut unit::World,id:usize)->Result<bool>{boolean(self.call(w,UnitCall::IsPet{unit:id})?)}
 fn recheck_manual(&mut self,w:&mut unit::World,id:usize)->Result{done(self.call(w,UnitCall::RecheckManual{unit:id})?)}
 fn buff_has_effect(&mut self,w:&mut unit::World,buff:usize,effect:&str)->Result<bool>{boolean(self.call(w,UnitCall::BuffHasEffect{buff,effect})?)}
 fn update_buff(&mut self,w:&mut unit::World,buff:usize,dt:f64)->Result{done(self.call(w,UnitCall::UpdateBuff{buff,dt})?)}
 fn transfer_mp_target(&mut self,w:&mut unit::World,id:usize)->Result<usize>{match self.call(w,UnitCall::TransferMpTarget{unit:id})?{Reply::Unit(v)=>Ok(v),Reply::UseRustResource=>self.resource(w,|w,h|crate::unit_resources::transfer_mp_target(w,id,h))?.value().ok_or_else(||"source transferred MP target is null/undefined".into()),_=>Err("host reply must be Unit or UseRustResource".into())}}
 fn set_mp(&mut self,w:&mut unit::World,id:usize,value:f64,source:usize)->Result{match self.call(w,UnitCall::SetMp{unit:id,value,source})?{Reply::UseRustResource=>self.resource(w,|w,h|crate::unit_resources::set_mp(w,id,value,h)),other=>done(other)}}
 fn buff_hpr_damage(&mut self,w:&mut unit::World,buff:usize,dt:f64)->Result{done(self.call(w,UnitCall::BuffHprDamage{buff,dt})?)}
 fn transfer_hp_target(&mut self,w:&mut unit::World,id:usize)->Result<usize>{match self.call(w,UnitCall::TransferHpTarget{unit:id})?{Reply::Unit(v)=>Ok(v),Reply::UseRustResource=>self.resource(w,|w,h|crate::unit_resources::transfer_heal_target(w,id,h))?.value().ok_or_else(||"source transferred heal target is null/undefined".into()),_=>Err("host reply must be Unit or UseRustResource".into())}}
 fn set_hp(&mut self,w:&mut unit::World,id:usize,value:f64)->Result{match self.call(w,UnitCall::SetHp{unit:id,value})?{Reply::UseRustResource=>self.resource(w,|w,h|crate::unit_resources::set_hp(w,id,value,h)),other=>done(other)}}
 fn add_restore(&mut self,w:&mut unit::World,id:usize,value:f64)->Result{done(self.call(w,UnitCall::AddRestore{unit:id,value})?)}
 fn fix_position(&mut self,w:&mut unit::World,position:Vec2Id)->Result<Vec2Id>{if let Reply::Vector(v)=self.call(w,UnitCall::FixPosition{position})?{Ok(v)}else{Err("host reply must be Vector".into())}}
}
struct SkillAdapter<'a,H>{units:&'a mut unit::World,speeders:&'a mut Vec<skill::Number>,host:&'a mut H}
impl<H:Hooks> SkillAdapter<'_,H>{
 fn call(&mut self,w:&mut skill::World,event:SkillCall<'_>)->skill::Result<Reply>{export_units(self.units,w,self.speeders).map_err(skill::Error::Host)?;let result=self.host.skill(&mut Context{units:self.units,timelines:w,info_speeders:self.speeders},event);let sync=import_units(self.units,w,self.speeders);match result{Ok(v)=>sync.map(|_|v).map_err(skill::Error::Host),Err(e)=>{let _=sync;Err(skill::Error::Host(e))}}}
 fn done(&mut self,w:&mut skill::World,event:SkillCall<'_>)->skill::Result{done(self.call(w,event)?).map_err(skill::Error::Host)}
}
impl<H:Hooks> skill::Hooks for SkillAdapter<'_,H>{
 fn update_tb(&mut self,w:&mut skill::World,skill:skill::SkillId,action_dt:f64,cd_dt:f64,raw_dt:f64)->skill::Result{self.done(w,SkillCall::UpdateTb{skill,action_dt,cd_dt,raw_dt})}
 fn check_region(&mut self,w:&mut skill::World,skill:skill::SkillId)->skill::Result{self.done(w,SkillCall::CheckRegion{skill})}
 fn unfreeze(&mut self,w:&mut skill::World)->skill::Result{self.done(w,SkillCall::Unfreeze)}
 fn on_attack_frame(&mut self,w:&mut skill::World,skill:skill::SkillId)->skill::Result{self.done(w,SkillCall::AttackFrame{skill})}
 fn get_unit_scale(&mut self,w:&mut skill::World,unit:skill::UnitId)->skill::Result<f64>{number(self.call(w,SkillCall::UnitScale{unit})?).map_err(skill::Error::Host)}
 fn lookup_launch_sound(&mut self,w:&mut skill::World,effect:&str)->skill::Result<Option<String>>{if let Reply::Text(v)=self.call(w,SkillCall::LaunchSound{effect})?{Ok(v)}else{Err(skill::Error::Host("host reply must be Text".into()))}}
 fn add_effect(&mut self,w:&mut skill::World,actor:usize,effect:&str,z:f64,offset:[f64;2])->skill::Result{self.done(w,SkillCall::AddEffect{actor,effect,z,offset})}
 fn play_effect(&mut self,w:&mut skill::World,sound:&str)->skill::Result{self.done(w,SkillCall::PlayEffect{sound})}
 fn interrupt(&mut self,w:&mut skill::World,skill:skill::SkillId)->skill::Result{match self.call(w,SkillCall::Interrupt{skill})?{Reply::UseRustSkill=>w.interrupt(skill,self),Reply::Done=>Ok(()),_=>Err(skill::Error::Host("interrupt requires UseRustSkill or completed override".into()))}}
 fn set_action(&mut self,w:&mut skill::World,skill:skill::SkillId,action:&str)->skill::Result{self.done(w,SkillCall::SetAction{skill,action})}
 fn finish(&mut self,w:&mut skill::World,skill:skill::SkillId)->skill::Result{match self.call(w,SkillCall::Finish{skill})?{Reply::UseRustSkill=>w.finish(skill,self),Reply::Done=>Ok(()),_=>Err(skill::Error::Host("finish requires UseRustSkill or completed override".into()))}}
 fn select_target(&mut self,w:&mut skill::World,skill:skill::SkillId,target:skill::Reference<skill::UnitId>)->skill::Result{self.done(w,SkillCall::SelectTarget{skill,target})}
 fn fix_enemy_cd(&mut self,w:&mut skill::World,skill:skill::SkillId,cd:f64)->skill::Result<f64>{number(self.call(w,SkillCall::FixEnemyCd{skill,cd})?).map_err(skill::Error::Host)}
 fn log_skill_start(&mut self,w:&mut skill::World,skill:skill::SkillId)->skill::Result{self.done(w,SkillCall::LogStart{skill})}
 fn skill_start_event(&mut self,w:&mut skill::World,caster:skill::UnitId,skill:skill::SkillId)->skill::Result{self.done(w,SkillCall::StartEvent{caster,skill})}
 fn is_pet(&mut self,w:&mut skill::World,unit:skill::UnitId)->skill::Result<bool>{boolean(self.call(w,SkillCall::IsPet{unit})?).map_err(skill::Error::Host)}
 fn set_pet_mp(&mut self,w:&mut skill::World,unit:skill::UnitId,mp:f64)->skill::Result{self.done(w,SkillCall::SetPetMp{unit,mp})}
 fn set_mp(&mut self,w:&mut skill::World,unit:skill::UnitId,mp:f64,source:skill::UnitId)->skill::Result{match self.call(w,SkillCall::SetMp{unit,mp,source})?{Reply::UseRustResource=>{
   let result=crate::unit_resources::set_mp(self.units,unit.0,mp,&mut ResourceAdapter{timelines:w,speeders:self.speeders,host:self.host});
   let sync=import_units(self.units,w,self.speeders);result.and(sync).map_err(skill::Error::Host)
  },other=>done(other).map_err(skill::Error::Host)}}
 fn set_pet_cast_skill(&mut self,w:&mut skill::World,value:bool)->skill::Result{self.done(w,SkillCall::SetPetCastSkill{value})}
 fn idle(&mut self,w:&mut skill::World,unit:skill::UnitId)->skill::Result{self.done(w,SkillCall::Idle{unit})}
 fn skill_finish_event(&mut self,w:&mut skill::World,caster:skill::UnitId,skill:skill::SkillId)->skill::Result{self.done(w,SkillCall::FinishEvent{caster,skill})}
}

struct ResourceAdapter<'a,H>{timelines:&'a mut skill::World,speeders:&'a mut Vec<skill::Number>,host:&'a mut H}
impl<H:Hooks> ResourceAdapter<'_,H>{
 fn call(&mut self,w:&mut unit::World,event:ResourceCall)->Result<Reply>{import_units(w,self.timelines,self.speeders)?;let result=self.host.resource(&mut Context{units:w,timelines:self.timelines,info_speeders:self.speeders},event);let sync=import_units(w,self.timelines,self.speeders);match result{Ok(v)=>sync.map(|_|v),Err(e)=>{let _=sync;Err(e)}}}
}
impl<H:Hooks> crate::unit_resources::Hooks for ResourceAdapter<'_,H>{
 fn max_mp(&mut self,w:&mut unit::World,unit:usize)->Result<f64>{number(self.call(w,ResourceCall::MaxMp{unit})?)}
 fn no_add_mp(&mut self,w:&mut unit::World,unit:usize)->Result<bool>{boolean(self.call(w,ResourceCall::NoAddMp{unit})?)}
 fn log_mp(&mut self,w:&mut unit::World,unit:usize)->Result{done(self.call(w,ResourceCall::LogMp{unit})?)}
 fn max_hp(&mut self,w:&mut unit::World,unit:usize)->Result<f64>{number(self.call(w,ResourceCall::MaxHp{unit})?)}
 fn ticks(&mut self,w:&mut unit::World)->Result<f64>{number(self.call(w,ResourceCall::Ticks)?)}
 fn set_last_hp_change_tick(&mut self,w:&mut unit::World,unit:usize,tick:f64)->Result{done(self.call(w,ResourceCall::SetLastHpChangeTick{unit,tick})?)}
 fn log_hp(&mut self,w:&mut unit::World,unit:usize)->Result{done(self.call(w,ResourceCall::LogHp{unit})?)}
 fn transfer_heal_enabled(&mut self,w:&mut unit::World,unit:usize)->Result<bool>{boolean(self.call(w,ResourceCall::TransferHealEnabled{unit})?)}
 fn transfer_heal_target(&mut self,w:&mut unit::World,unit:usize)->Result<skill::Reference<usize>>{if let Reply::UnitReference(v)=self.call(w,ResourceCall::TransferHealTarget{unit})?{Ok(v)}else{Err("host reply must be UnitReference".into())}}
 fn transfer_mp_enabled(&mut self,w:&mut unit::World,unit:usize)->Result<bool>{boolean(self.call(w,ResourceCall::TransferMpEnabled{unit})?)}
 fn transfer_mp_target(&mut self,w:&mut unit::World,unit:usize)->Result<skill::Reference<usize>>{if let Reply::UnitReference(v)=self.call(w,ResourceCall::TransferMpTarget{unit})?{Ok(v)}else{Err("host reply must be UnitReference".into())}}
}
