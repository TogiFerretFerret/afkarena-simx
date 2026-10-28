# Ordered event and state trace workload

`prepare-program-trace.mjs` restores the accepted trace source from
[the earlier source/native comparison](../../benchmarks/results/2026-10-27T23-49-07.298Z-boundary-optimized-native.json).
It writes a separate seven-module coverage manifest at
`work/rust-battle-trace/coverage.json`. Modules 0 and 6 come from that result's
verified source archives; modules 1 through 5 remain the original frozen source.
Every original function body hash must remain present with the same multiplicity.
The additional functions implement observation and export only.

```sh
node tools/rust-port/prepare-program-trace.mjs
```

The tool runs one battle with no warmup in pinned Node, replays the original
260-clock/two-random-input prefix, and compares its selected-state trace against
the previously verified archive. It fingerprints inputs and retains the coverage,
Node streams and comparison report under
`benchmarks/validation/rust-program-trace-preparation.*`.
The observer is expensive; this is a diagnostic run, not a speed benchmark.

The [prepared Node reference](../../benchmarks/validation/rust-program-trace-preparation.json)
passed with 64,419 ordered events and 55,078 snapshot nodes matching the accepted
archive. It completed 296 frames and 15,453 callbacks. All input fingerprints
remained unchanged. This establishes a source reference, not a new native Rust
battle result.

To compare a future candidate's NDJSON output against that prepared Node trace:

```sh
node tools/rust-port/check-program-trace.mjs \
  --candidate work/native-trace.stdout --exit-code 0 \
  --reference benchmarks/validation/rust-program-trace-preparation.json \
  --output benchmarks/validation/rust-program-trace-candidate.json
```

Supply the candidate process's actual exit code. This checker compares archived
output; it does not independently execute or authenticate a native executable.
It requires a passed source preparation and validates archive hashes, contiguous
event order, every event's state hash and the complete snapshot pool. Snapshot
interning order may differ; event order may not. It also compares every terminal
report field except timing. Raw floating-point bits are encoded as strings by
the observer and participate in these exact comparisons.

Comparison streams records and retains event digests and snapshot hashes, rather
than materializing two approximately 284 MB trace objects. Regression tests cover
bit changes, callback reordering, missing records, incomplete exports and failed
execution status:

```sh
node --test tools/rust-port/tests/program-trace.test.mjs
```

This workload uses `primitive-vector-battle-boundaries-v1`: selected own enumerable
primitive fields, numeric vectors, ordered entity lists, callbacks, RNG, clocks
and wrapped mechanics at each recorded boundary. It is not an exhaustive object
graph or an observation after every JavaScript instruction. Nested objects,
prototypes, closures, weak state and missing scene/actor behavior remain outside
this contract; see the retained result's limitations.

Preparing this coverage does not compile or execute a Rust trace candidate.
The full-program generator must accept its alternate coverage path before such
a candidate is generated. The final-report checker is a separate 20-battle gate;
it cannot substitute for this ordered trace comparison. The generic Rust arena
also retains temporary observer allocations, so fitting a complete trace in
memory remains an integration concern.
