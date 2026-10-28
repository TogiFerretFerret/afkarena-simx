# Reusing pooled copyObj capacity

The existing source-proven numeric copy helper previously cloned a new property
vector and hash table before allocating its output object. Assigning those
clones discarded any capacity retained by a recycled output slot.

After all original intrinsic/descriptor/prototype/value guards pass, the new
path allocates the fresh source-visible output and uses `objects.split_at_mut`
to borrow the live source and distinct destination. `clone_from` preserves the
complete property vector (including holes/order/descriptors/raw Number bits)
and hash index while reusing destination allocations where supported. No heap,
Runtime or source-object fields are added. Fresh prototype/extensibility/kind
and arguments-map reset still belong to the existing allocator. A corrupt pool
containing the live source is rejected before allocation.

The original allocation strategy remains available through the diagnostic
`try_native_copy_obj_with_capacity_reuse(..., false)` helper. The normal compiler
hook selects the new strategy. Both execute all the same eligibility guards;
only internal allocation/copy strategy changes.

61 library tests and all 52 independent copy-source oracle cases pass. The new
source-qualified native test executes 23 original `__nativeRun` GC backedges,
reuses the destination object ID 22 times and checks finite Number bits, key
order, indexes and descriptor flags after every copy.

The allocation diagnostic observes the actual helper and standard HashMap
implementation, rather than inferring reuse from capacity:

| Strategy | Calls | GC/reuses | Allocations | Requested bytes |
| --- | ---: | ---: | ---: | ---: |
| Original clone/assign | 23 | 23 / 22 | 46 | 77,280 |
| Destination clone_from | 23 | 23 / 22 | 2 | 3,360 |

Both have zero reallocations. This confirms matching pooled hash-table storage
and vector storage are reused. Different source/destination table sizes may
still allocate. The counter covers direct guarded helper calls; it excludes GC,
setup, observers and report formatting. These are allocation counts, not a
throughput result. See `benchmarks/validation/rust-copy-capacity-allocations.json`
and `rust-copy-capacity-source.json`.

`benchmark-copy-capacity-reuse.mjs` prepares an actual unchanged source copyObj
component. It compiles the same JS source twice and varies only the generated
Rust native-hook boolean. Each trial retains every source call and fresh-output
identity check, runs 23 exact-source GC safepoints, and reports copy/GC timings
separately. Final ordered raw-bit output is checked against pinned jitless Node.
This component's clones/sec do not qualify as battles/sec.

The prepared quiet component run passes all six trials: 138,000 original source
calls, 138 original-source-qualified collections and 132,000 recycled output
IDs. Each final 47-key ordered raw-bit snapshot matches Node. Copy throughput
improved **1.175x** (1.729M to 2.032M clones/sec); including measured GC time it
improved **1.126x** (1.644M to 1.851M clones/sec). Individual copy pair ratios are
1.221x, 1.109x and 1.196x. This is one short component cohort; GC has a visible
outlier in the second reuse trial. It establishes a component improvement, not a
full-battle speedup or a complete event-trace qualification. Identity-set host
observation remains in both timed paths.

Evidence: `benchmarks/results/2026-10-28T23-04-19.305Z-rust-copy-capacity-reuse.json`.
Generated Rust alternatives, unchanged JS source, harness, manifest, native
stdout and expected Node output are archived with hashes. The native binary ran
while the integration agent's compiler was paused; oracle analysis followed
from retained output (`recordedNativeRun: true`).
