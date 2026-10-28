# Packed literal read slots

`CachedSlot` stores the canonical string key and a physical property index in two
`usize` words. Both fields use `usize::MAX` for an empty hint. The former
`Option<PropertyKey>` and `Option<usize>` representation occupies four words on
the supported 64-bit host. No Object fields are added.

String IDs and physical property indices originate from non-zero-sized vectors;
their valid indices cannot reach `usize::MAX`. A hint is never a cached Value:
every hit still reads the current object, bounds-checks the physical slot,
compares the complete current key and checks that the descriptor contains data.
Functions and unsupported exotic objects retain the original fallback.
Reclaimed giant-string keys reset both fields before cache reuse.

The library suite passes 54 tests, including giant static-literal string
reclamation/re-interning, live raw bits, native object reuse and sentinel reset.
See `benchmarks/validation/rust-packed-literal-slots-lib-tests.json`.

`benchmark-packed-literal-slots.mjs` builds two binaries from the same original
Unit.update fixture with opt-level 3, 64 codegen units for all crates and LTO off.
Only `property_slots.rs` changes. Every callback and the raw-bit observer remain
in the timed call. Three alternating pairs compare ordered events and selected
state with pinned jitless Node. Component updates/sec do not qualify as battle
throughput. Use `--prepare-only`, then `--run-prepared` with the same `--updates`
value to separate compilation from the exclusive measurement slot.

The independent source oracle passes all 19 cache OFF/ON cases; see
`benchmarks/validation/rust-packed-literal-slots-source.json`. An earlier checker
attempt was rejected because its tracked source changed during the parallel
baseline build; the sequential retry above is the qualifying run.

Measured result: **neutral, no established speed improvement**. Three alternating
10,000-update pairs produced 16,452.35 updates/sec for the baseline and 16,380.19
for packed slots (0.995614x). Each of the six trials matched all 150,220 ordered
events and the selected raw-bit state against Node. Pair ratios were 1.016x,
1.014x and 0.958x. Do not present the memory reduction as a throughput win.

Evidence: `benchmarks/results/2026-10-28T22-36-39.431Z-rust-packed-literal-slots.json`.
Both property-slot source alternatives, unchanged generated fixture, original
source, harness, manifests, build timings and raw results are archived there.
The packed build's wall time includes a deliberate SIGSTOP while other agents
measured battles; it is not a clean compilation-speed measurement.
