# Canonical string hashing candidate

The isolated `candidate-string-hash` branch replaces the hash policy of exactly
three lookup caches: UTF16 canonical strings, UTF8 aliases and static literal
addresses. `Runtime::new_with_string_hash` selects either the original
`RandomState` Sip policy or dependency-free Fx-style hashing. Both choices use
the same runtime layout, generated code and native binary. The baseline includes
the same selector dispatch as the candidate.

The Fx policy mixes 64-bit chunks with rotate/XOR/multiply operations. Hashes
remain lookup hints: ordinary `HashMap` full key equality decides every match.
A deliberate complete 64-bit collision test keeps both different UTF16 strings
and their canonical IDs intact. Canonical IDs still follow insertion into the
ordered `Runtime::strings` vector, not bucket placement.

The only production cache consumers are lookup/insert, cache-length diagnostics,
and GC retention. GC retention adds byte counts and filters by existing IDs;
its traversal order is unobservable. JavaScript key enumeration uses the heap's
ordered property vectors. No model callback, floating-point operation, string
encoding or coercion is removed. The caches still invalidate giant dead strings,
including UTF8 aliases, static literals, literal read sites and regex keys.

This differs from the earlier 24-byte front-cache experiment (`6aa77f6`), which
kept Sip hashing on misses and did not reduce measured allocation requests.
This candidate changes hashing for strings of every supported length; it does
not add that front cache or claim fewer string allocations.

Validation:

- 48 library tests pass, including 20,000 canonical UTF16 ID sequences compared
  between policies, Unicode, NUL, surrogate pairs, lone surrogates, the deliberate
  collision, and giant-string GC/cache tests.
- 15 generated JavaScript String cases pass.
- 79,026 primitive, raw-f64 and Number/string comparisons pass. The 90 existing
  tagged-number remainder cases remain explicitly unsupported and are not passes.
- The same generated original `Unit.update` entry matches every fixture event
  and selected state bit for 18,000 updates per policy, across two rounds.

The component run was explicitly contended by the main full release build.
Round ratios were 1.134x and 1.523x; the aggregate was 1.346x (6,218 versus 8,370
controller updates/sec). One paired trial was negative: Fx took 308 ms and Sip
300 ms. All samples are retained. These provisional component figures include
fixture callbacks and raw-bit observation; they are not battles/sec, a stable
isolated speedup or full-battle qualification. A completed battle comparison and
measurement remain required before promotion.
