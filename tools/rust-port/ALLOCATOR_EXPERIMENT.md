# Native allocator experiment

The original qualified full Rust binary was executed with a requested native-only `LD_PRELOAD=/lib/x86_64-linux-gnu/libjemalloc.so.2`. JavaScript was not rerun under that allocator: comparison used the original pinned Node reference report from the qualified full baseline. No Rust source, callbacks, RNG use, battle inputs or mechanics changed.

The original twenty measured battles and three warmups completed. Every non-timing report field, callback count, RNG/state bits, class counters and host tape matched. The native binary, library and baseline hashes remained unchanged, and the then-current build proof verified before and after execution with zero changed source inputs.

The result is **not allocator-qualified**: the additional `/proc` child/maps observer captured no PID/maps, so it did not independently confirm jemalloc mapping. The report deliberately records `passed:false`, `semanticPassed:true`, and `allocatorLibrary.mapped:false`. The native environment request is recorded, but successful allocator interposition is not claimed.

Observed native timing was 0.72286 battles/sec, versus 0.71104/sec in the prior qualified baseline cohort, a 1.7% difference. Peak RSS was about 3.16 GiB. This comparison has no fresh matched system-allocator control and does not establish an improvement. No further allocator trial or default change is recommended from this evidence.

Evidence: `benchmarks/results/2026-10-28T23-57-27.342Z-rust-program-allocator.json` and its compressed stdout/stderr/maps archives. The build-proof source collector was subsequently hardened in a separate commit, after this experiment released its source freeze; the report preserves its original before/after verification records. This is one fixed-fixture experiment, not broad random-battle or 10k/sec qualification.
