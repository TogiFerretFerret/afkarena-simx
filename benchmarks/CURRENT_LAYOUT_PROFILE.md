# Qualified layout wave: warm CPU profile

The fresh TRACE0 profile passes the complete original 20 measured / 3 warmup
fixture: 309,060 callbacks, final report/state bits, host tapes and 12 native GC
collections match the accepted JS reference. All 1,435 build inputs and eight
linked libraries remain unchanged. Manifest is `e031c120...`; qualified native
binary is `5fb6b039...`. Sampling records 2,663 samples at 99 Hz with no losses.
Both measured-window control acknowledgments are valid.

This is CPU attribution, not a throughput measurement. Startup/warmup and final
external serialization are excluded using the two original wallNow markers;
control latency/skid remain. The underlying complete-battle qualification is
`benchmarks/validation/rust-program-layout-execution-wave-full.json`.

## Self CPU, merging duplicate CGU symbol instances

The raw perf top table splits some identical demangled paths across separate
CGUs. Use the merged `topSelf` table in the source-stack report:

| Function | Self samples |
| --- | ---: |
| get_literal_cached_impl(false) | 9.01% |
| Object::own | 7.81% |
| Runtime::get(Value) | 6.31% |
| GC Trace::drain | 5.93% |
| PropertyIndex HashMap::insert | 3.53% |
| call_value | 3.34% |
| resolve_binding_id | 3.15% |
| dynamic_slot_get | 2.93% |
| static_string | 2.82% |
| own_descriptor | 2.78% |
| alloc_object | 1.99% |
| typed_own_descriptor | 1.95% |
| dictionary_insert | 1.88% |

Unresolved samples remain 5.78%. These are attribution estimates; inlined work
belongs to its containing symbol.

## Inclusive source frames

| Source function | Inclusive samples |
| --- | ---: |
| Unit.update | 49.49% |
| Unit.addBuff | 33.35% |
| Actual Cocos constructor, unit 0 / function 1107 | 19.68% |
| Unit.resetBuffApply | 17.31% |
| Buff.create | 14.12% |
| Buff constructor | 11.60% |
| createDataObj | 10.66% |
| __nativeDrain | 7.25% |
| copyObj | 6.35% |
| Class-manager assertIntact | 1.84% |

Inclusive rows overlap and include callees. The override wrapper at unit 0 /
function 120 covers 76.46% as an ancestor of battle updates; that is not 76.46%
wrapper cost. Manifest checks show function 120 already selects
`native-override-dispatch-v1` and constructor 1107 already selects
`native-class-dispatch-v1`. This differs from the separate outer-constructor
experiment whose counters show no admission.

The next measured targets are literal/generic property access and descriptor
routing. Attribute-only dense records need actual eligible-key/read/write/cache
hit coverage first: inclusive Unit time does not prove that its attribute
lookups miss the existing caches. A smaller copy candidate is plausible because
older shape observations counted many nonempty arrays; their present length,
primitive-value and prototype eligibility must be counted before promotion.

## Evidence and replay

- Preparation: `benchmarks/validation/rust-wall-profile-layout-execution-wave.json`.
- Full reference: `benchmarks/validation/rust-wall-profile-layout-execution-wave-reference.json`.
- Profile: `benchmarks/results/2026-10-29T00-36-36.007Z-rust-program-perf.json`.
- Source attribution: its `.source-stacks.json` companion.
- Every raw perf/data/report payload is preserved as hashed gzip artifact chunks.
- Completed raw files were removed only after chunk hashes, gunzip hash and full
  raw-byte equality passed; see `rust-layout-profile-raw-archive-cleanup.json`.

The fixed fixture does not establish random 5v5 / gear / beasts coverage or the
10,000 battles/sec target.
