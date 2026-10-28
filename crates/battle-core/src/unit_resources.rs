//! Base Unit resource methods operating on the existing canonical unit arena.
//!
//! This is the Number-valued, stable-unit-ID domain. Maxima/effects/tick metadata
//! stay with the embedding; every observable metadata read and log call is a
//! required hook. Virtual overrides still require caller-side dispatch.
use crate::unit::{Result, UnitId, World};
use crate::skill::Reference;

pub trait Hooks {
    fn max_mp(&mut self, world: &mut World, unit: UnitId) -> Result<f64>;
    fn no_add_mp(&mut self, world: &mut World, unit: UnitId) -> Result<bool>;
    fn log_mp(&mut self, world: &mut World, unit: UnitId) -> Result;
    fn max_hp(&mut self, world: &mut World, unit: UnitId) -> Result<f64>;
    fn ticks(&mut self, world: &mut World) -> Result<f64>;
    fn set_last_hp_change_tick(&mut self, world: &mut World, unit: UnitId, tick: f64) -> Result;
    fn log_hp(&mut self, world: &mut World, unit: UnitId) -> Result;
    fn transfer_heal_enabled(&mut self, world: &mut World, unit: UnitId) -> Result<bool>;
    fn transfer_heal_target(&mut self, world: &mut World, unit: UnitId) -> Result<Reference<UnitId>>;
    fn transfer_mp_enabled(&mut self, world: &mut World, unit: UnitId) -> Result<bool>;
    fn transfer_mp_target(&mut self, world: &mut World, unit: UnitId) -> Result<Reference<UnitId>>;
}
fn require(world: &World, unit: UnitId) -> Result {
    world.units.get(unit).map(|_| ()).ok_or_else(|| "missing resource unit".into())
}

/// Original setMp ignores its source argument. Do not use Math.min/max: ordered
/// comparisons preserve NaNs, signed zero and the second maximum read on clamp.
pub fn set_mp<H: Hooks>(world: &mut World, unit: UnitId, mut value: f64, hooks: &mut H) -> Result {
    require(world, unit)?;
    if value > hooks.max_mp(world, unit)? { value = hooks.max_mp(world, unit)?; }
    if value < 0.0 { value = 0.0; }
    require(world, unit)?;
    if value > world.units[unit].mp && hooks.no_add_mp(world, unit)? { return Ok(()); }
    require(world, unit)?;
    world.units[unit].mp = value;
    hooks.log_mp(world, unit)
}

/// A log error occurs after the hp assignment and optional tick assignment.
/// NaN !== NaN updates the tick; -0 === +0 does not.
pub fn set_hp<H: Hooks>(world: &mut World, unit: UnitId, mut value: f64, hooks: &mut H) -> Result {
    require(world, unit)?;
    if value > hooks.max_hp(world, unit)? { value = hooks.max_hp(world, unit)?; }
    if value < 0.0 { value = 0.0; }
    require(world, unit)?;
    let old = world.units[unit].hp;
    world.units[unit].hp = value;
    if old != value {
        let tick = hooks.ticks(world)?;
        hooks.set_last_hp_change_tick(world, unit, tick)?;
    }
    hooks.log_hp(world, unit)
}

/// The source reads a truthy related target twice. The second read can return
/// null/undefined after a getter mutation; retain that distinction.
pub fn transfer_heal_target<H: Hooks>(world: &mut World, unit: UnitId, hooks: &mut H) -> Result<Reference<UnitId>> {
    require(world, unit)?;
    if hooks.transfer_heal_enabled(world, unit)? {
        if hooks.transfer_heal_target(world, unit)?.value().is_some() {
            let target = hooks.transfer_heal_target(world, unit)?;
            if let Some(id) = target.value() { require(world, id)?; }
            return Ok(target);
        }
    }
    Ok(Reference::Value(unit))
}

pub fn transfer_mp_target<H: Hooks>(world: &mut World, unit: UnitId, hooks: &mut H) -> Result<Reference<UnitId>> {
    require(world, unit)?;
    if hooks.transfer_mp_enabled(world, unit)? {
        if hooks.transfer_mp_target(world, unit)?.value().is_some() {
            let target = hooks.transfer_mp_target(world, unit)?;
            if let Some(id) = target.value() { require(world, id)?; }
            return Ok(target);
        }
    }
    Ok(Reference::Value(unit))
}
