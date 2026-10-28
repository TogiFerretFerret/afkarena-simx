# Combined next execution wave

This isolated integration starts from main `31e8c8c` and preserves its own-read, own-write, primary numeric array, integer key, dense-shift and string optimization defaults. It combines four candidates:

- Canonical StringId storage for internal FunctionRecord names, including GC roots independent of the mutable/deletable JS `.name` property.
- Exact-source primitive-only createDataObj loop scanning. Original copy calls, closures and source-visible operations remain in place; unsupported layouts run the original loop.
- Exact SHA-pinned Buff source ancestry selects optional prototype data reads. Ordinary read sites use a const-false entry with no prototype probe/learning branches. Cached slots occupy 24 bytes; heap objects have no added fields.
- Guarded copyObj destination Vec/HashMap capacity reuse from the existing GC pool, preserving descriptors, order and Number bits.

The new dataObj and source-selective prototype runtime flags default to true in this candidate. Existing main optimization flags remain true. The copy-capacity public diagnostic helper retains an explicit false arm for allocation comparisons. Main's currently measured binary is a separate build.

Integration required a fresh logical-own-property check before a prototype hit: primary numeric arrays may hold own elements outside the dictionary. A regression test warms a parent property named `0` and verifies that an own primary negative-zero element wins, bit for bit.

Qualification is recorded in `benchmarks/validation/next-execution-wave/summary.json`: all 18 source gates pass with unchanged runtime/compiler inputs. These cover source pin selection, native dataObj, prototype mutation, primary arrays, closures, reflection, arguments, diagnostics, errors, Date, arrays/from/construction, 20,000 typed-array cases, JSON, coercions, control flow and primitive operators. The primitive gate compares 79,026 cases successfully; 90 pre-existing ambiguous tagged-number remainder cases remain explicit Unsupported and are not passes. The combined runtime also passes 70 library tests and 26 integration tests, including 23-collection ID/capacity reuse and internal-name rooting.

Two launcher/setup failures are retained honestly: an omitted sparse game_util.js input and the raw-value checker's missing native binary argument. The first library attempt also had an incorrect hardcoded heap-size assertion; the actual current Object size is 152 bytes on x86-64. These were corrected, and all final tests pass. The failed raw-value launch remains in the combined summary's previousAttempts; the corrected value binary and proof hashes are recorded.

Component evidence supports reduced allocations and selected source-controller speed improvements, but this combined wave has not yet run a full battle. No battle-throughput gain or target attainment is claimed. A fresh generated program, frozen build proof and full oracle comparison are required next.

Re-run all source gates with `node tools/rust-port/check-next-execution-wave.mjs`. The runner builds the current value_check example automatically and uses one Cargo job per gate with the pinned jitless Node reference.
