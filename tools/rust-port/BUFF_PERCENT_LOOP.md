# Callback-preserving Buff percent loop

The compiler matches only the original applyPercentValue SHA256. It emits the
original for initializer first, preserving getDynamic and both conditional lock
callbacks, captured values and exceptions. An interior hook then attempts the
numeric loop. A miss continues at the original loop without replaying its prefix.
The function's call frame and source/reflection metadata stay intact.

The first domain accepts at most64 distinct own string list items, ordinary
callback-free data links and finite caster-basis numbers. Owner basis, duplicate
keys, input/output aliases, getters, exotics, coercions, readonly writes, active
debug recording and nonfinite operations use the source body. Every selected
result is computed and checked before any target mutation. Accepted math keeps
f=+0, then mul, add-to-f, and add-to-target using the existing pinned arithmetic;
no reassociation or FMA. Commit changes only current writable own descriptor
values, in source order. No callback or fallible guard follows the first write.

Validation passes62 library tests and26 integration tests, including23 actual
source safepoints that reclaim and reuse input object IDs between helper calls.
The30 source cases run both modes:60 exact event/state observations cover prefix
callbacks and late getter throws, readonly targets, array getters, overflow,
aliases, duplicates and signed zero. An additional40 control-flow cases pass.

Two rounds of three alternating10,000-pair source trials improve percent+fixed
method pairs/sec240,907 to300,345, a1.2467x component ratio (rounds1.262x/1.231x).
The pristine original getDynamic/isEnabled functions execute in both modes;
all256 intermediate raw-bit snapshots and terminal state match pinned Node.
Enabled trials admit10,005/10,005 percent calls including five warmups. Complete
battle admission and speed remain unmeasured. An initial successful comparison
failed while archiving because the new worktree lacked benchmarks/results;
the corrected complete run and failed launcher are retained.

Evidence: `benchmarks/validation/rust-buff-percent-loop-summary.json` and
`benchmarks/results/2026-10-28T23-12-52.615Z-rust-buff-percent-loop.json`.
