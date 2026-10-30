# Lazy small property index component qualification

This experiment retains the existing HashMap field and 160-byte Object / 24-byte StoredProperty layouts. Physical property slots supply linear lookup keys while the map is empty and the number of physical slots is within a cutoff. Crossing the cutoff materializes the index. This differs from the older inline-index experiment that enlarged every Object header.

Preparation uses immutable runtime snapshots: original native baseline `089ed84`, cutoff 2, and cutoff 4. Only the cutoff constant changes between the latter two snapshots. It never swaps source files in the shared worktree. All snapshot source bytes and hashes are archived. Native compilation is single-job, release opt-level 3 / 64 codegen units / no LTO, with a shared dependency target.

`node --jitless tools/rust-port/prepare-lazy-small-index.mjs --generate-only` prepares source and snapshots without native compilation. After the CPU coordinator releases builds, run the same script with `--build`. The generated sources execute the original pinned Unit.update and __nativeDrain controllers. Timing executables use the default System allocator. Separate app-feature executables use an atomic counting allocator only for allocation diagnostics; their elapsed time must never be presented as throughput.

After reserving CPU, run `node --jitless tools/rust-port/run-lazy-small-index.mjs --mode unit`, then `drain`, `shape`, or `json` as separate reserved slots. JSON defaults to the actual 101,695,086-byte `work/native-tables.json` at the main repository path; use `--table PATH` to bind another exact input. The runner records every native exit/status, complete output footer, input and executable hashes before/after. Three process orders alternate baseline/2/4 and 4/2/baseline. `--trials 1` is available for a short diagnostic. Use `--allocation` for one diagnostic process per variant, separately from timing.

After releasing CPU, repeat each runner command with `--analyze`. Unit/drain compare every ordered callback and final state against the pinned jitless Node oracle. Every mode compares full native heap fingerprints across the three implementations: Object IDs, prototypes, kind, extensibility, physical indices and tombstones, key IDs/UTF-16, descriptor attributes, data values with raw Number bits and reference IDs, accessor identities and primary numeric own descriptors. Every live physical descriptor is also checked against Object::own. The shape fixture includes cutoff-adjacent small records, deletion and reinsertion, sparse primary arrays, signaling NaNs, negative zero and accessor/prototype identities. The table fingerprint establishes equivalence to the original native runtime, not independent Node verification of each parsed value.

No timing, allocation reduction or battle-throughput claim is made until the prepared native probes run and their proofs pass. Component operations/sec are not battles/sec; the real full-battle qualification remains required before promotion.

## Measured result: do not promote yet

Both cutoffs pass 120 library and 26 integration tests plus the separate original-source mutation/getter/copy/arguments gate suite. Unit/drain callbacks and final states match the pinned Node oracle, and all physical heap fingerprints match the original native baseline. Actual table parsing produces identical native heap fingerprints across all three runtimes.

The first Unit/drain cohort overlapped another agent and is explicitly retained as contended exploratory evidence. Its apparent improvement does not qualify. A repeated cohort holds an exclusive OS flock at `/workspace/afkarena-simx/work/native-timing.lock`; the runner verifies a WRITE lock belongs to its process ancestry in `/proc/locks` before and after native execution. Compiler/gate and allocation diagnostic work uses shared locks.

| Component | Cutoff 2 / original | Cutoff 4 / original |
| --- | ---: | ---: |
| Original Unit.update, clean System allocator cohort | 0.89323× | 0.90021× |
| Original drain, clean System allocator cohort | 1.00591× | 1.11777× |
| Actual 97MiB JSON parse, one process each | 1.01947× | 0.92605× |

All three clean Unit pairs regress at both cutoffs: cutoff 2 ratios 0.9363/0.9524/0.8044, cutoff 4 0.8062/0.9247/0.9854. Drain pair spread is large, so its aggregate improvement is not a reliable whole-battle forecast. The table timing predates mandatory locking, but packed confirmed no CPU work after 15:30:55 and primary/cadence held through the exact table window 15:31:31–15:31:46. It remains a single-process-per-variant observation.

Separate counting-allocator diagnostics, with no throughput claim:

| Component | Original allocations / live bytes | Cutoff 2 | Cutoff 4 |
| --- | ---: | ---: | ---: |
| Unit, 10,000 updates | 1,448,439 / 123,672,570 | 1,323,329 / 113,128,720 | 1,278,218 / 110,763,700 |
| Drain, 12,800 callbacks | 179,987 / 29,053,398 | 167,187 / 27,942,496 | 154,186 / 27,938,740 |
| Actual table parse | 15,237,533 / 977,922,953 | 15,069,408 / 963,776,175 | 14,643,357 / 957,602,659 |

Unit retained requested bytes fall 8.53% / 10.44%; table retained requested bytes fall only 1.45% / 2.08%. These probes do not reproduce battle GC cadence and do not establish a multiworker memory or BPS gain. The clean Unit regression prevents promoting either cutoff based on the earlier contended improvement. A further implementation change needs its own frozen variants and clean rerun.

Clean timing reports: `2026-10-30T15-35-36.887Z-lazy-small-index-unit-timing.json`, `2026-10-30T15-35-37.591Z-lazy-small-index-drain-timing.json`. Allocation reports are the corresponding `15-35-50.533Z` table and `15-36-56.121Z` Unit / `15-36-56.622Z` drain files. All report prefixes live in `benchmarks/results` with raw output, complete native audit and expected snapshots archived as hashed gzip artifacts. No battles/sec improvement is claimed.
