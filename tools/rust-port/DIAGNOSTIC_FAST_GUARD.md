# Inline disabled diagnostic guards

Only record_get and report_noncallable change. Their original enabled test is
now a tiny inline wrapper. Unchanged enabled bodies live in cold, non-inlined
methods. Recording stays after the original Get operation, so a getter or key
coercion that toggles the flag still controls the same event. No Runtime fields,
source callbacks, trace records or GC-root traversal change.

Two libraries built serially in the same isolated Cargo path with opt3,64codegen
units and noLTO differ only in diagnostics.rs.77 library and26 integration tests
pass, including enable/disable inside getters and raw-key coercion/root cases.
The source observer gate passes with trace on and off.

Original Unit.update and original callback-drain fixtures pass complete source
Node event/state comparisons. TRACE1 selected observer stderr is byte-identical
between both binaries for Unit, drain and the missing-method source-frame case.
TRACE0 three alternating pairs observe1.127x Unit and1.116x drain throughput.
All pair ratios are positive, but an existing library compile finished during
the initial handshake and may overlap the first Unit pair by roughly one second.
These are descriptive component results, not a confidence interval or battle
throughput claim. Complete artifacts and the contention caveat are retained.

Reproduce library preparation only in an isolated worktree:
`node tools/rust-port/prepare-diagnostic-guard-libraries.mjs`.
Then prepare the source components with
`node --jitless tools/rust-port/benchmark-diagnostic-guard-components.mjs`.
After a quiet timing slot, add `--execute-prepared --run --trace-gate`.
