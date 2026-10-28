Numeric literal read-slot candidate

Isolated branch `candidate/numeric-literal-read-slots`; default OFF, no runtime
changes. The existing pinned numeric-literal whitelist and String(number)
canonicalization now optionally produce a literal Reference. Reads reuse
get_literal_cached; writes retain ordinary setters and descriptor semantics.
The unchanged Unit.update gains 60 guarded read sites (264 to324); its other
eight numeric member sites are pure writes.

The 126-observation source gate passes, including raw signaling/quiet NaN
payloads and signs, negative zero, getters, prototype changes, polymorphic
physical slots, compound/update/logical assignments, coercion fallbacks and
original function source text.

The first paired source Unit.update result shows no demonstrated speed gain:
15,662.17 updates/sec OFF versus15,216.53 ON, ratio0.97155. Three interleaved
trials of3,000 updates each match all45,068 ordered events and selected state
values per trial. Individual ratios vary0.902–1.031 and timed windows are about
0.2sec, so this is noisy negative evidence, not a robust causal slowdown.
This fixture remains in attack state; many walking coordinate sites are not
executed. No merge recommendation on this evidence. These are component
updates/sec, not battles/sec.

Evidence: validation/rust-generated-numeric-literal-read-slots.json and
results/2026-10-28T21-57-25.852Z-rust-unit-update-numeric-literal-read-slots.json.
