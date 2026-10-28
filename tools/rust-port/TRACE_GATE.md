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

## Reuse the completed main release build

The diagnostic wrapper can link the existing game crates without rebuilding
original game functions:

```sh
node tools/rust-port/prepare-reused-trace.mjs --prefix-events 1000
node tools/rust-port/run-reused-trace.mjs --oracle \
  --work work/rust-reused-trace-prefix
node tools/rust-port/run-reused-trace.mjs \
  --work work/rust-reused-trace-prefix --max-rss-gib 12 --timeout-ms 120000
```

Wait for the full main release build and its input proof before the native
command. Coordinate its execution separately from battle benchmarks and warm
profiling. The runner invokes `rustc` for a small observer app; it never invokes
Cargo or recompiles the original game-function crates.

Preparation guards every unchanged initialization statement and reuses public
compiled initialization helpers. It copies only the helper containing the host
input literal and the prefix of the helper preceding the original battle call.
The input JSON is replaced **before** the original clock installer copies and
freezes its replay tape. The diagnostic uses the accepted 260-clock/two-random
input prefix, one battle, and no warmups. All original game function definitions
and their source strings remain in the existing libraries.

Prefix mode records exactly the first requested number of events, then stops
capturing state while all wrapped original game methods and callbacks continue
to execute. Its header explicitly includes `prefixLimit` and `truncated`.
`check-program-trace-prefix.mjs` checks every prefix event payload, exact numeric
bits, and the complete transitive closure of referenced snapshots against the
accepted full trace. It also compares the entire terminal battle report. Events
after the limit are **not** qualified by this comparison.

The original full observer took about eight minutes in pinned Node. A retained
120-second complete-observer attempt stopped before completion and established
no trace parity. Prefix mode avoids making that cost a prerequisite for the
next native battle check. A failed, timed-out, or incomplete prefix attempt does
not establish prefix parity either.

```sh
node --test tools/rust-port/tests/program-trace-prefix.test.mjs
```

The regression fixture checks payload bits, callback order, required nested
snapshots, unexpected snapshots, final-report changes, missing footers and
failed process exit codes. This remains the selected-state contract described
above; it is not a complete object graph or a throughput result.

The derived pinned-Node prefix reference passed 1,000 events, all 1,437 required
snapshots and the full terminal report in
[the retained source check](../../benchmarks/validation/2026-10-28T20-23-55.444Z-rust-reused-trace-source.json).
The initial native wrapper compiled, but its diagnostic run exceeded the 12 GiB
RSS limit before exporting a complete prefix;
[that retained attempt](../../benchmarks/validation/2026-10-28T20-27-52.407Z-rust-reused-trace.json)
establishes no native trace parity. Observer allocation remains a limitation.
Preparation now requires the observer compiler fingerprints to match the main
manifest, preventing accidental mixing of a newer observer API with older game
rlibs. Reprepare after regenerating the next full build.

The next native retry completed and its [archived prefix comparison](../../benchmarks/validation/2026-10-28T21-09-48.807Z-rust-reused-trace.comparison.json) matched all 1,000 events, 1,437 required snapshots, the full terminal report and host consumption. The orchestrator session disappeared before its final provenance footer was written; [recovery metadata](../../benchmarks/validation/2026-10-28T21-09-48.807Z-rust-reused-trace.recovered.json) explicitly leaves complete execution provenance unqualified. No elapsed time, peak RSS or unchanged-library claim is inferred. The emitted observer reported completion; no native child remains. This is prefix evidence, not complete later-event coverage or a throughput result.
