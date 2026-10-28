# Native Rust battle compiler

This pipeline lowers the supplied JavaScript source into native Rust functions
and runs them through [js-runtime](../../crates/js-runtime/src/lib.rs). Babel is
build tooling; generated battles have no JavaScript execution fallback. The
[execution contract](CONTRACT.md) describes values, references, environments,
callbacks and explicit unsupported-operation failures.

## Current status

The compiler lowers all **22,986 functions in seven frozen source modules** with
zero unsupported AST functions. Large functions become helpers sharing the same
JavaScript frame and environment; dependency groups become small Cargo crates
to keep Rust compilation within memory limits. AST coverage does not establish
complete runtime semantics.

The [first pure Rust battle](../../benchmarks/results/2026-10-28T17-46-01.273Z-rust-one-battle-diagnostic.json)
completed with victory, 296 frames/ticks and 15,453 callbacks. Every non-timing
final-report field matched pinned Node, including captured raw state bits. Its
cold diagnostic timer measured **8.677 seconds, or 0.115 battles/second**, with
concurrent work; this is not a steady-state benchmark or a speed improvement.
The harness deliberately stops after its report, before consuming the remainder
of the original 23-battle host tape. Complete intermediate Rust event/state
tracing remains unqualified.

That battle retained **1,498,859 additional heap objects**. The
[20-battle batch attempt](../../benchmarks/validation/rust-full-program-release.json)
was stopped at approximately **13.5 GiB peak RSS** without a complete report;
it has no qualified throughput result. The pinned Node reference completed the
batch. The earlier external-table allocation failure is retained in
[the initial attempt](../../benchmarks/validation/rust-full-program-initial.json)
and has been passed by the newer diagnostic.

The next candidate contains validated empty-block environment elision, unused
strict-function arguments elision, constant-time callable-identity lookup and a
shared intrinsic strict-arguments thrower. Full-program rebuild and battle speed
measurements for these changes are pending. The
[first-battle profile](../../benchmarks/RUST_FIRST_BATTLE_PROFILE.md) explains
the observed lookup/string/allocation costs and its measurement limits.

Generated source gates separately verify operators, closures, control flow,
collections, typed buffers and selected real mechanics. Their case counts are
component evidence, not counts of complete battles. Older approximately
3 battles/second results use the earlier mixed JavaScript/Rust implementation;
they are not measurements of this native pipeline.

The [ordered trace preparation](../../benchmarks/validation/rust-program-trace-preparation.json)
matches all 64,419 events and 55,078 snapshot nodes between pinned Node and the
accepted archive. It prepares the next native trace comparison; it is not a
successful generated Rust trace. See [trace commands and scope](TRACE_GATE.md).

## Generate, build and compare

Run from the repository root with the pinned Node and Rust toolchains available.
The reference profile is [source-oracle-runtime.json](../../config/source-oracle-runtime.json):
Node 24.19.0, its recorded x64 V8 build, `--jitless`, and empty `NODE_OPTIONS`.
Prepared frozen source modules and the external table bundle under ignored
`work/` are prerequisites. Their paths and source hashes are recorded in
[rust-battle-compile-coverage.json](../../benchmarks/validation/rust-battle-compile-coverage.json);
these commands are not a fresh-checkout bootstrap.

```sh
node tools/rust-port/generate-program.mjs --through 6 --out work/rust-battle-full

node tools/rust-port/build-program.mjs \
  --manifest work/rust-battle-full/program-manifest.json \
  --profile release --jobs 2 \
  --output benchmarks/validation/rust-program-release-build.json

node tools/rust-port/check-program.mjs \
  --manifest work/rust-battle-full/program-manifest.json \
  --binary work/rust-port-shared-target/release/rust-battle-program \
  --build-proof benchmarks/validation/rust-program-release-build.json \
  --profile release \
  --output benchmarks/validation/rust-full-program-release.json
```

Generation writes Rust and UTF-16 source pools only when their bytes change.
The build wrapper runs Cargo with a shared target directory, archives its output,
and fingerprints the generated workspace, source pools, runtime, compiler, host
adapter, frozen source, external tables and toolchain. It records source changes
and stale generation fingerprints as failed qualification while retaining build
diagnostics. `--snapshot-only --output work/build-input-inspection.json` inspects
inputs without building. Stop source edits during a qualification build or run.

The checker independently executes the frozen source in pinned Node and the
native executable with diagnostic tracing disabled. It requires 20 results,
compares all report fields except timing, separately compares host-input
consumption, and preserves both raw outputs. Positive throughput is reported
only on a passing comparison. Use release builds for speed measurements;
unoptimized debug execution is for finding semantic failures.

The build proof and semantic report are separate artifacts. With `--build-proof`,
the checker requires a passed build, matching binary and manifest hashes, matching
profile and unchanged build inputs. It freezes the proof and those inputs across
both executions. Omitting the option permits semantic debugging but leaves
`binaryBoundToManifest` false. An invalid supplied proof fails the check while
retaining execution diagnostics.

For the smaller committed battle-method crate:

```sh
node tools/rust-port/generate-battle.mjs --check
cargo check -p generated-battle
node tools/rust-port/tests/expressions.mjs
node tools/rust-port/check-control-flow.mjs
node tools/rust-port/check-collections.mjs
```

## Qualification limits

The whole-program workload is one frozen callback fixture. Its final capture
includes selected raw floating-point state, callbacks, host events and runtime
counters; it does not trace every state transition of every battle. A passing
fixture is not 20,000 distinct battles or qualification for the 10,000
battles/second goal.

Broader qualification still requires the random positional 5v5 corpus with gear,
SI30, A5, level 360, one beast per team, timeout behavior, and complete mechanics.
Full-scene execution also depends on unavailable animation/skeleton assets and
native scene behavior. Missing callbacks, changed RNG consumption or omitted
mechanics cannot count as speed gains. Unsupported runtime domains and known
engine-specific representation gaps must remain explicit until validated.
