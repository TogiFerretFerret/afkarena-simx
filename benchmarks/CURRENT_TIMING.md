# Current battle timing profile

The current Rust-integrated native candidate passes the complete raw JS report comparison, including callbacks, RNG/clock consumption and fast-path/runtime counters. The profile covers **20 measured battles**, after three warmups, with **6,182 measured-window samples at 499 Hz**. Startup and final diagnostics are excluded.

The marker window is **12.38 seconds under profiling**. The separate unprofiled trial is **7.187 seconds for 20 battles (2.783 battles/second)**. DWARF sampling adds substantial overhead; this run is a hotspot diagnostic, not a new throughput result.

## Where user CPU is spent

These self-time buckets are disjoint. Milliseconds are **period-weighted sampling estimates per battle under profiling**, not unprofiled timings.

| Self-time bucket | Sampled user CPU | Estimated CPU ms/battle |
|---|---:|---:|
| Property reads, lookup and key hashing | 43.22% | 267.74 |
| Other VM operations | 27.00% | 167.23 |
| Other compiled application code | 10.55% | 65.33 |
| Other native/system code | 5.06% | 31.36 |
| Property writes and shape changes | 4.98% | 30.86 |
| Garbage collector | 4.97% | 30.76 |
| Call dispatch and function construction | 3.36% | 20.84 |
| Allocation and memory primitives | 0.86% | 5.31 |

The largest individual leaf is `_sh_ljs_get_by_id_rjs` at **15.66%**. This supports moving state access into typed Rust storage rather than replacing only arithmetic while retaining dynamic object lookups.

## Which mechanics contain the cost

Inclusive time includes descendants. These rows **overlap and must not be added**. Small self time does not make a mechanic cheap: most work executes in its VM callees.

| Mechanic | Inclusive user CPU | Own self CPU |
|---|---:|---:|
| BattleEngine.tick | 85.89% | 0.06% |
| Unit.update | 53.67% | 0.36% |
| Unit.addBuff | 39.53% | 0.18% |
| Unit.resetBuffApply | 20.67% | 0.06% |
| Skill.update | 12.18% | 0.16% |
| Buff.update | 4.48% | 0.18% |
| Ai.update | 3.59% | 0.05% |
| Callback queue drain | 6.00% | 0.03% |

The Rust Speeder guard/kernel together account for **0.36% self samples**. It is not the large opportunity implied by the whole `Unit.update` subtree. Buff creation/reapplication and the unit/skill execution path are the source-level targets; callback dispatch and source ordering still need to be preserved.

## Evidence and reproduction

- [Period-weighted timing data](validation/native-current-timing-breakdown.json)
- [Source-mapped measured samples](validation/native-current-measured-perf-source.json)
- [Raw profile and exact replay gate](results/2026-10-28T15-13-33.840Z-native-perf-current-rust-speeder-measured.json)
- [Separate unprofiled benchmark](results/2026-10-28T00-00-09.130Z-native-warm23-unit-speeder-battle.json)

```sh
node tools/analyze-current-native-timing.mjs benchmarks/results/2026-10-28T15-13-33.840Z-native-perf-current-rust-speeder-measured.json
```

This is one fixed callback-only fixture. It does not qualify the full actor/effect/view lifecycle, the requested random 5v5 corpus, or 10,000 faithful battles/second.
