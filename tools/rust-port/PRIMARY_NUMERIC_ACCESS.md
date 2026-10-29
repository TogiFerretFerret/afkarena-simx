# Existing primary numeric element access

This candidate adds one runtime switch, primary_numeric_access_enabled, default false. No compiler changes, slot tickets, caches or Object fields are added.

The read shortcut runs inside get_inner after original requireObjectCoercible, numeric typed-array handling, and ToPropertyKey. A fresh receiver check requires an ordinary non-function Array with primary numeric storage, an empty arguments map, a reserved canonical key ID 0..3, a present bit, and physical raw-bit storage. It returns f64::from_bits. The public get wrapper remains unchanged, so original raw key identity and recording after key coercion are preserved.

The write shortcut likewise follows original receiver/key coercion. It updates only an already-present primary own numeric data element with a Number value. Such elements have default writable descriptors; readonly array length and nonextensibility do not prohibit updating existing elements. Holes, new indices, non-number writes, descriptor changes, getters, functions and other layouts follow the original path.

Qualification passes 97 library tests and 26 integration tests, including seven new directed groups for raw signaling/quiet NaN and signed-zero bits, numeric/string/prepared keys, coercion that mutates/deopts/shrinks/throws, original raw diagnostic keys, readonly length/nonextensibility, holes/prototype setters, readonly/frozen indices and 23 actual source-pinned GC collections with ID reuse. The paired source-array suite passes 78 observations with primary storage enabled in both arms and only access shortcuts toggled.

The unchanged original Unit.update fixture runs 10,000 updates per arm in three alternating pairs from one prepared binary. All six trials match the original pinned jitless Node callback sequence and selected raw-bit state (150,220 events per trial). Baseline aggregate is 17,961.6 updates/sec; fast access is 18,915.0, ratio 1.05308x. Pair milliseconds are 533.4/537.4, 587.6/535.9 and 549.3/512.8 (off/on). The first pair is slightly slower with the shortcut; the later two are faster. This is a promising component cohort, not established full-battle improvement.

The native process completed in 5.45 seconds during an exclusive window with the only concurrent compiler paused. Binary and all prepared source hashes remained unchanged; exit zero and complete stdout hash are archived at benchmarks/validation/primary-numeric-access/unit-recorded-proof.json.gz. Analysis used the recorded output without recompiling/rerunning the timed binary. Two missing sparse-checkout output directories caused archive-only launcher failures; their logs are retained and corrected analyses pass.

Current evidence: benchmarks/results/2026-10-29T00-47-02.098Z-rust-unit-update-primary-numeric-access.json and benchmarks/validation/rust-port-primary-numeric-access.json. The switch remains off pending integration/full-workload qualification. No battles/sec or 10k/sec attainment is claimed.
