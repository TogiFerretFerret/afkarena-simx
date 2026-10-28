# Measuring fork benchmark observer overhead

The existing benchmark already read process PSS once per **1000 ms**, with a cheap RSS timer every 100 ms. Its prior throughput results therefore cannot be explained as PSS scans every 100 ms. This tool change preserves that default and makes the expensive interval explicit:

```sh
node tools/rust-port/benchmark-fork-program.mjs --run --serial-slot-released \
  --baseline benchmarks/validation/NEW-PASSING-FULL.json \
  --pss-poll-ms 1000 --output benchmarks/results/fork-observer-1000.json
```

After a passing frozen baseline and a quiet CPU slot, compare explicit `--pss-poll-ms 100`, `1000` and optionally `5000`. The accepted range is 100–60000 ms. No new measurements are claimed by this preparation.

Every run records:

- The actual requested PSS interval, successful `smaps_rollup` read count, and wall time spent awaiting those reads.
- Orchestrator `process.cpuUsage()` before/after deltas, split into user/system CPU, total CPU seconds and average CPU cores over the whole native run. This interval includes startup and warmups, not just the measured battle interval; it excludes prior file hashing and linking.
- Whole-cgroup `cpu.stat` counters before/after and exact decimal deltas, including throttled periods/time. These include workers, observer and unrelated processes; they do not identify a particular overhead source.
- Cheap RSS and cumulative `VmHWM` observations every 100 ms, with per-worker maximum observed RSS/HWM retained even after exit. Observed HWM can miss a worker that exits between polls.
- Whole-cgroup raw `memory.current` and estimated working memory every 100 ms, with both peaks retained. Clean file cache is estimated as `max(0, file - shmem - file_dirty - file_writeback)` from `memory.stat`; subtracting it is clamped to the raw current total. The safety guard applies to the remaining anonymous/shared/dirty/writeback working memory, rather than killing a run because reclaimable compiler file cache raises the raw total. A safety limit defaults to 95% of `memory.max`; `--max-cgroup-memory-gib` can select a lower explicit bound. A finite bound is mandatory when the cgroup is otherwise unlimited. The limit covers unrelated processes as well as these workers; only estimated clean reclaimable file cache is excluded.

The existing independent aggregate-PSS bound remains enforced at each PSS poll. Sparse PSS observations can miss an intervening PSS peak, while the cheap cgroup guard continues at 100 ms. Shared COW pages make summed RSS larger than real aggregate physical memory; RSS is recorded separately. Sampling is serialized, and an in-flight observation finishes before final observer CPU accounting and report serialization.

The original shared three-battle warmup, four independent twenty-battle workloads, full JS report/host-tape comparisons, GC checks, source/library hash checks and throughput interval calculation remain unchanged. Changing monitoring cadence neither skips game callbacks nor changes source RNG or mechanics. The observer itself can alter timing; only controlled comparisons can establish its cost.

Eight configuration/accounting tests cover polling bounds, RSS/HWM parsing, precise cgroup counter deltas, orchestrator CPU attribution and the cheap memory guard, including clean compiler cache versus anonymous/shared/dirty memory. Native execution awaits the next qualified full build.
