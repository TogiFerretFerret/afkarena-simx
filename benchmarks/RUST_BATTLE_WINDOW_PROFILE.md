# Native Rust battle-window profile

The current one-battle binary was sampled only between its existing
`one_battle_start` and `one_battle_complete` stderr markers. Both profiler
control commands were acknowledged. Table loading and initialization before the
start marker, and external JSON serialization after the end marker, are
excluded. Pipe/control latency makes the boundaries approximate: enable was
acknowledged about 4.4 ms after observation, disable about 3.6 ms after.

The run produced **1,001 user CPU samples at 199 Hz**, with no reported lost
samples. Its complete final report matched the archived Node source reference,
excluding only timing fields. The binary deliberately stops after one battle
with exit code 1; this is a profiling diagnostic, not a complete batch or host
tape-consumption qualification.

## Where the battle interval spends CPU

Inclusive rows include descendants, overlap, and must not be added. These are
sample shares, not exact milliseconds or unprofiled battle throughput.

| Original source function | Inclusive samples |
| --- | ---: |
| Unit.update | 46.25% |
| Unit.addBuff | 23.08% |
| Unit.resetBuffApply | 15.48% |
| Skill.update | 11.99% |
| copyObj | 4.60% |

Two infrastructure paths also appear inside this **cold first battle**:

- `__nativeExpose`: **30.67% inclusive**. Each call scans the complete definition
  name list, builds matching prefix children with string operations, and installs
  dependency accessors. Lazy dependency loading happens after the start marker.
  A source-preserving prefix index could remove repeated scans. This cost should
  also be measured over warm battles before extrapolation.
- The original override dispatcher wrapper: **68.73% inclusive**. It switches
  on `arguments.length`, invokes its captured dispatcher directly for zero to
  five arguments, and uses `arg2arry` for larger calls. This inclusive share
  includes actual hero/mechanic work below the wrapper; it is not a claim that
  dispatch alone consumes 68.73%.

Disjoint named self samples identify the dynamic execution cost:

| Native leaf | Self samples |
| --- | ---: |
| Own-property lookup | 10.99% |
| UTF16 interning | 7.69% |
| Runtime.get | 6.89% |
| Static literal lookup | 4.70% |
| SipHash byte writing | 4.10% |
| UTF8 interning | 4.00% |
| Binding resolution | 3.70% |

Unresolved symbols account for 8.49%. With 32 KiB captured stacks, 206 samples
lack a main/wrapper frame; this is a truncation diagnostic rather than a precise
count of truncated stacks. Missing ancestry makes inclusive source percentages
lower bounds. Source owners are deduplicated within a sample so Rust helper and
closure frames do not count the same original function twice.

## Evidence

- [Raw profile and exact final-report comparison](results/2026-10-28T19-28-18.217Z-rust-program-perf.json)
- [Source-mapped inclusive stacks and self samples](results/2026-10-28T19-28-18.217Z-rust-program-perf.source-stacks.json)
- [Unprofiled binary qualification](results/2026-10-28T18-40-55.250Z-rust-one-battle-check.json)

The reports retain binary/profiler hashes, both control acknowledgments, raw
`perf.data`, complete stacks and exact source function ranges. The profiler
keeps Rust symbols and uses binutils demangling; disabling inline expansion
avoids spending minutes in `addr2line` without changing the sampled binary.

```sh
node tools/rust-port/profile-program.mjs \
  --binary work/rust-one-battle-check/2026-10-28T18-40-55.250Z/one-battle \
  --program-dir work/rust-battle-full --scope markers \
  --start-marker one_battle_start: --end-marker one_battle_complete: \
  --expected-exit 1 --report-prefix ONE_BATTLE_REPORT: \
  --reference work/rust-new-battle-profile/oracle.json \
  --frequency 199 --stack-bytes 32768
```

The source oracle is archived by the linked unprofiled qualification report.
No source clock/RNG calls or game mechanics were changed for sampling. This is
one fixed callback fixture, not random/full-scene or 10,000 battles/sec proof.
