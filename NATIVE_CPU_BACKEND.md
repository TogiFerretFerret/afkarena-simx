Host CPU backend experiment preparation
=======================================

No prior target-cpu=native or march=native A/B was found in repository history or tool/benchmark sources. The similarly named native CPU sampling work uses perf and is not compiler CPU targeting.

Host: AMD EPYC9V74, family25/model17. This experiment will compare explicit generic x86-64 against target-cpu=native, with opt3,64 codegen units,no LTO and no fast-math. The source snapshot is identical for both variants. Inline SSE js_math helpers, floating environment checks, operation order, Number widths and gameplay code remain unchanged. Native binaries may require this host's instruction set and must not be represented as portable or as a cross-host speedup.

Prepared source-only snapshot contains174 runtime/core/dependency files,2.96MB; it excludes the553-crate generated battle workspace. Unit/drain generated Rust and UTF16 metadata are identical between backend variants. No compilation or performance run has occurred yet; the frozen main full build retains CPU priority.

Before timing, both backends must pass all runtime/core library tests (including NaN payload, signed zero, invalid operations, Infinity and reference MXCSR checks),79026 raw primitive value comparisons and255190 raw Math comparisons against pinned jitless Node. The90 existing ambiguous remainder cases remain explicitly unsupported; both backends must report the same exact exclusions. They do not count as passes. Then compare actual original Unit/drain ordered callbacks/state snapshots and selected TRACE1 observations. Archive compiler identity, complete CPU flags, source/library/binary hashes, all commands and backend cfgs.

Only a meaningful measured improvement justifies proposing a separate full native battle build. No GPU experiment, SIMD reassociation, unsafe numeric narrowing or source mechanism change is part of this task.
