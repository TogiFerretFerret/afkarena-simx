# Shared canonical UTF-16 storage candidate

Canonical String IDs remain append-only and content based. The string table and UTF-16 intern map now share one immutable `Arc<[u16]>` payload instead of keeping a boxed table copy and a separate vector key. Hashing and equality still inspect complete UTF-16 contents; neither surrogate normalization nor pointer-only key equality is introduced. `Runtime::string_units()` retains its borrowed `&[u16]` API.

The private owned snapshot helper clones only an Arc handle. `String.split` uses it for its converted input and non-RegExp separator while runtime calls can mutate other state. Input/limit/separator coercion order, RegExp species/flags/exec handling, fresh arrays and every source callback remain in their original paths. Existing interned split tokens need no new UTF-16 allocation; a new canonical token allocates one shared buffer.

Giant-string collection invalidates the same weak caches before replacing table entries with empty tombstones. IDs are never reused. Runtime-owned canonical UTF-16 payloads are counted once in the diagnostic `giant_string_bytes_freed` counter: a one-MiB UTF-16 string now contributes one MiB instead of the previous duplicated two MiB. The source-visible string values and collection cadence are unchanged. A temporary owning snapshot remains valid if its canonical ID is tombstoned, and does not prevent clearing that ID's weak cache entries.

The first implementation and identity/GC tests are committed as `5d4324a` and `8bbd7cb`. All 77 native library tests pass, including exact lone-surrogate contents, both Sip/Fx hash policies, input-vector mutation independence, shared-buffer pointer identity, static/UTF8 canonical routes, cache invalidation and 23 actual root GC safepoints with dead giant strings and a live giant string. The original controller component now passes: three 5,000-call pure timing trials per implementation measured 43,777.7 versus 45,361.1 calls/sec (1.0362x aggregate). Separate 5,000-call allocation trials fell from 369,932 to 336,648 allocations and from 51,117,416 to 47,817,088 requested bytes; reallocations remained 81,703. All ordered callback events, results and original function source metadata match pinned jitless Node. These are component results, not battle throughput.

`check-shared-utf16.mjs` adds fourteen source cases, including a 245-combination split corpus and receiver/limit/separator mutation, throwing conversions, intern-table growth, regex flags, surrogate captures, JSON/property keys and fresh arrays. The fourteen new source cases pass. The remaining source gates also pass: 15 String cases, 25 RegExp cases, 34 JSON cases, 14 guarded UTF8 cases, and the unchanged original __nativeRun giant-string fixture with 23 actual collections, 69 ordered frames and 120 callbacks. These complement the 77 native library tests; a new full battle proof remains required.

`benchmark-shared-utf16.mjs` prepares separate baseline and candidate binaries for the untouched original `getNeedReadSkillCacheTb` and parser bodies. It uses the actual stage and hero-list strings from Param, compares all ordered table/battle-ID/warning calls, boolean results and function source metadata, and preserves all other runtime optimization defaults. The baseline source comes from the immutable pre-change Git commit. Pure timing binaries have no measured allocator; separate allocation-counting binaries report requested allocation/reallocation counts and bytes. Both use release opt3, 64 codegen units and no LTO.

Preparation builds but executes no controller:

```sh
node tools/rust-port/benchmark-shared-utf16.mjs --source-root /path/to/source/repository
```

After reserving a quiet measurement slot:

```sh
node --jitless tools/rust-port/benchmark-shared-utf16.mjs --run --updates 5000 --trials 3
```

Component calls/second and allocation changes do not qualify battle throughput. Promotion requires the source gates and actual source component measurements, followed by a new complete native battle proof and reference comparison.
