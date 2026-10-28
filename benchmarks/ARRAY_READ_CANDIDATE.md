These experiments are isolated on `candidate/dense-array-reads`, based on
`8f6abcf`. Neither has been promoted to the main simulator.

| Candidate | Same-entry Unit.update OFF | ON | Observed ratio |
| --- | ---: | ---: | ---: |
| Bounded contiguous array read cache | 5,047.7 updates/s | 4,416.5 updates/s | 0.875× |
| Precomputed small numeric array keys | 7,646.7 updates/s | 7,661.5 updates/s | 1.002× |

The first candidate regressed this workload. The second showed no meaningful
speed gain. Timing remains provisional under concurrent work. These are
controller updates, not battles.

Both comparisons use one binary and the same generated original Unit.update
entry, with an explicit runtime switch and alternating trials. Each variant
completed three trials of 3,000 updates; all 45,068 ordered events and selected
state/number bits per trial matched the pinned JS source.

The first implementation cached default own values for arrays of at most 64
elements. Writes updated or invalidated the cache; holes, getters, unusual
descriptors and large/sparse arrays used ordinary lookup. Commit `a8eb351`
retains that implementation and its negative result.

The branch tip replaces it with a smaller experiment: numeric array indices
0–63 select an already interned property key. All value, descriptor, prototype
and getter operations remain generic. It adds no per-object fields and copies
no values. Object keys still perform their normal observable coercions, and
Number `-0` becomes string key `"0"`. The existing V8 array NaN-storage gap is
unchanged; no bits are normalized by either candidate.

Validation also passes 29 native runtime tests, 80 generated expression cases
and 11 generated array-method cases. New tests exercise mutation, deletion,
inherited getters, descriptor changes, shrinking/growing length, huge sparse
indices and raw number bits.

Results and complete artifacts:

- [Dense-cache comparison](results/2026-10-28T18-15-20.367Z-rust-unit-update-array-cache.json)
- [Numeric-key comparison](results/2026-10-28T19-48-33.807Z-rust-unit-update-numeric-keys.json)

Reproduce the branch-tip comparison with
`node --jitless tools/rust-port/benchmark-unit-update-array-cache.mjs --updates 3000`.
