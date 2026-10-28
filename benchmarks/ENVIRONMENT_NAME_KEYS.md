Candidate branch `candidate/env-name-keys` hoists canonical identifier IDs in
generated Rust. Main integration and whole-battle validation remain pending.

The runtime adds ID-based declaration, initialization, resolution, lookup,
assignment and `typeof` entry points. They use the original binding machinery:
parent scopes, global property existence, getters, setters, TDZ and mutable
cells are still checked at the original source operations. Only the immutable
identifier spelling is cached. Values and captured binding references are not
cached by this change.

The compiler prepares each distinct name once per Rust function or split
helper, using the existing canonical static-string cache. Specialized source
fast paths still return before this preparation. `staticEnvironmentNames:false`
retains the original string-based calls for comparison.

The first paired component run measured original Unit.update at 7,675.3
updates/s with string names and 9,195.1 with IDs, an observed 1.198× ratio.
Both variants run in one binary with identical runtime/options and alternating
trials. They are two generated versions of the same source function, rather
than the same machine-code address. Timed windows include the fixture's
callbacks and raw-bit observers. Concurrent work makes these timings
provisional; they are updates/s, not battles/s.

Each variant completed three trials of 3,000 updates. All 45,068 ordered events
and selected state bits per trial matched pinned JS. Validation also passes
63 focused ON/OFF/forced-split environment cases, 47 closure cases, 40 control
cases, 80 expression cases and 41 native runtime tests.

- [Component result and artifacts](results/2026-10-28T20-03-31.671Z-rust-unit-update-env-keys.json)
- [Focused environment gate](validation/rust-generated-env-name-keys.json)

Run `node --jitless tools/rust-port/benchmark-env-name-keys.mjs --updates 3000`
to reproduce the component benchmark. Captured-reference caching is a separate
proposal and has not been implemented on this branch.
