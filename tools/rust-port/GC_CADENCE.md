# Isolated battle collection cadence

`compileSource(..., { nativeBattleGc: true, nativeBattleGcCadence: 4 })`
collects at every fourth completed outer battle iteration and at the final
iteration. The default cadence is 1. The program generator accepts `--gc-cadence 4`
and records the selected positive safe integer in both program and unit manifests. Only the existing exact-source, unsplit,
environment-backed `__nativeRun` hook is eligible. Every collection still uses
the existing runtime context/source/numeric-binding guard and root graph.

The optional counter and final-iteration check execute after the completed
body, before the original source increment. The check reads the exact local
`battleIndex` and `battles` bindings without numeric coercion. It changes no
source binding, RNG consumption, callback, or output.

Run `node tools/rust-port/check-battle-gc-cadence.mjs` for pinned Node versus
Rust OFF/every-1/every-4 qualification. The 23-iteration fixture observes
0/23/6 collections, identical 69 ordered frame visits, 120 measured callbacks,
full source terminal state/report equality, and exact Float64 RNG bit pairs.
This fixture validates collection scheduling and roots, not real battle speed
or a safe production memory budget. Cadence 4 may retain up to four battles'
allocations between collections; qualify actual peak RSS before adopting it.
The candidate is intentionally not merged into the main compiler.

Run `node tools/rust-port/check-gc-cadence-generator.mjs` to validate rejected
CLI values and real frozen unit0 generation with explicit 4 and default 1.
