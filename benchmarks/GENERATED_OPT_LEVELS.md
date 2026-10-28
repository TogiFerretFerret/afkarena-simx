# Generated Rust optimization experiment

[Retained result](results/2026-10-28T17-26-14.922Z-rust-generated-opt-levels.json)
compares generated `Unit.update` fixture code at Rust optimization levels 1 and 3.
Both executables link the same frozen Cargo release runtime library with LTO off.
The original game method, callbacks and raw-bit observer are unchanged. All 36
trials match the pinned Node event sequence and selected state bits exactly.

| Measurement | Generated opt1 | Generated opt3 |
| --- | ---: | ---: |
| Compile and link wall time, one build each | 3.888 s | 4.013 s |
| Executable size | 7,188,800 bytes | 7,150,432 bytes |
| Original uncached compiler fixture | 7,175 updates/s | 6,949 updates/s |
| Cached compiler fixture | 7,332 updates/s | 7,695 updates/s |

Timing is **provisional and contended**. Each component rate aggregates nine
3,000-update trials across three alternating process pairs. The cached fixture
was 4.7% slower with opt1; the uncached fixture was 3.3% faster. The single build
pair shows only a 3.2% reduction in compile/link time. This small fixture does not
establish a useful build-time advantage for the full generated program, and its
updates/second are not battles/second.

Keep the current full-program release build as the comparison point. If full
compilation remains the bottleneck, a separate future Cargo profile can test
generated workspace crates at opt1 while keeping runtime dependencies at opt3:

```toml
[profile.porting]
inherits = "release"
opt-level = 1
codegen-units = 64
lto = false

[profile.porting.package."*"]
opt-level = 3
```

Cargo's `"*"` package override covers non-workspace dependencies. This matches
the generated standalone workspace, whose generated crates are members and whose
runtime is an external path dependency. The snippet is a candidate for measurement,
not a promoted setting; no full-program build, battle parity or speed result was
obtained for it. The current build-proof wrapper accepts debug/release only.

To reproduce the isolated experiment in the prepared workspace:

```sh
node tools/rust-port/benchmark-generated-opt-levels.mjs
```

The runner uses the existing frozen runtime and archived source fixture, writes
to its own work directory, verifies input hashes, and archives compiler output,
raw trial snapshots and generated fixture bytes. It does not regenerate game
code or rebuild the runtime.
