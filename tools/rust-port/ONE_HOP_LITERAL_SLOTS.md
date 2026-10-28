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

## Packed combined candidate: do not enable globally

`candidate-integration-metadata` packs key, physical index and weak owner IDs into three usize fields with usize::MAX sentinels. These IDs index non-zero-sized Vec elements, so a valid index cannot reach the sentinel. The resulting slot is 24 bytes, smaller than the original 32-byte own-only slot; Object remains 160 bytes. All 56 runtime library tests and 24 source cases pass, including the 23-collection weak-owner reuse test. Test output is archived at `benchmarks/validation/rust-packed-one-hop-library-tests.log.gz`.

The quiet combined-source rerun (`2026-10-28T22-37-30.603Z-rust-one-hop-buffs.json`) measures resetBuffApply 1.0934x and addBuff 1.0879x. However the unchanged original Unit.update fixture (`2026-10-28T22-37-05.186Z-rust-unit-update-one-hop-slots.json`) regresses to 0.9267x: 16,767 updates/sec with the one-hop switch off versus 15,538 on. All three on trials are slower (669.5/611.1/650.1ms versus respective off 601.5/595.7/592.1ms). Every trial's 150,220 ordered events and selected raw-bit state matches pinned Node.

Therefore globally enabling one-hop lookup is not recommended. The source component gains do not establish full-battle improvement. The runtime switch remains false. Packing alone is a separate candidate and its paired same-source evidence should be considered separately. A future candidate could restrict learning/probing to demonstrated useful source read sites while retaining all fresh semantic guards, but this candidate does not implement that restriction.

## Source-selective follow-up (awaiting timing)

`candidate-source-selective-prototype` limits optional prototype probing to read sites lexically contained by the exact SHA-256-pinned resetBuffApply/addBuff functions. Their nested callbacks qualify through the enclosing pinned source range. The compiler records that ancestor hash/range in every selected function's manifest. Names alone never authorize the hint; even whitespace changes to either pinned function remove its hints, and disabling sourceSpecializations removes all hints.

Selected sites use `LiteralReadSite::new_with_prototype_hint(..., true)` and the separately monomorphized hinted read entry. All other sites call the ordinary `<false>` entry: prototype probing and learning branches disappear under const-generic compilation regardless of the runtime switch. This avoids adding owner-miss work to unrelated Unit.update reads. The Unit benchmark asserts that no hinted calls exist in its generated fixture. Runtime metadata remains 24 bytes per cached site; heap objects remain unchanged.

The dedicated static-identity gate passes seven scenarios: exact Buff fixture (93 sites in four functions), specializations disabled (zero), exact reset (seven), changed reset (zero), exact add (86 across outer function and two callbacks), changed add (zero), and unrelated reads (zero). The 24-case runtime mutation suite explicitly instruments its test-only generated sites to invoke the guarded hinted entry; production compilation continues to require the source ancestry proof. All 56 library tests pass, including raw-bit preservation, virtual Array length and 23 actual collections with weak owner reuse. Evidence: `rust-source-selective-prototype.json`, `rust-generated-one-hop-slots.json`, and `rust-source-selective-prototype-library-tests.log.gz` under benchmarks/validation.

Both original-source component benchmark binaries are prepared. Timing is pending an exclusive CPU slot after the separate full simulator build. No source-component or full-battle improvement is claimed for this follow-up yet.
