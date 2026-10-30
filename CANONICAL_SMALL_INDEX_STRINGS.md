Canonical small index string lowering
====================================

Code 85c3549 changes only compiler stringValue: when staticLiteralStrings is enabled and the exact string is one character 0–3, emit Value::String(js_runtime::StringId(N)). Runtime::new_with_string_hash already interns these four strings before bootstrap; new() delegates to it. Existing primary numeric arrays use the same ID contract. No runtime field, branch, allocation, hashing or callback is added.

staticLiteralStrings=false retains rt.string; numericLiteralKeys=false retains computed numeric Number keys; computed[-0] still normalizes through String(-0) to "0". Other strings, Unicode and lone surrogates retain the original lowering. The codegen contract checks all four IDs, both disabled settings, noncanonical forms and -0.

Source coverage: the original pinned Unit.update has 68 numeric computed member sites (40 index 0, 28 index 1). The full original Unit fixture has 132 static lookups eliminated (76/51/3/2 for 0/1/2/3). Original callback drain has zero matching sites and its generated Rust is byte-identical before/after, providing a negative control. Counts are static source sites, not dynamic calls.

Native validation against the current qualified hot-execution runtime:

- 378 independent Node comparisons: numeric keys, coercions, control flow, arrays and explicit string values, each with enabled/staticOFF/numericOFF settings. Every runtime instance asserts canonical IDs0–3.
- Original Unit.update and drain ordered callbacks and selected snapshots match pinned jitless Node; selected TRACE1 stdout/stderr observations match between compiler variants.
- Twelve complete native timing processes, alternating variants in three pairs; one frozen runtime rlib used for all four opt3/CGU64/noLTO binaries. Generated source and runtime hashes remain unchanged.
- Unit 1.00279× (+0.28%); byte-identical drain 1.00036×. Treat timing as neutral, not a meaningful benchmark speedup.

Results and full compressed artifacts are in benchmarks/results/2026-10-30T14-46-12.187Z-canonical-small-index.json and benchmarks/validation/canonical-small-index-source-gate.json. External UTF16 source metadata pools are archived after timing but were absent from the initial timing input hash map; the report documents this limit. The 378 case gate embeds source metadata directly. No full battle with this compiler change has been measured, and component rates do not count toward 10000 faithful battles/sec.
