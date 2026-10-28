# afkarena-simx

A source-driven Rust port of the AFK Arena companion battle simulator. The goal is **10,000 faithful battles per second**: preserve the original execution order, callbacks, RNG consumption, timeouts and floating-point behavior while replacing dynamic object-heavy execution with Rust.

**That target is not reached.** The latest pure Rust run completes **20 measured battles after three warmups at 0.391 battles/second**, matching every non-timing report field and host-input count against pinned Node. The prior qualified run measured 0.384; this single comparison shows only a 1.7% change, not an established material warm-speed gain.

An earlier four-process run completed **80 battles at 1.288 aggregate battles/second**, with overlapping measured windows and exact reports from every worker. Both rates remain below the historical approximately 3 battles/second Static Hermes result. The latest single-process batch has an observed lifetime high-water RSS of **2.53 GiB**. Earlier memory failures are retained as history.

## Current results

| Evidence | Result | Coverage |
| --- | --- | --- |
| [Latest pure Rust batch](benchmarks/validation/rust-full-program-next.json) | 20 measured after 3 warmups; **0.390778 battles/sec**; 2.53 GiB observed HWM | Every non-timing final-report field and full host consumption match pinned Node; build provenance passes |
| [Prior pure Rust batch](benchmarks/validation/rust-full-program-gc.json) | Same 20/3 workload; **0.384357 battles/sec** | Exact report/host parity; its external memory monitor failed to observe the child and makes no RSS claim |
| [Four forked warm Rust workers](benchmarks/results/2026-10-28-fork-four-next.json) | **1.480826 aggregate battles/sec**, 80 battles over 54.024 s | Shared original three-warmup state; each full report/tape matches Node, overlapping measured windows; peak PSS 7.69 GiB |
| [Four independent Rust processes](benchmarks/results/2026-10-28T20-20-38.054Z-rust-parallel-four.json) | **1.287522 aggregate battles/sec**, 80 battles over 62.135 s | Earlier qualified runtime; all four measured windows overlap, each full report/host tape matches Node; not a sum of isolated rates |
| [Latest cold single battle](benchmarks/results/2026-10-28T20-56-07.133Z-rust-one-battle-check.json) | 2.056 s; **0.486381 battles/sec**; 386,457 added objects | Diagnostic final-report parity; unfinished original clock suffix; cold improvement does not establish warm throughput |
| [Prepared ordered trace reference](benchmarks/validation/rust-program-trace-preparation.json) | Node matches all 64,419 events and 55,078 snapshot nodes in the accepted archive | Source preparation for the next Rust trace gate; **not a new Rust trace result** |
| [Earlier Static Hermes/Rust run](benchmarks/results/2026-10-28T00-00-09.130Z-native-warm23-unit-speeder-battle.json) | 20 measured battles after 3 warmups; 2.783 battles/sec | Historical mixed backend; one frozen callback fixture, not the generated pure Rust backend |

**20,000 component cases are not 20,000 battles.** Fixed-fixture results do not qualify the random-team corpus. See [benchmark status](benchmarks/STATUS.md) for exact scopes, failed experiments and archived evidence.

## Timing profile

The [warm Rust profile](benchmarks/RUST_WARM_BATTLE_PROFILE.md) isolates the 20 measured battles after warmup, matches the complete source report and records 23 actual collections. Measured-window collection pauses total 4.831 seconds. It enables raw-get diagnostics, so its overhead and attribution must be kept separate from the unprofiled 0.384 run. The completed [trace-disabled warm profile](benchmarks/RUST_WARM_TRACE0_PROFILE.md) also matches the report and host tape. Its 4,660 samples point to property access, key conversion, hash tables and GC; profiling timing is not a new throughput result.

Environment/arguments elision, callable-identity indexing, clone specialization and giant-string collection have passed component gates and the retained battle checks. Large component or cold-start wins have not translated into a large warm-batch win. The [real clone diagnostic](benchmarks/RUST_COPY_OBJ_DIAGNOSTIC.md) shows that targeted numeric objects and empty arrays already have the likely native-copy allocation signature. The [earlier Hermes profile](benchmarks/CURRENT_TIMING.md) describes a different backend.

## Where the Rust work lives

- [`tools/rust-port`](tools/rust-port/README.md): Babel source lowering, generated-program builds, Node differential gates and profiling.
- [`crates/js-runtime/src`](crates/js-runtime/src): native Rust values, binary64 operations, UTF-16 strings, objects, closures, builtins and source execution semantics. The generated backend has no JavaScript execution fallback.
- [`crates/generated-battle/src`](crates/generated-battle/src): committed generated Rust for selected real unit, skill, engine and buff methods. The complete seven-module workspace is generated under ignored `work/`.
- [`crates/battle-core/src`](crates/battle-core/src): numerical semantics and earlier typed engine, scheduler, unit, buff and resource implementations with their own component gates.
- [`src`](src): supplied JavaScript reference and data. [`tools`](tools) contains extraction, compilation, differential testing and profiling tools.

The complete frozen source lowers 22,986 functions into Rust. AST coverage alone does not prove every runtime behavior or battle. The earlier typed-core and Hermes integrations have separate coverage; a missing callback or an unsupported operation cannot become a successful battle.

## Build and check

Use the versions pinned in [toolchains.json](config/toolchains.json) and [source-oracle-runtime.json](config/source-oracle-runtime.json): Rust 1.99.1, Node 24.19.0 with its pinned V8, and the recorded Buck2 commit. GCC, G++, Python 3 and the bundled Buck2 prelude are required by the current host toolchain.

```sh
npm ci
cargo check -p battle-core
cargo test -p battle-core
buck2 build root//crates/battle-core:battle_core
npm test
```

The managed workspace caches Rust under `work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin` and Buck2 at `work/buck2`. Add that Rust directory to `PATH` when using the cached tools. These ignored downloads and build products are not committed; a fresh checkout needs the pinned tools installed.

Run the existing source/component gates with:

```sh
npm run verify
npm run verify:components
```

The connected Rust unit/skill fixture has its own executable and source comparison. In the prepared workspace, the checker snapshots its inputs, builds the pinned Buck2 target, and rejects source changes during the run:

```sh
node --jitless tools/check-unit-skill-runtime.mjs --cases 20000
```

That checker exercises a composed controller fixture, not complete battles. Its source oracle uses `--jitless` because JIT tiers can change NaN bits; see [oracle runtime notes](benchmarks/validation/ORACLE-RUNTIME.md). Keep `NODE_OPTIONS` empty for reference runs.

## Reproduce battle evidence

The active pure Rust pipeline uses prepared frozen source modules and the external table bundle recorded by the coverage manifest. Generate, build with input provenance, then compare the complete batch against pinned Node:

```sh
node tools/rust-port/generate-program.mjs --through 6 --out work/rust-battle-full
cargo generate-lockfile --offline --manifest-path work/rust-battle-full/Cargo.toml
node tools/rust-port/build-program.mjs --profile release --jobs 2 \
  --output benchmarks/validation/rust-program-review-build.json
node tools/rust-port/check-program.mjs --profile release \
  --binary work/rust-port-shared-target/release/rust-battle-program \
  --build-proof benchmarks/validation/rust-program-review-build.json \
  --output benchmarks/validation/rust-full-program-review.json
```

Regeneration can change generated crate partitions, so refresh the standalone workspace lockfile before the build wrapper snapshots inputs and invokes Cargo with `--locked`. Use new result paths to preserve retained records. [Pipeline details](tools/rust-port/README.md) cover prerequisites and smaller diagnostics. [Ordered trace instructions](tools/rust-port/TRACE_GATE.md) describe the prepared Node reference; a bounded native trace attempt hit its memory limit without a complete export, so no generated Rust ordered-trace pass is claimed.

The older mixed-backend experiment can be rerun in a workspace containing its SHA-bound compiler, private VM and seven-unit build prerequisites:

```sh
node tools/run-native-unit-speeder-battle.mjs
```

The runner rejects stale proofs and artifacts, compares the complete semantic report and host-input consumption, and writes a timestamped result with raw outputs. Its prerequisite paths and exact build/link commands are retained in the [result metadata](benchmarks/results/2026-10-28T00-00-09.130Z-native-warm23-unit-speeder-battle.json). It is not a one-command fresh-checkout build.

The earlier ordered trace can be checked directly from committed archives, without ignored compiler artifacts:

```sh
node --max-old-space-size=12288 tools/check-battle-boundary-archive.mjs benchmarks/results/2026-10-27T23-15-36.402Z-boundary-source-reference.json benchmarks/results/2026-10-27T23-49-07.298Z-boundary-optimized-native.json
```

This is a memory-intensive evidence replay, not a new simulation benchmark. The package's `benchmark:battles` command is an older direct-tick diagnostic that omits frame callback/scene phases; its throughput cannot count toward the target.

## Remaining qualification

The realistic corpus uses positional random 5v5 teams, A5, level 360, four gear slots, SI30 and one beast per team. The [full-scene preflight](benchmarks/validation/random-5v5-preflight.json) completes none of its ten cases: missing animation/atlas data and unsupported native Cocos `setSkin`/`setTransform` operations stop execution. Fake durations or skipped actor operations would change mechanics.

Selected-state trace parity does not cover arbitrary nested/prototype/closure/weak state or the full actor/effect/view lifecycle. Full-scene corpus parity and 10k faithful battles/sec remain open work.
