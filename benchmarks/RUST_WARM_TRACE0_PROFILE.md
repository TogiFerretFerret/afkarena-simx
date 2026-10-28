# Warm profile with runtime tracing disabled

The current native 20-battle/three-warmup program matched every non-timing
report field and host-input consumption while profiled with
`RUST_PORT_TRACE=0`. Its tiny linked driver asserts that setting. The original
wall-clock host function still executes; two sideband markers bracket its
existing measured calls. This excludes initialization and the three warmups
without enabling recent-get diagnostic recording.

There were 4,660 samples at 99 Hz and zero lost samples. Both control commands
were acknowledged approximately 0.94 ms and 0.81 ms after marker observation.
The marker interval was 47.59 seconds under profiling. This is not an
unprofiled throughput measurement.

| Native leaf | Self sample share |
| --- | ---: |
| Literal property-slot reads | 8.73% |
| Object.own | 8.07% |
| Runtime.get | 6.61% |
| GC Trace.drain | 6.09% |
| Runtime.get_inner | 3.48% |
| Static string lookup | 3.26% |
| SipHash byte writing | 3.11% |
| UTF8 interning | 3.00% |
| Property-index insertion | 2.88% |
| Own-descriptor lookup | 2.64% |
| Typed own-descriptor lookup | 2.10% |
| Property-key conversion | 2.08% |
| Binding resolution by ID | 2.02% |
| UTF16 interning | 1.95% |
| Function call dispatch | 1.95% |
| Number formatting | 1.70% |

Unresolved symbols account for 5.62%. Allocation is not measured by call count:
malloc/free self samples total 1.44%, and object allocation has 0.84% self.
Dictionary insertion, object initialization, GC and cache pressure also carry
memory costs, so allocator self time does not measure all allocation overhead.

Inclusive source shares overlap: Unit.update 44.16%, Unit.addBuff 32.53%,
Puppeteer.Puppet_update 22.94%, the Cocos Class wrapper 17.79%,
TwinsB.update 16.52%, Unit.resetBuffApply 15.47% and __nativeDrain 14.72%.
The last function drains client callbacks with shift and executes snapshots
around each callback; it is not disposable logging work. The Class percentage
includes its actual constructor descendants and is not dispatcher self cost.
897 samples lack a main/wrapper ancestor with 32 KiB stacks, so inclusive
ancestry can be missing.

The hot costs remain property access, key conversion/interning, hash tables and
GC. Array.length is virtual in the existing general descriptor path and does
not hit the own-data slot cache. Number formatting is consistent with dynamic
numeric keys requiring conversion, but samples alone do not count such reads.

- [Exact final-report comparison and retained raw profile](results/2026-10-28T21-02-53.236Z-rust-program-perf.json)
- [Original-source inclusive stacks and self samples](results/2026-10-28T21-02-53.236Z-rust-program-perf.source-stacks.json)
- [Tiny-driver build/link provenance](validation/rust-wall-profile-2026-10-28T21-02-22.060Z.json)

Reproduce using that exact qualified driver and the raw referenceReport from
rust-full-program-next.json:

```sh
node tools/rust-port/profile-program.mjs \
  --binary work/rust-wall-profile/2026-10-28T21-02-22.060Z/wall-profile \
  --program-dir work/rust-battle-full --scope markers --trace-env 0 \
  --start-marker PARALLEL_WALL_NOW:0: --end-marker PARALLEL_WALL_NOW:1: \
  --reference work/rust-trace0-profile-reference.json \
  --frequency 99 --stack-bytes 32768
```

This fixed callback fixture does not qualify random full-scene battles or
20,000-battle coverage. The internal optional memory observer recorded no
samples because this environment omits the /proc task-children interface;
no process-memory claim is made from this profile.
