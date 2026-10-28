This candidate adds read-only heap reachability diagnostics. It does not free,
reuse, reset or rewrite any runtime object, environment, function or string.
It stays on `candidate/reachability` until the full program build is finished.

Call the API from the Rust host after a generated entry has returned:

```rust
let report = rt.host_boundary_reachability(
    &[returned_report, retained_fixture],
    js_runtime::reachability::WeakEdgePolicy::Ephemeron,
)?;
eprintln!("{report:#?}");
```

Pass every host-retained `Value`. If the host also retains non-global `EnvId`
handles, use `host_boundary_reachability_with_env_roots(values, environments,
policy)`. Active generated calls, construction or array joins are rejected;
unregistered Rust temporaries inside those calls are not roots this API can see.

Each arena reports total, graph-reachable and retained-but-unreachable counts.
Buffer and UTF16 storage byte counts are included. Interning and compiled-regex
caches are excluded from the language root graph and reported separately. They
are still intact; an unreachable string count does not mean its storage is free.
Hidden error-stack override entries are conservatively strong roots, which may
overestimate the live graph. Debug diagnostic records and saved intrinsic guard
snapshots are traced because they retain raw handles for later use.

`Ephemeron` traces live Map/Set entries strongly, WeakMap values only when their
keys become live, and WeakSet keys weakly. It iterates to a fixpoint so chains
of WeakMaps work. `ConservativeStrong` retains keys and values in all reachable
collections and shows the extra objects that a conservative policy would retain.
Neither mode implements weak-reference GC behavior or modifies a weak collection.

The graph follows prototypes, raw data/accessor descriptors, mapped arguments,
closure environments, bound functions, lexical cells, shared binary buffers,
collection iterators and RegExp sources. It never calls getters, performs JS
coercion or executes source callbacks. Invalid graph handles reject inspection.

Validation: `cargo test -p js-runtime --lib`. Six graph tests cover inaccessible
cycles, explicit host and closure roots, non-observing accessors, WeakMap fixpoint
and cycle behavior, shared buffers, iterators, cache-only strings, invalid roots,
explicit environments and active-stack rejection. The archived result is in
`benchmarks/validation/rust-reachability-candidate.json`.
