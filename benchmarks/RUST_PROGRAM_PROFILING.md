# Profile the generated native Rust program

Once the release binary finishes a battle, run:

```sh
node tools/rust-port/profile-program.mjs \
  --binary work/rust-port-shared-target/release/rust-battle-program \
  --program-dir work/rust-battle-full \
  --scope unit6 --frequency 99 \
  --reference path/to/raw-source-oracle-report.json
```

Use the actual release binary and matching generated program directory. The
reference argument accepts the raw final oracle JSON, rather than a benchmark
wrapper report. Timing fields are excluded from comparison; semantic fields and
host-input consumption are compared. Omitting the reference leaves
`semanticReportMatched` null.

The tool records sampled user CPU, disjoint self-time groups, top native symbols,
inclusive call stacks, function source ranges, raw process output and raw
`perf.data`. It archives compressed evidence under `benchmarks/results/` and pins
the binary, profiler, demangler, manifests and producer with SHA-256 hashes.
Rust v0 symbols are demangled using binutils because this perf build leaves them
mangled. Anonymous generated functions receive source ranges, not guessed names
of game mechanics. Inlined operations remain attributed to their enclosing
native symbol. Unresolved samples remain visible.

`--scope unit6` starts perf disabled and enables it after observing the existing
`unit_start:6` stderr line. It requests disable after `unit_finished:6`; process
exit also ends sampling. Control acknowledgments, pipe errors and observer
timestamps are retained. This approximately excludes units 0–5 startup without
editing mechanics or consuming extra source clock/RNG calls. **Unit 6 setup,
warmups and final diagnostics are included.** Pipe and control latency prevent
treating this as an exact measured-battle window.

`--scope whole` includes all initialization, including source table loading and
decoding. It is useful for startup problems but must not be described as battle
execution time. Profiled elapsed time is never a throughput benchmark.

Validation:

- [Native control fixture](../tools/rust-port/tests/profile-fixture.rs) produces
  startup and unit 6 markers. The profiler starts with events disabled, receives
  an enable acknowledgment, records samples and compares its final reference.
- [Passing control smoke report](results/2026-10-28T17-16-44.432Z-rust-program-perf.json)
  retains 26 samples and the control trace. This fixture does not simulate battles.
- [Original Unit.update component profile](results/2026-10-28T17-15-46.253Z-rust-program-perf.json)
  validates Rust runtime symbol classification with 395 samples. It includes
  setup and diagnostics, lacks a full-battle reference, and has 24.1% unresolved
  samples. Its largest named leaves include SipHash, heap property lookup,
  string interning and deallocation. It establishes no whole-battle bottleneck
  or speedup.
- The initial control smoke failure is retained. It exposed the normal race
  where the child exits before perf acknowledges disable. The tool now records
  that edge explicitly and requires an acknowledged enable plus both markers
  and successful process exit; it does not claim an exact end boundary.
