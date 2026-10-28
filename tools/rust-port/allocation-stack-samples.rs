// Optional expensive diagnostic. Sample every 131072nd successful allocation.
// The reentrancy guard excludes allocations made by the stack observer itself.
thread_local! { static OBSERVING_ALLOCATION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
static ALLOCATION_SAMPLES: std::sync::Mutex<Vec<(u64,std::backtrace::Backtrace)>> = std::sync::Mutex::new(Vec::new());
fn observer_active() -> bool {
    OBSERVING_ALLOCATION.try_with(|flag| flag.get()).unwrap_or(true)
}
fn sample_allocation(ordinal: u64) {
    if ordinal % 131072 != 0 { return; }
    OBSERVING_ALLOCATION.with(|flag| {
        flag.set(true);
        let stack = std::backtrace::Backtrace::force_capture();
        // Store only while the guard is set: both capturing and growing this
        // observer's Vec may themselves call the process allocator.
        if let Ok(mut samples) = ALLOCATION_SAMPLES.lock() { samples.push((ordinal,stack)); }
        flag.set(false);
    });
}
fn dump_allocation_samples() {
    if let Ok(samples) = ALLOCATION_SAMPLES.lock() {
        for (ordinal,stack) in samples.iter() {
            eprintln!("ALLOCATION_STACK_BEGIN:{ordinal}\n{stack}\nALLOCATION_STACK_END:{ordinal}");
        }
    }
}
