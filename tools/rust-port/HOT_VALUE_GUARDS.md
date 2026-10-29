# Bounded slot and primitive fast guards

This independent candidate starts at6369efc and changes no Runtime fields.
Small dynamic-slot read/object guards and the disabled/out-of-bound learning
check become inline. The existing learning body stays out of line. Valid object
identity checks, length/string-unit access and primitive truthiness are inline;
identical object-id errors remain cold. A Number-only to_number guard returns
its original raw binary64 value; every other value delegates to the unchanged
original conversion match, including all source callbacks and recursion.

Two frozen libraries built in the same Cargo path with opt3/CGU64/noLTO differ
only in dynamic_slots.rs, runtime.rs and value.rs.90 library and26 integration
tests pass, plus36 dynamic-slot,40 coercion,24 reflection and source diagnostic
cases. Both libraries match79,026 raw-value observations, retaining the same90
explicit unsupported remainder domains. TRACE1 selected stderr is byte-identical
for original Unit.update, original callback drain and a source-frame observer.

Three alternating source pairs in a coordinated quiet slot observe1.031x Unit
updates and1.052x drain callbacks/sec. All source events, snapshots and terminal
state match pinned Node. This is one descriptive component cohort; complete
battle throughput is unmeasured and these results establish no confidence
interval. The earlier diagnostics guard is present in both libraries.

Evidence: `benchmarks/validation/hot-value-guards-summary.json` and
`benchmarks/results/2026-10-29T00-27-38.323Z-hot-value-guards.json`.
