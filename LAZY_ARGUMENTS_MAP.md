Lazy mapped-arguments storage candidate
=======================================

Baseline b5b572b. Ordinary objects previously embedded an empty 32B HashMap for the rare mapped-arguments mechanism. ArgumentsMap now contains an 8B Option<Box<BindingMap>>: default/read/clear/remove on None allocate nothing. The first insertion allocates the box and ordinary hash table; subsequent remove/clear retain both capacities for GC slot reuse. Existing default ID hasher, keys, BindingRef values and iteration semantics remain unchanged. From<BindingMap> supports Rust callers migrating the public field type with .into(); the JavaScript API does not change.

Measured layout from the initial library gate: Object 160→136B(-15% header bytes), ArgumentsMap 8B, StoredProperty 24B unchanged. No extra per-object heap allocation occurs for None. Mapped arguments incur one additional 32B Box allocation on first use; this must be measured alongside whole-heap savings.

The baseline audit lists 28 reference lines. Ordinary/function/small-array/buff/copy guards still call is_empty; none changes its JS eligibility domain. Parameter creation inserts identical BindingRefs. Reads and descriptor changes still use the original Runtime get/remove/write logic. Reachability iterates only live map entries. GC reset clears the retained map, so old BindingRefs must never act as roots.

Final library gate: 121 tests passed. The old layout assertion now expects 136B. The new 23 original-source GC regression passes: live mapped object/raw Number parameters stay rooted; delete/readonly/accessor conversion detach dead bindings; WeakMap keys/values and environments are freed; object IDs recycle; -0/signaling/quiet NaN/subnormal bits remain exact. Source gates pass 40 argument, 24 reflection and 50 closure cases; 79026 primitive value comparisons pass. Existing 2 Symbol/arguments.iterator and 90 ambiguous remainder cases remain explicit exclusions.

Source/operator gates completed before measurement. Performance compared original Unit/drain and the actual 97MB table JSON physical-slot/value/descriptor/prototype/ID fingerprint, with separate allocator instrumentation and process RSS/header-arena accounting. Snapshot preparation preserves baseline and candidate source separately; no main source edits. All builds/gates require shared flock and actual timings exclusive flock on work/native-timing.lock.

Completed component results: do not promote as-is
------------------------------------------------

All System timing processes held a verified exclusive flock; separate counting diagnostics held a shared lease. Source/binary/table hashes stayed unchanged. Original Unit/drain complete ordered callback/state snapshots match pinned jitless Node. Shape and actual table complete physical-slot/descriptor/raw-value/String-unit/prototype/identity fingerprints match between runtimes.

- Original Unit: 0.96856× baseline (~3.1% slower).
- Callback drain: 0.99941×, neutral.
- Actual table JSON: 0.96583× (~3.4% slower), 1032950 identical objects.
- Header backing arena 160→136MiB, exactly 24MiB saved.
- Table mean RSS 954.48→930.88MiB; mean peak RSS 1147.85→1124.19MiB.
- Allocation and reallocation counts unchanged for all three fixtures; none materialized a mapped argument table. Table requested bytes 1722658241→1672351169; live bytes 977922955→952757132. These byte savings are real; counted elapsed times are not throughput results.

The clean negative timing outweighs the modest total memory reduction for promotion. Keep the candidate isolated. No full battle or 10000 battles/sec claim. Full reports, allocator traces, source snapshots, generated inputs, OS lease witnesses and table hash are linked in benchmarks/validation/lazy-arguments-map/component-summary.json.
