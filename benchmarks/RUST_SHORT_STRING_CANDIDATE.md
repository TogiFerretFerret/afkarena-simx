# Short string lookup candidate

This candidate adds a 64-slot, content-verified cache before the existing UTF8
interner map. The existing map already avoids UTF16 conversion and temporary
vectors for repeated strings. This change targets its hashing/lookup cost; it
does not eliminate more repeated-string allocations.

Every entry owns up to 24 UTF8 bytes and a canonical `StringId`. A slot hint uses
length and three bytes, but a hit requires full byte and length equality.
Collisions fall back to the existing interner. The cache never relies on caller
pointers or retained borrowed buffers. UTF8/UTF16 entry order, embedded NUL,
non-ASCII, surrogate pairs and distinct lone-surrogate strings retain canonical
identity. `intern_utf16` is unchanged. Dynamic strings over 24 bytes use the
existing map. No source callback or coercion is elided.

The isolated worktree branch is `candidate/intern-cache`. Main was not changed.
The original `Unit.update` fixture was built against frozen runtimes differing
only in `Runtime.intern`'s body; both retained the same cache field and layout.
All 54,000 updates per runtime matched the pinned source's complete fixture
event sequence and selected state bits (45,068 ordered events per trial).

| Compiler variant | Before updates/sec | Candidate updates/sec | Observed ratio |
| --- | ---: | ---: | ---: |
| Uncached local bindings/literals | 4,219 | 5,621 | 1.33x |
| Cached local bindings/literals | 4,216 | 5,743 | 1.36x |

These three alternated process pairs ran while the full program release build
used all four CPUs. Part of the run also overlapped allocation instrumentation.
The timing is explicitly contended and establishes no sustained speedup.
Separate instrumented timing moved in the opposite direction. These are
component updates, not battles; full-battle validation and measurement are still
required before promotion.

Allocation/reallocation counts were **unchanged** at 1,592,202 requests and
237,211,476 requested bytes per 3,000 updates, with all six trials per runtime
agreeing. The instrumented call excludes runtime setup, warmup and final JSON
serialization, and retains all fixture callbacks/raw-bit formatting. The new
fixed-size cache increases runtime object storage, rather than heap requests in
the measured controller call.

Evidence:

- [Uninstrumented comparison](results/2026-10-28T17-29-53.355Z-rust-unit-update-short-string-cache.json)
- [Allocation comparison](results/2026-10-28T17-29-49.757Z-rust-unit-update-short-string-cache-allocations.json)

Both reports retain exact outputs, frozen runtime/runner source archives and
binary hashes. Semantic gates also passed: 22 runtime tests, 8 heap tests, 2
canonical-string/cache-collision tests, 80 generated expression cases and 47
generated closure cases. No battle throughput claim is made.
