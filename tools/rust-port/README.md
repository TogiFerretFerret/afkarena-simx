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

The first whole-program native debug build initialized modules 0 through 5 and
entered module 6, the battle runner. It stopped while loading the external table
bundle with `Unsupported("ArrayBuffer allocation exceeds supported resource bound")`.
Source-proven specialization of that file-loading path is the current integration
work. The pinned Node reference completed its 20 measured battles after three
warmups. The native run has **no completed battle or battle throughput result**
yet; its retained failure and reference outputs are in
[rust-full-program-initial.json](../../benchmarks/validation/rust-full-program-initial.json).

Generated source gates separately verify operators, closures, control flow,
collections, typed buffers and selected real mechanics. Their case counts are
component evidence, not counts of complete battles. Older approximately
3 battles/second results use the earlier mixed JavaScript/Rust implementation;
they are not measurements of this native pipeline.

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
