# Physical function tag candidate

This isolated candidate uses the existing private Object.is_function tag in two
places. Ordinary objects return directly from value_for_object without probing
the function identity map. Ordinary own-property reads skip the legacy
`arguments` UTF16 key comparison before the normal descriptor lookup. Function
objects retain the existing reflection and identity paths.

All creation paths go through allocate_function_record, which sets the tag;
allocation/sweep reset_for_reuse clears it before ordinary-object reuse. The
tag is independent of prototypes, so an object inheriting from a function stays
ordinary. It remains set when a function's prototype changes. Invalid IDs retain
the prior map fallback in value_for_object.

Audit: value_for_object is used in prototype reflection, typed-array stores and
error accessors, rather than every ordinary get. The own_descriptor guard is
the change on ordinary property reads. No generated source or mechanics change.

Validation passed 41 Rust library tests, four slot tests including 23 actual
GC recycling rounds/function aliases, 47 generated closure cases and 40
generated argument/reflection cases.

The original unchanged Unit.update fixture uses identical generated source and
existing native-var/property-slot optimizations with either runtime. All
45,068 events and selected raw state bits matched the independent JS reference.
The initial sequential runtime sample observed 3,927 versus 7,383 updates/sec;
an alternating rerun over 54,000 updates per runtime observed 4,511 versus 5,990.
These are **updates, not battles/sec**.

Host contention makes the speedup magnitude uncertain. The three alternating
process pairs measured baseline/candidate updates/sec as 3,032/6,835,
5,477/4,595 and 6,550/7,306. One pair regressed. The 32.8% aggregate difference
is an observation, not an established steady-state benefit or full-battle claim.

- [Initial source qualification and archived source/snapshots](results/2026-10-28T20-07-00.523Z-rust-unit-update-function-tag.json)
- [Alternating exact-binary rerun](results/2026-10-28T20-08-21.183Z-rust-unit-update-function-tag-alternating.json)

Reproduce against an unchanged baseline checkout:

```sh
node --jitless tools/rust-port/benchmark-function-tag.mjs --updates 3000 --baseline-root /path/to/baseline
node tools/rust-port/rerun-function-tag.mjs benchmarks/results/<qualification-report>.json
```

The baseline in this evidence was d628ed0; both runtime source trees and binaries
are hashed in the qualification report. The rerun uses only archived qualified
binaries and verifies every timed trial's complete snapshot.
