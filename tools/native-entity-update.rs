//! Scalar arithmetic for an opt-in Entity VM block. Canonical state stays in JS.
#[path = "../crates/battle-core/src/js_math.rs"]
mod js_math;
#[unsafe(no_mangle)]
pub extern "C" fn battle_entity_component(position: f64, velocity: f64, dt: f64) -> f64 {
    js_math::add(position, js_math::mul(velocity, dt))
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_entity_should_flip(velocity: f64, direction: f64) -> u8 {
    u8::from(js_math::mul(velocity, direction) < 0.0)
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_entity_reference_fp_environment() -> u8 {
    u8::from(js_math::reference_fp_environment())
}
