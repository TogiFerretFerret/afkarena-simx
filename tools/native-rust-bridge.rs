//! Isolated scalar bridge prototype. The caller retains canonical JS state.
use std::sync::atomic::{AtomicUsize, Ordering};
static CALLS: AtomicUsize = AtomicUsize::new(0);

#[unsafe(no_mangle)]
pub extern "C" fn battle_compare_float(a: f64, b: f64, operator: u32) -> u8 {
    CALLS.fetch_add(1, Ordering::Relaxed);
    let a = (10000.0 * a).floor();
    let b = (10000.0 * b).floor();
    u8::from(match operator { 0 => a > b, 1 => a >= b, 2 => a < b, 3 => a <= b, 4 => a == b, _ => unreachable!() })
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_compare_float_hits() -> usize { CALLS.load(Ordering::Relaxed) }
