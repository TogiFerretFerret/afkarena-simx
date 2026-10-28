# Warm profiling and trace GC checks

`prepare-wall-profile.mjs` derives collection counts from the passing baseline's generated manifest. The original twenty measured battles and three warmups require `ceil(23 / nativeBattleGcCadence)` collections. A cadence-two build therefore prepares a twelve-collection marker.

Pass the resulting preparation to the profiler:

```sh
node tools/rust-port/prepare-wall-profile.mjs \
  --baseline benchmarks/validation/NEW-PASSING-FULL.json \
  --output benchmarks/validation/new-wall-preparation.json
node tools/rust-port/profile-program.mjs --preparation benchmarks/validation/new-wall-preparation.json \
  --binary PREPARED-BINARY-PATH --scope markers \
  --start-marker PARALLEL_WALL_NOW:0: --end-marker PARALLEL_WALL_NOW:1: \
  --program-dir work/rust-battle-full --reference ACCEPTED-REFERENCE-REPORT.json
```

`--preparation` verifies the selected binary, exact manifest, prepared wrapper and host, eight selected libraries, accepted full baseline and original frozen build proof before profiling. It repeats input and build-proof checks afterward and requires exactly one `PROFILE_TRACE:0` marker and one collection marker with the expected count. A mismatch makes `profileSucceeded` false. The option is additive; older profiling uses without a preparation retain their previous diagnostic behavior and have no new GC qualification. Profiling remains a sampling diagnostic; its execution time is not a throughput measurement.

The ordered trace diagnostic executes one battle and zero warmups, unlike the throughput fixture. Its exact original runner always collects the final partial cadence, so its expected collection count is one at every supported positive cadence. Trace preparation binds this count to the same manifest; the native driver emits `TRACE_GC_COLLECTIONS`, and the trace checker requires the exact count. The JavaScript observer and diagnostic battle source are unchanged, preserving reuse of the accepted Node prefix. Reprepare old native trace wrappers before using the updated checker.

`trace-after-full-pass.mjs` now passes the full build's exact manifest explicitly into trace preparation and records the derived single-battle GC expectation. It continues to require the complete full-battle gate and unchanged build proof before and after the native prefix qualification.

These tooling changes have syntax and configuration checks; they do not constitute a new profiled battle or ordered-trace pass.
