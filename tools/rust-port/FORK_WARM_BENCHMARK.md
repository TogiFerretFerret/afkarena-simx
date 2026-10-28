# Prepared Linux warm-state fork benchmark

This isolated tool is prepared, not qualified by a native run. It changes only
the host driver, preserving the frozen seven generated source modules, runtime,
20-battle/3-warmup root source, RNG state, callbacks, timeouts and input tapes.

The first __nativeWallNow call occurs after the three original warmup battles.
The synchronous Rust host verifies exactly one OS thread, drops I/O locks and
flushes buffered output, then forks four children. Each receives the same COW
runtime snapshot and resumes the original 20 measured battles. There is no
shared mutable battle state or runtime serialization. The parent performs no
measured battle; it waits for every child and syncs durable waitpid results.

Each child redirects stdout/stderr to its own files. Its clock wrapper logs a
common UNIX-epoch measured start/end exactly like the existing independent
parallel benchmark. After reporting, it flushes and fsyncs output, then exits
without dropping the cloned runtime arena. Arena destruction after the measured
window would otherwise dirty COW pages while producing no source-visible work.
The parent likewise exits without destructing the cloned arena.

The runner refuses to build or execute without --run and a released serial
slot. It requires a passing frozen full20/3 baseline, tracks its bound source
inputs and all linked rlibs, and checks each child against pinned Node's complete
report and hostInputConsumption (including full clock tapes and class metadata).
All four must complete 20 battles with 23 inherited+measured collections, zero
exit failures and overlapping measured windows. Throughput is 80 battles divided
by the latest end minus earliest start, never a sum of individual rates.

Memory observation records parent and all children. RSS is sampled every100ms;
PSS and private pages are sampled every1000ms from smaps_rollup. Summed RSS
counts shared COW pages repeatedly and is reported separately. The memory limit
uses aggregate PSS plus the observer RSS, with at least one observed five-process
PSS sample required. Sampling is sequential and approximate; observer overhead
and shared-page write faults remain part of the actual benchmark. Timeouts or
memory excess terminate the entire detached process group.

After the next completed frozen build and baseline/profile slot release:

```
node tools/rust-port/benchmark-fork-program.mjs --run --serial-slot-released \
  --baseline <passing-full20-report.json> --deps <completed-release-deps>
```

Preparation checks:19 static host-tool/default-no-run checks pass and the Linux
fork helper compiles to Rust metadata. No fork or native battle has been run by
this candidate. Real terminal reports, tape parity, throughput, PSS and memory
savings must be measured before adoption. The single-thread fork boundary is
specific to this standalone Linux driver; do not reuse it inside a multithreaded
application or an engine with asynchronous workers.
