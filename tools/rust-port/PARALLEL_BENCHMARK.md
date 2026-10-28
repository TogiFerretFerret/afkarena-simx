`benchmark-parallel-program.mjs` prepares a four-process benchmark using the eight existing release rlibs. It never rebuilds or changes the compiler, runtime, generated game bodies, battle counts, callbacks, RNG or clock tapes. Each OS process owns a separate Runtime and executes all seven frozen source units, with the original 20 measured battles and three warmups.

Run it only after the current full native/Node baseline passes and control/root releases the serial warm-profile slot:

```
node tools/rust-port/benchmark-parallel-program.mjs --run --serial-slot-released --baseline benchmarks/validation/rust-full-program-gc.json
```

Without `--run`, the tool prints usage and performs no build or workload. The baseline must contain a successful complete 20/3 comparison and frozen build binding. The tool validates the exact `__nativeRun` source hash, its two `wallNow` calls, and the unchanged final driver arguments before linking a tiny standalone app against the completed immutable release target. Selection uses the newest modification time per top-level rlib; every rlib, binary and tracked source is hashed before and after. This links a new instrumented driver and does not independently reconstruct the source-to-rlib compiler proof.

The only instrumentation wraps the host `__nativeWallNow` argument. It records two common UNIX-epoch nanosecond timestamps and calls the original Date.now function with the original receiver and arguments. The source performs its original warmup, every battle step and callback, final capture, complete host-tape consumption and report emission. Native GC must complete all 23 original loop backedges. Each full native non-timing report and host consumption must match the same pinned Node reference from the successful baseline.

The aggregate rate is **80 / (latest measured end - earliest measured start)**. It includes gaps from measured-window start skew; it never adds four per-process rates. The report records common measured overlap, every process window, exit status and RSS. A 100 ms sampler caps the sum of all four child RSS values plus the Node monitor at 14 GiB, terminating all workers on memory excess or timeout. Per-process high-water values are reported separately. Unrelated external processes are outside this cap.

This measures parallel throughput for the existing fixed callback fixture. It does not qualify full-scene random 5v5 battles, unseen mechanics, 20,000-battle parity or the 10,000 battles/sec target. No benchmark result is claimed until the actual run passes.
