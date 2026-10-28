# afkarena-simx

A source-driven Rust port of the AFK Arena companion battle simulator. The goal is **10,000 faithful battles per second**: preserve the original execution order, callbacks, RNG consumption, timeouts and floating-point behavior while replacing dynamic object-heavy execution with Rust.

**That target is not reached.** The latest native battle experiment measured **2.783 battles/second**, about three, not 2,783. It still executes most game mechanics through Static Hermes compiled from the supplied JavaScript. The Rust execution core is being connected; this is not yet a complete Rust simulator.

## Current results

| Evidence | Result | Coverage |
| --- | --- | --- |
| [Rust speed-block battle run](benchmarks/results/2026-10-28T00-00-09.130Z-native-warm23-unit-speeder-battle.json) | 20 measured battles after 3 warmups; 2.783 battles/sec; 72,677 Rust admissions | One frozen callback-only fixture; raw source reports, callbacks, host inputs and runtime cleanup match |
| [Prior cache candidate](benchmarks/results/2026-10-27T22-50-55.607Z-native-warm23-global-ed-prefilter.json) | 2.849 battles/sec in the adjacent trial | Same fixture; the Rust speed-block trial establishes no improvement and remains unpromoted |
| [Ordered selected-state trace](benchmarks/results/2026-10-27T23-49-07.298Z-boundary-optimized-native.json) | All 64,419 events and 55,078 snapshot nodes match | One complete battle on the **pre-speed-block core**; selected state, not the full object graph or scene |
| [Rust resource controllers](benchmarks/validation/unit-resources.json) | 20,008 source differential cases; 42,806 ordered events | Base HP/MP setters and transfer selectors, including mutation/error prefixes and raw float bits |

**20,000 component cases are not 20,000 battles.** Fixed-fixture results do not qualify the random-team corpus. See [benchmark status](benchmarks/STATUS.md) for exact scopes, failed experiments and archived evidence.

## Timing profile

The [current measured-window profile](benchmarks/CURRENT_TIMING.md) attributes **43.22% of sampled self CPU to property reads/lookup/key hashing**, 4.98% to property writes/shape changes, and 4.97% to GC. Unit updates contain 53.67% of sampled CPU inclusively, buff addition 39.53%, and buff recomputation 20.67%; those inclusive costs overlap.

This points to typed Rust state and the unit/buff execution path as the large opportunities. The profile excludes startup, warmups and final reporting, and passes the raw battle comparison. Its 12.38-second instrumented window includes sampling overhead and is not a replacement for the separate unprofiled throughput measurement.

## Where the Rust work lives

- [`crates/battle-core/src`](crates/battle-core/src): engine, scheduler, units, skill timelines, typed callback queues, buffs, damage, AI, RNG and numeric semantics.
- [`unit_skill_runtime.rs`](crates/battle-core/src/unit_skill_runtime.rs): connects Rust unit updates to Rust skill execution and deferred callbacks. Shared unit fields have a canonical owner; host mutations are reconciled at call boundaries.
- [`unit_resources.rs`](crates/battle-core/src/unit_resources.rs): base HP/MP setters and transfer selectors operating on the canonical unit arena.
- [`engine_runtime.rs`](crates/battle-core/src/engine_runtime.rs): fallible engine orchestration that retains mutations before a failing mechanics call.
- [`src`](src): supplied JavaScript reference and data. [`tools`](tools) contains extraction, compilation, differential testing and profiling tools.

The connected Rust path still requires concrete mechanics hooks. Untranslated mechanics must be dispatched explicitly or fail; a missing callback is not a successful battle. Rust Entity, clone, sort and guarded numeric implementations also have separate native-runtime integrations. These paths have different coverage and should not be conflated.

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

The connected Rust unit/skill fixture has its own executable and source comparison:

```sh
cargo build --release --example unit_skill_runtime_check
node --jitless tools/check-unit-skill-runtime.mjs target/release/examples/unit_skill_runtime_check
```

That checker exercises a composed controller fixture, not complete battles. Its source oracle uses `--jitless` because JIT tiers can change NaN bits; see [oracle runtime notes](benchmarks/validation/ORACLE-RUNTIME.md). Keep `NODE_OPTIONS` empty for reference runs.

## Reproduce battle evidence

The warmed native experiment can be rerun in a workspace containing its SHA-bound compiler, private VM and seven-unit build prerequisites:

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
