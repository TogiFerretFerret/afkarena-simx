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

The [latest native batch](../../benchmarks/validation/rust-full-program-next.json)
passes every non-timing final-report field and host-input check for **20 battles
after three warmups at 0.390778 battles/second**. Its observed high-water RSS is
2.53 GiB. The previous qualified batch measured 0.384357; the single-pair change
is only 1.7%, despite large component and cold-start improvements.

The [latest cold diagnostic](../../benchmarks/results/2026-10-28T20-56-07.133Z-rust-one-battle-check.json)
matches the Node final report at 0.486381 battles/second and adds 386,457 objects.
It intentionally stops before the unused original clock suffix is consumed.
The [earlier four-process trial](../../benchmarks/results/2026-10-28T20-20-38.054Z-rust-parallel-four.json)
measures 1.287522 aggregate battles/second with every worker report matching Node.
These measurements remain below the historical approximately 3 battles/second
mixed backend and the 10,000 target. Cold, warm and aggregate rates have different
measurement windows and must be kept separate.

Allocation elision, callable indexing, source-specialized clones and giant-string
collection have source gates and retained battle comparisons. Earlier
[memory failures](../../benchmarks/validation/rust-full-program-release.json)
remain archived. The [warm profile](../../benchmarks/RUST_WARM_BATTLE_PROFILE.md)
records actual collection pauses and its raw-get diagnostic overhead; a new
diagnostic-free profile is being collected before further optimization choices.

Generated source gates separately verify operators, closures, control flow,
collections, typed buffers and selected real mechanics. Their case counts are
component evidence, not counts of complete battles. Older approximately
3 battles/second results use the earlier mixed JavaScript/Rust implementation;
they are not measurements of this native pipeline.

The [ordered trace preparation](../../benchmarks/validation/rust-program-trace-preparation.json)
matches all 64,419 events and 55,078 snapshot nodes between pinned Node and the
accepted archive. The bounded generated-Rust prefix attempt exceeded its memory
limit without a complete export. No native ordered-trace pass is claimed.
See [trace commands and scope](TRACE_GATE.md).

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

cargo generate-lockfile --offline --manifest-path work/rust-battle-full/Cargo.toml

node tools/rust-port/build-program.mjs \
  --manifest work/rust-battle-full/program-manifest.json \
  --profile release --jobs 2 \
  --output benchmarks/validation/rust-program-review-build.json

node tools/rust-port/check-program.mjs \
  --manifest work/rust-battle-full/program-manifest.json \
  --binary work/rust-port-shared-target/release/rust-battle-program \
  --build-proof benchmarks/validation/rust-program-review-build.json \
  --profile release \
  --output benchmarks/validation/rust-full-program-review.json
```

Generation writes Rust and UTF-16 source pools only when their bytes change.
Changed crate partitions can require a new standalone workspace lockfile. Run
the offline lockfile step after generation and before the build wrapper; the
wrapper snapshots the lockfile and uses Cargo `--locked`.
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

After the main release build finishes, the prepared one-battle checker can link
a small diagnostic app against the newest release libraries without rebuilding
the generated modules:

```sh
node tools/rust-port/check-one-battle.mjs
```

It hashes every dependency library before and after, retains its wrapper and
compiler arguments, and limits the child to 8 GiB observed RSS and 120 seconds.
It compares every final-report field except the two timing fields against the
committed pinned-Node single-battle reference. An intentional internal stop after
the report leaves the original clock tape unfinished; that stop and the exact
consumed prefix must be present. This remains a cold diagnostic, not a successful
batch or intermediate-state trace. The tool itself does not establish that the
selected library bytes were built from the currently checked-out Rust source.

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
