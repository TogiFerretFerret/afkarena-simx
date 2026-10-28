# Warm full-batch profile

The exact release binary passed all non-timing fields and host-input consumption
against the qualified 20-battle source report while sampled at 99 Hz. Sampling
started after collection 3 (the three warmups) and stopped after collection 23.
Both commands were acknowledged, approximately 3.4 ms and 1.5 ms after observing
the existing stderr markers. No source clock/RNG calls or mechanics changed.

There were 5,896 CPU samples and zero lost samples. The measured marker window
was about 60.35 seconds under tracing/profiling; this does not measure normal
battles/sec. Startup, lazy first-battle initialization and warmups are excluded.

| Native leaf | Self samples |
| --- | ---: |
| Object.own | 7.78% |
| get_literal_cached | 7.55% |
| GC Trace.drain | 5.38% |
| Runtime.get | 5.19% |
| UTF8 interning | 4.53% |
| Binding resolution | 3.61% |
| SipHash byte writing | 3.09% |
| String hashing | 2.82% |

Unresolved symbols account for 6.39%. Inclusive original-source shares overlap:
Unit.update 47.22%, Unit.addBuff 32.19%, Puppeteer.Puppet_update 23.52%,
TwinsB.update 18.35%. The cold __nativeExpose path is absent from the hot list;
its earlier first-battle cost should not be extrapolated to warm throughput.
1,342 samples lack a main/wrapper ancestor with 32 KiB captured stacks, so
source-inclusive shares can omit ancestry.

All 23 collection records are retained. Pauses totalled 5.476 seconds across
warmups and measured battles, including 4.831 seconds for collections 4–23.
The externally observed process VmHWM was 3,377,548 KiB (about 3.22 GiB).
The RSS observer attached mid-run after `/proc/PID/task/PID/children` proved
unavailable; VmHWM retains lifetime high water. The profiler's automatic memory
observer recorded zero samples, so use the separate explicit-PID observer data.

- [Exact report comparison, raw perf data and stacks](results/2026-10-28T20-16-21.297Z-rust-program-perf.json)
- [Source-mapped stacks](results/2026-10-28T20-16-21.297Z-rust-program-perf.source-stacks.json)
- [All collection statistics and external memory samples](results/2026-10-28T20-16-21.297Z-rust-program-perf.memory-gc.json)

Reproduce with the qualified binary and its archived source reference:

```sh
node tools/rust-port/profile-program.mjs \
  --binary work/rust-port-shared-target/release/rust-battle-program \
  --program-dir work/rust-battle-full --scope markers --trace-env 1 \
  --start-marker 'rust_port_battle_gc:collections=3 ' \
  --end-marker 'rust_port_battle_gc:collections=23 ' \
  --reference work/rust-warm-profile-reference.json \
  --frequency 99 --stack-bytes 32768
```

This is the existing fixed callback fixture. It does not qualify full-scene
random battles or 20,000-battle coverage.
