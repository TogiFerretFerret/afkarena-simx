# Bounded generated-part codegen experiment

This pilot compares Rust codegen-unit counts 64, 4 and 1 without changing the simulator's production profile. It selects the smallest and largest **current workspace member** generated part crates, not potentially stale directories left by earlier partitions.

Run after the full-world build and all higher-priority battle benchmarks have completed:

```sh
flock -x /workspace/afkarena-simx/work/native-timing.lock \
  node --jitless tools/rust-port/probe-part-codegen-units.mjs \
  --reference-root /workspace/afkarena-simx
```

Use an isolated worktree. The tool writes only its own `work/part-codegen-units-probe` directory. The reference workspace and its completed dependency rlibs are read-only. They must remain frozen until the pilot finishes; all used files are hashed again at the end. For a retry, pass `--work work/part-codegen-units-probe-retry` to retain the failed run's evidence.

Each selected part has six cold compilations: 64/4/1 CGUs, then 1/4/64. The command uses direct `rustc` with opt-level 3, no LTO, no incremental cache, no embedded bitcode and no debug info. It reuses the exact existing compiled dependencies, excluding dependency rebuilding and Cargo scheduling from measurements. A small Linux `wait4` wrapper records wall time, user/system CPU time and peak RSS for the complete compiler process. Every command and resulting rlib size/hash is retained in the report.

The existing original `Unit.update` fixture is also built under all three CGU counts. Each runs both property-cache configurations for 64 updates and compares every observed event and selected raw-bit state with the independent Node source oracle. This qualifies that fixture, not the newly compiled part crates in a full battle. Any eventual production setting change still requires the full source/fidelity gates and a representative battle throughput comparison.

The report is `work/part-codegen-units-probe/report.json`; compressed compiler diagnostics, fixture observations and the independent oracle remain beside it. The pilot does not measure a complete 554-crate build or promise that lower CGU counts improve it. In particular, fewer CGUs may trade shorter startup/object-generation time for worse LLVM optimization time or runtime speed.
