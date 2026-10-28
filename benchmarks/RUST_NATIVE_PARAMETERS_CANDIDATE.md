# Immutable native parameters and empty activation candidate

This isolated compiler candidate keeps immutable, uncaptured simple parameters
in Rust `Value` locals. Duplicate formals, implicit `arguments`, eval contexts,
captured or reassigned parameters stay in the existing environment path.
Legacy `f.arguments` reads still create fresh original snapshots: for an
unchanged parameter its raw call slot equals its current value, so the runtime
does not need an address into the Rust stack.

An anonymous nonsplit function reuses its parent environment only when all
formal and var cells are native and there are no nested functions, lexical
declarations, catch scopes, class declarations, eval, implicit arguments or
GC-root driver. Free names resolve through the same parent. This eliminates
the activation allocation without changing the runtime or its GC roots.
`nativeParameters:false` disables both candidate transformations.

On the original unchanged Unit.update component, both variants retain all
existing native-var, numeric and property-slot optimizations. Over three
alternating trials of 3,000 updates each:

| Variant | Updates/sec | Environments per trial | Objects per trial |
| --- | ---: | ---: | ---: |
| Existing compiler | 5,664 | 94,739 | 54,068 |
| Candidate | 6,213 | 43,671 | 54,068 |

Observed improvement was 9.7%; environment records decreased 53.9%. Every
trial matched the independent jitless JS source's 45,068 ordered events and
selected state bits. These shared-host timings were collected while other
builds were active and are component updates, **not battles/sec**. Candidate
lowering also applies to fixture callbacks/observers, so the gain does not
belong exclusively to Unit.update.

Environment counts use two diagnostic `child_env` sentinel IDs outside each
timed window; collection is disabled in this component. The difference excludes
both sentinels. Object counts cover the timed call only. These observers do not
modify source mechanics or enter the timed interval.

Evidence: [component report](results/2026-10-28T20-01-12.432Z-rust-unit-update-native-parameters.json),
[40 arguments cases](validation/rust-generated-arguments-elision.json),
[47 closure cases](validation/rust-generated-closures.json), and
[six directed anonymous-activation cases](validation/rust-generated-native-parameters.json).
The directed cases include callback reflection during an elided activation,
fresh legacy snapshot identity, raw -0, extra arguments, throw cleanup, lexical
shadowing and parent mutation. Independent structural tests cover 18 activation
eligibility cases; existing native-local and argument-policy tests also pass.

No complete battle or random/full-scene qualification is claimed.
