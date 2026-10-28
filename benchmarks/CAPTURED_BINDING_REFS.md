Captured binding reference candidate — rejected

Branch `candidate/captured-binding-refs` reuses guarded, nondeletable lexical
cell addresses or nonconfigurable own-global addresses per invocation. Values,
getters, TDZ and writes remain live; dynamic addresses resolve at each source
reference. Compound assignments resolve their Reference before the RHS.

The 93-case pinned-source gate passes. The actual unchanged Unit.update paired
benchmark (same binary/runtime, three interleaved trials of 3,000 updates) is
slower: 11,827.96 updates/sec OFF versus 10,478.50 ON, ratio 0.88591. All 45,068
ordered events and selected state values match the source oracle each trial.
This is a component benchmark, not battles/sec. The per-invocation guard and
per-reference fallback branches outweigh saved lookups in this fixture.

Do not merge. Evidence is in validation/rust-generated-captured-binding-refs.json
and results/2026-10-28T21-24-40.017Z-rust-unit-update-env-keys.json (the result
suffix was inherited from the environment-ID benchmark; the captured-reference
options and complete source artifacts identify this experiment).
