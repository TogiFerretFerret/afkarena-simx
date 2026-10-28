# Canonical numeric keys and stack decimal indices

This candidate combines a bounded integer-to-PropertyKey memo with allocation
free native array-index formatting. Builtin index helpers and Runtime.array
share index_property_key(usize), preserving their original has/get/set/delete
positions and callbacks. Full-usize decimal formatting never rounds through
f64. The 256-entry direct-mapped memo stores the actual index alongside each
canonical key, so collisions cannot return another index's key.

Primitive Number keys use the memo only for integral values from zero through
4,294,967,294; -0 shares the canonical key "0". Other Number values and all
object coercions retain their original conversion paths. Cached decimal IDs
have at most ten UTF16 units, cannot meet the giant-string collection threshold,
and are never reused. Storage stays bounded even for huge sparse indices.

Two directed Rust tests pass, including 20,000 cached/uncached canonical key
comparisons, collisions, negative zero, fractions, infinities, NaN, boundary
indices, full-usize keys, lone-surrogate string keys and 23 verified collections.
The joint runtime's 49 library tests also pass. Wider combined source tests are
recorded by the separate integration qualification.

Controlled allocation probes with identical checksums observed:

| Workload | Old allocations | New allocations |
| --- | ---: | ---: |
| 100,000 warmed index keys | 100,000 | 0 |
| 1,000 dense eight-element arrays | 12,000 | 4,000 |
| 1,000 sparse four-element arrays | 7,000 | 3,000 |

Reallocation counts stayed unchanged. These are targeted native operation
counts, not estimates of total battle allocations.

The original unchanged Unit.update component ran through the same generated
entry and runtime with both candidate selectors OFF/ON. Fx string hashing,
stack primitive conversion and literal property slots remained enabled for both.
Three alternating trials of 3,000 updates each matched all 45,068 ordered events
and selected state bits per trial. Aggregate rates were 16,090 versus 16,608
updates/sec, an observed 3.2% difference. One pair regressed; host contention
makes this a noisy component observation, not an established full-battle gain.

- [Allocation probe](validation/rust-index-allocation-proof.json)
- [Original Unit.update paired comparison and retained observations](results/2026-10-28T21-31-49.794Z-rust-unit-update-numeric-key-cache.json)

Reproduce:

```sh
node tools/rust-port/prove-index-allocations.mjs
node --jitless tools/rust-port/benchmark-numeric-key-cache.mjs --updates 3000
```

Updates/sec are not battles/sec. Complete battle parity, throughput and random
20,000-battle coverage remain separate qualifications.
