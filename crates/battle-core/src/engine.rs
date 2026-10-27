//! Control flow of ed.BattleEngine.tick, with explicit calls into battle mechanics.
//! Hooks must implement the corresponding source methods; this is not a complete
//! hero/skill implementation. Numeric counters remain binary64.
use crate::scheduler::{EntityId, ListId, Scheduler};
use std::sync::Arc;

pub struct Battle<T> {
    pub entities: Scheduler<T>,
    pub running: bool,
    pub freeze_level: f64,
    pub ignore_level: f64,
    pub time_limit: f64,
    pub time_skill_add: f64,
    pub special_time_limit: Option<f64>,
    pub tick_interval: f64,
    pub ticks: f64,
    pub will_restart_game: bool,
    pub mode: Arc<str>,
    pub config_mode: Option<Arc<str>>,
    pub limit_dead_count: Option<f64>,
    pub enemy_hero_dead_count: f64,
    pub player_hero_dead_count: f64,
    pub alive_enemy_count: f64,
    pub alive_player_count: f64,
}
impl<T> Default for Battle<T> {
    fn default() -> Self {
        Self { entities: Scheduler::default(), running: false, freeze_level: 0.0,
            ignore_level: 0.0, time_limit: 90.0, time_skill_add: 0.0,
            special_time_limit: None, tick_interval: 1.0/8.0, ticks: 0.0,
            will_restart_game: false, mode: Arc::from("stage"), config_mode: Some(Arc::from("stage")),
            limit_dead_count: None, enemy_hero_dead_count: 0.0, player_hero_dead_count: 0.0,
            alive_enemy_count: 0.0, alive_player_count: 0.0 }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome { Victory, Defeat, Timeout }

/// Each required hook corresponds to an actual source call. No mechanics are
/// silently stubbed: a concrete engine must supply every implementation.
pub trait Hooks<T> {
    fn weather_update(&mut self, battle: &mut Battle<T>, dt: f64);
    fn tick_operation(&mut self, battle: &mut Battle<T>);
    fn tick_rage_objects(&mut self, battle: &mut Battle<T>, dt: f64);
    fn update_entity(&mut self, battle: &mut Battle<T>, id: EntityId, dt: f64);
    fn check_victory_time_fix(&mut self, battle: &mut Battle<T>, id: EntityId);
    fn check_push(&mut self, battle: &mut Battle<T>, dt: f64);
    fn restart(&mut self, battle: &mut Battle<T>);
    fn rtpvp_death_limit(&mut self, battle: &mut Battle<T>) -> f64;
    fn deep_stage_death_limit(&mut self, battle: &mut Battle<T>) -> f64;
    fn is_halloween_mode(&mut self, battle: &mut Battle<T>, mode: Option<&str>) -> bool;
    fn check_halloween_end(&mut self, battle: &mut Battle<T>);
    fn uses_max_ticks(&mut self, battle: &mut Battle<T>, mode: Option<&str>) -> bool;
    fn max_ticks(&mut self, battle: &mut Battle<T>, mode: Option<&str>) -> f64;
    fn on_battle_end(&mut self, battle: &mut Battle<T>, outcome: Outcome);
    fn format_log(&mut self, battle: &mut Battle<T>) -> String;
    fn append_log(&mut self, battle: &mut Battle<T>, log: &str);
}
#[inline]
fn truthy(value: f64) -> bool { value != 0.0 && !value.is_nan() }
impl<T> Battle<T> {
    #[inline]
    fn append_tick_log<H: Hooks<T>>(&mut self, hooks: &mut H) {
        let text=hooks.format_log(self);
        hooks.append_log(self,&text);
    }

    pub fn tick<H: Hooks<T>>(&mut self, hooks: &mut H) {
        if !self.running { return; }
        if !(self.freeze_level>0.0 || self.ignore_level>0.0) {
            self.time_limit-=self.tick_interval;
            hooks.weather_update(self,self.tick_interval);
            // Read AFTER weatherUpdate; that call may change interval or special limit.
            if let Some(limit)=self.special_time_limit {
                if truthy(limit) { self.special_time_limit=Some(limit-self.tick_interval); }
            }
        }
        hooks.tick_operation(self);
        hooks.tick_rage_objects(self,self.tick_interval);
        let group_count=self.entities.groups.len();
        for group in 0..group_count {
            let list=self.entities.groups[group];
            let mut length=self.entities.lists[list.0].len();
            let mut index=0;
            while index<length {
                let id=self.entities.lists[list.0][index];
                if !self.entities.entities[id.0].frozen {
                    hooks.update_entity(self,id,self.tick_interval);
                    if &*self.mode=="race_dream" { hooks.check_victory_time_fix(self,id); }
                }
                length=self.entities.lists[list.0].len();
                index+=1;
            }
            let filtered=self.entities.lists[list.0][..length].iter().copied()
                .filter(|id|!self.entities.entities[id.0].terminated).collect();
            let new_list=ListId(self.entities.lists.len());
            self.entities.lists.push(filtered);
            self.entities.groups[group]=new_list;
        }
        hooks.check_push(self,self.tick_interval);
        self.ticks+=1.0;
        if self.will_restart_game {
            self.will_restart_game=false;
            hooks.restart(self);
        }
        // The source caches config.mode before computing time remaining.
        let mode=self.config_mode.clone();
        let mode=mode.as_deref();
        let timeout=self.time_limit+self.time_skill_add<=0.0;
        if mode==Some("rt_pvp") {
            if !self.limit_dead_count.is_some_and(truthy) {
                self.limit_dead_count=Some(hooks.rtpvp_death_limit(self));
            }
            let limit=self.limit_dead_count.unwrap_or(f64::NAN);
            if self.enemy_hero_dead_count>=limit { hooks.on_battle_end(self,Outcome::Victory); }
            else if self.player_hero_dead_count>=limit { hooks.on_battle_end(self,Outcome::Defeat); }
            else if timeout { hooks.on_battle_end(self,Outcome::Timeout); }
        } else if mode==Some("deep_stage") {
            let limit=hooks.deep_stage_death_limit(self);
            if self.alive_enemy_count<=0.0 && self.player_hero_dead_count<=limit {
                hooks.on_battle_end(self,Outcome::Victory);
            } else if self.player_hero_dead_count>limit || self.alive_player_count<=0.0 {
                hooks.on_battle_end(self,Outcome::Defeat);
            } else if timeout { hooks.on_battle_end(self,Outcome::Timeout); }
        } else if hooks.is_halloween_mode(self,mode) {
            hooks.check_halloween_end(self);
        } else {
            let maximum=if hooks.uses_max_ticks(self,mode) {
                let value=hooks.max_ticks(self,mode);
                Some(if truthy(value){value}else{4800.0})
            } else { None };
            if maximum.is_some_and(|maximum|maximum>0.0 && self.ticks>=maximum) {
                hooks.on_battle_end(self,Outcome::Defeat);
                self.append_tick_log(hooks);
                return;
            }
            if self.alive_enemy_count<=0.0 { hooks.on_battle_end(self,Outcome::Victory); }
            else if self.alive_player_count<=0.0 { hooks.on_battle_end(self,Outcome::Defeat); }
            else if timeout { hooks.on_battle_end(self,Outcome::Timeout); }
        }
        self.append_tick_log(hooks);
    }
}
