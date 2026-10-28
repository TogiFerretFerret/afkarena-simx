# Whole-workspace ThinLTO experiment

Keep the current no-LTO profile: this paired component experiment found no
throughput benefit from enabling ThinLTO across the runtime and generated code.

Both fresh workspaces explicitly use opt-level 3 and 64 codegen units for every
crate, matching the full program's baseline profile. The only profile difference
is lto=false versus lto="thin". Ambient Rust flags are cleared identically.
This tests whole-workspace optimization, rather than the earlier runtime-only
codegen-unit experiment. The generated original Unit.update fixture and runtime
sources are identical in both builds.

Three alternating trials of 10,000 updates per variant matched the independent
jitless JS source's complete 150,220 ordered component events and selected state
bits per trial. No-LTO averaged 16,746 updates/sec and ThinLTO 16,167: an observed
ratio of 0.9655. Shared-host noise remains, so this does not establish a precise
regression, but it provides no reason to promote ThinLTO.

Complete cold builds took 20.75 seconds without LTO and 23.13 seconds with
ThinLTO. Cargo's per-crate timing HTML is archived along with the exact profiles,
source/generated code, actual/reference snapshots and binary hashes. Package
timing placement differs under LTO; individual crate durations do not capture
the final cross-crate link work.

[Exact paired result and all retained artifacts](results/2026-10-28T22-11-58.307Z-rust-whole-thin-lto.json)

```sh
node --jitless tools/rust-port/benchmark-whole-thin-lto.mjs --updates 10000
```

Timing excludes startup, construction, five warmups, reset and final snapshot.
These are component updates/sec, not battles/sec; no new full-battle or random
20,000-battle qualification is claimed. Main profile/source settings are unchanged.
