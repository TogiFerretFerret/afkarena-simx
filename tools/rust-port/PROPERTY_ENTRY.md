# Single-probe ordered property insertion

`Object::dictionary_insert` uses `HashMap::entry` in place of `get` followed by
`insert`. An occupied entry replaces the descriptor at its existing vector slot.
A vacant entry appends the same `(key, descriptor)` at the end and stores that
index through the already computed entry. Primary numeric array materialization
uses the same method. Property order, holes, descriptors, raw Number bits and
source-visible outcomes are unchanged. No fields or caches are added.

Keys are canonical integer IDs with an internal callback-free hasher. Entry
occupation has the same key equality as the previous lookup; a vacant insertion
reuses its computed hash/probe instead of hashing the new key a second time.
Enumeration continues to use the ordered vector, never hash-table iteration.

70 library tests pass, including exact-source GC/reuse tests. Independent source
gates also pass: reflection 24, arguments 40, arrays 11, primary arrays 70 and
closures/bound calls 47. Two pre-existing Symbol-related arguments observations
remain explicitly unsupported. See
`benchmarks/validation/rust-property-entry-gates.json`.

The actual source component uses unchanged `__nativeDrain` with the established
closure/callback queue fixture. Both runtimes create every callback closure and
function descriptor, queue every callback, invoke it and execute both snapshots.
Three alternating process pairs contain 18 trials: all 230,400 callbacks and
460,800 snapshots match the complete ordered Node reference output.

Observed throughput is 133,365 to 135,484 callbacks/sec (**1.0159x**). Pair ratios
are 1.0322x, 0.9922x and 1.0239x: the small gain is not a robust speed claim.
This demonstrates faithful component execution; callback rates are not battle
throughput. Both binaries use the same generated source and opt3/CGU64/LTO-off
settings; only dictionary insertion changes. Prepared native processes ran in a
quiet slot; Node validation followed from retained output.

Evidence: `benchmarks/results/2026-10-28T23-17-04.592Z-rust-property-entry.json`.
Baseline/candidate heap sources, generated fixture, original drain source,
harness, manifest, stdout and expected output are archived with hashes.
