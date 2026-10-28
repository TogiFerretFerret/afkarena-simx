# Independent-runtime battle throughput

The existing Rust-integrated native candidate was run with **1, 2 and 4 independent worker processes**. Every worker executes the unchanged frozen callback-only workload: three warmups followed by 20 measured battles. All seven compiled game objects and the candidate VM DSO are reused unchanged.

| Workers | Measured battles | Cohort measured wall | Aggregate battles/sec | Full per-worker source gate |
|---:|---:|---:|---:|---|
| 1 | 20 | 10.130 s | 1.974 | Pass |
| 2 | 40 | 10.874 s | 3.679 | Pass |
| 4 | 80 | 16.843 s | **4.750** | Pass |

These are **provisional, potentially contended measurements**. The user authorized overlapping benchmark work to improve iteration speed; process/cgroup snapshots are recorded in every result. Single trials under different contention do not establish an uncontended scaling curve or improvement against the historical 2.783/sec trial.

## Timing and isolation

A small `LD_PRELOAD` transport shim recognizes only the existing private benchmark start-marker `fprintf` format. Each worker signals READY after its three warmups, then waits on a dedicated pipe. The parent releases all READY workers and uses its own monotonic clock from immediately before release until arrival of the last worker's END marker. This includes release IPC and marker-delivery/event-loop delay. Startup, warmups and final reports are outside that cohort window.

The original per-worker `elapsedMs` and `battlesPerSecond` include the barrier wait and **are never used for aggregate throughput**. Rates are completed measured battles divided by one shared parent-clock interval; per-worker rates are not added.

Each process has its own Runtime, TLS, mutable heap, replay cursor and RNG state. Only read-only executable/shared-library pages are naturally shared by the OS; sharing immutable battle configuration across heaps is not claimed.

Every worker passes all raw source report fields except diagnostic timing, plus exact host input consumption, callback/ClassMgr state, every established fast-path counter, cache counters and runtime cleanup. Each worker consumes 5,980 replay-clock entries and two host random values, exercises 72,677 Rust Speeder admissions, and destroys its one runtime with TLS cleared. No callbacks or mechanics are omitted.

## Reproduce and inspect

```sh
node tools/run-native-parallel-battles.mjs --workers 1
node tools/run-native-parallel-battles.mjs --workers 2
node tools/run-native-parallel-battles.mjs --workers 4
```

Execution requires the SHA-bound ignored candidate build prerequisites, just like the existing native battle runner. The barrier changes benchmark transport only; all original game functions, game clock/RNG inputs and seven objects remain unchanged.

- [One-worker raw result](results/2026-10-28T15-32-36.800Z-native-parallel-1-workers.json)
- [Two-worker raw result](results/2026-10-28T15-33-20.977Z-native-parallel-2-workers.json)
- [Four-worker raw result](results/2026-10-28T15-34-21.275Z-native-parallel-4-workers.json)

This is **140 measured repetitions of one frozen callback-only fixture**, not a random 5v5 corpus, complete actor/effect/view qualification, or the 10,000 faithful battles/second target.
