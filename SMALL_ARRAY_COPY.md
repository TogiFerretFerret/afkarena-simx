Small dense finite array copy candidate
======================================

Code: `f6cb385`, isolated from main. The original source `ed.copyObj` entry and fallback remain unchanged. The existing pristine Object/Array constructors, Object.keys, prototype descriptors/chains, and lexical Object guard run first. Only extensible standard Arrays of length 1–4 with every own index present as default writable/enumerable/configurable finite Number data qualify. Reject own constructor, extra own keys, mapped arguments, nonwritable length, inherited numeric descriptors and recycled-source aliasing before allocation. Read all source values first, then create a fresh default Array. Preserve finite f64 bits, including -0 and subnormals. Unknown/nonfinite/accessor/hole shapes execute original source.

Actual shape coverage is low: the instrumented current qualified full 20+3 fixture observed 2507 eligible calls out of 481029 (0.521%): 391 length 1, 1748 length 2, 0 length 3, 368 length 4. Full report/raw state bits, clock/random consumption and 12 GC matched the frozen oracle; observer timings do not measure throughput. Lexical environment internals are not inspected by the external observer, so these are shape opportunities rather than exact native guard-hit counts.

Validation: 105 library tests, including all four lengths with both primary-array settings, 12 pre-allocation rejection cases and 23 original-source-qualified GC safepoints with fresh identities/reused destination IDs. 66 specialized/unspecialized original-source Node comparisons pass, including constructor getter ordering, inherited indexed setters, readonly length, index descriptors, extra nonenumerable keys, holes and trailing holes.

Frozen two-binary measurements use opt 3, CGU 64, no LTO and three alternating process pairs,three trials/process:

- Original copy source on dense length 2 (-0,minimum subnormal): 5.442× faster, 5.083× including GC. 414000 total calls and 414 GC collections across both variants; every trial's final ordered raw-bit snapshot matches pinned jitless Node. Intermediate copy results are untraced.
- Existing 47-field numeric-object copy: 1.0186×, noisy pair ratios0.964/1.043/1.052.
- Original Unit.update: 1.0626×, pair ratios0.991/1.138/1.053. **The Unit fixture never calls copyObj; this is layout/noise and cannot be attributed to this fast path.** All 180000 updates' ordered callbacks/selected state snapshots match Node.

Object 160B/property 24B unchanged. No full battle with the new runtime has been measured yet. The low actual domain coverage limits expected whole-battle benefit. Component operations/sec do not count toward the 10000 faithful battles/sec target.

Proofs: `benchmarks/results/2026-10-30T13-48-40.312Z-small-array-copy-eligibility.json`, `benchmarks/results/2026-10-30T13-53-41.335Z-rust-small-array-copy.json`, `benchmarks/results/2026-10-30T13-53-45.136Z-small-array-source-component.json`, and `benchmarks/validation/small-array-copy-library.json`.
