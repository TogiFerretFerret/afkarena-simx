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
