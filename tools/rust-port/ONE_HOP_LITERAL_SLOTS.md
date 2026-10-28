# One-hop prototype literal data cache candidate

This disabled candidate adds an optional weak owner ID to the existing per-runtime literal-read slot. It does not add bytes to heap objects: `Object` remains 160 bytes on x86-64. CachedSlot grows from 32 to 48 bytes, which is a real memory cost not represented by the enabled/disabled same-binary timing comparison.

An own-data physical slot is still checked first. A prototype hit checks the current receiver kind, immediate prototype identity, owner kind and current physical property key/data descriptor, and current receiver own-property absence. It reads the current value rather than saving a value. Parent accessors, deeper chains, missing properties, function objects and array virtual length use the original lookup. After a slow lookup, learning examines the post-callback layout and never replaces that lookup's result. Owner eligibility precedes receiver own-property absence hashing so Array.prototype methods do not add that unnecessary hash on every miss.

No owner is strongly retained. The ordinary literal string-key reclamation path clears the complete entry. Three native tests cover raw negative zero/signaling-NaN bits, virtual Array length with the separate length shortcut disabled, and 23 actual source-pinned battle collections with weak owner ID reuse. The generated source differential suite passes 24 cases with both switch settings, including mutation, shadowing, inherited getters, prototype replacement, and two separately compiled modules in one runtime.

The initial 10,000-call benchmark inherited the repository Cargo profile (one codegen unit, ThinLTO); it measured resetBuffApply 1.071x and addBuff 0.975x. It remains archived as historical evidence, not the current candidate's performance claim.

The rerun explicitly builds runtime and generated driver at optimization level 3, 64 codegen units, without LTO. It executes the unchanged original resetBuffApply/addBuff bodies with explicit prototype-heavy dependency fixtures, all dependency callbacks and queued view/visibility callbacks. For 20,000 calls per arm in three alternating trials:

| Original source body | Baseline calls/sec | One-hop calls/sec | Aggregate ratio |
| --- | ---: | ---: | ---: |
| resetBuffApply | 89,549 | 105,334 | 1.1763x |
| addBuff | 10,889 | 11,886 | 1.0915x |

All ordered logs and selected final state match pinned jitless Node. See `benchmarks/results/2026-10-28T22-33-18.598Z-rust-one-hop-buffs.json` and compressed source/generated/actual/expected archives. The quiet CPU measurement was coordinated with other candidates; no other compile/test workload ran during execution. Only one sample cohort was collected. These are source-component calls/sec, not battle throughput or complete battle fidelity qualification. The switch remains disabled pending combined/full-workload measurement, and slot packing is being tested separately.

Reproduce:

```
CARGO_PROFILE_RELEASE_CODEGEN_UNITS=64 CARGO_PROFILE_RELEASE_LTO=false node tools/rust-port/check-one-hop-slots.mjs
node --jitless tools/rust-port/benchmark-one-hop-buffs.mjs --calls 20000
```

The benchmark's `--prepare-only` builds its binary without executing timed trials. Source inputs are hashed before/after, and the report binds the binary, generated source, original source bodies and compiler profile.
