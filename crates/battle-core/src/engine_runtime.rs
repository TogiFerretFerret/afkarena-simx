//! Fallible source-ordered BattleEngine.tick orchestration.
//! Unlike the historical infallible engine::Hooks adapter, each required
//! mechanics call may fail and stops at its original source boundary, retaining
//! prior mutations. No mechanic has a default implementation.
use crate::engine::{Battle, Outcome};
use crate::scheduler::{EntityId, ListId};

pub trait TryHooks<T> {
    type Error;
    fn weather_update(&mut self, battle: &mut Battle<T>, dt: f64) -> Result<(), Self::Error>;
    fn tick_operation(&mut self, battle: &mut Battle<T>) -> Result<(), Self::Error>;
    fn tick_rage_objects(&mut self, battle: &mut Battle<T>, dt: f64) -> Result<(), Self::Error>;
    fn update_entity(&mut self, battle: &mut Battle<T>, id: EntityId, dt: f64) -> Result<(), Self::Error>;
    fn check_victory_time_fix(&mut self, battle: &mut Battle<T>, id: EntityId) -> Result<(), Self::Error>;
    fn check_push(&mut self, battle: &mut Battle<T>, dt: f64) -> Result<(), Self::Error>;
    fn restart(&mut self, battle: &mut Battle<T>) -> Result<(), Self::Error>;
    fn rtpvp_death_limit(&mut self, battle: &mut Battle<T>) -> Result<f64, Self::Error>;
    fn deep_stage_death_limit(&mut self, battle: &mut Battle<T>) -> Result<f64, Self::Error>;
    fn is_halloween_mode(&mut self, battle: &mut Battle<T>, mode: Option<&str>) -> Result<bool, Self::Error>;
    fn check_halloween_end(&mut self, battle: &mut Battle<T>) -> Result<(), Self::Error>;
    fn uses_max_ticks(&mut self, battle: &mut Battle<T>, mode: Option<&str>) -> Result<bool, Self::Error>;
    fn max_ticks(&mut self, battle: &mut Battle<T>, mode: Option<&str>) -> Result<f64, Self::Error>;
    fn on_battle_end(&mut self, battle: &mut Battle<T>, outcome: Outcome) -> Result<(), Self::Error>;
    fn format_log(&mut self, battle: &mut Battle<T>) -> Result<String, Self::Error>;
    fn append_log(&mut self, battle: &mut Battle<T>, log: &str) -> Result<(), Self::Error>;
}
#[inline]
fn truthy(value: f64) -> bool { value != 0.0 && !value.is_nan() }
fn append_tick_log<T, H: TryHooks<T>>(battle: &mut Battle<T>, hooks: &mut H) -> Result<(), H::Error> {
    let text = hooks.format_log(battle)?;
    hooks.append_log(battle, &text)
}

pub fn try_tick<T, H: TryHooks<T>>(battle: &mut Battle<T>, hooks: &mut H) -> Result<(), H::Error> {
        if !battle.running { return Ok(()); }
        if !(battle.freeze_level>0.0 || battle.ignore_level>0.0) {
            battle.time_limit-=battle.tick_interval;
            hooks.weather_update(battle,battle.tick_interval)?;
            // Read AFTER weatherUpdate; that call may change interval or special limit.
            if let Some(limit)=battle.special_time_limit {
                if truthy(limit) { battle.special_time_limit=Some(limit-battle.tick_interval); }
            }
        }
        hooks.tick_operation(battle)?;
        hooks.tick_rage_objects(battle,battle.tick_interval)?;
        let group_count=battle.entities.groups.len();
        for group in 0..group_count {
            let list=battle.entities.groups[group];
            let mut length=battle.entities.lists[list.0].len();
            let mut index=0;
            while index<length {
                let id=battle.entities.lists[list.0][index];
                if !battle.entities.entities[id.0].frozen {
                    hooks.update_entity(battle,id,battle.tick_interval)?;
                    if &*battle.mode=="race_dream" { hooks.check_victory_time_fix(battle,id)?; }
                }
                length=battle.entities.lists[list.0].len();
                index+=1;
            }
            let filtered=battle.entities.lists[list.0][..length].iter().copied()
                .filter(|id|!battle.entities.entities[id.0].terminated).collect();
            let new_list=ListId(battle.entities.lists.len());
            battle.entities.lists.push(filtered);
            battle.entities.groups[group]=new_list;
        }
        hooks.check_push(battle,battle.tick_interval)?;
        battle.ticks+=1.0;
        if battle.will_restart_game {
            battle.will_restart_game=false;
            hooks.restart(battle)?;
        }
        // The source caches config.mode before computing time remaining.
        let mode=battle.config_mode.clone();
        let mode=mode.as_deref();
        let timeout=battle.time_limit+battle.time_skill_add<=0.0;
        if mode==Some("rt_pvp") {
            if !battle.limit_dead_count.is_some_and(truthy) {
                battle.limit_dead_count=Some(hooks.rtpvp_death_limit(battle)?);
            }
            let limit=battle.limit_dead_count.unwrap_or(f64::NAN);
            if battle.enemy_hero_dead_count>=limit { hooks.on_battle_end(battle,Outcome::Victory)?; }
            else if battle.player_hero_dead_count>=limit { hooks.on_battle_end(battle,Outcome::Defeat)?; }
            else if timeout { hooks.on_battle_end(battle,Outcome::Timeout)?; }
        } else if mode==Some("deep_stage") {
            let limit=hooks.deep_stage_death_limit(battle)?;
            if battle.alive_enemy_count<=0.0 && battle.player_hero_dead_count<=limit {
                hooks.on_battle_end(battle,Outcome::Victory)?;
            } else if battle.player_hero_dead_count>limit || battle.alive_player_count<=0.0 {
                hooks.on_battle_end(battle,Outcome::Defeat)?;
            } else if timeout { hooks.on_battle_end(battle,Outcome::Timeout)?; }
        } else if hooks.is_halloween_mode(battle,mode)? {
            hooks.check_halloween_end(battle)?;
        } else {
            let maximum=if hooks.uses_max_ticks(battle,mode)? {
                let value=hooks.max_ticks(battle,mode)?;
                Some(if truthy(value){value}else{4800.0})
            } else { None };
            if maximum.is_some_and(|maximum|maximum>0.0 && battle.ticks>=maximum) {
                hooks.on_battle_end(battle,Outcome::Defeat)?;
                append_tick_log(battle,hooks)?;
                return Ok(());
            }
            if battle.alive_enemy_count<=0.0 { hooks.on_battle_end(battle,Outcome::Victory)?; }
            else if battle.alive_player_count<=0.0 { hooks.on_battle_end(battle,Outcome::Defeat)?; }
            else if timeout { hooks.on_battle_end(battle,Outcome::Timeout)?; }
        }
        append_tick_log(battle,hooks)?;
        Ok(())
}

/// A scheduler record's `frozen` projects the source entity's `frozen_model`.
/// Unit records therefore share that field with canonical Unit state. Terminated
/// remains a distinct source flag and is never inferred from HP or Unit::state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntityDispatch { Unit(usize), External(usize) }
#[derive(Clone, Copy, Debug)]
pub enum EngineCall<'a> {
 Weather{dt:f64}, Operation, RageObjects{dt:f64},
 UpdateUnit{entity:EntityId,unit:usize,dt:f64}, UpdateExternal{entity:EntityId,token:usize,dt:f64},
 RaceFix{entity:EntityId}, Push{dt:f64}, Restart, RtDeathLimit, DeepDeathLimit,
 IsHalloween{mode:Option<&'a str>}, HalloweenEnd, UsesMaxTicks{mode:Option<&'a str>},
 MaxTicks{mode:Option<&'a str>}, End{outcome:Outcome}, FormatLog, AppendLog{text:&'a str},
}
pub enum EngineReply { Done, Bool(bool), Number(f64), Text(String), UseRustUnit }
use crate::unit_skill_runtime::{self as mechanics, Context, UnitCall, SkillCall, ResourceCall, Reply};
pub type RuntimeResult<T=()> = Result<T,String>;

/// Required host dispatch. Unit/skill overrides and all remaining mechanics are
/// explicit; the Rust base Unit controller is selected only by UseRustUnit.
pub trait RuntimeHooks {
 fn engine(&mut self,context:&mut DriverContext<'_, '_>,call:EngineCall<'_>)->RuntimeResult<EngineReply>;
 fn unit(&mut self,context:&mut DriverContext<'_, '_>,call:UnitCall<'_>)->RuntimeResult<Reply>;
 fn resource(&mut self,context:&mut DriverContext<'_, '_>,call:ResourceCall)->RuntimeResult<Reply>;
 fn skill(&mut self,context:&mut DriverContext<'_, '_>,call:SkillCall<'_>)->RuntimeResult<Reply>;
}

/// Hosts have one mutable view at a time. `with_engine` commits pending mechanic
/// state before engine mutations, then imports those writes. Direct mechanic
/// mutations are committed on the next engine read or on callback exit, including
/// errors. This avoids exposing independently writable copies of shared fields.
pub struct DriverContext<'a,'b> {
 battle:&'a mut Battle<EntityDispatch>, mechanics:&'a mut Context<'b>,
}
impl<'a,'b> DriverContext<'a,'b> {
 pub fn engine(&mut self)->RuntimeResult<&Battle<EntityDispatch>> {export_shared(self.battle,self.mechanics)?;Ok(self.battle)}
 pub fn with_engine<R>(&mut self,f:impl FnOnce(&mut Battle<EntityDispatch>)->R)->RuntimeResult<R> {
  export_shared(self.battle,self.mechanics)?;
  let value=f(self.battle);
  import_shared(self.battle,self.mechanics)?;
  Ok(value)
 }
 pub fn mechanics(&mut self)->&mut Context<'b>{self.mechanics}
}
fn validate_mapping(battle:&Battle<EntityDispatch>,context:&Context<'_>)->RuntimeResult {
 let mut seen=vec![false;context.unit_records().len()];
 for record in &battle.entities.entities {
  if let EntityDispatch::Unit(unit)=record.data {
   let slot=seen.get_mut(unit).ok_or_else(||"scheduler unit handle out of range".to_string())?;
   if *slot{return Err("duplicate scheduler record for one canonical unit".into())}
   *slot=true;
  }
 }
 Ok(())
}
fn import_shared(battle:&Battle<EntityDispatch>,context:&mut Context<'_>)->RuntimeResult {
 validate_mapping(battle,context)?;
 *context.freeze_level_mut()=battle.freeze_level;
 // getMode() returns engine.mode, not config.mode (which outcome selection uses).
 context.set_mode(battle.mode.to_string());
 for record in &battle.entities.entities {if let EntityDispatch::Unit(unit)=record.data {context.unit_mut(unit)?.frozen_model=record.frozen}}
 Ok(())
}
fn export_shared(battle:&mut Battle<EntityDispatch>,context:&mut Context<'_>)->RuntimeResult {
 validate_mapping(battle,context)?;
 battle.freeze_level=context.freeze_level();
 battle.mode=std::sync::Arc::from(context.mode());
 for record in &mut battle.entities.entities {if let EntityDispatch::Unit(unit)=record.data {record.frozen=context.unit_records()[unit].frozen_model}}
 Ok(())
}
fn keep_error<T>(result:RuntimeResult<T>,sync:RuntimeResult)->RuntimeResult<T> {
 match result {Ok(v)=>sync.map(|_|v),Err(error)=>Err(error)}
}
pub struct Driver { battle:Battle<EntityDispatch>, mechanics:mechanics::Runtime }
impl Driver {
 pub fn new(battle:Battle<EntityDispatch>,mut mechanics:mechanics::Runtime)->RuntimeResult<Self>{
  let mut context=mechanics.context();
  validate_mapping(&battle,&context)?;
  // Inputs describe the same source objects, so reject contradictory initial
  // frozen projections instead of silently choosing one object's value.
  for record in &battle.entities.entities {if let EntityDispatch::Unit(unit)=record.data {if record.frozen!=context.unit_records()[unit].frozen_model{return Err("inconsistent initial frozen_model projections".into())}}}
  import_shared(&battle,&mut context)?;
  Ok(Self{battle,mechanics})
 }
 pub fn battle(&self)->&Battle<EntityDispatch>{&self.battle}
 pub fn inspect<R>(&mut self,f:impl FnOnce(&Battle<EntityDispatch>,&crate::unit::World,&crate::skill::World)->R)->RuntimeResult<R>{
  self.mechanics.inspect(|units,timelines|f(&self.battle,units,timelines))
 }
 pub fn tick<H:RuntimeHooks>(&mut self,host:&mut H)->RuntimeResult {
  let result=try_tick(&mut self.battle,&mut DriverAdapter{mechanics:&mut self.mechanics,host});
  let sync=import_shared(&self.battle,&mut self.mechanics.context());
  keep_error(result,sync)
 }
 /// The source host decides when its client queue is drained; a tick does not
 /// automatically drain callbacks earlier than that boundary.
 pub fn drain_callbacks<H:RuntimeHooks>(&mut self,host:&mut H)->RuntimeResult {
  import_shared(&self.battle,&mut self.mechanics.context())?;
  let result=self.mechanics.drain_callbacks(&mut MechanicsAdapter{battle:&mut self.battle,host});
  let sync=export_shared(&mut self.battle,&mut self.mechanics.context());
  keep_error(result,sync)
 }
}
struct DriverAdapter<'a,H>{mechanics:&'a mut mechanics::Runtime,host:&'a mut H}
impl<H:RuntimeHooks> DriverAdapter<'_,H>{
 fn call(&mut self,battle:&mut Battle<EntityDispatch>,event:EngineCall<'_>)->RuntimeResult<EngineReply>{
  let mut context=self.mechanics.context();import_shared(battle,&mut context)?;
  let result=self.host.engine(&mut DriverContext{battle,mechanics:&mut context},event);
  let sync=export_shared(battle,&mut context);keep_error(result,sync)
 }
}
fn engine_done(reply:EngineReply)->RuntimeResult {if matches!(reply,EngineReply::Done){Ok(())}else{Err("engine host reply must be Done".into())}}
fn engine_number(reply:EngineReply)->RuntimeResult<f64>{if let EngineReply::Number(v)=reply{Ok(v)}else{Err("engine host reply must be Number".into())}}
fn engine_bool(reply:EngineReply)->RuntimeResult<bool>{if let EngineReply::Bool(v)=reply{Ok(v)}else{Err("engine host reply must be Bool".into())}}
impl<H:RuntimeHooks> TryHooks<EntityDispatch> for DriverAdapter<'_,H>{
 type Error=String;
 fn weather_update(&mut self,b:&mut Battle<EntityDispatch>,dt:f64)->RuntimeResult{engine_done(self.call(b,EngineCall::Weather{dt})?)}
 fn tick_operation(&mut self,b:&mut Battle<EntityDispatch>)->RuntimeResult{engine_done(self.call(b,EngineCall::Operation)?)}
 fn tick_rage_objects(&mut self,b:&mut Battle<EntityDispatch>,dt:f64)->RuntimeResult{engine_done(self.call(b,EngineCall::RageObjects{dt})?)}
 fn update_entity(&mut self,b:&mut Battle<EntityDispatch>,entity:EntityId,dt:f64)->RuntimeResult {
  match b.entities.entities[entity.0].data {
   EntityDispatch::External(token)=>engine_done(self.call(b,EngineCall::UpdateExternal{entity,token,dt})?),
   EntityDispatch::Unit(unit)=>match self.call(b,EngineCall::UpdateUnit{entity,unit,dt})? {
    EngineReply::Done=>Ok(()),
    EngineReply::UseRustUnit=>{
     import_shared(b,&mut self.mechanics.context())?;
     let result=self.mechanics.update_unit(unit,dt,&mut MechanicsAdapter{battle:b,host:self.host});
     let sync=export_shared(b,&mut self.mechanics.context());keep_error(result,sync)
    },
    _=>Err("unit update requires Rust base selection or completed override".into()),
   },
  }
 }
 fn check_victory_time_fix(&mut self,b:&mut Battle<EntityDispatch>,entity:EntityId)->RuntimeResult{engine_done(self.call(b,EngineCall::RaceFix{entity})?)}
 fn check_push(&mut self,b:&mut Battle<EntityDispatch>,dt:f64)->RuntimeResult{engine_done(self.call(b,EngineCall::Push{dt})?)}
 fn restart(&mut self,b:&mut Battle<EntityDispatch>)->RuntimeResult{engine_done(self.call(b,EngineCall::Restart)?)}
 fn rtpvp_death_limit(&mut self,b:&mut Battle<EntityDispatch>)->RuntimeResult<f64>{engine_number(self.call(b,EngineCall::RtDeathLimit)?)}
 fn deep_stage_death_limit(&mut self,b:&mut Battle<EntityDispatch>)->RuntimeResult<f64>{engine_number(self.call(b,EngineCall::DeepDeathLimit)?)}
 fn is_halloween_mode(&mut self,b:&mut Battle<EntityDispatch>,mode:Option<&str>)->RuntimeResult<bool>{engine_bool(self.call(b,EngineCall::IsHalloween{mode})?)}
 fn check_halloween_end(&mut self,b:&mut Battle<EntityDispatch>)->RuntimeResult{engine_done(self.call(b,EngineCall::HalloweenEnd)?)}
 fn uses_max_ticks(&mut self,b:&mut Battle<EntityDispatch>,mode:Option<&str>)->RuntimeResult<bool>{engine_bool(self.call(b,EngineCall::UsesMaxTicks{mode})?)}
 fn max_ticks(&mut self,b:&mut Battle<EntityDispatch>,mode:Option<&str>)->RuntimeResult<f64>{engine_number(self.call(b,EngineCall::MaxTicks{mode})?)}
 fn on_battle_end(&mut self,b:&mut Battle<EntityDispatch>,outcome:Outcome)->RuntimeResult{engine_done(self.call(b,EngineCall::End{outcome})?)}
 fn format_log(&mut self,b:&mut Battle<EntityDispatch>)->RuntimeResult<String>{if let EngineReply::Text(v)=self.call(b,EngineCall::FormatLog)?{Ok(v)}else{Err("engine host reply must be Text".into())}}
 fn append_log(&mut self,b:&mut Battle<EntityDispatch>,text:&str)->RuntimeResult{engine_done(self.call(b,EngineCall::AppendLog{text})?)}
}
struct MechanicsAdapter<'a,H>{battle:&'a mut Battle<EntityDispatch>,host:&'a mut H}
impl<H:RuntimeHooks> mechanics::Hooks for MechanicsAdapter<'_,H>{
 fn resource(&mut self,context:&mut Context<'_>,event:ResourceCall)->RuntimeResult<Reply>{
  export_shared(self.battle,context)?;
  let result=self.host.resource(&mut DriverContext{battle:self.battle,mechanics:context},event);
  let sync=export_shared(self.battle,context);keep_error(result,sync)
 }
 fn unit(&mut self,context:&mut Context<'_>,event:UnitCall<'_>)->RuntimeResult<Reply>{
  export_shared(self.battle,context)?;
  let result=self.host.unit(&mut DriverContext{battle:self.battle,mechanics:context},event);
  let sync=export_shared(self.battle,context);keep_error(result,sync)
 }
 fn skill(&mut self,context:&mut Context<'_>,event:SkillCall<'_>)->RuntimeResult<Reply>{
  export_shared(self.battle,context)?;
  let result=self.host.skill(&mut DriverContext{battle:self.battle,mechanics:context},event);
  let sync=export_shared(self.battle,context);keep_error(result,sync)
 }
}
