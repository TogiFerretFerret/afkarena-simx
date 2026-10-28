# Allocation-wave warm profile

The qualified allocation-wave binary again matched the complete original
20-battle report and host-input consumption under a trace-disabled warm profile.
The tiny driver delegated the original two measured wall-clock calls, asserted
RUST_PORT_TRACE=0, and observed all 23 collections. Startup and three warmups
were outside the sampled interval.

There were 3,277 CPU samples at 99 Hz, zero lost samples, and both control
acknowledgments. Enable/disable acknowledgments followed marker observation by
about 0.85/0.63 ms. The 33.75-second profiled interval is not an unprofiled
throughput measurement.

| Native leaf | Self sample share |
| --- | ---: |
| Literal property-slot reads | 9.70% |
| GC Trace.drain | 8.51% |
| Object.own | 8.27% |
| Runtime.get | 7.26% |
| Property-index insertion | 3.51% |
| Own-descriptor lookup | 3.36% |
| Binding resolution by ID | 2.90% |
| Static string lookup | 2.53% |
| Function call dispatch | 2.47% |
| Typed own-descriptor lookup | 2.35% |
| Object.insert | 1.53% |
| Typed reads | 1.46% |

Unresolved symbols account for 7.02%. Inclusive rows overlap: Unit.update
48.37%, Unit.addBuff 33.45%, Puppeteer.Puppet_update 23.80%, TwinsB.update
18.86%, the Class wrapper 17.88% and Unit.resetBuffApply 16.72%.
688 samples lack a main/wrapper ancestor with the captured 32 KiB stacks, so
inclusive source shares can omit ancestry.

The cost distribution moved after the combined optimizations. Builtin routines
appear in 6.96% of stacks versus 16.37% in the preceding trace-disabled profile.
__nativeDrain inclusive share fell from 14.72% to 5.40%; every callback and
snapshot remains in the compared report. UTF8 interning self share fell from
3.00% to 1.16%, and UTF16 interning from 1.95% to 0.88%. Several changes were
combined, so these differences cannot be attributed to a single feature.
Property access and global-graph collection remain substantial targets.

Percentages describe sampled CPU composition. They are not standalone speedup
measurements, allocation call counts, or proof of random 20,000-battle fidelity.

- [Raw profile and exact report comparison](results/2026-10-28T21-53-01.251Z-rust-program-perf.json)
- [Original-source hot map](results/2026-10-28T21-53-01.251Z-rust-program-perf.source-stacks.json)
- [Driver and exact linked-library provenance](validation/rust-wall-profile-allocation-wave.json)
- [Independent unprofiled full-batch qualification](validation/rust-program-allocation-wave-full.json)

Reproduce after the full report passes and the target is frozen:

```sh
node tools/rust-port/prepare-wall-profile.mjs \
  --baseline benchmarks/validation/rust-program-allocation-wave-full.json \
  --output benchmarks/validation/rust-wall-profile-allocation-wave.json
node tools/rust-port/profile-program.mjs \
  --binary work/rust-wall-profile/2026-10-28T21-51-50.993Z/wall-profile \
  --program-dir work/rust-battle-full --scope markers --trace-env 0 \
  --start-marker PARALLEL_WALL_NOW:0: --end-marker PARALLEL_WALL_NOW:1: \
  --reference work/rust-allocation-wave-profile-reference.json \
  --frequency 99 --stack-bytes 32768
```

Use the newly emitted driver path when preparing again. The reference file is
the raw referenceReport extracted from the linked full-batch qualification.
