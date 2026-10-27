//! Isolated scalar bridge prototype. The caller retains canonical JS state.
use std::sync::atomic::{AtomicUsize, Ordering};
static CALLS: AtomicUsize = AtomicUsize::new(0);
#[path = "../crates/battle-core/src/numeric.rs"]
mod numeric;
#[path = "../crates/battle-core/src/js_math.rs"]
mod js_math;
static VECTOR_CALLS: [AtomicUsize;4] = [const { AtomicUsize::new(0) };4];

#[unsafe(no_mangle)]
pub extern "C" fn battle_compare_float(a: f64, b: f64, operator: u32) -> u8 {
    CALLS.fetch_add(1, Ordering::Relaxed);
    let a = (10000.0 * a).floor();
    let b = (10000.0 * b).floor();
    u8::from(match operator { 0 => a > b, 1 => a >= b, 2 => a < b, 3 => a <= b, 4 => a == b, _ => unreachable!() })
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_compare_float_hits() -> usize { CALLS.load(Ordering::Relaxed) }

#[inline]
fn record_vector(index:usize,value:f64)->f64 {
    if !value.is_nan() { VECTOR_CALLS[index].fetch_add(1,Ordering::Relaxed); }
    value
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_vec_distance_sq(ax:f64,ay:f64,bx:f64,by:f64)->f64 {
    record_vector(0,numeric::distance_squared([ax,ay],[bx,by]))
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_vec_length_sq(x:f64,y:f64)->f64 {
    record_vector(1,numeric::length_squared([x,y]))
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_vec_dot(ax:f64,ay:f64,bx:f64,by:f64)->f64 {
    record_vector(2,numeric::dot([ax,ay],[bx,by]))
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_vec_cross(ax:f64,ay:f64,bx:f64,by:f64)->f64 {
    record_vector(3,numeric::cross([ax,ay],[bx,by]))
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_vector_hits(index:u32)->usize {
    VECTOR_CALLS.get(index as usize).map_or(0,|count|count.load(Ordering::Relaxed))
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_reference_fp_environment()->u8 { u8::from(js_math::reference_fp_environment()) }
