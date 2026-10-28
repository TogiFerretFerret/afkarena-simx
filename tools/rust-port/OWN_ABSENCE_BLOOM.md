# Own-property absence filter candidate

A monotone `u32` records `1 << (StringId & 31)` for every dictionary insertion.
`Object::own` checks primary numeric virtual elements first, then rejects an
absent mask bit before hashing the key. A matching bit proves nothing: the full
original hash lookup and descriptor remain authoritative. Deletion leaves bits
set; reuse clears the mask. Thus collisions and deleted keys only cause extra
lookups. No Values, descriptors, object identities or source outcomes are cached.

The field fits padding: the original and candidate Object layouts are both
152 bytes, alignment 8. The committed layout probe repeats the original field
list and compares its size with the actual candidate Object type.

The complete mutation audit found one dictionary-copy bypass: the source-proven
copyObj helper clones the raw property vector and hash map. It now also copies
the source mask. Other direct writes replace existing Values or delete keys.
Normal insertion, primary-array materialization and garbage-collected object
reuse preserve the invariant.

For same-binary measurements, `set_own_absence_bloom_enabled(false)` sets every
mask to all ones and future allocations retain that state. Enabling rebuilds
masks from existing keys. Both modes maintain insertion masks and execute the
bit test, so this isolates rejection benefit rather than measuring the complete
cost against an original binary without Bloom code.

Qualification: 61 library tests, 23 Bloom OFF/ON source cases and 52 existing
copyObj source cases pass. Tests cover collisions, deletion/reinsertion,
descriptors, mapped arguments, accessors, prototypes, virtual arrays,
materialization, native GC and recycled objects. See
`benchmarks/validation/rust-own-absence-bloom-gates.json`.

The quiet paired result does **not establish a repeatable speed improvement**:

| Original source component | OFF | ON | ON/OFF |
| --- | ---: | ---: | ---: |
| Unit.update, 3 x 10,000 | 16,461 updates/sec | 16,201 updates/sec | 0.9842x |
| Buff percent/fixed pair, 2 x 3 x 10,000 | 246,578 pairs/sec | 257,584 pairs/sec | 1.0446x |

Buff round ratios are 1.0896x and 0.9932x, so its aggregate gain is inconclusive.
All 150,220 ordered Unit events and selected state bits match per trial; Buff's
256 prefix snapshots and complete terminal attribute state match per trial.
Later Buff intermediate states are unobserved. Both components use the same
binary and unchanged source entry in both modes at opt3, CGU64, LTO off.
Prepared native processes ran during the root-coordinated pause of the full
build; Node oracle analysis and archival ran afterward from retained stdout.
Reports mark `recordedNativeRun: true` and leave execution wall time null.
Component updates/pairs per second are not battle throughput.

Results are the `2026-10-28T22-46-10.311Z-rust-unit-update-own-absence-bloom`
and `2026-10-28T22-46-12.659Z-rust-buff-own-absence-bloom` JSON files under
`benchmarks/results`. Keep this candidate isolated unless a full workload
establishes a benefit.
