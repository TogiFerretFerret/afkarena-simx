Host CPU backend experiment preparation
=======================================

No prior target-cpu=native or march=native A/B was found in repository history or tool/benchmark sources. The similarly named native CPU sampling work uses perf and is not compiler CPU targeting.

Host: AMD EPYC 9V74, family 25/model 17. This experiment will compare explicit generic x86-64 against target-cpu=native, with opt 3, 64 codegen units, no LTO and no fast-math. The source snapshot is identical for both variants. Inline SSE js_math helpers, floating environment checks, operation order, Number widths and gameplay code remain unchanged. Native binaries may require this host's instruction set and must not be represented as portable or as a cross-host speedup.

Prepared source-only snapshot contains 174 runtime/core/dependency files, 2.96MB; it excludes the 553-crate generated battle workspace. Unit/drain generated Rust and UTF16 metadata are identical between backend variants. No compilation or performance run has occurred yet; the frozen main full build retains CPU priority.

Before timing, both backends must pass all runtime/core library tests (including NaN payload, signed zero, invalid operations, Infinity and reference MXCSR checks), 79026 raw primitive value comparisons and 255190 raw Math comparisons against pinned jitless Node. The 90 existing ambiguous remainder cases remain explicitly unsupported; both backends must report the same exact exclusions. They do not count as passes. Then compare actual original Unit/drain ordered callbacks/state snapshots and selected TRACE1 observations. Archive compiler identity, complete CPU flags, source/library/binary hashes, all commands and backend cfgs.

Only a meaningful measured improvement justifies proposing a separate full native battle build. No GPU experiment, SIMD reassociation, unsafe numeric narrowing or source mechanism change is part of this task.

Qualification and decision
--------------------------

Both backends passed 44 battle-core and 114 runtime tests, 79026 raw value comparisons and 255190 Math comparisons each. The same 90 ambiguous remainder cases remain excluded. Original Unit/drain ordered events and selected state snapshots match pinned jitless Node; selected TRACE1 observations match between backends. All source/library/binary/UTF16 pool hashes remained unchanged.

The native timing cohort 15:30:01.027–15:30:10.842Z overlapped another agent's Unit/drain timing cohort because idle checks raced. Its observed Unit ratio 1.00083 and drain ratio 1.01755 are **exploratory and contended**, not established speedups. Reject promotion; no additional full battle build is justified. No rerun is needed for this rejected candidate.

All future actual benchmarks require exclusive `flock -x /workspace/afkarena-simx/work/native-timing.lock`; compiles and gates use shared `flock -s` on that same path. The source/raw-bit fidelity proofs remain valid despite timing contention. See benchmarks/results/2026-10-30T15-30-55.263Z-native-cpu-backend.json and benchmarks/validation/native-cpu/.
