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
isolated Rust V8 small-sort component matches 20,000 cases and 1,814,158 ordered
comparisons for lengths 0–63, including RNG and exceptions. It is not yet the VM
sort implementation; larger inputs remain unsupported by that component. See
`validation/v8-small-sort.json` for the admitted domain and exact source pin.

The fresh seven-unit native runs complete the frozen battle, but their raw
reports remain negative: private immutable/mutable table read counters differ by
974/30. Every other compared field matches, including final captures and table
hashes. Attribution is in progress; no diagnostic counts have been normalized.
The first-battle timings include lazy guarded-table registration and are cold
measurements, not steady-state simulation throughput. Raw results are committed
in `results/` (2026-10-27 19:55 and 19:57 UTC).
