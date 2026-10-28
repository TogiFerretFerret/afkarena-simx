# Runtime codegen-unit experiment

Keep the current 64-unit runtime profile: this experiment did not establish a
throughput benefit from changing js-runtime alone to one codegen unit.

Both binaries use the same generated original Unit.update fixture and identical
runtime sources, opt-level 3 and no LTO. Generated code and other dependencies
remain at 64 codegen units. Only the Cargo package override for js-runtime
changes between 64 and 1. Each timing excludes startup, fixture construction,
five warmup updates, reset and final snapshot. Binaries run in alternating
process order against independent jitless source observations.

| Trial size per variant | CGU64 updates/sec | CGU1 updates/sec | Observed ratio |
| --- | ---: | ---: | ---: |
| 9,000 updates | 9,373 | 9,840 | 1.050 |
| 30,000 updates | 10,631 | 10,267 | 0.966 |

The longer run's three pair ratios were 1.020, 0.893 and 0.990. The first
sample's apparent improvement did not repeat. Shared-host native builds and
other work make these observations noisy; they do not establish a precise
regression either. These are **component updates, not battles/sec**.

Every trial matched the complete ordered component event array and selected
raw numeric state bits: 45,068 events per short trial and 150,220 per long one.
The generated source, actual/expected snapshots, binaries' hashes, Cargo
profiles, compiler inputs and Cargo timing HTML are retained.

Initial package compilation observed js-runtime at 15.88 seconds with CGU64
versus 12.17 seconds with CGU1; complete cold builds took 33.25 and 29.34
seconds. Source/page caches and host load were not controlled, so this does not
prove a compile-time advantage. The long run reused both runtime artifacts and
rebuilt only the changed fixture harness in about four seconds per variant.

- [Initial exact paired run and cold compilation timings](results/2026-10-28T20-55-49.938Z-rust-runtime-cgu.json)
- [Longer exact paired run](results/2026-10-28T20-57-04.097Z-rust-runtime-cgu.json)

Reproduce in an isolated checkout:

```sh
node --jitless tools/rust-port/benchmark-runtime-cgu.mjs --updates 3000
node --jitless tools/rust-port/benchmark-runtime-cgu.mjs --updates 10000
```

No main build profile or simulator source changed. Full battles and random
20,000-battle coverage remain separate qualifications.
