# Guarded Unit motion candidate

This opt-in prototype lowers the two exact source expressions `this.position[i]+=m[i]*r` for i=0/1 in the unchanged Unit.update body (SHA a0997743bf70f854c4d9ff8d45107cc2fa3a10395a1b68dbab33818c53bd488e). `compileSource(...,{guardedUnitMotion:true})` enables it; the default remains false. Different source hashes, specialization optout, unavailable native m/r bindings and diagnostics mode retain original source lowering.

Each assignment is guarded independently at its original execution point. The guard proves ordinary/array nonfunction, unmapped receiver and motion objects; the receiver's own data position object; an existing writable own finite Number position leaf; an own finite Number motion leaf; and primitive finite Number scale. Prototype mutations do not affect own data reads or existing own writable writes. No cached location/value survives an assignment or source call. Aliased motion and position arrays read live state after any previous assignment. Original descriptor flags and primary numeric array storage remain intact.

On guard success the helper performs the same separately rounded multiplication then addition using the pinned numeric_arithmetic helpers, followed by one existing-property write. Signed zeros retain those helpers' behavior. Nonfinite inputs reject before writes; the existing numeric-array NaN representation gap stays on the original source path. A miss performs no source callback/Get/Put/coercion or JS allocation before the entire original expression. TRACE1 always follows that original expression. The only speculative canonical lookup is the position property string at the same original property-access boundary; no user conversion runs.

130 runtime tests and three compiler tests pass, including both primary-storage modes, nonfinite fallback, signed zeros, aliases, nondefault descriptor flags and accessor/readonly/hole/non-Number/diagnostic fallback. Five preexisting region-planner tests pass. Evidence is under benchmarks/validation/guarded-unit-motion. The twelve-mode source gate and original Unit.update benchmark are complete; the final decision and baseline limitation appear below. No component or whole-battle speedup is established.

Run after building this candidate Runtime:

```
flock -s /workspace/afkarena-simx/work/native-timing.lock node --jitless tools/rust-port/check-guarded-motion.mjs
flock -s /workspace/afkarena-simx/work/native-timing.lock node --jitless tools/rust-port/benchmark-guarded-motion.mjs --updates 5000
flock -x /workspace/afkarena-simx/work/native-timing.lock node --jitless tools/rust-port/benchmark-guarded-motion.mjs --updates 5000 --run --execute-prepared
```

The benchmark compares compiler OFF/ON with the same Runtime and scalar-array optimization enabled in both, three alternating pairs, all original fixture callbacks and raw-state observers. Timed attempts/hits must prove actual motion execution; compiled hooks alone are insufficient. Results are updates/second, not battles/second. Timed counters are retained in the measured paths. No GC/scheduler/game callback or RNG operation is skipped.

Final decision: **hold; no demonstrated performance gain**. The finite-input revision de99eb7 passed130 runtime tests. The actual-source twelve-mode gate has11 Node-exact cases, plus one explicitly retained preexisting numeric-array NaN representation gap; raw compiler OFF/ON results and TRACE1 diagnostics match for all12. TRACE0 made20 attempts/12 admissions; TRACE1 madezero. The excluded nonfinite axis retains original source.

The exclusive three-pair5000-update benchmark achieved0.961594× aggregate speed (18,595→17,881 updates/sec). Pair ratios vary0.874/1.068/0.962; these short windows do not establish a statistical regression, but give no reason to promote this candidate. Each ON trial made10,000/10,000 guarded admissions, and all75,112 ordered callbacks/events and selected state bits matched pinned jitless Node. No whole-battle speedup was measured. See benchmarks/validation/guarded-unit-motion/summary.json and benchmarks/results/2026-10-30T18-15-46.101Z-rust-unit-update-guarded-motions.json. The pass remains opt-in and isolated.
## Publication status

Only the negative benchmark evidence and this document are published on main.
The compiler pass and Runtime helper remain unmerged on
`candidate/guarded-unit-motion` at `e5316dd`; check out that branch to reproduce.

