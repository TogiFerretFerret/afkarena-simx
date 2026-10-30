Guarded pure-tree copy region
============================

Exact original ed.copyObj source remains the outer entry. Its existing flat helper is byte-for-byte unchanged from d13fb6a. A second Babel source-pinned hook handles only wholly validated pure trees. Runtime.native_nested_copy_obj_enabled now defaults true; diagnostics/TRACE1 always rejects the new region, retaining original recursive source calls and property traces.

The helper resolves captured ed through initialized data bindings without source Get/lookup callbacks. Global access requires global_object's own data property; accessors, inherited-only values, foreign object-backed/TDZ/unresolved bindings reject. The namespace's own data copyObj must be the FunctionId currently executing, or its exact function-object alias whose object ID and function registry both identify that same active FunctionId. Wrapper/replacement/bound functions and method getters fall back. Existing pristine Object/Array constructor, Object.keys and prototype-chain guards run first.

Entire bounded graph preflight precedes any JS allocation: ordinary standard objects or dense standard arrays; default writable/enumerable/configurable data; finite Number or primitive/function leaves; no own constructor, prototype write conflicts, holes, extras, accessors, custom prototypes, cycles or unsupported shapes. Depth≤3, container occurrences≤32, physical properties≤256, array length≤64. Numeric keys use the exact canonical array-index rule and stable key ordering. Each shared child occurrence gets a separate plan and fresh output: no memoized aliases. Free-list source aliases/duplicate allocation slots reject before allocation. Rust scratch allocations are internal; no JS callbacks, RNG, clocks or source writes occur during preflight.

Emission allocates/writes in original depth-first order. Arrays begin through Runtime.array([]), retaining the same primary numeric insertion/deoptimization progression; length grows in ordered writes. Tests explicitly check storage masks, subsequent signaling/quiet NaN and -0 writes, and later prototype changes/deletion/inherited lookup. Functions and UTF16 strings retain identity; 23 source-qualified GC safepoints verify roots, recycled output IDs and per-path freshness.

Validation:127 library tests pass. The independent 34-case source gate covers 136 native executions/68 paired TRACE observations; ten pure cases prove admission by fewer JS allocations. Node values, ordered effect logs and selected TRACE1 IDs/source frames match. Cycle/depth/size rejection is verified directly before JS allocation; the source cycle fixture uses a bounded wrapper rather than unbounded generic recursion.

Static exact-guard JSON census admits all 3672 SkillBuff, 12741 UnitLevel and 13220 UnitQuality rows; runtime mutation/intrinsics/namespace still require fresh guards. Static coverage is not live-world frequency. Actual original createDataObj→swallowCopyObject→copyObj controllers use eight source rows per table, full ordered output descriptors/value bits/freshness/function sources compared to pinned jitless Node.

The short 300-copy cohort had noisy zero-nested controls and is retained only as exploratory evidence. Its Rank slowdown cannot be attributed to this region because there were zero nested calls. The justified longer repeat used 5000 copies/trial, three alternating OFF/ON pairs, one binary/runtime, exclusive OS flock and full output verification:

- SkillBuff: 1.76114×; pair ratios 2.0025/1.3478/2.0389. ON 5000/5000 admissions per trial; flat calls 40000→5000.
- UnitLevel: 1.66630×; pair ratios 1.5887/1.6695/1.7441. ON 5000/5000 admissions per trial; flat calls 25000→5000.
- Peak monitored process RSS 990.91MiB, below the 1900MiB limit. Endpoint atomic counters remain inside timed paths, so reduced observer work is included; no claim of an uninstrumented or whole-battle speedup.

The measured algorithm was e569f7f, with explicit flag OFF/ON. Additive default-on/admission-counter promotion bee808f changes no preflight/emission algorithm; 7900cb1/dd250a0 subsequently admit only exact same-function object aliases, with direct positive/wrong-function rejection tests. Full-source qualification was refreshed afterward. Host-only counters rt.nested_copy_obj_attempts/hits count enabled non-debug attempts/hits; a full-world harness must print enabled=true and actual positive admissions before crediting performance. No full battle build or benchmark has been launched for this region. Current profile attributes about 6.256% inclusive CPU to copyObj, limiting possible whole-program gains.

Proof index: benchmarks/validation/nested-copy/summary.json. All core edits remain isolated on candidate/nested-copy-obj until parent selects the next qualified full-world freeze.
