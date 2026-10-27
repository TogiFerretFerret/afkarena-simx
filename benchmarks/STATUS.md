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
the strict numeric check reports them as failures. The compiled VM also has
separate NaN literal/storage discrepancies under investigation. These are not
accepted as bit-exact matches.

The C/Rust attribute bridge builds and runs through
`buck2 run //tools:native_attribute_abi_check`. It requires immutable numeric
inputs, preserves ordered observers, and rejects incompatible floating-point
controls. It is bridge infrastructure, not an integrated simulator benchmark.

A qualifying result needs completed realistic battles, source-backed mechanics,
matching ordered events and state bits, exact RNG and external-input consumption,
and a reproducible performance run with the fidelity instrumentation outside the
timed execution path. Omitting game callbacks or shortening timeouts cannot
qualify a result.
