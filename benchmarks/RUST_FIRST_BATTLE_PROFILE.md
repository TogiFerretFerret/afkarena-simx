# First complete native Rust battle profile

One original-source battle completed and its complete final report matched the
Node source reference after excluding only the two timing fields. This includes
the victory result, 296 frames/ticks, 15,453 callbacks, checksum and all captured
state bits. No floating-point or mechanic fields were normalized.

The diagnostic runner requests one measured battle and zero warmups, prints its
report, then deliberately exits with an internal diagnostic stop. The remaining
full-workload host tape is unconsumed. The raw profiler report therefore keeps
`profileSucceeded: false` and exit code 1. The separate
[assessment](results/2026-10-28T17-45-55.647Z-rust-program-perf.assessment.json)
verifies the intentional stop and exact final-report comparison.

The run retained **1,498,859 additional heap objects** during the battle. Its
existing wrapper timer measured 7.744 seconds under profiling; this is not a
throughput benchmark. The binary predates the new empty-block environment,
shared poison intrinsic and constant-time function-identity lookup changes.

The whole process produced 1,071 user CPU samples at 99 Hz, with no reported
lost samples. Startup includes source/table loading and JSON parsing; final
diagnostics are included. These are **whole-process self samples**, not measured
battle-only percentages:

| Named leaf | Sample share |
| --- | ---: |
| SipHash byte writing | 6.72% |
| Object own-property lookup | 6.54% |
| Prototype getter | 6.54% |
| UTF16 string interning | 6.07% |
| UTF8 string interning | 4.48% |
| Deallocation (`cfree`) | 3.17% |
| Static string lookup | 2.80% |
| Property-index table growth/rehash | 2.52% |

The profile supports investigating property lookup, string interning and
allocation. The prototype getter called the old function-identity scan, which
the separate runtime fix replaces with an ID index. It does not prove how much
any change improves complete battles. Unresolved symbols account for 16.8% of
samples; inlining and limited stack capture also restrict attribution.

[Raw profile, stacks and artifacts](results/2026-10-28T17-45-55.647Z-rust-program-perf.json)
pin the binary and retained evidence. Recheck the final report with:

```sh
node tools/rust-port/assess-one-battle-profile.mjs \
  benchmarks/results/2026-10-28T17-45-55.647Z-rust-program-perf.json \
  work/utf8-context-probe/one-battle-oracle.json
```

The reference JSON is also archived by the assessment. This is one fixed
callback fixture; full native ordered-event tracing, broader battle corpus and
full-scene qualification remain separate requirements.
