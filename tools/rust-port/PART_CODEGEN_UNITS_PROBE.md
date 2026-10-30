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

## Completed result

The [published report](../../benchmarks/validation/part-codegen-units-probe.json) pins the passing guarded-native full-world proof and its runtime rlib SHA. It includes compiler argv, wall/user/system time, peak RSS, artifact hashes and sizes, current workspace member census, and 20 compressed evidence archives. No incremental caches were created.

| Compilation | CGU 64 | CGU 4 | CGU 1 |
| --- | ---: | ---: | ---: |
| Small actual part, mean seconds | 0.821 | 0.759 | 0.878 |
| Large actual part, mean seconds | 0.764 | 0.733 | 0.683 |
| Original Unit fixture, seconds | 2.511 | 2.606 | 3.159 |

The small part has 14 public functions and a 102,183-byte source file. Four CGUs reduced its aggregate compile time by 7.6%; one CGU increased it by 7.0%. Its rlib shrank from 327,024 bytes at 64 CGUs to 322,644 at four and 307,644 at one.

The largest part has a 1,488,396-byte source file but only one public function. Its rlib is byte-identical under every configuration. Its timing spread cannot establish a benefit from changing backend partitioning; two alternating rounds also leave ordinary process/cache variation.

All three Unit fixture binaries matched the independent Node oracle in both property-cache modes: 964 ordered events and selected raw-bit state per execution. However, its compile took 3.8% longer at four CGUs and 25.8% longer at one. Production remains at **64 CGUs**. This bounded pilot provides no evidence for changing that default or claiming faster full-battle simulation.
