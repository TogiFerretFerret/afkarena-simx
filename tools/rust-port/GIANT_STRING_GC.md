# Isolated selective giant string reclamation

This candidate reclaims unreachable UTF16 string payloads of at least 1 MiB
(524,288 UTF16 code units) only inside the existing opt-in, exact-source battle
backedge collector. Generic runtime execution still performs no collection.
The existing safepoint proof requires the original outer battle loop, all live
source bindings in rooted environments, no unknown native caller and no live
unregistered Rust temporaries across that edge. Hosts retaining values must
supply them as collector roots.

The collector retains string marks from its existing graph traversal. Live
property keys, values, boxed strings, environment names/cells, regex sources,
weak-map values with live keys, explicit host values, diagnostics and hidden
intrinsic guard snapshots therefore preserve their StringIDs and payloads.
Static literal cache IDs are strong roots because generated Rust may hoist them
across the safepoint. Subthreshold payloads remain canonical even when unreachable.

For each unreachable giant ID, reclamation removes its UTF16 and UTF8 interner
entries, invalidates literal-property read-site entries,
and prunes compiled-regex cache entries keyed by that ID before replacing the
payload with an empty boxed slice. IDs are append-only and never reused. A
later intern of the same content receives a new ID; no live string loses its
canonical identity. Dead regex arena records may retain a tombstoned source ID,
but cannot be reached through surviving regex objects and IDs are never reused.
Their compiled payload reclamation is outside this change.

The new stats count reclaimed strings and logical payload bytes released from
the UTF16 arena, UTF16 interner keys and UTF8 interner keys. They do not claim
an equal RSS reduction; allocator behavior requires a real-process measurement.

Validation: all 47 library tests pass, including giant dead payloads, threshold
behavior, no ID reuse, live giant property keys/values, actual giant regex
sources, hidden diagnostic roots and all three weak cache families and static-literal strong roots. The exact
original __nativeRun source fixture matches pinned Node OFF/ON for its entire
report, 69 ordered frame visits and 120 callbacks. It performs 23 collections
and reclaims 23 distinct giant temporary strings (77,594,624 logical bytes).
The unchanged-source default battle collector gate remains separately available.
No production memory or throughput claim is made by this toy fixture.
