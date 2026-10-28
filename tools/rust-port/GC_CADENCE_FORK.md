# Warm-fork GC cadence measurement

`benchmark-fork-gc-cadence.mjs` extends the existing warm-fork driver with the source-pinned runner from a verified GC-cadence preparation. The replacement preserves declaration source, name, arity, global parent, and `Function.prototype.toString`; the preparation records the closed-world runner-reference audit. Selected original release libraries remain unchanged. This is a fixed-source fixture experiment, not a general JavaScript rebinding equivalence claim.

The four children share the original three-battle warmup through copy-on-write, then independently execute all twenty original measured battles each. Each complete report, including final raw number bits, callback counts, RNG, class counters and host tape, matches the pinned JS reference. Measurements use the union of all measured intervals, not summed per-process rates. The runner changes only GC cadence, with twelve collections per child at cadence two. Source and library hashes and the original frozen build proof are checked before and after execution.

On this four-CPU-quota environment, [the passing run](../../benchmarks/results/2026-10-28-gc-cadence-two-fork-four-retry.json) completed eighty measured battles in 34.9498 seconds: **2.289 battles/sec**. This is 15.5% above the previous separately measured 1.982/sec fork run; it is one cohort, not a paired confidence estimate. Peak aggregate PSS plus orchestrator RSS was 9.586 GiB, and summed RSS was 13.626 GiB (the latter double-counts COW pages). The target of three, or ten thousand, battles/sec remains unmet. Random full-scene 5v5 qualification remains separate.

The initial attempt failed during compilation because a generated module declaration preceded Rust inner doc comments. Its failure report is retained; it executed no battle. The corrected retry passed all checks. Compilation and execution logs, original generated runner and UTF-16 pool, child reports, wait statuses, and source wrapper are retained in artifacts or the report.

Run after releasing other compilation/profiling work:

```sh
node tools/rust-port/benchmark-fork-gc-cadence.mjs --run --serial-slot-released \
  --baseline benchmarks/validation/rust-program-allocation-wave-full.json \
  --cadence 2 --output benchmarks/results/my-cadence-fork.json
```

The tool supports `--repository` when invoked from an isolated tooling checkout and `--cadence-preparation` for another fully qualified preparation. Other supported cadences are one, four and eight; higher cadence requires additional memory and must respect the aggregate PSS limit.
