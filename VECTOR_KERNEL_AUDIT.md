Vector kernel source audit
==========================

The current qualified profile does not identify a large vector/matrix kernel. Matching exact function-source SHA256 values gives:

| Function | Inclusive samples /2663 | Inclusive share |
| --- | ---: | ---: |
| ed.edpDistanceSQ | 10 | 0.3755% |
| ed.edpSub | 4 | 0.1502% |
| ed.edpMult | 4 | 0.1502% |
| ed.edpNormalize | 2 | 0.0751% |
| ed.edpAdd, LengthSQ, CompMult, Cross, Mid, Dot, Angle | 0 | 0 sampled |

The sum is20 samples,0.7510%; inclusive rows can overlap. This is an observed sampled upper bound for helper bodies, not a statistical confidence bound or achievable speedup. Property resolution at the caller before callee entry is excluded. A specialization inside the original function preserves its call/frame; it cannot remove that caller work. No matrix helper frame appears in this profile. Unit.update's49.49% inclusive time must not be treated as vector math time.

Existing implementation and prior experiments
---------------------------------------------

`config/numeric-kernels.json` and generated `crates/battle-core/src/numeric.rs` already lower nine arithmetic helpers: DistanceSQ, LengthSQ, Dot, Cross, Mid, Add, Sub, Mult and CompMult. They use the existing binary64 js_math add/sub/mul operation order; this is not currently guarded integration into generated runtime helper entries. Current manifest records no source specialization for the sampled vector functions. Duplicate edpSub source bodies occur in the input; source audit deduplicates hashes for the aggregate.

The historical Static Hermes/Rust vector report `2026-10-27T18-39-46.555Z-rust-native-oracle-rust-vectors-warm20.json` counted311466 DistanceSQ hits and92 LengthSQ hits across20 measured+3 warmup battles. It records stale dependencies, uses a different backend, and is not current frequency/throughput evidence. Another historical flat-copy battle report failed its semantic table-boundary comparison and is excluded. No existing result establishes current vector eligibility/call counts.

Proof domain for any later native entry
--------------------------------------

Use the exact source SHA, retaining the original function entry/metadata and fallback. Before any source getter or coercion, inspect each argument without callbacks: actual Array, own indices0 and1 containing finite Number data, expected scalar arguments finite Number. Own data shadows prototypes, so a prototype getter cannot run on an accepted read. Any holes, accessors, non-number values, unsupported objects, arguments mappings or unqualified shapes fall back before allocation or source-visible writes. The initial conservative diagnostic counts only arrays of length2.

Read accepted values once, follow source operation order through existing js_math helpers, and create a fresh normal source Array literal equivalent for vector results. Preserve -0/subnormal bits and fresh identity. Avoid NaN results on the fast path because V8 array storage feedback remains unqualified; finite inputs can overflow and Normalize's underflow can produce0*Infinity, so finite input alone does not guarantee a finite result. Do not reassociate arithmetic, fuse multiply/add, invent SIMD/GPU results, or mutate source arrays.

Normalize additionally observes lexical/global Math and Math.pow after reading its input, even for the zero-vector branch. Its exact source computes pow before returning[1,0]. It requires pristine binding/property guards and the existing exact runtime power implementation; replacing pow with sqrt or skipping it on zero is unproven. Angle calls mutable ed.edpDistanceSQ, Math.pow, Math.asin and ed.edpRadian; exclude it from a simple pure entry.

Next evidence, before implementation
------------------------------------

`tools/rust-port/vector-call-probe.rs` is source-only, uncompiled preparation. It wraps existing ed helpers, counts read-only finite dense2 input opportunities and calls every original function with unchanged receiver/arguments. Its wrapper preserves original function source text. A future current-qualified full20+3 wrapper must verify actual function sources, full report/rawbits, random/clock tape,12GC and immutable library/source hashes. No runs or compiles were performed during the frozen full build.

Given the measured small body share, prioritize larger dictionary/dispatch/allocation work unless new evidence changes the workload coverage.
