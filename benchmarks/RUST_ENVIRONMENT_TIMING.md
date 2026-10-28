# Native Rust lexical environment allocation

The original, unchanged `Unit.update` component fixture now allocates **15.6%
fewer allocation/reallocation requests** with canonical integer binding names.
This result does not establish faster complete battles.

Each 3,000-update trial includes all fixture callbacks and raw-bit event
formatting, and matches all 45,068 ordered events and selected state bits against
the pinned JS source. The two frozen runtimes differ only in `env.rs`. Existing
local-cell identities, mapped arguments, closure captures, TDZ, global bindings,
and fresh loop environments retain their behavior.

| Per 3,000 updates | Owned string binding keys | Canonical binding IDs |
| --- | ---: | ---: |
| Allocation/reallocation requests | 1,886,613 | 1,592,202 |
| Requested allocation/reallocation bytes | 263,282,221 | 237,211,476 |

All 18 trials per runtime returned the same allocation counts. Requested bytes
sum allocation and reallocation sizes; they do not measure live or peak memory.
Counters cover the timed controller call, excluding setup, warmup, reset and the
final JSON snapshot. Counter overhead affects the instrumented timing.

Uninstrumented alternated process pairs were inconclusive: the compiler-cached
fixture measured 7,595 before versus 7,575 updates/sec after; the compiler-uncached
fixture measured 7,121 versus 6,648 updates/sec. Shared CPU contention and process
variance remain present. The separately instrumented run measured different
ratios, so these measurements do not support a sustained speedup claim.

Reports and exact output archives:

- [Uninstrumented comparison](results/2026-10-28T17-09-05.184Z-rust-unit-update-env-map.json)
- [Allocation comparison](results/2026-10-28T17-09-57.234Z-rust-unit-update-env-map.json)
- [Frozen runtime and runner source](validation/rust-unit-update-env-map-frozen-runtime.json.gz)

The archive contains both complete runtime source snapshots and the allocation
counter runner. Generated component source and its pinned oracle reference are
linked from each report. `tools/rust-port/compare-unit-update-binaries.mjs`
compares built runner binaries against that source oracle and records the full
ordered snapshots. These are controller updates, not battles.
