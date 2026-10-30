Function own-data literal read candidate

The existing ordinary-object cache-hit path is unchanged. After its miss, a function value resolves its current function record to an object on each access. Only an ordinary function object with no mapped bindings may supply a fresh keyed physical data slot. `arguments` and `caller` always use the original lookup. Prototype caching remains unchanged. A slow getter's return value is preserved; the next access learns only the descriptor present after the callback.

The cache stores locations and keys, never a function identity or value. Existing weak string-key invalidation applies. Four new native tests cover raw negative-zero/NaN payloads, current function/object ID reuse through 23 collections, legacy exclusions and invalid identities, descriptor mutation, and diagnostic receiver/key/bit recording. All 115 library tests passed. The independent Node source gate passed 31 cases (62 OFF/ON observations), including recursive active arguments, mapped arguments, strict legacy throws and function mutations.

`function_own_literal_slots_enabled` controls this candidate independently. Unit and original callback-drain tools prepare separate binaries and bind their input/binary hashes for later paired timing. Throughput remains unmeasured; this candidate is not ready for promotion. These are component gates, not full-battle qualification.
