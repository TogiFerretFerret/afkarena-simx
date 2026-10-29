# One-multiply canonical ID hashing candidate

The existing integer hasher uses a SplitMix-style addition, two multiplications
and three XOR shifts. This candidate uses one multiplication by the odd constant
`0x9e3779b97f4a7c15`. Odd multiplication permutes the entire u64 domain; sequential
IDs spread across bucket indices and upper control fingerprints. The fallback
incremental byte-write algorithm remains unchanged. No fields are added.

This affects four internal lookup tables: ordered property indexes, mapped
arguments, environment bindings and the object-to-function index. Full key
equality remains authoritative. Object enumeration uses its ordered vector;
lexical cell and GC live-set behavior does not expose hash-table iteration.
Hash outputs are internal, so they need not match the previous policy.

Previous source history contains the original Sip-to-SplitMix change b5fff63;
no prior Fibonacci candidate was found. Tests cover 100,000 mixed insert/get/
replace/delete operations, extreme and strided keys, compound byte writes,
compound tuple equality and sequential fingerprint distribution. Strided IDs
can cluster more than SplitMix despite exact lookup outcomes; this policy is
measured against actual source components rather than inferred from instruction
count.

76 library tests and independent reflection 24, arguments 40 and closures 47
cases pass. Two existing Symbol-related arguments observations remain explicitly
unsupported. See `benchmarks/validation/rust-fibonacci-id-hash-gates.json`.

The quiet paired source component retains every Unit callback and selected raw
state-bit observation, plus all source copy calls/fresh outputs and exact-source
GC backedges. All 12 native processes exit zero with complete output and source/
binary hashes unchanged. Node checks pass for 180,000 Unit updates, 414,000 copy
calls and 414 collections. Both runtimes use the same generated JS source and
opt3/CGU64/LTO-off profile; property entries remain 48 bytes and Object remains
152 bytes in both.

| Component | Original | Fibonacci | Ratio |
| --- | ---: | ---: | ---: |
| Unit.update | 15,714 updates/sec | 15,955 updates/sec | 1.0153x |
| Source copyObj | 1.748M copies/sec | 2.057M copies/sec | 1.1770x |
| copyObj including GC | 1.643M copies/sec | 1.928M copies/sec | 1.1734x |

Unit pair ratios are 0.9926x, 1.1172x and 0.9371x: no repeatable Unit improvement
is established. Copy pair ratios are all positive (1.1124x, 1.3232x, 1.0972x).
These are component rates, not battles/sec. Copy intermediate outcomes are not
traced; final ordered raw bits match Node each trial. Keep the candidate separate
from the frozen main build until a full-workload trial supports promotion.

Evidence: `benchmarks/results/2026-10-29T00-13-08.122Z-rust-fibonacci-id-hash.json`
and its complete `.native-run-audit.json` companion. Full runtime snapshots,
generated original-source entries, harness and expected/actual output are
archived with hashes. Native processes run in the root-coordinated quiet window;
Node validation and compression follow from retained stdout.
