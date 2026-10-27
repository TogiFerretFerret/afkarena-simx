Current qualification status
============================

No implementation has qualified for the 10,000 faithful battles/second target.

The realistic workload uses independently selected positional 5v5 teams, level
360, A5, four job-compatible gear pieces, SI30, and one beast per team. The
scenario contract is `config/scenario-contract.json`; use
`createQualificationScenario`, which permits the same hero on opposite teams.
The frozen seed2026 input predates that selection policy and remains a regression
fixture. Battles must finish through original engine termination rules, including
timeouts. A harness frame limit is a failure, never a battle result.

Current single-process native diagnostics, all using the frozen callback-only
workload with three warmups and 20 measured battles:

| Configuration | Measured battles/sec | Full raw report |
| --- | ---: | --- |
| Original Entity body, Rust V8 sort | 0.219039 | Pass |
| Guarded Rust Entity update | 0.220975 | Pass |
| Entity plus guarded numeric/empty clone | 0.196885 | Pass |
| Same clone candidate, initial old-generation allocation | 0.223861 | Pass |
| Same, 4 GiB initial / 8 GiB maximum heap | 0.192482 | Pass |
| Same, 8 GiB initial / 8 GiB maximum heap | 0.158546 | Pass |
| Worker-owned strong table registries, default GC | 1.324503 | Pass |

These are individual diagnostic windows, not established speedups. The larger
heap experiments consumed more memory without solving the throughput problem;
their raw outputs and resource samples remain in `results/`.

The worker-owned registry candidate measures 20 battles in 15.100 seconds,
versus 101.582 seconds for the otherwise identical clone candidate: an observed
6.73× improvement in this diagnostic fixture. All 309,060 measured callbacks,
table counters/hashes, RNG, host inputs, allocation counters and final captures
match. Only the private table helper changes; original game source bytes and six
compiled units remain unchanged. The supplied worker loader retains every
approved table root throughout the batch, allowing strong Maps instead of
WeakMaps for those private registries. Generic callers and replaced table leases
are rejected. This removes diagnostic GC overhead, not game mechanics; full
scene/random-corpus/ordered-trace qualification is still outstanding. See
`results/2026-10-27T21-26-15.501Z-native-warm23-worker-map.json` and
`validation/worker-strong-map.json`. Active generic adapters remain unchanged.

The separate **instrumentation-off performance fixture** measures 20 battles in
7.330 seconds, **2.728513 battles/second**, after three warmups. Every field
matches an independently generated, instrumentation-off source JS reference.
All 309,060 measured callbacks, RNG, clock inputs, allocation counters and final
captures also match the guarded workload; the diagnostic `tableBoundary` field
is absent by this performance contract. Game callback and engine execution
match the guarded fixture. Across all 23 battles, ordinary empty-array clone admissions increase
to 360,624, with 55,821 numeric clones; qualification Proxies previously blocked
those ordinary-array guards. Only the private boundary initializer changes;
all original function bytes and six other units remain unchanged. See
`results/2026-10-27T21-55-08.845Z-native-warm23-no-proxy.json` and
`validation/warm23-no-proxy-source-node.json`. This is still a single callback-only fixture,
not a qualified full-scene, ordered-trace or random-roster result.

CPU sampling restricted to the measured battle window identifies property
access as the next bottleneck: named-property slow-path reads account for
17.18% of leaf samples, while garbage collection accounts for 5.56%. Inclusive
game stacks include Unit.update (50.85%), addBuff (39.84%) and resetBuffApply
(19.21%); these overlapping percentages must not be added. The profile contains
3,451 samples inside the two native monotonic-clock markers and excludes
initialization, all three warmups and final reporting. Its complete source
reference comparison passes. See
`validation/native-no-proxy-measured-perf-source.json`. Profiling timings are
diagnostic and do not replace the unprofiled throughput measurement above.

A separate, measured-window histogram passes the same complete source report
comparison and records 82,936,670 named-property slow-path calls. Reads of the
global `ed` binding account for 13.83%; `info`, `_battleEngineInstance`, `caster`
and `AttrDebugMgr` account for another 14.93% combined. Initialization and
warmups are excluded. See
`validation/native-measured-property-histogram-analysis.json`; histogram
instrumentation timings are not throughput results.

The first permanent-global slot-cache trial also matches the reference, but
does not improve throughput: the immutable-proof rerun measures 20 battles in
8.365 seconds (2.390915/second). Cold-start names fill its 64 entries, leaving
17,093,212 capacity rejections and only 297,014 hits across the full process.
This candidate is not promoted. Its isolated native proof covers 160,000
mutation cases, forced GC and eight complete VM lifecycles, checking current
values rather than caching values or heap pointers. See
`results/2026-10-27T22-44-29.280Z-native-warm23-global-slot.json` and
`validation/native-global-slot.json`.

Selective admission fixes that capacity failure: the `ed`-only candidate records
13,206,487 hits with one entry and no capacity rejection. Its full source report
also matches, but 20 battles take 8.164 seconds (2.449780/second), so it is not
promoted either. Both cache candidates add a wrapper to every named-property
slow read, including unrelated reads; the results do not establish that wrapper
overhead is the cause of the slowdown. See
`results/2026-10-27T22-46-08.935Z-native-warm23-global-ed-slot.json` and
`validation/native-global-ed-slot.json`.

A third variant bypasses the C++ bridge for unrelated property names using a
thread-local integer SymbolID and opaque runtime identity. Matching names still
execute the full global-object guard and load the current value. It measures
20 battles in 6.879 seconds (**2.907399/second**) with every source report field
matching, 13,206,487 cache hits, and runtime identity cleared at teardown. This
single observation is 6.56% above the earlier instrumentation-off measurement.
An adjacent baseline/candidate pair also passes every raw field: baseline
7.374 seconds (2.712232/second), candidate 7.021 seconds (2.848597/second), an
observed 5.03% throughput difference. This is one pair, not a confidence interval
or an established speedup across workloads. See
`results/2026-10-27T22-49-25.607Z-native-warm23-global-ed-prefilter.json` and
`validation/native-global-ed-prefilter-adjacent-pair.json`. The full-game qualification limits
above continue to apply.

The broader current-dictionary ordinal-hint candidate passes the complete raw
battle report, but measures 8.954 seconds for 20 battles (2.233639/second), so it
is not promoted. It records 72,935,092 ordinal hits across the full process;
high admission counts alone do not demonstrate a useful optimization. The
isolated proof compares 192,000 mutation cases against both pinned JS and
untouched native execution, including forced GC, current descriptors, getters,
exceptions and internal Empty rejection. No original class definitions or live
VM files change. See
`results/2026-10-27T22-53-56.831Z-native-warm23-dictionary-hint.json` and
`validation/native-dictionary-hint.json`. The worker benchmark uses one active
runtime per thread; alternating live runtimes requires a separate bounded
context-lifetime check before broader embedding claims.

The separate dictionary TLS-lease variant removes per-read weak/shared ownership
operations and proves bounded fallback/adoption with two live runtimes. Its raw
battle report and every cache admission counter match the earlier dictionary
candidate. Twenty battles take 7.350 seconds (2.721088/second), effectively the
adjacent plain baseline's 7.374 seconds; this does not justify promotion or more
timing trials. Teardown leaves zero live contexts. See
`results/2026-10-27T23-00-22.571Z-native-warm23-dictionary-lease.json`,
`validation/native-dictionary-lease.json` and its independent review. Runtime
initialization, use and shutdown remain on the same worker thread.

A new **selected-state ordered trace** has a completed independent source JS
reference: one fresh battle, 296 frames, 15,453 callbacks, 64,419 events and
55,078 content-addressed snapshot nodes. Traced and fresh untraced JS terminal
reports match in every raw field except timings. Both integrity and strict
schema gates pass; approximately 266 MiB of reconstructable snapshots are
preserved in 13 gzip chunks. Native comparison is still pending. See
`results/2026-10-27T23-15-36.402Z-boundary-source-reference.json`.

This diagnostic captures selected engine/unit/skill/buff lists, own enumerable
string-keyed data fields, numeric vectors, RNG/callback/mechanic boundaries and
typed payloads. It omits non-enumerable and symbol-keyed state, unselected nested
objects, prototypes, closures and the actor/effect/view lifecycle. It cannot
substitute for the outstanding full-program and full-scene trace gates. Earlier
encoding attempts with reserved-field and numeric-payload omissions were
rejected and retained as incomplete diagnostics; no partial run is a pass.

The first optimized native trace reached battle termination but failed while
serializing the entire report into one string, exceeding Hermes's string limit.
No complete native report was emitted and no parity pass is claimed. See
`results/2026-10-27T23-33-06.332Z-boundary-native-serialization-failure.json`.
The replacement changes only post-battle output to bounded NDJSON records.
Its full-source preflight round-trips all 119,499 records, all snapshots/events
and the raw terminal report; the largest row is 225,901 UTF-16 code units.
Actual Hermes transport tests and an independent build review pass. The six
other optimized objects and private VM remain byte-identical. The new native
battle/trace comparison is pending. See
`validation/battle-boundary-stream-preflight.json` and
`validation/battle-boundary-stream-build-independent-review.json`.

The warmed Static Hermes experiment recorded 20 completed repetitions of that
frozen fixture at 2.123 battles/second. It matched the emitted Node reference's
terminal state and recorded host-input consumption. See
`results/2026-10-27T17-36-51.886Z-native-native-oracle-warm20.json` for the exact
compiler, input hashes, timing boundary, and limitations. This is a diagnostic
callback-only adapter: actor/effect/view scene updates and a broad ordered trace
gate are still outstanding. It does not establish whole-game fidelity.

The older stage-1 results in `baseline.json` used a provisional adapter that
suppressed client callbacks and omitted subsequently repaired initialization.
Keep them as historical measurements; they cannot support a faithful throughput
claim or a speedup comparison with the realistic workload.

Component differential results in `validation/` establish their stated domains
under explicit mechanics hooks. They do not establish an integrated Rust battle
simulator. The pinned ten-suite gate passes 200,000 cases. Damage arithmetic also
passes its adversarial raw-bit corpus after matching operand order explicitly.
See `validation/component-verification-summary.json` for the exact source hashes
and `validation/ORACLE-RUNTIME.md` for the pinned `--jitless` reference policy.
Remaining numeric array NaN differences depend on V8 allocation-site history;
the strict numeric check reports them as failures. The compiled VM preserves literal NaN bits after a compiler repair; arbitrary
NaN payload storage still has an explicit failing probe. These discrepancies
are not accepted as bit-exact matches.

The C/Rust attribute bridge builds and runs through
`buck2 run //tools:native_attribute_abi_check`. It requires immutable numeric
inputs, preserves ordered observers, and rejects incompatible floating-point
controls. It is bridge infrastructure, not an integrated simulator benchmark.

A qualifying result needs completed realistic battles, source-backed mechanics,
matching ordered events and state bits, exact RNG and external-input consumption,
and a reproducible performance run with the fidelity instrumentation outside the
timed execution path. Omitting game callbacks or shortening timeouts cannot
qualify a result.

The current eager-source gate executes the entire supplied battle script and
passes one frozen 5v5 battle against emitted Node: 296 ticks and 15,453 executed
callbacks, matching terminal state and input consumption. The refreshed initial
graph also matches 10,914 nodes and 32,834 code entries, including observed private
Cocos allocation counters. This establishes emitter parity within the adapter
scope, not native full-battle qualification. See
`validation/tracked-capsule-source-node.json` and the corresponding
archives in `fixtures/` for exact contracts and replay inputs.

The full-scene random-team preflight covers eight independent seeds and two
mirror variants: 57 distinct heroes and 10 beasts. All ten stop at the first
unsupported actor operation on tick 1: four missing animation durations, three
missing atlas geometry records, two unsupported setSkin calls, and one unsupported
setTransform call. No case counts as completed. Exact inputs, phases, error
stacks, source hashes and host inputs are retained in
`validation/random-5v5-preflight.json`; rerun with
`node tools/preflight-random-battles.mjs`. These are concrete blockers to full-scene
qualification, separate from callback-only diagnostic measurements.

A backend compatibility audit also found observable sorting differences: Hermes
and V8 use different comparison schedules. Some supplied comparators consume RNG
or violate normal ordering rules, including a battle comparator for Sala. The
Rust V8 sort kernels match both the small-array corpus and a full 20,000-case
corpus with 12,284,696 ordered comparisons, including RNG, exceptions, merges and
gallops. The private VM adapter also passes 5,512 generated cases plus directed
mutation/coercion cases and 668 forced GC collections. The private battle runtime now uses this kernel. See `validation/v8-full-sort.json` and
`validation/native-tim-sort.json` for exact domains and source pins.

The earlier seven-unit native runs remain archived as raw negative results:
private immutable/mutable table read counters differed by 974/30. Exact
attribution to GuildTurntableTech.Level, SoundAnim.Delay and AnimAtkFrame.Time
led to the V8 sort repair; no diagnostic counts were normalized.

The repaired private native runtime now passes EVERY compared report field for
the frozen battle, including table counters/hashes, final captures, callback
counts, RNG, host inputs and private allocation counters. It executes 446 Rust
sorts and 142 admitted default string sorts with zero unsupported fallbacks.
See `results/2026-10-27T20-33-51.021Z-native-oracle-seven-v8-sort.json`. The first
battle takes 72.5 seconds including lazy guarded-table validation; this is a cold
measurement, not steady-state simulation throughput. Actor/effect/view lifecycle
and the full random roster remain unqualified.

The refreshed warmed workload passes source JS, emitted Node, and seven-unit
Node replay with every compared semantic field intact: three warmups followed
by 20 measured battles and 309,060 measured callbacks. All replay inputs and
outputs are committed under `fixtures/warm23-counter-capsule/`; the source gate
is `validation/warm23-source-node.json`.

The native Entity+TimSort candidate now passes that complete warmed report:
20 measured battles in 90.508 seconds, **0.220975 battles/second**, with 309,060
measured callbacks and zero unsupported sort fallbacks. It executes 230 Rust
Entity updates and 10,236 Rust sorts across all 23 battles. Total wall time is
178.320 seconds; the difference includes cold initialization, three warmups and
final diagnostic reporting. This is an instrumented callback-only result,
well below the target, and does not qualify whole-game fidelity. See
`results/2026-10-27T20-51-34.120Z-native-warm23-entity.json`. The historical 2.123
measurement above uses a different diagnostic configuration and is not a
matched baseline for this candidate.

The matched run retaining the original Entity body also passes every report
field: 20 battles in 91.308 seconds, 0.219039 battles/second. See
`results/2026-10-27T20-56-14.019Z-native-warm23-baseline.json`. The roughly 0.9%
difference from this single pair does not establish an Entity speedup. Only 230
Entity calls were admitted across the warmups and measured battles, making this
a small opportunity in this fixture.

The combined clone candidate passes the same raw report but is slower: 20 battles
in 101.582 seconds, 0.196885 battles/second. Keep it optional, not a promoted
optimization. Across all 23 battles it admits 55,821 numeric object copies and
only 76 empty arrays; source Node profile counts did not establish native
admission rates. See
`results/2026-10-27T21-01-54.537Z-native-warm23-entity-copy.json`. Its separate
native CPU profile is diagnostic and cannot establish throughput.

The actual native CPU profile passes replay and processing gates: 9,380 samples,
zero lost samples, exact executable/DSO/source attribution. Young-generation
evacuation accounts for 66.34% of all samples, with weak-reference acceptance
adding roughly 5.3%. GC also dominates later elapsed-time bins; this is not just
an initial boot hotspot. Exact evidence is in
`results/2026-10-27T21-02-54.615Z-native-perf-entity-copy.json` and
`validation/native-copy-perf-source.json`. The profile includes cold setup,
warmups, measured battles and final diagnostics, without exact phase markers.
Runtime GC settings are being tested against the unchanged executable and full
report gate. A larger allocation budget may postpone collection beyond a short
measurement window; it cannot by itself establish sustained throughput.

Archived ordered traces can be checked with
`node tools/check-archived-native-trace.mjs reference.stdout.gz candidate.stdout.gz metadata.json gate.json`.
This gate rejects missing state captures and compares complete ordered captures,
semantic report fields and replay consumption. Adding the checker does not
establish that an actual native battle has passed the ordered-trace gate.
