# Guarded Unit motion candidate

This opt-in prototype lowers the two exact source expressions `this.position[i]+=m[i]*r` for i=0/1 in the unchanged Unit.update body (SHA a0997743bf70f854c4d9ff8d45107cc2fa3a10395a1b68dbab33818c53bd488e). `compileSource(...,{guardedUnitMotion:true})` enables it; the default remains false. Different source hashes, specialization optout, unavailable native m/r bindings and diagnostics mode retain original source lowering.

Each assignment is guarded independently at its original execution point. The guard proves ordinary/array nonfunction, unmapped receiver and motion objects; the receiver's own data position object; an existing writable own Number position leaf; an own Number motion leaf; and primitive Number scale. Prototype mutations do not affect own data reads or existing own writable writes. No cached location/value survives an assignment or source call. Aliased motion and position arrays read live state after any previous assignment. Original descriptor flags and primary numeric array storage remain intact.

On guard success the helper performs the same separately rounded multiplication then addition using the pinned numeric_arithmetic helpers, followed by one existing-property write. NaN payloads and signed zeros retain those helpers' behavior. A miss performs no source callback/Get/Put/coercion or JS allocation before the entire original expression. TRACE1 always follows that original expression. The only speculative canonical lookup is the position property string at the same original property-access boundary; no user conversion runs.

130 runtime tests and three compiler tests pass, including both primary-storage modes, raw NaN/-0 bits, aliases, nondefault descriptor flags and accessor/readonly/hole/non-Number/diagnostic fallback. Five preexisting region-planner tests pass. Evidence is under benchmarks/validation/guarded-unit-motion. A twelve-mode actual-source gate and original Unit.update A/B benchmark are prepared but have not yet run: they wait for the whole-world coordinator's exclusive timing lease. No component or whole-battle speedup is claimed.

Run after building this candidate Runtime:

```
flock -s /workspace/afkarena-simx/work/native-timing.lock node --jitless tools/rust-port/check-guarded-motion.mjs
flock -s /workspace/afkarena-simx/work/native-timing.lock node --jitless tools/rust-port/benchmark-guarded-motion.mjs --updates 5000
flock -x /workspace/afkarena-simx/work/native-timing.lock node --jitless tools/rust-port/benchmark-guarded-motion.mjs --updates 5000 --run --execute-prepared
```

The benchmark compares compiler OFF/ON with the same Runtime and scalar-array optimization enabled in both, three alternating pairs, all original fixture callbacks and raw-state observers. Timed attempts/hits must prove actual motion execution; compiled hooks alone are insufficient. Results are updates/second, not battles/second. Timed counters are retained in the measured paths. No GC/scheduler/game callback or RNG operation is skipped.
