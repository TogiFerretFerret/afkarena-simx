# afkarena-simx

A source-driven Rust port of the AFK Arena companion battle simulator. The goal is **10,000 faithful battles per second**: preserve the original execution order, callbacks, RNG consumption, timeouts and floating-point behavior while replacing dynamic object-heavy execution with Rust.

**That target is not reached.** The latest qualified pure Rust run completes **20 measured battles after three warmups at 0.750892 battles/second**, matching every non-timing report field and the full host-input tape against pinned Node. Four warm forked workers complete **80 battles at 2.191376 aggregate battles/second** with exact reports from every worker.

Both rates remain below the historical approximately **3 battles/second Static Hermes** baseline. These are fixed-fixture results, not a 20,000-battle random-team qualification. The next combined optimization batch is undergoing full validation; its component gains are not whole-battle performance results.

## Current results

| Evidence | Result | Coverage |
| --- | --- | --- |
| [Latest qualified Rust batch](benchmarks/validation/rust-program-layout-execution-wave-full.json) | **0.750892 battles/sec**, original20/3 workload | Exact final reports, raw number bits and host tape; frozen build proof passes |
| [Latest qualified four-worker run](benchmarks/results/2026-10-29-layout-execution-wave-fork-four.json) | **2.191376 aggregate battles/sec**, 80 battles over36.507s | Four exact reports/tapes, GC12 each; peak process PSS plus orchestrator RSS7.153GiB |
| [Current candidate validation](benchmarks/validation/hot-execution-wave/summary.json) | 111 library +26 integration tests and25 source gates passed; release build pending | Primary numeric access, getter-aware mode path, argument stack and cold literal reads enabled; no new battle rate claimed |
| [Prior pure Rust batch](benchmarks/validation/rust-program-next-execution-wave-full.json) | 20 measured after 3 warmups; **0.711035 battles/sec** | Every non-timing final-report field and full host consumption match pinned Node; build provenance passes |
| [Earlier pure Rust batch](benchmarks/validation/rust-program-own-primary-wave-full.json) | Same 20/3 workload; **0.700574 battles/sec** | Exact report/host parity; earlier runtime |
| [Prior four forked warm Rust workers](benchmarks/results/2026-10-28-next-execution-fork-four-retry.json) | **2.051487 aggregate battles/sec**, 80 battles over 38.996 s | Shared original three-warmup state; each full report/tape matches Node, overlapping measured windows; peak process PSS plus orchestrator RSS 9.68 GiB |
| [Prior cadence-2 fork cohort](benchmarks/results/2026-10-28-gc-cadence-two-fork-four-retry.json) | **2.288997 aggregate battles/sec**, 80 battles over 34.950 s | All four reports/tapes match; latest cohort is 10.38% slower, so aggregate improvement is not established |
| [Latest helper A/B](benchmarks/results/2026-10-28-next-helper-ab.json) | All on **0.747668**, all four helpers off **0.707572 battles/sec**, 1.057× | Exact reports/tapes; one sequential trial per mode, separate wrapper from canonical full program |
| [Individual helper flags](benchmarks/results/2026-10-28-next-helper-individual-ab.json) | Parser off **0.697554**, buff off **0.731625**, data factory off **0.724739**, prototype cache off **0.753950 battles/sec** | Exact reports/tapes; the prototype-off difference is below 1% versus the earlier all-on trial |
| [Current same-binary component flags](benchmarks/results/2026-10-28-own-primary-components.json) | All on **0.686706**, primary off **0.690486**, own-set off **0.614364**, all new off **0.651304 battles/sec** | Each complete report/tape matches Node; one trial per mode; primary storage is neutral in this trial |
| [Own-read disabled](benchmarks/results/2026-10-28-own-primary-ownread-off.json) | **0.640151 battles/sec** | Separate same-binary run; exact full report/tape parity |
| [Same-binary runtime A/B](benchmarks/results/2026-10-28-allocation-wave-ab.json) | **0.472224 reference → 0.625076 optimized battles/sec**, 1.324× | Each complete report/tape matches Node; reference disables hashing/key/length/shift fast paths, stack number conversion remains enabled in both |
| [Four independent Rust processes](benchmarks/results/2026-10-28T20-20-38.054Z-rust-parallel-four.json) | **1.287522 aggregate battles/sec**, 80 battles over 62.135 s | Earlier qualified runtime; all four measured windows overlap, each full report/host tape matches Node; not a sum of isolated rates |
| [Latest cold single battle](benchmarks/results/2026-10-28T20-56-07.133Z-rust-one-battle-check.json) | 2.056 s; **0.486381 battles/sec**; 386,457 added objects | Diagnostic final-report parity; unfinished original clock suffix; cold improvement does not establish warm throughput |
| [Native ordered trace prefix](benchmarks/validation/rust-native-prefix-after-full.json) | 1,000 ordered events and 1,437 required snapshot nodes match | Full terminal report/host tape and build/link provenance pass; remaining 63,419 intermediate events unobserved |
| [Prepared ordered trace reference](benchmarks/validation/rust-program-trace-preparation.json) | Node matches all 64,419 events and 55,078 snapshot nodes in the accepted archive | Source preparation for the next Rust trace gate; **not a new Rust trace result** |
| [Earlier Static Hermes/Rust run](benchmarks/results/2026-10-28T00-00-09.130Z-native-warm23-unit-speeder-battle.json) | 20 measured battles after 3 warmups; 2.783 battles/sec | Historical mixed backend; one frozen callback fixture, not the generated pure Rust backend |

**20,000 component cases are not 20,000 battles.** Fixed-fixture results do not qualify the random-team corpus. See [benchmark status](benchmarks/STATUS.md) for exact scopes, failed experiments and archived evidence.

## Timing profile

The [latest trace-disabled warm profile](benchmarks/RUST_ALLOCATION_WAVE_PROFILE.md) matches the complete report and host tape, with 3,277 CPU samples and zero lost samples. Property reads, descriptors, hash-table insertion and GC remain prominent costs. Profiling timing is separate from throughput. Earlier [trace-enabled](benchmarks/RUST_WARM_BATTLE_PROFILE.md) and [trace-disabled](benchmarks/RUST_WARM_TRACE0_PROFILE.md) profiles remain archived.

The [GC cadence experiment](benchmarks/RUST_GC_CADENCE.md) also matches all full reports and host tapes. Against its same-rebinding cadence-1 control, cadence 2 gains 12.7% at 3.01 GiB observed HWM; cadence 8 gains 21.6% at 4.64 GiB. These derivative-runner rates are separate from the qualified program and four-worker benchmark above.

The [counted allocation diagnostic](benchmarks/results/2026-10-28T21-18-46.972Z-rust-measured-allocations.json) also matches the full report and host tape. Each measured battle requests about **4.289 million allocations / 110.3 MB**, plus **185,910 reallocations** with 84.1 MB of old and 168.5 MB of new requested sizes. These are allocation traffic counts, not live bytes or peak memory; instrumented timing is not throughput evidence.

Environment/arguments elision, callable-identity indexing, clone specialization and giant-string collection have passed component gates and the retained battle checks. The preceding execution wave measured 0.711035 battles/sec, only 1.49% above the previous 0.700574 fixed-fixture result. Its helper A/B is exact at all settings and measures a 5.7% combined difference; the latest fork cohort is 2.051487 battles/sec, 7.17% below the previous 2.209977. The earlier property/array component checks all match Node, but that wave's 2.209977 aggregate rate is 3.45% below the earlier cadence-2 cohort. The first latest-wave fork attempt was aborted by a guard that counted reclaimable file cache as simulator memory; its failure record and corrected-monitor retry are both retained. The original allocation-wave A/B remains archived. The 3 and 10,000 battles/second goals remain unmet. The [real clone diagnostic](benchmarks/RUST_COPY_OBJ_DIAGNOSTIC.md) shows that targeted numeric objects and empty arrays already have the likely native-copy allocation signature. The [earlier Hermes profile](benchmarks/CURRENT_TIMING.md) describes a different backend.

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

Regeneration can change generated crate partitions, so refresh the standalone workspace lockfile before the build wrapper snapshots inputs and invokes Cargo with `--locked`. Use new result paths to preserve retained records. [Pipeline details](tools/rust-port/README.md) cover prerequisites and smaller diagnostics. [Ordered trace instructions](tools/rust-port/TRACE_GATE.md) retain the complete Node reference and a passing native 1,000-event prefix with all 1,437 required snapshots, full terminal report/host tape and complete provenance. Later intermediate events remain unobserved.

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
